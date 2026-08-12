/**
 * Der „Store“ des Verify-Bots – OHNE Datenbank.
 *
 * Die komplette Konfiguration jeder Regeln-Nachricht (Modus, Rollen,
 * Log-Kanal, Prüf-Modus, Formularfelder, Bild/Banner) steckt als
 * unsichtbarer Zero-Width-Blob IN der Nachricht selbst. Der Bot hält nur
 * eine flüchtige In-Memory-Registry (guildId → Nachrichten) und findet
 * seine Nachrichten jederzeit selbst wieder, indem er die Kanäle nach dem
 * Marker `vrf::v1::` durchsucht.
 *
 * Daraus folgt: Neustarts, Ausfälle und Registry-Verluste sind egal –
 * der Bot heilt sich selbst.
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');

const { parseRulesMessage, isRulesMessage } = require('./embed-builder');
const { MAX_RULES_MESSAGES } = require('./logic');

const SCAN_LIMIT = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function keyOf(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

function createStore({ client, logger }) {
  /** guildId -> Map<`${channelId}:${messageId}`, entry> */
  const registry = new Map();
  /** guildId -> Sprache (per /set_language) */
  const serverLang = new Map();
  /** Serialisiert Edits pro Nachricht. */
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
    serverLang.delete(guildId);
  }

  function countMessages(guildId) {
    return guildMap(guildId).size;
  }

  function hasCapacity(guildId) {
    return countMessages(guildId) < MAX_RULES_MESSAGES;
  }

  /** Gibt alle Verify-Modus-Nachrichten einer Gilde zurück. */
  function verifyMessages(guildId) {
    return list(guildId).filter((e) => e.mode === 'verify');
  }

  function withLock(key, fn) {
    const previous = locks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(() => fn());
    const chained = run.catch(() => {});
    locks.set(key, chained);
    chained.finally(() => {
      if (locks.get(key) === chained) locks.delete(key);
    });
    return run;
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

  /** Durchsucht eine Gilde nach allen Regeln-Nachrichten des Bots. */
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
        continue;
      }
      for (const message of messages.values()) {
        if (message.author?.id !== client.user?.id) continue;
        if (!isRulesMessage(message)) continue;
        found.push({ channel, message });
      }
      await sleep(120);
    }
    return found;
  }

  function entryFromMessage(guildId, channel, message) {
    const parsed = parseRulesMessage(message);
    if (!parsed) return null;
    return {
      guildId,
      channelId: channel.id,
      messageId: message.id,
      mode: parsed.mode,
      lang: parsed.lang,
      buttonName: parsed.buttonName,
      rules: parsed.rules,
      loggingChannelId: parsed.loggingChannelId,
      unverifiedRoleId: parsed.unverifiedRoleId,
      verifiedRoleId: parsed.verifiedRoleId,
      verifyForm: parsed.verifyForm,
      formFields: parsed.formFields,
      bannerUrl: parsed.bannerUrl,
      imageUrl: parsed.imageUrl,
      createdAt: message.createdTimestamp || Date.now(),
    };
  }

  async function scanGuilds() {
    for (const guild of client.guilds.cache.values()) {
      try {
        await scanGuild(guild);
      } catch (err) {
        logger.warn(`[verify-bot] Scan von „${guild.name}“ fehlgeschlagen:`, err.message);
      }
      await sleep(250);
    }
  }

  async function scanGuild(guild) {
    const found = await findMessages(guild);
    const map = guildMap(guild.id);
    for (const { channel, message } of found) {
      const entry = entryFromMessage(guild.id, channel, message);
      if (!entry) continue;
      map.set(keyOf(channel.id, message.id), entry);
    }
    if (found.length) {
      logger.info(`[verify-bot] „${guild.name}“: ${found.length} Regeln-Nachricht(en) gefunden.`);
    }
    return found.length;
  }

  /** Findet eine bestimmte Nachricht wieder – erst Registry, dann Suche. */
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

  /**
   * Löscht ALLE Regeln-Nachrichten einer Gilde – außer der angegebenen
   * neuen Nachricht (channelId:messageId). Rückgabe: Anzahl gelöschter
   * Nachrichten. Registry-Einträge werden mit entfernt.
   */
  async function deleteOldRules(guildId, except = {}) {
    const entries = list(guildId);
    let removed = 0;
    for (const entry of entries) {
      if (except?.channelId === entry.channelId && except?.messageId === entry.messageId) continue;
      const channel = await client.channels.fetch(entry.channelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        const msg = await channel.messages.fetch(entry.messageId).catch(() => null);
        if (msg) {
          await msg.delete().catch(() => {});
          removed += 1;
        }
      }
      remove(guildId, entry.channelId, entry.messageId);
    }
    return removed;
  }

  // -------------------------------------------------------------------------
  // Server-Sprache
  // -------------------------------------------------------------------------

  function getServerLang(guildId) {
    return serverLang.get(guildId) || null;
  }

  function setServerLang(guildId, lang) {
    serverLang.set(guildId, lang);
  }

  return {
    list,
    get,
    set,
    remove,
    deleteGuild,
    countMessages,
    hasCapacity,
    verifyMessages,
    entries: () => registry.entries(),
    guildIds: () => [...registry.keys()],
    findMessages,
    scanGuild,
    scanGuilds,
    resolveMessage,
    entryFromMessage,
    deleteOldRules,
    withLock,
    getServerLang,
    setServerLang,
    MAX_RULES_MESSAGES,
  };
}

module.exports = { createStore, keyOf, SCAN_LIMIT };
