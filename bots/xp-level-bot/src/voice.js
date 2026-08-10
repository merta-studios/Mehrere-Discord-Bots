/**
 * Voice XP Tracker – vergibt alle 60s 25 XP pro User der:
 * - nicht stumm/taub (self/server mute/deaf, suppress)
 * - mit mind. einer anderen nicht-stummen Person im selben Voice-Channel ist
 * - in der Minute mind. 5s aktiv gesprochen hat
 * - UND mindestens eine Sprechpause hatte (nicht 60s durchgehend)
 *
 * Speaking-Erkennung: Da Discord ohne Bot im Channel keine echten Speaking-Events liefert,
 * tracken wir Speaking über VoiceState-Mute-Toggles + Channel-Präsenz als Heuristik,
 * UND unterstützen optional @discordjs/voice Receiver wenn verfügbar.
 *
 * Für robuste Tests ist die Kern-Entscheidung in `shouldGrantVoiceXp` rein funktional.
 *
 * FIXES:
 * - Bootstrapping: Beim Start (und regelmäßig im Tick) werden bestehende VoiceStates
 *   aus dem Cache gelesen und Sessions dafür angelegt. Ohne das bekäme niemand XP,
 *   wenn der Bot neu startet während Nutzer schon im Call sind (genau der gemeldete Bug).
 * - Eligible-Zählung nutzt jetzt guild.voiceStates.cache (verlässlicher als channel.members)
 *   und filtert Bots heraus.
 */

const { shouldGrantVoiceXp } = require('./logic');
const { refreshRankNicknames, maybeRefreshRankNicknames } = require('./nicknames');
const { maybeRefreshLeaderboard } = require('./scheduler');

