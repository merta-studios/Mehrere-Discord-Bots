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
 * Mitgereist in der Liste:
 * - Events als „🚀 **Name**“-Zeilen (mit in die Monate einsortiert)
 * - die optionale Geburtstagsrollen-ID im Marker (bday::v1::<lang>:<roleId>)
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
  buildEventCongratsEmbed,
  encodeEventName,
  LIST_MARKER,
} = require('./embed-builder');
const { tzParts, todayKey, pad } = require('./logic');
const { tzOf } = require('./languages');
const { componentsV2Payload } = require('./message-payload');

const BIRTHDAY_ROLE_DURATION_MS = 24 * 60 * 60 * 1000; // Geburtstagsrolle: 24 Stunden
// Geburtstags-Grüße & Event-Posts bleiben 7 Tage unter der Liste stehen und
// werden danach samt aller Nachrichten darüber (bis zur Liste) gelöscht.
const POST_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
// Obergrenze: So viele Nachrichten unter der Liste werden pro Cleanup maximal
// durchsucht, damit das Aufräumen auf sehr aktiven Servern nicht explodiert.
const CLEANUP_SCAN_CAP = 2000;

// Emojis für Geburtstags-Glückwünsche – in zufälliger Reihenfolge als Reaktionen
const BIRTHDAY_REACTION_EMOJIS = ['🎉', '🎂', '🎊', '🎁', '🎈', '🥳'];

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Extrahiert alle Emojis aus einem Text (z. B. Event-Namen).
 * Behält Reihenfolge der ersten Vorkommen, dedupliziert, behält Variation Selectors.
 * Unterstützt: Extended_Pictographic mit Modifiers, ZWJ-Sequenzen, Flags.
 */
function extractEmojisFromText(text) {
  if (!text || typeof text !== 'string') return [];
  // Kombiniert pictographic + modifiers + ZWJ + Flags
  const regex = /(?:\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|\uFE0F|\uFE0E)?)*|\p{Regional_Indicator}{2})/gu;
  let matches = [];
  try {
    matches = [...text.matchAll(regex)].map((m) => m[0]);
  } catch {
    // Fallback für sehr alte Node-Versionen ohne Unicode Properties
    try {
      matches = [...text.matchAll(/\p{Emoji}/gu)].map((m) => m[0]);
    } catch {
      return [];
    }
  }
  // Deduplizieren (Discord erlaubt nur eine Reaktion pro Emoji pro Message)
  return [...new Set(matches)];
}

async function addReactionsInRandomOrder(message, emojis) {
  if (!message || !Array.isArray(emojis) || emojis.length === 0) return;
  const shuffled = shuffleArray(emojis);
  for (const emoji of shuffled) {
    try {
      await message.react(emoji);
    } catch {
      // Keine Rechte / Unknown Emoji / Rate-Limit – nicht kritisch
    }
  }
}

