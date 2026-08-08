/**
 * Der „Store“ des Geburtstags-Bots – OHNE Datenbank.
 *
 * Idee: Die Geburtstagsliste steckt komplett im Embed (Felder + Footer).
 * Der Bot hält nur eine flüchtige In-Memory-Registry (guildId → wo ist
 * meine Liste?), findet seine Nachrichten aber jederzeit selbst, indem
 * er Channels nach dem Marker „bday::v1::…“ durchsucht.
 *
 * Beim stündlichen Refresh wird das Embed NEU AUSGELESEN, Nutzer, die
 * den Server verlassen haben, werden entfernt, und das Embed wird
 * frisch gebaut (aktueller Monat zuerst).
 */

const { ChannelType } = require('discord.js');

const {
  buildListEmbed,
  listActionRow,
  parseListEmbed,
  buildCongratsEmbed,
  LIST_MARKER,
} = require('./embed-builder');
const { tzParts, todayKey, pad } = require('./logic');
const { tzOf } = require('./languages');

function createStore({ client, logger }) {
  const registry = new Map(); // guildId -> entry

  /**
   * Durchsucht alle sichtbaren Textchannels einer Gilde nach der
   * eigenen Geburtstagsliste (Marker im Footer).
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
            m.embeds?.[0] &&
            (m.embeds[0].footer?.text || '').includes(LIST_MARKER)
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
   * 1. Eigenes Embed holen (oder neu senden, falls gelöscht)
   * 2. Einträge NEU auslesen (Self-Healing, keine Datenbank)
   * 3. Nutzer rausfiltern, die den Server verlassen haben
   * 4. Embed frisch bauen (aktueller Monat zuerst) und editieren
   *
   * `apply(birthdays)` ist optional: Damit können Änderungen (z. B. ein
   * neuer Eintrag) direkt auf den frisch ausgelesenen Stand angewendet
   * werden, bevor neu gebaut wird – sonst würden sie vom alten
   * Embed-Inhalt überschrieben.
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

    const embed = buildListEmbed({ birthdays, lang });
    const components = [listActionRow(lang)];

    if (msg) {
      await msg.edit({ embeds: [embed], components }).catch(() => {});
    } else {
      msg = await channel.send({ embeds: [embed], components }).catch(() => null);
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
   * Pro Geburtstagskind wird genau EIN Gruß-Embed gesendet – Doppel-
   * sendungen werden über den Marker im Footer verhindert (der Bot
   * schaut nach, ob der Gruß für heute schon existiert).
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
      const alreadySent = recentArr.some(
        (m) => (m.embeds?.[0]?.footer?.text || '').includes(marker)
      );
      if (alreadySent) continue;

      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (!member) continue;

      const { embed, row } = buildCongratsEmbed({ member, lang: entry.lang, dateKey });
      await channel.send({ embeds: [embed], components: [row] }).catch((err) => {
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
