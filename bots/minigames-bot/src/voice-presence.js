/**
 * Stille Voice-Präsenz für das Owner-Admin-Panel.
 *
 * Der Bot tritt entweder dem am stärksten besuchten Sprachkanal bei oder –
 * wenn alle geeigneten Kanäle leer sind – einem zufälligen. Es wird bewusst
 * kein Audio-Player angelegt: Der Bot bleibt nur stumm und taub im Call.
 *
 * Eine gewünschte Verbindung wird während der gesamten Prozesslaufzeit
 * überwacht. Discords Voice-Library kümmert sich um normale Reconnects; dieser
 * Watchdog stellt die Verbindung zusätzlich wieder her, falls der Bot aus dem
 * Call getrennt wurde oder der Zielkanal verschwindet.
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const defaultVoice = require('@discordjs/voice');

const VOICE_WATCHDOG_INTERVAL_MS = 15_000;
const VOICE_REJOIN_DELAY_MS = 3_000;
const VOICE_READY_TIMEOUT_MS = 20_000;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection.values === 'function') return [...collection.values()].filter(Boolean);
  return Object.values(collection).filter(Boolean);
}

function voiceMemberCount(channel, botId = '') {
  const members = channel?.members;
  if (!members) return 0;
  if (typeof members.values === 'function') {
    return [...members.values()].filter((member) => String(member?.id || '') !== String(botId || '')).length;
  }
  const size = Math.max(0, Number(members.size) || 0);
  return members.has?.(botId) ? Math.max(0, size - 1) : size;
}

function canJoinVoiceChannel(ctx, guild, channel) {
  if (!channel || channel.type !== ChannelType.GuildVoice || channel.joinable === false) return false;
  if (!guild?.voiceAdapterCreator) return false;

  const me = guild.members?.me || ctx.client?.user;
  const permissions = channel.permissionsFor?.(me);
  if (!permissions) return true;
  return Boolean(
    permissions.has(PermissionFlagsBits.ViewChannel) &&
      permissions.has(PermissionFlagsBits.Connect)
  );
}

/**
 * Bevorzugt den Voice-Channel mit den meisten Mitgliedern. Bei Gleichstand
 * wird zufällig gewählt; sind alle leer, ist die Auswahl vollständig zufällig.
 */
function pickVoiceChannel(ctx, guild, channels, random = Math.random) {
  const eligible = valuesOf(channels).filter((channel) => canJoinVoiceChannel(ctx, guild, channel));
  if (!eligible.length) return null;

  const withCounts = eligible.map((channel) => ({
    channel,
    members: voiceMemberCount(channel, ctx.client?.user?.id),
  }));
  const largest = Math.max(...withCounts.map((item) => item.members));
  const pool = largest > 0 ? withCounts.filter((item) => item.members === largest) : withCounts;
  const rawIndex = Math.floor(Number(random()) * pool.length);
  const index = Math.min(pool.length - 1, Math.max(0, Number.isFinite(rawIndex) ? rawIndex : 0));

  return {
    channel: pool[index].channel,
    members: pool[index].members,
    mode: largest > 0 ? 'most-members' : 'random',
  };
}