function createStore({ client, logger }) {
  const registry = new Map(); // guildId -> entry
  // Laufende 24h-Timer für vergebene Geburtstagsrollen: "guildId:userId" -> Timeout
  const roleTimers = new Map();

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
            events: parsed.events || [],
            birthdayRoleId: parsed.birthdayRoleId || null,
            lastRenderDay: null,
            lastBirthdayCheckDay: null,
          });
          logger.info(
            `[birthday-bot] Liste auf „${guild.name}“ gefunden (${parsed.birthdays.length} Geburtstage, ${(parsed.events || []).length} Events, Sprache ${parsed.lang}).`
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
   * Stand überschrieben. `applyEvents(events)` macht dasselbe für Events.
   */
  async function refresh(entry, apply, applyEvents) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return null;

    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    let msg = entry.messageId ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;

    let lang = entry.lang;
    let birthdays = entry.birthdays;
    let events = entry.events || [];

    if (msg) {
      const parsed = parseListEmbed(msg);
      if (parsed) {
        lang = parsed.lang;
        birthdays = parsed.birthdays;
        events = parsed.events || [];
        if (parsed.birthdayRoleId !== undefined) entry.birthdayRoleId = parsed.birthdayRoleId;
      }
    }

    if (typeof apply === 'function') birthdays = apply(birthdays);
    if (typeof applyEvents === 'function') events = applyEvents(events);

    birthdays = await filterMembers(guild, birthdays);
    // Deduplizieren: Nutzer nach userId+Tag+Monat, Events nach Name+Tag+Monat
    const seen = new Set();
    birthdays = birthdays.filter((b) => {
      const key = `${b.userId}:${b.month}:${b.day}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const seenEvents = new Set();
    events = events.filter((e) => {
      const key = `${String(e.name).toLowerCase()}:${e.month}:${e.day}`;
      if (seenEvents.has(key)) return false;
      seenEvents.add(key);
      return true;
    });

    const container = buildListEmbed({
      birthdays,
      events,
      lang,
      birthdayRoleId: entry.birthdayRoleId || null,
    });

    if (msg) {
      await msg.edit(componentsV2Payload([container], { embeds: [] })).catch(() => {});
    } else {
      msg = await channel.send(componentsV2Payload([container])).catch(() => null);
      if (!msg) return null;
      entry.messageId = msg.id;
    }

    entry.lang = lang;
    entry.birthdays = birthdays;
    entry.events = events;
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
   * Vergibt die Geburtstagsrolle (falls konfiguriert) für 24 Stunden an ein
   * Geburtstagskind. Der Abbaupfad ist doppelt abgesichert: ein 24h-Timer
   * (flüchtig) plus das stündliche cleanupBirthdayRoles (überlebt Restarts,
   * weil es anhand der Liste prüft, ob der heutige Tag noch der Geburtstag ist).
   */
  async function assignBirthdayRole(guild, member, entry) {
    const roleId = entry.birthdayRoleId;
    if (!roleId || !member) return;
    try {
      const role = guild.roles?.cache?.get(roleId) || (await guild.roles?.fetch(roleId).catch(() => null));
      if (!role) return; // Rolle wurde gelöscht
      if (member.roles?.cache?.has(roleId)) {
        scheduleRoleRemoval(guild, member.id, roleId); // Timer trotzdem frisch stellen
        return;
      }
      await member.roles.add(roleId, 'Geburtstagsrolle: 24 Stunden zum Geburtstag');
      logger.info(`[birthday-bot] Geburtstagsrolle an ${member.id} auf ${guild.name} vergeben (24h)`);
      scheduleRoleRemoval(guild, member.id, roleId);
    } catch (err) {
      logger.warn(`[birthday-bot] Geburtstagsrolle konnte nicht vergeben werden (fehlen Rechte „Rollen verwalten“?):`, err.message);
    }
  }

  function scheduleRoleRemoval(guild, userId, roleId, ms = BIRTHDAY_ROLE_DURATION_MS) {
    const key = `${guild.id}:${userId}`;
    const old = roleTimers.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
      roleTimers.delete(key);
      void (async () => {
        try {
          const member = await guild.members.fetch(userId).catch(() => null);
          if (member?.roles?.cache?.has(roleId)) {
            await member.roles.remove(roleId, 'Geburtstagsrolle: 24 Stunden vorbei').catch(() => {});
            logger.info(`[birthday-bot] Geburtstagsrolle von ${userId} nach 24h entfernt`);
          }
        } catch {}
      })();
    }, ms);
    if (timer.unref) timer.unref();
    roleTimers.set(key, timer);
  }

  /**
   * Stündliche Absicherung: Jeder, der die Geburtstagsrolle trägt, deren
   * Geburtstag aber NICHT heute ist, verliert sie wieder (self-healing,
   * auch nach Bot-Neustarts).
   */
  async function cleanupBirthdayRoles(entry) {
    const roleId = entry.birthdayRoleId;
    if (!roleId) return;
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return;
    const t = tzParts(tzOf(entry.lang));
    const todays = new Set(
      (entry.birthdays || [])
        .filter((b) => b.month === t.month && b.day === t.day)
        .map((b) => String(b.userId))
    );
    let members;
    try {
      members = await guild.members.fetch();
    } catch {
      return;
    }
    const role = guild.roles?.cache?.get(roleId) || (await guild.roles?.fetch(roleId).catch(() => null));
    if (!role) return; // Rolle gelöscht → nichts zu tun
    for (const member of members.values()) {
      if (!member.roles?.cache?.has(roleId)) continue;
      if (todays.has(String(member.id))) continue; // hat heute Geburtstag → Rolle bleibt
      await member.roles.remove(roleId, 'Geburtstag vorbei – Rolle zurückgenommen').catch(() => {});
      logger.info(`[birthday-bot] Geburtstagsrolle von ${member.id} (${guild.name}) entfernt (Geburtstag vorbei)`);
      const key = `${guild.id}:${member.id}`;
      if (roleTimers.has(key)) { clearTimeout(roleTimers.get(key)); roleTimers.delete(key); }
    }
  }

  /**
   * Täglicher Check um 0 Uhr: Wer hat heute Geburtstag? Welches Event ist heute?
   * Pro Geburtstagskind/Event wird genau EIN Container gesendet – Doppel-
   * sendungen werden über den Marker verhindert (der Bot schaut nach,
   * ob der Gruß für heute schon existiert).
   * Events landen danach NICHT wieder in der Liste wie Geburtstage, sondern
   * werden dort gelöscht.
   */
  async function birthdayCheck(entry) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return;

    const channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    const tz = tzOf(entry.lang);
    const t = tzParts(tz);
    const dateKey = `${t.year}-${pad(t.month)}-${pad(t.day)}`;

    const todays = (entry.birthdays || []).filter((b) => b.month === t.month && b.day === t.day);
    const todaysEvents = (entry.events || []).filter((e) => e.month === t.month && e.day === t.day);
    if (!todays.length && !todaysEvents.length) return;

    // Bereits gesendete Grüße/Event-Posts finden (nur die letzten 50 Nachrichten).
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => []);
    const recentArr = recent instanceof Map ? [...recent.values()] : [...recent];
    const wasSent = (marker) =>
      recentArr.some((m) =>
        JSON.stringify(m.components || []).includes(marker) ||
        JSON.stringify(m.embeds || []).includes(marker) ||
        (m.content || '').includes(marker)
      );

    for (const b of todays) {
      const marker = `bday-congrats:${dateKey}:${b.userId}`;
      if (wasSent(marker)) {
        // Gruß schon da (z.B. nach Restart) – Rolle aber sicherheitshalber setzen
        const member = await guild.members.fetch(b.userId).catch(() => null);
        if (member && entry.birthdayRoleId) await assignBirthdayRole(guild, member, entry);
        continue;
      }

      const member = await guild.members.fetch(b.userId).catch(() => null);
      if (!member) continue;

      const { container } = buildCongratsEmbed({ member, lang: entry.lang, dateKey });
      let sent = null;
      try {
        sent = await channel.send(componentsV2Payload([container]));
      } catch (err) {
        logger.warn(`[birthday-bot] Gruß für ${b.userId} konnte nicht gesendet werden:`, err.message);
        sent = null;
      }
      if (sent) {
        // Mit 🎉🎂🎊🎁🎈🥳 in zufälliger Reihenfolge reagieren
        await addReactionsInRandomOrder(sent, BIRTHDAY_REACTION_EMOJIS).catch(() => {});
      }
      // Geburtstagsrolle für 24 Stunden vergeben (falls beim /setup gewählt)
      if (entry.birthdayRoleId) await assignBirthdayRole(guild, member, entry);
    }

    // Events: ähnliche 0-Uhr-Nachricht (eigener Titel/Text/Button), danach
    // aus der Liste ENTFERNEN (Events rotieren nicht wie Geburtstage).
    let fired = 0;
    for (const ev of todaysEvents) {
      const marker = `bday-event:${dateKey}:${encodeEventName(ev.name)}`;
      if (!wasSent(marker)) {
        const { container } = buildEventCongratsEmbed({ name: ev.name, lang: entry.lang, dateKey });
        let sent = null;
        try {
          sent = await channel.send(componentsV2Payload([container]));
        } catch (err) {
          logger.warn(`[birthday-bot] Event-Post „${ev.name}“ konnte nicht gesendet werden:`, err.message);
          sent = null;
        }
        if (sent) {
          // Mit den Emojis aus dem Event-Namen reagieren (zufällige Reihenfolge), sonst nichts
          const emojis = extractEmojisFromText(ev.name);
          if (emojis.length) {
            await addReactionsInRandomOrder(sent, emojis).catch(() => {});
          }
        }
        fired++;
        logger.info(`[birthday-bot] Event „${ev.name}“ auf ${guild.name} gefeuert`);
      }
    }
    if (todaysEvents.length) {
      // Fällige Events aus der Liste löschen (nicht ans Listen-Ende rotieren)
      await refresh(entry, null, (events) =>
        events.filter((e) => !(e.month === t.month && e.day === t.day))
      );
    }
  }

  /**
   * Die neue 7-Tage-Aufräumregel:
   *
   * Geburtstags-Grüße & Event-Posts (erkennbar an ihren Markern) bleiben
   * insgesamt 7 Tage unter der Liste stehen. Ist ein Post älter als 7 Tage,
   * wird er gelöscht – und zwar zusammen mit ALLEN Nachrichten, die darüber
   * (zwischen ihm und der Liste) liegen. Danach ist der Bereich direkt unter
   * der Liste wieder sauber, ohne dass frische Posts vorzeitig verschwinden.
   *
   * Läuft stündlich über den Scheduler (plus beim ersten Tick nach dem Start).
   */
  async function cleanupExpired(entry) {
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) return { deleted: 0, scanned: 0, hitCap: false };

    let channel = await client.channels.fetch(entry.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return { deleted: 0, scanned: 0, hitCap: false };

    // Listen-Nachricht holen – falls die gespeicherte ID veraltet ist,
    // über den Marker selbst wiederfinden (Self-Healing).
    let listMsg = entry.messageId ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;
    if (!listMsg) {
      const found = await findListMessage(guild);
      if (!found) return { deleted: 0, scanned: 0, hitCap: false };
      channel = found.channel;
      listMsg = found.message;
      entry.channelId = channel.id;
      entry.messageId = listMsg.id;
    }

    const listTs = listMsg.createdTimestamp;
    const now = Date.now();

    // Nachrichten unter der Liste in Batches einsammeln (neueste zuerst),
    // bis die Liste selbst erreicht ist oder der Scan-Cap greift.
    const fetched = [];
    let before = undefined;
    let hitCap = false;
    while (fetched.length < CLEANUP_SCAN_CAP) {
      let batch;
      try {
        batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      } catch {
        break; // z. B. Rate-Limit – nächstes Mal weiter
      }
      if (!batch.size) break;
      const arr = [...batch.values()];
      fetched.push(...arr);
      if (arr.some((m) => m.id === entry.messageId)) break; // Liste erreicht
      before = arr[arr.length - 1].id; // älteste der Batch als Cursor
      if (fetched.length >= CLEANUP_SCAN_CAP) hitCap = true;
      await sleep(150); // höflich zur API
    }

    // Nur Nachrichten UNTER der Liste (neuer als die Liste), chronologisch
    const below = fetched
      .filter((m) => m.id !== entry.messageId && m.createdTimestamp > listTs)
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Abgelaufene Posts: eigene Geburtstags-Grüße / Event-Posts, älter als 7 Tage.
    const isPost = (m) => {
      const s = JSON.stringify(m.components || []);
      return s.includes('bday-congrats:') || s.includes('bday-event:') || (m.content || '').includes('bday-congrats:') || (m.content || '').includes('bday-event:');
    };
    const expired = below.filter((m) => isPost(m) && m.createdTimestamp + POST_LIFETIME_MS <= now);
    if (!expired.length) return { deleted: 0, scanned: below.length, hitCap };

    // Für jeden abgelaufenen Post (ältester zuerst): erst alle Nachrichten
    // darüber bis zur Liste löschen, dann den Post selbst.
    const deletedIds = new Set();
    let deleted = 0;
    for (const post of expired) {
      const between = below
        .filter((m) => !deletedIds.has(m.id) && m.createdTimestamp > listTs && m.createdTimestamp < post.createdTimestamp)
        .map((m) => m.id);
      const targets = [...between, post.id];
      for (const id of targets) {
        await deleteMessageSafely(channel, id);
        deletedIds.add(id);
        deleted += 1;
      }
    }

    if (deleted > 0) {
      logger.info(`[birthday-bot] 7-Tage-Cleanup auf „${guild.name}“: ${deleted} Nachricht(en) gelöscht (${expired.length} abgelaufene Posts).`);
    }
    return { deleted, scanned: below.length, hitCap };
  }

  /** Löscht Nachrichten robust: Bulk wo möglich (unter 14 Tagen), sonst einzeln, mit Rate-Limit-Retry. */
  async function deleteMessageSafely(channel, id) {
    // Bulk-Delete nur für Nachrichten unter 14 Tagen – unsere Ziele sind
    // höchstens ~7 Tage alt, aber Nachrichten zwischen Liste und altem Post
    // können älter sein. filterOld=true entfernt zu alte aus dem Bulk.
    try {
      const done = await channel.bulkDelete([id], true);
      if (done && done.size) return;
    } catch (err) {
      if (err?.status === 403) return; // keine Manage-Messages-Rechte → aufgeben
      // 429/5xx: unten einzeln mit Retry versuchen
    }
    // Einzeln löschen (funktioniert auch für >14 Tage), mit 429-Retry
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const m = await channel.messages.fetch(id).catch(() => null);
        if (m) await m.delete();
        return;
      } catch (err) {
        if (err?.status === 429) {
          const wait = (err.retryAfter ?? err.rateLimit?.retryAfter ?? 1) * 1000 + 250;
          await sleep(Math.min(wait, 10_000));
          continue;
        }
        if (err?.status === 403) return;
        if (err?.code === 10008 || err?.code === 10005) return; // schon weg
        await sleep(300 * (attempt + 1));
      }
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
    cleanupExpired,
    assignBirthdayRole,
    cleanupBirthdayRoles,
    BIRTHDAY_ROLE_DURATION_MS,
    POST_LIFETIME_MS,
    // Exposed for testing
    _extractEmojis: extractEmojisFromText,
    _shuffle: shuffleArray,
    _BIRTHDAY_REACTION_EMOJIS: BIRTHDAY_REACTION_EMOJIS,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { createStore };
