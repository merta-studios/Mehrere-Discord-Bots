/**
 * Der „Store“ des Self-Roles-Bots – OHNE Datenbank.
 *
 * Die komplette Konfiguration jeder Self-Roles-Nachricht (Titel,
 * Beschreibung, Sprache, Auswahl-Modus, Rollen + Platzhalter) steckt als
 * unsichtbarer Zero-Width-Blob IN der Nachricht selbst. Der Bot hält nur
 * eine flüchtige In-Memory-Registry (guildId → Nachrichten) und findet
 * seine Nachrichten jederzeit selbst wieder, indem er die Kanäle nach dem
 * Marker `srl::v1::` bzw. den Buttons `srl_role_<id>` durchsucht.
 *
 * Daraus folgt: Neustarts, Ausfälle und Registry-Verluste sind egal –
 * der Bot heilt sich selbst (scanGuilds + Recovery beim Button-Klick).
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const {
  parseSelfRoleMessage,
  isSelfRoleMessage,
  buildSelfRoleContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { MAX_MESSAGES, normalizeMode } = require('./logic');

/** Wie viele Nachrichten pro Kanal beim Scan durchsucht werden. */
const SCAN_LIMIT = 50;
/** Mitglieder-Cache: so lange gilt ein kompletter members.fetch() als frisch. */
const MEMBER_CACHE_TTL_MS = 5 * 60 * 1000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function keyOf(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

function createStore({ client, logger }) {
  /** guildId -> Map<`${channelId}:${messageId}`, entry> */
  const registry = new Map();
  /** guildId -> timestamp des letzten vollständigen members.fetch() */
  const memberFetchAt = new Map();
  /** Serialisiert Refreshes pro Nachricht (verhindert Race-Conditions). */
  const locks = new Map();

  function guildMap(guildId) {
    if (!registry.has(guildId)) registry.set(guildId, new Map());
    return registry.get(guildId);
  }

  function list(guildId) {
    return [...guildMap(guildId).values()];
  }

  function get(guildId, channelId, messageId) {
    return guildMap(guildId).get(keyOf(channelId, messageId)) || null;
  }

  function set(entry) {
    if (!entry?.guildId || !entry?.channelId || !entry?.messageId) return null;
    guildMap(entry.guildId).set(keyOf(entry.channelId, entry.messageId), entry);
    return entry;
  }

  function remove(guildId, channelId, messageId) {
    return guildMap(guildId).delete(keyOf(channelId, messageId));
  }

  function deleteGuild(guildId) {
    registry.delete(guildId);
    memberFetchAt.delete(guildId);
  }

  function countMessages(guildId) {
    return guildMap(guildId).size;
  }

  function totalRoles(guildId) {
    return list(guildId).reduce((sum, e) => sum + (e.roles?.length || 0), 0);
  }

  /**
   * Führt `fn` pro Nachricht seriell aus (kein paralleles Editieren).
   * Damit können sich gleichzeitige Klicks nicht gegenseitig überholen und
   * veraltete Zähler zurückschreiben.
   */
  function withLock(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => fn());
    // Kette weiterführen, Fehler dürfen die Kette nicht sprengen
    const chained = run.catch(() => {});
    locks.set(key, chained);
    chained.finally(() => {
      if (locks.get(key) === chained) locks.delete(key);
    });
    return run;
  }

  // -------------------------------------------------------------------------
  // Mitglieder & Zähler
  // -------------------------------------------------------------------------

  /**
   * Sorgt dafür, dass der Mitglieder-Cache halbwegs frisch ist. Ohne den
   * GuildMembers-Intent (oder bei großen Servern) kann das fehlschlagen –
   * dann zählen wir eben mit dem, was im Cache liegt.
   */
  async function ensureMembers(guild, { force = false } = {}) {
    if (!guild) return false;
    const last = memberFetchAt.get(guild.id) || 0;
    if (!force && Date.now() - last < MEMBER_CACHE_TTL_MS) return true;
    try {
      await guild.members.fetch();
      memberFetchAt.set(guild.id, Date.now());
      return true;
    } catch (err) {
      logger.warn(
        `[self-roles-bot] Mitglieder von „${guild.name}“ nicht ladbar (${err.message}) – zähle mit Cache.`
      );
      // Trotzdem Zeitstempel setzen, damit wir nicht in einer Fetch-Schleife hängen
      memberFetchAt.set(guild.id, Date.now());
      return false;
    }
  }

  /** Zählt, wie viele Mitglieder eine Rolle tragen (0 wenn Rolle weg ist). */
  function countRoleMembers(guild, roleId) {
    const role = guild?.roles?.cache?.get(roleId);
    if (!role) return null; // null = Rolle existiert nicht (mehr)
    return role.members?.size ?? 0;
  }

  // -------------------------------------------------------------------------
  // Nachrichten finden (Self-Healing)
  // -------------------------------------------------------------------------

  function textChannelsOf(guild) {
    const types = new Set([
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.PublicThread,
      ChannelType.PrivateThread,
      ChannelType.AnnouncementThread,
    ]);
    return [...guild.channels.cache.values()].filter((c) => types.has(c.type));
  }

  /** Durchsucht eine Gilde nach allen Self-Roles-Nachrichten des Bots. */
  async function findMessages(guild, { limitPerChannel = SCAN_LIMIT } = {}) {
    const found = [];
    let channels;
    try {
      channels = await guild.channels.fetch().then((c) => [...c.values()].filter(Boolean));
    } catch {
      channels = textChannelsOf(guild);
    }

    for (const channel of channels) {
      if (!channel?.isTextBased?.() || !channel.viewable) continue;
      const me = guild.members?.me;
      if (me && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ViewChannel) === false) continue;

      let messages;
      try {
        messages = await channel.messages.fetch({ limit: limitPerChannel });
      } catch {
        continue; // keine Rechte / Rate-Limit → nächster Kanal
      }
      for (const message of messages.values()) {
        if (message.author?.id !== client.user?.id) continue;
        if (!isSelfRoleMessage(message)) continue;
        found.push({ channel, message });
      }
      await sleep(120); // höflich zur API
    }
    return found;
  }

  /** Baut aus einer gefundenen Nachricht einen Registry-Eintrag. */
  function entryFromMessage(guildId, channel, message) {
    const parsed = parseSelfRoleMessage(message);
    if (!parsed) return null;
    return {
      guildId,
      channelId: channel.id,
      messageId: message.id,
      lang: parsed.lang || 'en',
      mode: normalizeMode(parsed.mode),
      title: parsed.title || '',
      description: parsed.description || '',
      roles: (parsed.roles || []).map((r) => ({ roleId: r.roleId, label: r.label })),
      createdAt: message.createdTimestamp || Date.now(),
    };
  }

  /** Beim Start: alle Gilden nach bestehenden Nachrichten absuchen. */
  async function scanGuilds() {
    for (const guild of client.guilds.cache.values()) {
      try {
        await scanGuild(guild);
      } catch (err) {
        logger.warn(`[self-roles-bot] Scan von „${guild.name}“ fehlgeschlagen:`, err.message);
      }
      await sleep(250);
    }
  }

  async function scanGuild(guild) {
    const found = await findMessages(guild);
    const map = guildMap(guild.id);
    for (const { channel, message } of found) {
      const entry = entryFromMessage(guild.id, channel, message);
      if (!entry || !entry.roles.length) continue;
      map.set(keyOf(channel.id, message.id), entry);
    }
    if (found.length) {
      logger.info(
        `[self-roles-bot] „${guild.name}“: ${found.length} Self-Roles-Nachricht(en) gefunden (${totalRoles(guild.id)} Rollen).`
      );
    }
    return found.length;
  }

  /**
   * Findet eine bestimmte Nachricht wieder – erst über den Registry-Eintrag,
   * dann per Suche. Gibt { channel, message, entry } oder null zurück.
   */
  async function resolveMessage(guild, channelId, messageId) {
    if (!guild) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (message) {
        const entry = get(guild.id, channelId, messageId) || entryFromMessage(guild.id, channel, message);
        if (entry) set(entry);
        return { channel, message, entry };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Refresh: Zähler & Layout aktualisieren
  // -------------------------------------------------------------------------

  /**
   * Liest eine Nachricht neu ein, zählt die Rollen-Mitglieder frisch,
   * entfernt gelöschte Rollen und schreibt den Container zurück.
   *
   * Optionen:
   *   force        – auch schreiben, wenn sich nichts geändert hat
   *   ensureFresh  – vorher members.fetch() erzwingen
   */
  async function refreshEntry(entry, { force = false, ensureFresh = false } = {}) {
    if (!entry) return null;
    const lockKey = keyOf(entry.channelId, entry.messageId);

    return withLock(lockKey, async () => {
      const guild = client.guilds.cache.get(entry.guildId);
      if (!guild) {
        deleteGuild(entry.guildId);
        return null;
      }

      const channel = await client.channels.fetch(entry.channelId).catch(() => null);
      if (!channel?.isTextBased?.()) {
        remove(entry.guildId, entry.channelId, entry.messageId);
        return null;
      }

      const message = await channel.messages.fetch(entry.messageId).catch(() => null);
      if (!message) {
        // Nachricht gelöscht → aus der Registry werfen (kein Drama)
        remove(entry.guildId, entry.channelId, entry.messageId);
        logger.info(`[self-roles-bot] Nachricht ${entry.messageId} ist weg – aus der Registry entfernt.`);
        return null;
      }

      // Konfiguration IMMER frisch aus der Nachricht lesen (Self-Healing)
      const parsed = parseSelfRoleMessage(message);
      if (parsed && parsed.roles.length) {
        entry.lang = parsed.lang || entry.lang;
        entry.mode = normalizeMode(parsed.mode || entry.mode);
        entry.title = parsed.title || entry.title;
        entry.description = parsed.description || entry.description;
        entry.roles = parsed.roles.map((r) => ({ roleId: r.roleId, label: r.label }));
      }

      await ensureMembers(guild, { force: ensureFresh });
      await guild.roles.fetch().catch(() => {});

      const liveRoles = [];
      let rolesVanished = 0;
      for (const r of entry.roles) {
        const count = countRoleMembers(guild, r.roleId);
        if (count === null) {
          rolesVanished += 1; // Rolle gelöscht → aus der Nachricht nehmen
          continue;
        }
        liveRoles.push({ ...r, count });
      }

      if (!liveRoles.length) {
        // Alle Rollen weg → Nachricht ist sinnlos, Registry-Eintrag löschen.
        remove(entry.guildId, entry.channelId, entry.messageId);
        logger.warn(
          `[self-roles-bot] Alle Rollen der Nachricht ${entry.messageId} auf „${guild.name}“ sind gelöscht – Eintrag entfernt.`
        );
        return null;
      }

      entry.roles = liveRoles.map((r) => ({ roleId: r.roleId, label: r.label }));

      const signature = JSON.stringify({
        t: entry.title,
        d: entry.description,
        m: entry.mode,
        l: entry.lang,
        r: liveRoles.map((r) => [r.roleId, r.label, r.count]),
      });
      if (!force && entry.signature === signature) return message; // nichts zu tun

      const container = buildSelfRoleContainer({
        title: entry.title,
        description: entry.description,
        roles: liveRoles,
        lang: entry.lang,
        mode: entry.mode,
      });

      try {
        await message.edit(componentsV2Payload([container]));
        entry.signature = signature;
        entry.lastRefresh = Date.now();
        if (rolesVanished) {
          logger.info(
            `[self-roles-bot] ${rolesVanished} gelöschte Rolle(n) aus Nachricht ${entry.messageId} entfernt.`
          );
        }
      } catch (err) {
        // 10008 Unknown Message / 50001 Missing Access → Eintrag verwerfen
        if (err?.code === 10008 || err?.code === 50001) {
          remove(entry.guildId, entry.channelId, entry.messageId);
        } else {
          logger.warn(`[self-roles-bot] Update der Nachricht ${entry.messageId} fehlgeschlagen:`, err.message);
        }
        return null;
      }

      set(entry);
      return message;
    });
  }

  /** Alle Nachrichten einer Gilde aktualisieren. */
  async function refreshGuild(guildId, options = {}) {
    for (const entry of list(guildId)) {
      await refreshEntry(entry, options).catch(() => {});
      await sleep(120);
    }
  }

  /** Alle bekannten Nachrichten aller Gilden aktualisieren. */
  async function refreshAll(options = {}) {
    for (const guildId of [...registry.keys()]) {
      if (!client.guilds.cache.has(guildId)) {
        deleteGuild(guildId);
        continue;
      }
      await refreshGuild(guildId, options);
    }
  }

  /**
   * Aktualisiert alle Nachrichten einer Gilde, die eine bestimmte Rolle
   * enthalten – z. B. wenn ein Admin die Rolle manuell vergibt/entzieht.
   */
  async function refreshForRole(guildId, roleId, options = {}) {
    const affected = list(guildId).filter((e) => e.roles?.some((r) => r.roleId === roleId));
    for (const entry of affected) {
      await refreshEntry(entry, options).catch(() => {});
    }
    return affected.length;
  }

  /** Kapazitätscheck: max. 10 Self-Roles-Nachrichten pro Server. */
  function hasCapacity(guildId) {
    return countMessages(guildId) < MAX_MESSAGES;
  }

  return {
    // Registry
    list,
    get,
    set,
    remove,
    deleteGuild,
    countMessages,
    totalRoles,
    hasCapacity,
    entries: () => registry.entries(),
    guildIds: () => [...registry.keys()],
    // Suche & Recovery
    findMessages,
    scanGuild,
    scanGuilds,
    resolveMessage,
    entryFromMessage,
    // Aktualisierung
    ensureMembers,
    countRoleMembers,
    refreshEntry,
    refreshGuild,
    refreshAll,
    refreshForRole,
    withLock,
    MAX_MESSAGES,
  };
}

module.exports = { createStore, keyOf, MEMBER_CACHE_TTL_MS, SCAN_LIMIT };