function createVoicePresenceManager(
  ctx,
  {
    voice = defaultVoice,
    random = Math.random,
    watchdogIntervalMs = VOICE_WATCHDOG_INTERVAL_MS,
    rejoinDelayMs = VOICE_REJOIN_DELAY_MS,
    readyTimeoutMs = VOICE_READY_TIMEOUT_MS,
  } = {}
) {
  // guildId -> { channelId, mode, members, established, joining, retryTimer }
  const desired = new Map();
  const observedConnections = new WeakSet();
  // Verhindert, dass ein noch nicht aktualisierter Discord.js-VoiceState direkt
  // nach einem Owner-Leave den Button fälschlich weiter als „verlassen“ rendert.
  const ownerDisconnected = new Set();
  let stopped = false;

  function guildById(guildId) {
    return ctx.client?.guilds?.cache?.get?.(String(guildId)) || null;
  }

  function voiceGroup() {
    // Der Hoster betreibt mehrere Discord-Clients in einem Node-Prozess. Eine
    // eigene Voice-Gruppe verhindert Kollisionen mit Verbindungen anderer Bots.
    return `minigames:${ctx.client?.user?.id || 'pending'}`;
  }

  function connectionFor(guildId) {
    return voice.getVoiceConnection(String(guildId), voiceGroup());
  }

  function actualChannelId(guild) {
    return String(guild?.members?.me?.voice?.channelId || '');
  }

  function channelById(guild, channelId) {
    return guild?.channels?.cache?.get?.(String(channelId)) || null;
  }

  function currentChannel(guild) {
    if (ownerDisconnected.has(String(guild?.id || ''))) return null;
    const actualId = actualChannelId(guild);
    if (actualId) return channelById(guild, actualId) || guild?.members?.me?.voice?.channel || null;

    const connection = connectionFor(guild?.id || '');
    if (connection?.state?.status !== voice.VoiceConnectionStatus.Ready) return null;
    const channelId = connection.joinConfig?.channelId || desired.get(String(guild.id))?.channelId;
    return channelById(guild, channelId);
  }

  function isConnected(guild) {
    if (!guild || ownerDisconnected.has(String(guild.id))) return false;
    if (actualChannelId(guild)) return true;
    return connectionFor(guild.id)?.state?.status === voice.VoiceConnectionStatus.Ready;
  }

  async function chooseChannel(guild) {
    let channels = null;
    try {
      channels = await guild.channels?.fetch?.();
    } catch (err) {
      ctx.logger.warn(`[minigames-bot] Voice-Channels von ${guild.name} konnten nicht geladen werden: ${err.message}`);
    }
    return pickVoiceChannel(ctx, guild, channels || guild.channels?.cache, random);
  }

  function clearRetry(entry) {
    if (entry?.retryTimer) clearTimeout(entry.retryTimer);
    if (entry) entry.retryTimer = null;
  }

  function scheduleEnsure(guildId, delay = rejoinDelayMs) {
    const entry = desired.get(String(guildId));
    if (stopped || !entry?.established || entry.retryTimer) return;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      void ensureConnection(guildId, { forceRejoin: true }).catch((err) => {
        if (!desired.get(String(guildId))?.established) return;
        ctx.logger.warn(`[minigames-bot] Voice-Reconnect auf ${guildId} fehlgeschlagen: ${err.message}`);
        scheduleEnsure(guildId);
      });
    }, Math.max(0, delay));
    entry.retryTimer.unref?.();
  }

  function observeConnection(guildId, connection) {
    if (!connection || observedConnections.has(connection)) return;
    observedConnections.add(connection);

    connection.on?.('error', (err) => {
      ctx.logger.warn(`[minigames-bot] Voice-Verbindung auf ${guildId}: ${err.message}`);
    });
    connection.on?.('stateChange', (_oldState, newState) => {
      if (newState?.status === voice.VoiceConnectionStatus.Ready) {
        clearRetry(desired.get(String(guildId)));
        connection.setSpeaking?.(false);
      } else if (
        newState?.status === voice.VoiceConnectionStatus.Disconnected ||
        newState?.status === voice.VoiceConnectionStatus.Destroyed
      ) {
        scheduleEnsure(guildId);
      }
    });
  }

  async function resolveTarget(guild, entry) {
    let channel = channelById(guild, entry.channelId);
    if (canJoinVoiceChannel(ctx, guild, channel)) return channel;

    const selection = await chooseChannel(guild);
    if (!selection) throw new Error('Kein beitretbarer Voice-Channel gefunden.');
    entry.channelId = selection.channel.id;
    entry.mode = selection.mode;
    entry.members = selection.members;
    return selection.channel;
  }

  async function ensureConnection(guildId, { forceRejoin = false } = {}) {
    const id = String(guildId);
    const entry = desired.get(id);
    if (!entry) throw new Error('Für diesen Server ist kein Call vorgemerkt.');
    if (entry.joining) return entry.joining;

    entry.joining = (async () => {
      const guild = guildById(id);
      if (!guild) throw new Error('Server nicht mehr verfügbar.');
      const channel = await resolveTarget(guild, entry);
      let connection = connectionFor(id);

      if (connection?.state?.status === voice.VoiceConnectionStatus.Destroyed) connection = null;
      if (!connection) {
        connection = voice.joinVoiceChannel({
          channelId: channel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          group: voiceGroup(),
          selfDeaf: true,
          selfMute: true,
        });
      } else if (
        forceRejoin ||
        connection.joinConfig?.channelId !== channel.id ||
        connection.state?.status === voice.VoiceConnectionStatus.Disconnected
      ) {
        const accepted = connection.rejoin({ channelId: channel.id, selfDeaf: true, selfMute: true });
        if (!accepted) {
          connection.destroy();
          connection = voice.joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            group: voiceGroup(),
            selfDeaf: true,
            selfMute: true,
          });
        }
      }

      observeConnection(id, connection);
      await voice.entersState(connection, voice.VoiceConnectionStatus.Ready, readyTimeoutMs);
      connection.setSpeaking?.(false);
      entry.established = true;
      ownerDisconnected.delete(id);
      clearRetry(entry);
      return { connection, channel, mode: entry.mode, members: entry.members };
    })();

    try {
      return await entry.joining;
    } finally {
      if (desired.get(id) === entry) entry.joining = null;
    }
  }

  async function joinGuild(guild) {
    if (!guild) return { ok: false, error: 'Server nicht mehr verfügbar.' };
    const id = String(guild.id);
    const wasOwnerDisconnected = ownerDisconnected.delete(id);
    if (!wasOwnerDisconnected && isConnected(guild)) {
      return { ok: true, already: true, channel: currentChannel(guild) };
    }

    const selection = await chooseChannel(guild);
    if (!selection) {
      return { ok: false, error: 'Kein beitretbarer Voice-Channel gefunden.' };
    }

    const previous = desired.get(id);
    if (previous) clearRetry(previous);
    const entry = {
      channelId: selection.channel.id,
      mode: selection.mode,
      members: selection.members,
      established: false,
      joining: null,
      retryTimer: null,
    };
    desired.set(id, entry);

    try {
      const result = await ensureConnection(id);
      return { ok: true, ...result };
    } catch (err) {
      if (desired.get(id) === entry && !entry.established) desired.delete(id);
      const connection = connectionFor(id);
      if (connection && connection.state?.status !== voice.VoiceConnectionStatus.Destroyed) {
        connection.destroy();
      }
      if (wasOwnerDisconnected) ownerDisconnected.add(id);
      return { ok: false, error: err.message };
    }
  }

  async function leaveGuild(guild) {
    if (!guild) return { ok: false, error: 'Server nicht mehr verfügbar.' };
    const id = String(guild.id);
    const entry = desired.get(id);
    clearRetry(entry);
    desired.delete(id);

    const channel = currentChannel(guild);
    ownerDisconnected.add(id);
    const connection = connectionFor(id);
    if (connection && connection.state?.status !== voice.VoiceConnectionStatus.Destroyed) {
      connection.destroy();
    } else if (guild.members?.me?.voice?.channelId) {
      await guild.members.me.voice.disconnect('Minigames Owner-Panel: Call verlassen').catch(() => {});
    }
    return { ok: true, channel };
  }

  function forgetGuild(guildId) {
    const id = String(guildId);
    const entry = desired.get(id);
    clearRetry(entry);
    desired.delete(id);
    ownerDisconnected.delete(id);
    const connection = connectionFor(id);
    if (connection && connection.state?.status !== voice.VoiceConnectionStatus.Destroyed) connection.destroy();
  }

  function onVoiceStateUpdate(oldState, newState) {
    const guild = newState?.guild || oldState?.guild;
    const userId = newState?.id || oldState?.id;
    if (!guild?.id || userId !== ctx.client?.user?.id) return;

    const entry = desired.get(String(guild.id));
    if (!entry?.established) return;
    if (newState?.channelId) {
      // Wird der Bot von einem Moderator verschoben, bleibt er im neuen Call
      // statt gegen die Verschiebung anzukämpfen.
      entry.channelId = String(newState.channelId);
      return;
    }
    scheduleEnsure(guild.id);
  }

  async function maintainConnections() {
    if (stopped) return;
    for (const [guildId, entry] of desired) {
      if (!entry.established || entry.joining) continue;
      const guild = guildById(guildId);
      if (!guild) {
        forgetGuild(guildId);
        continue;
      }

      const actualId = actualChannelId(guild);
      if (actualId && actualId !== entry.channelId) entry.channelId = actualId;
      const connection = connectionFor(guildId);
      const status = connection?.state?.status;
      if (
        actualId &&
        (status === voice.VoiceConnectionStatus.Ready ||
          status === voice.VoiceConnectionStatus.Connecting ||
          status === voice.VoiceConnectionStatus.Signalling)
      ) {
        continue;
      }
      if (
        !actualId ||
        !connection ||
        status === voice.VoiceConnectionStatus.Disconnected ||
        status === voice.VoiceConnectionStatus.Destroyed
      ) {
        scheduleEnsure(guildId, 0);
      }
    }
  }

  const watchdog = setInterval(() => void maintainConnections(), Math.max(1, watchdogIntervalMs));
  watchdog.unref?.();
  ctx.client?.on?.('voiceStateUpdate', onVoiceStateUpdate);

  function shutdown() {
    stopped = true;
    clearInterval(watchdog);
    ctx.client?.removeListener?.('voiceStateUpdate', onVoiceStateUpdate);
    for (const guildId of [...desired.keys()]) forgetGuild(guildId);
  }

  return {
    joinGuild,
    leaveGuild,
    isConnected,
    currentChannel,
    ensureConnection,
    maintainConnections,
    forgetGuild,
    shutdown,
    desired,
  };
}

module.exports = {
  VOICE_WATCHDOG_INTERVAL_MS,
  VOICE_REJOIN_DELAY_MS,
  VOICE_READY_TIMEOUT_MS,
  valuesOf,
  voiceMemberCount,
  canJoinVoiceChannel,
  pickVoiceChannel,
  createVoicePresenceManager,
};
