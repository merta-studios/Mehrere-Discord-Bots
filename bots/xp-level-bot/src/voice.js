/**
 * Voice XP Tracker – 10 XP pro vollständig anwesender Minute im Voice.
 *
 * V3 ist absichtlich nicht mehr von genau einem Discord-Event oder einem
 * erfolgreichen REST-Fetch abhängig:
 * - voiceStateUpdate wird sofort abonniert (auch schon vor ClientReady).
 * - Alle 15 Sekunden werden VoiceState- UND Voice-Channel-Caches abgeglichen.
 * - Bestehende Calls werden dadurch nach einem Bot-Neustart wiedergefunden.
 * - Member und Channel müssen nicht für jede XP-Minute über REST geladen werden;
 *   der VoiceState selbst ist die maßgebliche Anwesenheitsquelle.
 * - Verpasste/verspätete Timer-Ticks verlieren keine bereits vollständig
 *   abgelaufenen Minuten.
 * - Mute, Deaf, Suppress, Stage und Alleinsein sind weiterhin egal.
 */

const { shouldGrantVoiceXp } = require('./logic');
const { refreshRankNicknames, maybeRefreshRankNicknames } = require('./nicknames');
const { maybeRefreshLeaderboard } = require('./scheduler');
const { syncLevelRolesForUser } = require('./level-roles');
const { sendLevelAnnouncement } = require('./level-announcements');

const VOICE_XP_PER_MINUTE = 10;
const VOICE_MINUTE_MS = 60_000;
// Der kurze Watchdog macht den Tracker unempfindlich gegen ein verpasstes Event
// und gegen Timer-Drift. XP gibt es trotzdem erst nach einer vollen Minute.
const VOICE_SCAN_INTERVAL_MS = 15_000;
// Bei einer längeren Event-Loop-Pause in kleinen, sicheren Portionen nachholen.
// So kann applyXpGain weiterhin jeden Level-Reset korrekt einzeln anwenden.
const MAX_CATCHUP_MINUTES_PER_TICK = 5;

