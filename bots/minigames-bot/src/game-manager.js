/**
 * Recovery und Ablaufsteuerung für Minigame-Nachrichten.
 * Die Registry ist nur ein Cache; bei jedem Klick wird der Marker neu gelesen.
 */

const { PermissionFlagsBits } = require('discord.js');
const { parseGameMessage, parseLanguageMessage, buildGamePayload } = require('./embed-builder');
const { parseCountingTopic } = require('./counting');
const {
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_EXPIRED,
  expireChallenge,
} = require('./games');

const SCAN_LIMIT = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGameManager(ctx) {
  const timers = new Map();

  function keyOf(guildId, channelId, messageId) {
    return `${guildId}:${channelId}:${messageId}`;
  }

  function clearTimer(guildId, channelId, messageId) {
    const key = keyOf(guildId, channelId, messageId);
    const timer = timers.get(key);
    if (timer) clearTimeout(timer);
    timers.delete(key);
  }

  function untrack(guildId, channelId, messageId) {
    clearTimer(guildId, channelId, messageId);
    ctx.store.removeGame(guildId, channelId, messageId);
  }

  function track(message, state) {
    const guildId = message.guildId || message.guild?.id;
    const channelId = message.channelId || message.channel?.id;
    if (!guildId || !channelId || !message.id) return;

    clearTimer(guildId, channelId, message.id);
    if (![STATUS_PENDING, STATUS_ACTIVE].includes(state.status)) {
      ctx.store.removeGame(guildId, channelId, message.id);
      return;
    }

    ctx.store.setGame({ guildId, channelId, messageId: message.id, message, state });
    if (state.status !== STATUS_PENDING) return;

    const delay = Math.max(0, Number(state.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      void expireEntry({ guildId, channelId, messageId: message.id, message, state }).catch((err) => {
        ctx.logger.warn('[minigames-bot] Herausforderung konnte nicht ablaufen:', err.message);
      });
    }, Math.min(delay, 2_147_000_000));
    timer.unref?.();
    timers.set(keyOf(guildId, channelId, message.id), timer);
  }

  async function fetchMessage(entry) {
    const channel =
      entry.message?.channel ||
      (await ctx.client.channels.fetch(entry.channelId).catch(() => null));
    if (!channel?.isTextBased?.()) return null;
    if (!channel.messages?.fetch) return entry.message || null;
    return (await channel.messages.fetch(entry.messageId).catch(() => null)) || entry.message || null;
  }

  async function expireEntry(entry, now = Date.now()) {
    const lockKey = keyOf(entry.guildId, entry.channelId, entry.messageId);
    return ctx.store.withLock(lockKey, async () => {
      clearTimer(entry.guildId, entry.channelId, entry.messageId);
      const message = await fetchMessage(entry);
      if (!message) {
        untrack(entry.guildId, entry.channelId, entry.messageId);
        return false;
      }

      const current = parseGameMessage(message) || entry.state;
      if (current.status !== STATUS_PENDING) {
        track(message, current);
        return false;
      }
      if (Number(now) < current.expiresAt) {
        track(message, current);
        return false;
      }

      const expired = expireChallenge(current, now);
      await message.edit(buildGamePayload(expired)).catch((err) => {
        ctx.logger.warn('[minigames-bot] Abgelaufene Anfrage konnte nicht editiert werden:', err.message);
      });
      untrack(entry.guildId, entry.channelId, entry.messageId);
      return true;
    });
  }

  async function expireDue(now = Date.now()) {
    const due = ctx.store
      .allGames()
      .filter((entry) => entry.state?.status === STATUS_PENDING && Number(entry.state.expiresAt) <= Number(now));
    for (const entry of due) await expireEntry(entry, now);
  }

  async function scanGuild(guild) {
    let channels;
    try {
      const fetched = await guild.channels.fetch();
      channels = [...fetched.values()].filter(Boolean);
    } catch {
      channels = [...(guild.channels?.cache?.values?.() || [])];
    }

    let gamesFound = 0;
    let newestLanguage = null;
    for (const channel of channels) {
      // Counting-Themen sind ein dauerhafter zweiter Speicher für die
      // Server-Sprache und verschwinden nicht aus einem Nachrichtenfenster.
      const counting = parseCountingTopic(channel?.topic);
      if (
        counting?.lang &&
        (!newestLanguage || Number(counting.languageChangedAt) >= newestLanguage.changedAt)
      ) {
        newestLanguage = {
          guildId: guild.id,
          lang: counting.lang,
          changedAt: Number(counting.languageChangedAt) || 1,
        };
      }

      if (!channel?.isTextBased?.() || channel.viewable === false || !channel.messages?.fetch) continue;
      const me = guild.members?.me;
      if (me && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ViewChannel) === false) continue;

      const messages = await channel.messages.fetch({ limit: SCAN_LIMIT }).catch(() => null);
      if (!messages) continue;
      for (const message of messages.values()) {
        if (message.author?.id !== ctx.client.user?.id) continue;

        const language = parseLanguageMessage(message);
        if (language?.guildId === guild.id && (!newestLanguage || language.changedAt > newestLanguage.changedAt)) {
          newestLanguage = language;
        }

        const state = parseGameMessage(message);
        if (!state || ![STATUS_PENDING, STATUS_ACTIVE].includes(state.status)) continue;
        gamesFound += 1;
        if (state.status === STATUS_PENDING && state.expiresAt <= Date.now()) {
          await expireEntry({ guildId: guild.id, channelId: channel.id, messageId: message.id, message, state });
        } else {
          track(message, state);
        }
      }
      await sleep(75);
    }

    if (newestLanguage) {
      ctx.store.setServerLang(guild.id, newestLanguage.lang, newestLanguage.changedAt);
    }
    if (gamesFound) {
      ctx.logger.info(`[minigames-bot] „${guild.name}“: ${gamesFound} laufende Battle(s) wiedergefunden.`);
    }
    return gamesFound;
  }

  async function scanGuilds() {
    for (const guild of ctx.client.guilds.cache.values()) {
      await scanGuild(guild).catch((err) => {
        ctx.logger.warn(`[minigames-bot] Scan von „${guild.name}“ fehlgeschlagen:`, err.message);
      });
      await sleep(150);
    }
  }

  function deleteGuild(guildId) {
    const prefix = `${guildId}:`;
    for (const [key, timer] of timers.entries()) {
      if (!key.startsWith(prefix)) continue;
      clearTimeout(timer);
      timers.delete(key);
    }
    ctx.store.deleteGuild(guildId);
  }

  function shutdown() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { track, untrack, expireEntry, expireDue, scanGuild, scanGuilds, deleteGuild, shutdown };
}

module.exports = { createGameManager, SCAN_LIMIT };
