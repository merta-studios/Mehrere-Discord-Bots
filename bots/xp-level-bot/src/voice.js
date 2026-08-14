/**
 * Voice XP Tracker – vergibt alle 60s **10 XP** pro User, der einfach in
 * einem Voice-Channel ist.
 *
 * Seit v2 (Fix „Voice XP geht immer noch nicht“):
 * - Es gibt KEINE Bedingungen mehr an Mute/Deaf/Suppress (self ODER server),
 *   an Sprechzeit, Sprechpausen oder die Anzahl weiterer Personen im Channel.
 * - „Anwesend = XP“: Ob man stumm ist, taub gestellt, allein im Channel oder
 *   im Stage – man bekommt pro angefangener Minute 10 XP.
 * - Fairer Wert: Chat-XP bringt bis zu 30 XP pro Nachricht bei 30s Cooldown
 *   (≈60 XP/min für sehr aktive Chatter). 10 XP/min reine Anwesenheit belohnt
 *   das „Im-Call-Sein“ spürbar, ohne aktives Chatten zu überholen.
 *
 * Technik:
 * - Sessions (guildId:userId -> voiceSession) werden beim Join, beim
 *   Bootstrap (Bot-Start während Leute schon im Call sind) und einmal pro
 *   Tick nachgezogen, damit nie jemand durch einen verpassten
 *   voiceStateUpdate leer ausgeht.
 * - Nur Menschen (keine Bots) und nur konfigurierte Gilden
 *   (cfg.leaderboardChannelId) bekommen XP.
 */

const { shouldGrantVoiceXp } = require('./logic');
const { refreshRankNicknames, maybeRefreshRankNicknames } = require('./nicknames');
const { maybeRefreshLeaderboard } = require('./scheduler');
const { syncLevelRolesForUser } = require('./level-roles');
const { sendLevelAnnouncement } = require('./level-announcements');

/** Fairer Wert: 10 XP pro Minute Anwesenheit im Voice-Channel. */
const VOICE_XP_PER_MINUTE = 10;

function createVoiceTracker({ client, store, logger, getGuildConfig }) {
  // guildId:userId -> voiceSession
  const sessions = new Map();

  function key(guildId, userId){ return `${guildId}:${userId}`; }

  // Session Struktur: { guildId, userId, channelId, joinedAt, lastMinuteStart }
  function ensureSession(guildId, userId, channelId) {
    const k = key(guildId,userId);
    let s = sessions.get(k);
    if (!s || s.channelId !== channelId) {
      s = {
        guildId, userId, channelId,
        joinedAt: Date.now(),
        lastMinuteStart: Date.now(),
      };
      sessions.set(k,s);
    }
    // Falls Channel gewechselt hat, aktualisieren
    if (s.channelId !== channelId) {
      s.channelId = channelId;
    }
    return s;
  }

  function removeSession(guildId, userId){
    sessions.delete(key(guildId,userId));
  }

  // Wird bei jedem voiceStateUpdate aufgerufen – legt Sessions an bzw. räumt auf
  function onVoiceStateUpdate(oldState, newState){
    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = newState.id || oldState.id;
    if (!guildId || !userId) return;
    const channelId = newState.channelId;

    if (!channelId) {
      // Verlassen
      sessions.delete(key(guildId,userId));
      return;
    }
    // Gejoint oder gewechselt
    ensureSession(guildId, userId, channelId);
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

      // Prüfe ob user noch in Channel ist (über voiceStates)
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
      // Falls member nicht gefetched werden konnte, aber voiceState vorhanden, nutze voiceState
      const vs = member?.voice || voiceState;
      if (!vs || !vs.channelId) { sessions.delete(k); continue; }

      // Zeit seit letztem Tick
      const elapsedSec = Math.round((now - sess.lastMinuteStart)/1000);
      if (elapsedSec < 60) continue; // erst nach 60s werten

      // Seit v2: Anwesend = XP – keine Mute-/Speaking-/Personenzahl-Prüfungen mehr
      const present = true;
      const grant = shouldGrantVoiceXp({ present });
      if (grant) {
        await grantVoiceXp(sess.guildId, sess.userId, channel);
        logger?.info?.(`[xp-voice] +${VOICE_XP_PER_MINUTE} XP für ${sess.userId} in ${guild.name} (Anwesenheit im Voice)`);
      }

      // Reset für nächste Minute
      sess.lastMinuteStart = now;
    }
  }

  async function grantVoiceXp(guildId, userId, voiceChannel){
    try {
      const cfg = getGuildConfig(guildId);
      if (!cfg || !cfg.leaderboardChannelId) return;
      const wasNewUser = !store.getUser(guildId, userId);
      const user = store.ensureUser(guildId, userId);
      const { applyXpGain } = require('./logic');
      const res = applyXpGain(user, VOICE_XP_PER_MINUTE);
      user.level = res.level;
      user.xp = res.xp;
      user.lastActivity = Date.now(); // Voice-XP zählt als Aktivität für den Decay
      user.inactiveDays = 0; // Reset Inaktivitäts-Zähler sofort
      user.lastXpGain = user.lastXpGain || 0;
      store.setUser(user);
      const { clearInactiveRoleForUser } = require('./inactive-role');
      const lang = cfg.lang || 'de';
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;
      const miniCtx = { client, store, logger };
      if (res.leveled) {
        // Persistenz parallel starten; die sichtbare Ankündigung darf nicht auf
        // Turso oder andere Discord-Nebenwirkungen warten.
        const levelFlush = store.flush().catch((e) => logger?.warn?.('[xp-voice] Level-Flush fehlgeschlagen:', e.message));
        await sendLevelAnnouncement({
          ctx: miniCtx,
          guild,
          cfg,
          userId,
          res,
          source: 'voice',
        });
        await Promise.allSettled([
          refreshRankNicknames(miniCtx, guild, userId, lang),
          syncLevelRolesForUser({ ctx: miniCtx, guild, userId, level: res.level }),
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
            await maybeRefreshRankNicknames(miniCtx, guild, userId, lang).catch(()=>{});
          }
        } catch {}
        await clearInactiveRoleForUser(miniCtx, guild, userId).catch(()=>{});
      }
    } catch(e){
      logger.warn('[xp-voice] grant failed:', e.message);
    }
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

  return { start, stop, onVoiceStateUpdate, tickMinute, sessions, populateAllSessions, ensureSession, VOICE_XP_PER_MINUTE };
}

module.exports = { createVoiceTracker, VOICE_XP_PER_MINUTE };