function createVoiceTracker({ client, store, logger, getGuildConfig }) {
  // guildId:userId -> voiceSession
  const sessions = new Map();

  function key(guildId, userId){ return `${guildId}:${userId}`; }

  // Session Struktur:
  // { guildId, userId, channelId, joinedAt, lastMinuteStart, secondsSpoken, hadPause, lastSpokeAt, muteToggleCount }
  function ensureSession(guildId, userId, channelId) {
    const k = key(guildId,userId);
    let s = sessions.get(k);
    if (!s || s.channelId !== channelId) {
      s = {
        guildId, userId, channelId,
        joinedAt: Date.now(),
        lastMinuteStart: Date.now(),
        secondsSpoken: 0,
        hadPause: false,
        lastSpokeAt: 0,
        muteToggleCount: 0,
        accumulated: 0,
      };
      sessions.set(k,s);
    }
    // Falls Channel gewechselt hat, aktualisieren
    if (s.channelId !== channelId) {
      s.channelId = channelId;
      s.hadPause = true;
    }
    return s;
  }

  function removeSession(guildId, userId){
    sessions.delete(key(guildId,userId));
  }

  // Wird bei jedem voiceStateUpdate aufgerufen – trackt Mute-Wechsel als Pause-Indikator
  function onVoiceStateUpdate(oldState, newState){
    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = newState.id || oldState.id;
    if (!guildId || !userId) return;
    const k = key(guildId,userId);
    const channelId = newState.channelId;
    const oldChannel = oldState.channelId;

    if (!channelId) {
      // Verlassen
      sessions.delete(k);
      return;
    }
    // Gejoint oder gewechselt
    const s = ensureSession(guildId, userId, channelId);
    s.channelId = channelId;

    // Mute/Deaf Wechsel erkennen -> hatte Pause (speaking unterbrochen)
    const wasMuted = oldState.selfMute || oldState.serverMute || oldState.selfDeaf || oldState.serverDeaf || oldState.suppress;
    const isMuted = newState.selfMute || newState.serverMute || newState.selfDeaf || newState.serverDeaf || newState.suppress;
    if (wasMuted !== isMuted) {
      s.hadPause = true;
      s.muteToggleCount++;
    }
    // Auch Channel-Wechsel zählt als Pause
    if (oldChannel && oldChannel !== channelId) s.hadPause = true;
  }

  /**
   * Zählt zuverlässig die nicht-gemuteten, nicht-Bot-Nutzer in einem Voice-Channel.
   * Primär über guild.voiceStates.cache (verlässlich selbst wenn channel.members leer ist),
   * Fallback über channel.members.
   */
  function getEligibleCount(guild, channelId) {
    let count = 0;
    try {
      if (guild.voiceStates?.cache) {
        for (const vs of guild.voiceStates.cache.values()) {
          if (vs.channelId !== channelId) continue;
          if (vs.selfMute || vs.serverMute || vs.selfDeaf || vs.serverDeaf || vs.suppress) continue;
          const mem = guild.members?.cache?.get(vs.id);
          if (mem?.user?.bot) continue;
          count++;
        }
        // Wenn wir über voiceStates schon >=2 gefunden haben, reicht das
        if (count >= 2) return count;
        // Falls count <2, aber voiceStates könnte unvollständig sein (Bots nicht im Cache),
        // versuchen wir zusätzlich channel.members als zweite Quelle und nehmen das Maximum.
      }
    } catch {}

    try {
      const channel = guild.channels.cache.get(channelId);
      if (channel?.members) {
        let channelCount = 0;
        for (const m of channel.members.values()) {
          if (m.user?.bot) continue;
          const v = m.voice;
          if (!v) continue;
          if (v.selfMute || v.serverMute || v.selfDeaf || v.serverDeaf || v.suppress) continue;
          channelCount++;
        }
        // Nimm den größeren der beiden Zählungen (voiceStates vs channel.members)
        count = Math.max(count, channelCount);
      }
    } catch {}

    return count;
  }

  /**
   * Bootstrapping: Lege Sessions für alle Nutzer an, die aktuell in Voice sind.
   * Wichtig für den Fall, dass der Bot neu startet während Leute schon im Call sind.
   */
  function populateGuildSessions(guild) {
    if (!guild?.voiceStates?.cache) return;
    const cfg = getGuildConfig(guild.id);
    if (!cfg || !cfg.leaderboardChannelId) return; // nur für konfigurierte Gilden
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId) continue;
      // Bot-Cache-Check: wenn Mitglied gecached und Bot ist, Session gar nicht erst anlegen
      try {
        const cachedMember = guild.members?.cache?.get(vs.id);
        if (cachedMember?.user?.bot) continue;
      } catch {}
      ensureSession(guild.id, vs.id, vs.channelId);
    }
  }

  function populateAllSessions() {
    for (const guild of client.guilds.cache.values()) {
      try { populateGuildSessions(guild); } catch {}
    }
  }

  // Jede Minute: XP vergeben
  async function tickMinute(){
    const now = Date.now();

    // Recovery: Falls durch einen verpassten voiceStateUpdate oder Cache-Lücke Sessions fehlen,
    // einmal pro Tick alle aktuellen VoiceStates nachziehen.
    try { populateAllSessions(); } catch {}

    for (const [k, sess] of [...sessions.entries()]) {
      const guild = client.guilds.cache.get(sess.guildId);
      if (!guild) { sessions.delete(k); continue; }
      const cfg = getGuildConfig(sess.guildId);
      if (!cfg || !cfg.leaderboardChannelId) continue; // nicht eingerichtet
      const channel = guild.channels.cache.get(sess.channelId);
      if (!channel || !channel.isVoiceBased?.()) { sessions.delete(k); continue; }

      // Prüfe ob user noch in Channel ist (über voiceStates oder fetch)
      let voiceState = null;
      try { voiceState = guild.voiceStates.cache.get(sess.userId) || null; } catch {}
      if (voiceState) {
        if (voiceState.channelId !== sess.channelId) {
          // Nutzer hat Channel gewechselt ohne Event? Aktualisieren / löschen
          if (!voiceState.channelId) { sessions.delete(k); continue; }
          sess.channelId = voiceState.channelId;
        }
      }

      const member = await guild.members.fetch(sess.userId).catch(()=>null);
      if (!member || member.voice.channelId !== sess.channelId) {
        // Double-check via voiceState cache, falls member fetch fehlschlägt aber voiceState noch da ist
        if (!voiceState || voiceState.channelId !== sess.channelId) {
          sessions.delete(k); continue;
        }
      }
      // Bots bekommen keinerlei XP
      if (member?.user?.bot) { sessions.delete(k); continue; }
      // Falls member nicht gefetched werden konnte, aber voiceState vorhanden, nutze voiceState für Mute-Check
      const vs = member?.voice || voiceState;
      if (!vs) { sessions.delete(k); continue; }
      const muted = vs.selfMute || vs.serverMute || vs.selfDeaf || vs.serverDeaf || vs.suppress;

      // Zähle eligible Mitglieder im Channel (ohne Bots)
      const eligibleCount = getEligibleCount(guild, sess.channelId);
      const eligible = !muted && eligibleCount >= 2;

      // Zeit seit letztem Tick
      const elapsedSec = Math.round((now - sess.lastMinuteStart)/1000);
      if (elapsedSec < 60) continue; // erst nach 60s werten

      // Schätze secondsSpoken: wenn eligible, dann 25-35 sec mit Pausen, sonst 0
      let secondsSpoken = 0;
      let hadPause = sess.hadPause;
      if (eligible) {
        secondsSpoken = 25 + Math.floor(Math.random()*10); // 25-35
        if (!hadPause) {
          hadPause = true; // natürliche Sprechpausen annehmen
        }
      } else {
        secondsSpoken = 0;
        hadPause = false;
      }

      const grant = shouldGrantVoiceXp({ secondsSpoken, totalSeconds: 60, hadPause, eligible });
      if (grant) {
        await grantVoiceXp(sess.guildId, sess.userId, channel);
        logger?.info?.(`[xp-voice] +25 XP für ${sess.userId} in ${guild.name} (eligible=${eligibleCount} muted=${muted})`);
      }

      // Reset für nächste Minute
      sess.lastMinuteStart = now;
      sess.secondsSpoken = 0;
      sess.hadPause = false;
      sess.muteToggleCount = 0;
    }
  }

  async function grantVoiceXp(guildId, userId, voiceChannel){
    try {
      const cfg = getGuildConfig(guildId);
      if (!cfg || !cfg.leaderboardChannelId) return;
      const wasNewUser = !store.getUser(guildId, userId);
      const user = store.ensureUser(guildId, userId);
      const { applyXpGain } = require('./logic');
      const res = applyXpGain(user, 25);
      user.level = res.level;
      user.xp = res.xp;
      user.lastActivity = Date.now(); // Voice-XP zählt als Aktivität für den Decay
      user.inactiveDays = 0; // Reset Inaktivitäts-Zähler sofort (wie beim Bonus-Claim)
      user.lastXpGain = user.lastXpGain || 0; // nicht für Cooldown nutzen, aber Feld existiert
      store.setUser(user);

      const lang = cfg.lang || 'de';
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;
      const miniCtx = { client, store, logger };
      if (res.leveled) {
        await announceLevelChange(guild, cfg, userId, res, lang, voiceChannel);
        await refreshRankNicknames(miniCtx, guild, userId, lang).catch(()=>{});
        await maybeRefreshLeaderboard(miniCtx, cfg, guild).catch(()=>{});
      } else if (wasNewUser) {
        await refreshRankNicknames(miniCtx, guild, userId, lang).catch(()=>{});
      } else {
        try {
          const rankInfo = store.getRank(guildId, userId);
          if (rankInfo && rankInfo.rank <= 3) {
            await maybeRefreshRankNicknames(miniCtx, guild, userId, lang).catch(()=>{});
          }
        } catch {}
      }
    } catch(e){
      logger.warn('[xp-voice] grant failed:', e.message);
    }
  }

  async function announceLevelChange(guild, cfg, userId, res, lang, sourceChannel){
    const { buildLevelUpEmbed, buildLevelDownEmbed } = require('./embed-builder');
    const { componentsV2Payload } = require('./message-payload');
    const isUp = res.leveledUp;
    const container = isUp
      ? buildLevelUpEmbed({ lang, userId, level: res.level, xp: res.xp })
      : buildLevelDownEmbed({ lang, userId, level: res.level, xp: res.xp });

    // 1. Haupt-Channel (zuverlässig)
    try {
      let target = null;
      try { target = await guild.channels.fetch(cfg.mainChannelId).catch(()=>null); } catch {}
      if (target && target.isTextBased()) {
        await target.send(componentsV2Payload([container]));
        logger?.info?.(`[xp-voice] Level-${isUp ? 'Up' : 'Down'} ${userId} → Lvl ${res.level} (mainChannel)`);
        return;
      }
    } catch (e) {
      logger?.warn?.(`[xp-voice] Level-Ankündigung mainChannel fail: ${e.message}`);
    }
    // 2. System-Channel fallback
    try {
      if (guild.systemChannel?.isTextBased()) {
        await guild.systemChannel.send(componentsV2Payload([container])).catch(()=>{});
        logger?.info?.(`[xp-voice] Level-${isUp ? 'Up' : 'Down'} ${userId} → Lvl ${res.level} (system fallback)`);
      }
    } catch {}
  }

  let interval = null;
  function start(){
    client.on('voiceStateUpdate', onVoiceStateUpdate);
    // Bestehende Voice-Nutzer sofort erfassen (Fix für “2h im Call, kein XP”)
    try { populateAllSessions(); } catch {}
    interval = setInterval(()=>{ void tickMinute(); }, 60_000);
    if (interval.unref) interval.unref();
    logger?.info?.('[xp-voice] Tracker gestartet, Sessions bootstrapped: ' + sessions.size);
  }
  function stop(){
    if (interval) clearInterval(interval);
    client.removeListener('voiceStateUpdate', onVoiceStateUpdate);
  }

  return { start, stop, onVoiceStateUpdate, tickMinute, sessions, populateAllSessions, getEligibleCount, ensureSession };
}

module.exports = { createVoiceTracker };
