/**
 * Der „Store“ des Geburtstags-Bots – OHNE Datenbank.
 *
 * Idee: Die Geburtstagsliste steckt komplett in den Komponenten selbst
 * (Container mit TextDisplay, Trennlinien und Buttons).
 * Der Bot hält nur eine flüchtige In-Memory-Registry (guildId → wo ist
 * meine Liste?), findet seine Nachrichten aber jederzeit selbst, indem
 * er Channels nach dem Marker „bday::v1::…“ oder dem Button „bday_add“
 * durchsucht.
 *
 * Beim stündlichen Refresh wird die Nachricht NEU AUSGELESEN, Nutzer, die
 * den Server verlassen haben, werden entfernt, und der Container wird
 * frisch gebaut (aktueller Monat zuerst).
 */

const { ChannelType } = require('discord.js');

const {
  buildListEmbed,
  parseListEmbed,
  buildCongratsEmbed,
  LIST_MARKER,
} = require('./embed-builder');
const { tzParts, todayKey, pad } = require('./logic');
const { tzOf } = require('./languages');
const { componentsV2Payload } = require('./message-payload');

function createStore({ client, logger }) {
  const registry = new Map(); // guildId -> entry

  /**
   * Durchsucht alle sichtbaren Textchannels einer Gilde nach der
   * eigenen Geburtstagsliste (Marker oder Button in Komponenten/Embeds).
   * Rückgabe: { channel, message } oder null.
   */
  async function findListMessage(guild) {
    let channels;
    try {
      channels = await guild.channels.fetch();
    } catch {
      return null;
    }

    for (const channel of channels.filter(
      (c) => c.type === ChannelType.GuildText && c.viewable
    ).values()) {
      try {
        const messages = await channel.messages.fetch({ limit: 30 });
        const found = messages.find(
          (m) =>
            m.author?.id === client.user.id &&
            (
              JSON.stringify(m.components || []).includes('bday::v1::') ||
              JSON.stringify(m.components || []).includes('bday_add') ||
              (m.embeds?.[0]?.footer?.text || '').includes(LIST_MARKER) ||
              (m.embeds?.[0]?.description || '').includes(LIST_MARKER)
            )
        );
        if (found) return { channel, message: found };
      } catch {
        /* Channel ohne Zugriff o. Ä. überspringen */
      }
    }
    return null;
  }

  /** Scannt beim Start alle Gilden nach bestehenden Listen. */
  async function scanGuilds() {
    for (const guild of client.guilds.cache.values()) {
      if (registry.has(guild.id)) continue;
      try {
        const found = await findListMessage(guild);
        if (found) {
          const parsed = parseListEmbed(found.message);
          registry.set(guild.id, {
            guildId: guild.id,
            channelId: found.channel.id,
            messageId: found.message.id,
            lang: parsed.lang,
            birthdays: parsed.birthdays,
            lastRenderDay: null,
            lastBirthdayCheckDay: null,
          });
          logger.info(
            `[birthday-bot] Liste auf „${guild.name}“ gefunden (${parsed.birthdays.length} Geburtstage, Sprache ${parsed.lang}).`
          );
        }
      } catch {
        /* einzelne Gilde überspringen */
      }
      await sleep(250); // höflich zur API
    }
  }

  /**
   * Stündlicher/täglicher Refresh:
   * 1. Eigene Nachricht holen (oder neu senden, falls gelöscht)
   * 2. Einträge NEU auslesen (Self-Healing, keine Datenbank)
   * 3. Nutzer rausfiltern, die den Server verlassen haben
   * 4. Container frisch bauen (aktueller Monat zuerst) und editieren
   *
   * `apply(birthdays)` ist optional: Damit können Änderungen (z. B. ein
   * neuer Eintrag) direkt auf den frisch ausgelesenen Stand angewendet
   * werden, bevor neu gebaut wird – sonst würden sie vom alten
   * Stand überschrieben.
   */
  async function refresh(entry, apply) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return null;

    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    let msg = entry.messageId ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;

    let lang = entry.lang;
    let birthdays = entry.birthdays;

    if (msg) {
      const parsed = parseListEmbed(msg);
      if (parsed) {
        lang = parsed.lang;
        birthdays = parsed.birthdays;
      }
    }

    if (typeof apply === 'function') birthdays = apply(birthdays);

    birthdays = await filterMembers(guild, birthdays);
  // Deduplizieren nach userId + Tag + Monat
  const seen = new Set();
  birthdays = birthdays.filter((b) => {
    const key = `${b.userId}:${b.month}:${b.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

    const container = buildListEmbed({ birthdays, lang });

    if (msg) {
      await msg.edit(componentsV2Payload([container], { embeds: [] })).catch(() => {});
    } else {
      msg = await channel.send(componentsV2Payload([container])).catch(() => null);
      if (!msg) return null;
      entry.messageId = msg.id;
    }

    entry.lang = lang;
    entry.birthdays = birthdays;
    entry.lastRenderDay = todayKey(lang);
    return msg;
  }

  /** Entfernt Einträge von Nutzern, die nicht mehr in der Gilde sind. */
  async function filterMembers(guild, birthdays) {
    const out = [];
    for (const b of birthdays) {
      let present = guild.members.cache.has(b.userId);
      if (!present) {
        try {
          await guild.members.fetch(b.userId);
          present = true;
        } catch (err) {
          // 10007 = Unknown Member → Nutzer ist weg. Alles andere: lieber behalten.
          present = err?.code !== 10007;
        }
      }
      if (present) out.push(b);
    }
    return out;
  }

  /**
   * Täglicher Check um 0 Uhr: Wer hat heute Geburtstag?
   * Pro Geburtstagskind wird genau EIN Gruß-Container gesendet – Doppel-
   * sendungen werden über den Marker verhindert (der Bot schaut nach,
   * ob der Gruß für heute schon existiert).
   */
  async function birthdayCheck(entry) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return;

    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const tz = tzOf(entry.lang);
    const t = tzParts(tz);
    const dateKey = `${t.year}-${pad(t.month)}-${pad(t.day)}`;

    const todays = entry.birthdays.filter((b) => b.month === t.month && b.day === t.day);
    if (!todays.length) return;

    // Bereits gesendete Grüße finden (nur die letzten 50 Nachrichten).
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => []);
    const recentArr = recent instanceof Map ? [...recent.values()] : [...recent];

    for (const b of todays) {
      const marker = `bday-congrats:${dateKey}:${b.userId}`;
      const alreadySent = recentArr.some((m) =>
        JSON.stringify(m.components || []).includes(marker) ||
        JSON.stringify(m.embeds || []).includes(marker) ||
        (m.content || '').includes(marker)
      );
      if (alreadySent) continue;

      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (!member) continue;

      const { container } = buildCongratsEmbed({ member, lang: entry.lang, dateKey });
      await channel.send(componentsV2Payload([container])).catch((err) => {
        logger.warn(`[birthday-bot] Gruß für ${b.userId} konnte nicht gesendet werden:`, err.message);
      });
    }
  }

  return {
    get: (guildId) => registry.get(guildId),
    set: (entry) => registry.set(entry.guildId, entry),
    delete: (guildId) => registry.delete(guildId),
    entries: () => registry.entries(),
    findListMessage,
    scanGuilds,
    refresh,
    birthdayCheck,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { createStore };