function createVoiceTracker({ client, store, logger, getGuildConfig, onXpGain = null, now = () => Date.now() }) {
  // guildId:userId -> { guildId, userId, channelId, joinedAt,
  //                    lastMinuteStart, isBot }
  const sessions = new Map();
  const stats = {
    startedAt: 0,
    lastTickAt: 0,
    lastSuccessfulGrantAt: 0,
    ticks: 0,
    grantedMinutes: 0,
    grantedXp: 0,
    skippedOverlappingTicks: 0,
  };

  let interval = null;
  let started = false;
  let tickRunning = false;

  function key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  function cachedMember(guild, userId) {
    try {
      return guild?.members?.cache?.get?.(userId) || null;
    } catch {
      return null;
    }
  }

  function memberIsBot(member) {
    return typeof member?.user?.bot === 'boolean' ? member.user.bot : null;
  }

  /**
   * Erstellt/aktualisiert eine Session. Ein Channel-Wechsel beendet die
   * Voice-Anwesenheit nicht und setzt deshalb die bereits laufende Minute nicht
   * zurück. Nur ein echtes Disconnect-Event entfernt die Session.
   */
  function ensureSession(guildId, userId, channelId, member = null, seenAt = now()) {
    if (!guildId || !userId || !channelId) return null;
    const k = key(guildId, userId);
    const knownBot = memberIsBot(member);
    if (knownBot === true) {
      sessions.delete(k);
      return null;
    }

    let session = sessions.get(k);
    if (!session) {
      session = {
        guildId: String(guildId),
        userId: String(userId),
        channelId: String(channelId),
        joinedAt: seenAt,
        lastMinuteStart: seenAt,
        isBot: knownBot,
      };
      sessions.set(k, session);
    } else {
      session.channelId = String(channelId);
      if (knownBot !== null) session.isBot = knownBot;
    }
    return session;
  }

  function removeSession(guildId, userId) {
    sessions.delete(key(guildId, userId));
  }

  /**
   * Discord liefert beim Join/Leave/Move sowie bei Mute-/Deaf-Änderungen ein
   * VoiceStateUpdate. Mute-Änderungen dürfen die Minuten-Uhr nicht zurücksetzen.
   */
  function onVoiceStateUpdate(oldState, newState) {
    const guild = newState?.guild || oldState?.guild;
    const guildId = guild?.id;
    const userId = newState?.id || oldState?.id;
    if (!guildId || !userId) return;

    if (!newState?.channelId) {
      removeSession(guildId, userId);
      return;
    }

    const member = newState.member || cachedMember(guild, userId) || oldState?.member || null;
    ensureSession(guildId, userId, newState.channelId, member);
  }

  /**
   * Liefert die aktuell sichtbaren Voice-Nutzer aus zwei voneinander
   * unabhängigen Discord.js-Caches. channel.members ist ein wichtiger Fallback,
   * falls der VoiceState-Cache während Resume/Ready noch nicht vollständig ist.
   */
  function collectGuildPresences(guild) {
    const presences = new Map();

    try {
      for (const voiceState of guild?.voiceStates?.cache?.values?.() || []) {
        const userId = voiceState?.id;
        const channelId = voiceState?.channelId;
        if (!userId || !channelId) continue;
        const member = voiceState.member || cachedMember(guild, userId);
        presences.set(String(userId), { channelId: String(channelId), member });
      }
    } catch (err) {
      logger?.warn?.(`[xp-voice] VoiceState-Cache von ${guild?.name || guild?.id || '?'} nicht lesbar: ${err.message}`);
    }

    try {
      for (const channel of guild?.channels?.cache?.values?.() || []) {
        if (!channel?.isVoiceBased?.() || !channel.members?.values) continue;
        for (const member of channel.members.values()) {
          if (!member?.id) continue;
          const channelId = member.voice?.channelId || channel.id;
          if (!channelId) continue;
          presences.set(String(member.id), { channelId: String(channelId), member });
        }
      }
    } catch (err) {
      logger?.warn?.(`[xp-voice] Voice-Channel-Cache von ${guild?.name || guild?.id || '?'} nicht lesbar: ${err.message}`);
    }

    return presences;
  }

  function populateGuildSessions(guild, seenAt = now()) {
    const cfg = getGuildConfig(guild?.id);
    if (!cfg?.leaderboardChannelId) return 0;

    const presences = collectGuildPresences(guild);
    for (const [userId, presence] of presences) {
      ensureSession(guild.id, userId, presence.channelId, presence.member, seenAt);
    }
    return presences.size;
  }

  function populateAllSessions(seenAt = now()) {
    let visible = 0;
    for (const guild of client?.guilds?.cache?.values?.() || []) {
      try {
        visible += populateGuildSessions(guild, seenAt);
      } catch (err) {
        logger?.warn?.(`[xp-voice] Bootstrap für ${guild?.name || guild?.id || '?'} fehlgeschlagen: ${err.message}`);
      }
    }
    return visible;
  }

  async function resolveBotFlag(guild, session, presence) {
    const direct = memberIsBot(presence?.member);
    if (direct !== null) return direct;
    if (session.isBot !== null && session.isBot !== undefined) return session.isBot;

    const cached = memberIsBot(cachedMember(guild, session.userId));
    if (cached !== null) return cached;

    // Nur bei einer echten Cache-Lücke einmalig REST versuchen. Normale Ticks
    // erzeugen dadurch keinerlei Member-Requests.
    try {
      const fetched = await guild?.members?.fetch?.(session.userId);
      const fetchedFlag = memberIsBot(fetched);
      return fetchedFlag === null ? null : fetchedFlag;
    } catch {
      return null;
    }
  }

  /**
   * Mutiert den XP-Stand zuerst vollständig im RAM und führt sichtbare
   * Discord-Nebenwirkungen anschließend aus. `minutes` bleibt klein, damit
   * jeder Level-Reset durch applyXpGain korrekt verarbeitet wird.
   */
  async function grantVoiceXp(guildId, userId, minutes = 1) {
    let xpCommitted = false;
    try {
      const cfg = getGuildConfig(guildId);
      if (!cfg?.leaderboardChannelId || minutes < 1) return false;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return false;

      const wasNewUser = !store.getUser(guildId, userId);
      const user = store.ensureUser(guildId, userId);
      const { applyXpGain } = require('./logic');
      let levelResult = null;

      for (let minute = 0; minute < minutes; minute++) {
        const result = applyXpGain(user, VOICE_XP_PER_MINUTE);
        user.level = result.level;
        user.xp = result.xp;
        if (result.leveled) levelResult = result;
      }

      const activityAt = now();
      user.lastActivity = activityAt;
      user.inactiveDays = 0;
      // Voice soll den Nachrichten-Cooldown nicht setzen.
      user.lastXpGain = user.lastXpGain || 0;
      store.setUser(user);
      if (onXpGain) onXpGain(guildId, userId, minutes * VOICE_XP_PER_MINUTE);
      // Ab hier sind die XP im autoritativen RAM-Store verbucht. Fehler bei
      // Nickname/Rolle/Ankündigung dürfen keinen erneuten XP-Versuch auslösen.
      xpCommitted = true;

      const { clearInactiveRoleForUser } = require('./inactive-role');
      const lang = cfg.lang || 'de';
      const miniCtx = { client, store, logger };

      if (levelResult) {
        // Zeige den finalen XP-Rest nach eventuell nachgeholten Minuten an.
        const announcementResult = { ...levelResult, level: user.level, xp: user.xp };
        const levelFlush = store
          .flush()
          .catch((err) => logger?.warn?.('[xp-voice] Level-Flush fehlgeschlagen:', err.message));

        await sendLevelAnnouncement({
          ctx: miniCtx,
          guild,
          cfg,
          userId,
          res: announcementResult,
          source: 'voice',
        });
        await Promise.allSettled([
          refreshRankNicknames(miniCtx, guild, userId, lang),
          syncLevelRolesForUser({ ctx: miniCtx, guild, userId, level: user.level }),
          maybeRefreshLeaderboard(miniCtx, cfg, guild),
          clearInactiveRoleForUser(miniCtx, guild, userId),
          levelFlush,
        ]);
      } else if (wasNewUser) {
        await Promise.allSettled([
          refreshRankNicknames(miniCtx, guild, userId, lang),
          clearInactiveRoleForUser(miniCtx, guild, userId),
        ]);
      } else {
        try {
          const rankInfo = store.getRank(guildId, userId);
          if (rankInfo && rankInfo.rank <= 3) {
            await maybeRefreshRankNicknames(miniCtx, guild, userId, lang).catch(() => {});
          }
        } catch {}
        await clearInactiveRoleForUser(miniCtx, guild, userId).catch(() => {});
      }

      return true;
    } catch (err) {
      logger?.warn?.(`[xp-voice] XP-Vergabe für ${guildId}:${userId} fehlgeschlagen: ${err.message}`);
      return xpCommitted;
    }
  }

  async function tickMinute() {
    if (tickRunning) {
      stats.skippedOverlappingTicks += 1;
      return { skipped: true, reason: 'already-running' };
    }
    tickRunning = true;

    const tickAt = now();
    stats.lastTickAt = tickAt;
    stats.ticks += 1;

    try {
      const guildPresences = new Map();

      // Erst den aktuellen Discord-Zustand sammeln und Sessions daraus
      // rekonstruieren. Das ist der zentrale Self-Healing-Pfad nach Restarts.
      for (const guild of client?.guilds?.cache?.values?.() || []) {
        const cfg = getGuildConfig(guild.id);
        const presences = collectGuildPresences(guild);
        guildPresences.set(String(guild.id), presences);

        if (!cfg?.leaderboardChannelId) continue;
        for (const [userId, presence] of presences) {
          ensureSession(guild.id, userId, presence.channelId, presence.member, tickAt);
        }
      }

      const grants = [];
      for (const [sessionKey, session] of [...sessions.entries()]) {
        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) {
          sessions.delete(sessionKey);
          continue;
        }

        const cfg = getGuildConfig(session.guildId);
        if (!cfg?.leaderboardChannelId) {
          // Keine rückwirkenden XP, falls /setup erst später ausgeführt wird.
          session.lastMinuteStart = tickAt;
          continue;
        }

        const presence = guildPresences.get(session.guildId)?.get(session.userId);
        if (!presence?.channelId) {
          // Ein Disconnect wird normalerweise schon vom Event entfernt. Der
          // Poll-Abgleich räumt zusätzlich verpasste Disconnect-Events auf.
          sessions.delete(sessionKey);
          continue;
        }
        session.channelId = presence.channelId;

        const isBot = await resolveBotFlag(guild, session, presence);
        if (isBot === true) {
          sessions.delete(sessionKey);
          continue;
        }
        if (isBot === null) {
          // Unbekannte Accounts nicht versehentlich belohnen, Minute aber auch
          // nicht verwerfen – der nächste Watchdog-Tick versucht es erneut.
          continue;
        }
        session.isBot = false;

        const elapsed = tickAt - Number(session.lastMinuteStart ?? tickAt);
        const fullMinutes = Math.floor(elapsed / VOICE_MINUTE_MS);
        if (fullMinutes < 1) continue;

        const minutes = Math.min(fullMinutes, MAX_CATCHUP_MINUTES_PER_TICK);
        if (!shouldGrantVoiceXp({ present: true })) continue;

        // Erst nach erfolgreicher RAM-Buchung von der Session-Uhr abbuchen.
        // Schlägt eine Vergabe vor store.setUser fehl, versucht der nächste
        // Watchdog dieselbe volle Minute erneut statt sie still zu verlieren.
        const minuteStart = Number(session.lastMinuteStart);
        grants.push(
          grantVoiceXp(session.guildId, session.userId, minutes).then((granted) => {
            if (granted) session.lastMinuteStart = minuteStart + minutes * VOICE_MINUTE_MS;
            return { granted, session, minutes };
          })
        );
      }

      const results = await Promise.allSettled(grants);
      let grantedUsers = 0;
      let grantedMinutes = 0;
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value.granted) continue;
        grantedUsers += 1;
        grantedMinutes += result.value.minutes;
        logger?.info?.(
          `[xp-voice] +${result.value.minutes * VOICE_XP_PER_MINUTE} XP für ` +
            `${result.value.session.userId} in ` +
            `${client.guilds.cache.get(result.value.session.guildId)?.name || result.value.session.guildId} ` +
            `(${result.value.minutes} Voice-Min.)`
        );
      }

      if (grantedMinutes > 0) {
        stats.lastSuccessfulGrantAt = now();
        stats.grantedMinutes += grantedMinutes;
        stats.grantedXp += grantedMinutes * VOICE_XP_PER_MINUTE;
      }

      return { skipped: false, grantedUsers, grantedMinutes };
    } catch (err) {
      logger?.warn?.('[xp-voice] Watchdog-Tick fehlgeschlagen:', err.message);
      return { skipped: false, error: err };
    } finally {
      tickRunning = false;
    }
  }

  function start() {
    if (started) return false;
    started = true;
    stats.startedAt = now();

    // Vor client.login() aufgerufen: So kann kein früher VoiceState verloren
    // gehen. populateAllSessions ist zu diesem Zeitpunkt sicher und zunächst
    // einfach leer; beim Ready-Event wird es noch einmal explizit aufgerufen.
    client.on('voiceStateUpdate', onVoiceStateUpdate);
    const visible = populateAllSessions(stats.startedAt);
    interval = setInterval(() => void tickMinute(), VOICE_SCAN_INTERVAL_MS);
    interval.unref?.();

    logger?.info?.(
      `[xp-voice] V3-Tracker aktiv: ${sessions.size} Sessions (${visible} VoiceStates sichtbar), ` +
        `Scan alle ${VOICE_SCAN_INTERVAL_MS / 1000}s, ${VOICE_XP_PER_MINUTE} XP/Min.`
    );
    return true;
  }

  function stop() {
    if (interval) clearInterval(interval);
    interval = null;
    if (started) client.removeListener('voiceStateUpdate', onVoiceStateUpdate);
    started = false;
  }

  return {
    start,
    stop,
    onVoiceStateUpdate,
    tickMinute,
    sessions,
    stats,
    collectGuildPresences,
    populateGuildSessions,
    populateAllSessions,
    ensureSession,
    removeSession,
    grantVoiceXp,
    VOICE_XP_PER_MINUTE,
    VOICE_SCAN_INTERVAL_MS,
  };
}

module.exports = {
  createVoiceTracker,
  VOICE_XP_PER_MINUTE,
  VOICE_SCAN_INTERVAL_MS,
  VOICE_MINUTE_MS,
};
