/**
 * Scheduler XP Bot:
 * - Minütlich: prüft ob Tag für Gilde gewechselt (0 Uhr in Guild-TZ) -> daily decay
 *   (10% Basis, +5 Prozentpunkte pro zusätzlichem inaktivem Tag)
 * - Stündlich: Leaderboard neu rendern (zeitbasiert: wenn >55min seit letztem stündlichen Refresh)
 *   FIX: Stündlich ist jetzt unabhängig von Level-Up-Refreshes. Früher wurde der Hourly-Timer
 *   durch jedes Level-Up zurückgesetzt, sodass bei viel Aktivität das Board scheinbar nur bei
 *   Level-Ups aktualisiert wurde. Jetzt gibt es zwei getrennte Tracker:
 *     lastLeaderboardRefresh (Throttle 10min für Level-Up)
 *     lastHourlyRefresh      (55min für stündlich)
 * - Zusätzlich bei Level-Up/Down: Leaderboard aktualisieren, wenn die letzte
 *   Aktualisierung länger als 10 Minuten her ist (Throttle)
 * - Selbstheilung: schlägt die Command-Registrierung beim Start fehl, wird sie regelmäßig erneut versucht
 * - 5min: Backup flush
 */

const { todayKey } = require('./logic');
const { buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { syncLevelRolesForUser } = require('./level-roles');
const { refreshRankNicknames } = require('./nicknames');

const MINUTE_MS = 60_000;
const LEADERBOARD_MIN_REFRESH_MS = 10 * 60 * 1000;
const LEADERBOARD_HOURLY_MS = 55 * 60 * 1000; // stündlich (mit Toleranz)
const COMMAND_RETRY_EVERY_TICKS = 15; // alle 15 min erneut versuchen

// Wann wurde das Leaderboard pro Gilde zuletzt (erfolgreich) aktualisiert (für 10min Throttle)?
const lastLeaderboardRefresh = new Map(); // guildId -> timestamp
// Wann wurde das Leaderboard zuletzt STÜNDLICH aktualisiert (unabhängig von Level-Ups)?
const lastHourlyRefresh = new Map(); // guildId -> timestamp
// Wann wurde es zuletzt VERSUCHT (dämpft Log-/API-Spam bei dauerhaften Fehlern)
const lastLeaderboardAttempt = new Map(); // guildId -> timestamp

function isLeaderboardRefreshDue(guildId, now = Date.now()) {
  const last = lastLeaderboardRefresh.get(guildId) || 0;
  return (now - last) >= LEADERBOARD_MIN_REFRESH_MS;
}

function isHourlyRefreshDue(guildId, now = Date.now()) {
  const last = lastHourlyRefresh.get(guildId) || 0;
  return (now - last) >= LEADERBOARD_HOURLY_MS;
}

function noteLeaderboardRefresh(guildId, now = Date.now()) {
  lastLeaderboardRefresh.set(guildId, now);
}

function noteHourlyRefresh(guildId, now = Date.now()) {
  lastHourlyRefresh.set(guildId, now);
  lastLeaderboardRefresh.set(guildId, now); // stündlich gilt auch als allgemeines Refresh für Throttle
}

function startScheduler({ ctx }){
  let counter = 0;
  const timer = setInterval(()=>{ counter+=1; void tick(ctx, counter).catch(()=>{}); }, MINUTE_MS);
  timer.unref?.();
  // initial tick after 10s for faster first leaderboard
  setTimeout(()=> void tick(ctx, 0).catch(()=>{}), 10_000);
  return ()=> clearInterval(timer);
}

/**
 * Holt die Gilde robust: erst Cache, dann API. Nur wenn Discord die Gilde
 * definitiv nicht kennt (10004 Unknown Guild → Bot wurde entfernt), wird die
 * Konfiguration verworfen.
 */
async function resolveGuild(ctx, guildId){
  const cached = ctx.client.guilds.cache.get(guildId);
  if (cached) return { guild: cached, gone: false };
  try {
    const guild = await ctx.client.guilds.fetch(guildId);
    return { guild: guild || null, gone: !guild };
  } catch (err) {
    if (err?.code === 10004) return { guild: null, gone: true };
    return { guild: null, gone: false };
  }
}

let tickRunning = false;

async function tick(ctx, counter){
  if (tickRunning) return;
  tickRunning = true;
  try {
    return await tickInner(ctx, counter);
  } finally {
    tickRunning = false;
  }
}

async function tickInner(ctx, counter){
  const now = new Date();
  const nowMs = Date.now();

  if (ctx.commandsRegistered === false && counter % COMMAND_RETRY_EVERY_TICKS === 1) {
    try {
      const { registerCommands } = require('./commands');
      await registerCommands(ctx);
    } catch {}
  }
  if (counter > 0 && counter % (24 * 60) === 0) {
    ctx.commandsRegistered = false;
  }

  for (const entry of ctx.store.getAllGuilds()){
    const { guild, gone } = await resolveGuild(ctx, entry.guildId);
    if (gone){ ctx.store.deleteGuild(entry.guildId); continue; }
    if (!guild){ ctx.logger.warn(`[xp-level-bot] Gilde ${entry.guildId} aktuell nicht erreichbar – überspringe Tick (Config bleibt)`); continue; }
    try {
      const dayKey = todayKey(entry.lang);
      if (entry.lastDailyDecay !== dayKey) {
        await applyDailyDecayForGuild(ctx, entry, guild);
        entry.lastDailyDecay = dayKey;
        ctx.store.setGuild(entry);
      }

      if (ctx.bonusDropper) {
        try {
          await ctx.bonusDropper.checkScheduled(entry, guild, now);
        } catch (e) {
          ctx.logger.warn(`[xp-level-bot] Bonus-Scheduler Fehler Gilde ${entry.guildId}:`, e.message);
        }
      }

      // Stündlich Leaderboard – UNABHÄNGIG von Level-Up-Refreshes
      const lastHourly = lastHourlyRefresh.get(entry.guildId) || 0;
      const lastAttempt = lastLeaderboardAttempt.get(entry.guildId) || 0;
      const hourlyDue = (nowMs - lastHourly) >= LEADERBOARD_HOURLY_MS;
      const attemptReady = (nowMs - lastAttempt) >= LEADERBOARD_MIN_REFRESH_MS;

      if (counter === 0 || (hourlyDue && attemptReady)) {
        lastLeaderboardAttempt.set(entry.guildId, nowMs);
        await refreshLeaderboard(ctx, entry, guild, now, { isHourly: true });
      }
    } catch(err){
      ctx.logger.warn(`[xp-level-bot] Tick Fehler Gilde ${entry.guildId}:`, err.message);
    }
  }

  if (counter % 5 === 0) {
    void ctx.store.flush().catch(()=>{});
  }
}

/**
 * Aktualisiert das Leaderboard bei Level-Up/Down, aber maximal alle 10 Minuten.
 * (Der stündliche Tick läuft unabhängig davon immer.)
 */
async function maybeRefreshLeaderboard(ctx, entry, guild) {
  if (!isLeaderboardRefreshDue(entry.guildId)) return false;
  await refreshLeaderboard(ctx, entry, guild, new Date(), { isHourly: false });
  return true;
}

async function applyDailyDecayForGuild(ctx, entry, guild){
  const lang = entry.lang || 'de';
  const users = ctx.store.getUsersForGuild(entry.guildId);
  if (!users.length) return;
  const { applyDailyDecay, nextDecayInfo } = require('./logic');
  let decayed = 0;
  let leveledDownUsers = [];
  for (const u of users){
    const info = nextDecayInfo(u, Date.now());
    u.inactiveDays = info.inactiveDays;
    const before = { level: u.level, xp: u.xp };
    const res = applyDailyDecay(u, info.rate);
    if (res.level !== before.level || res.xp !== before.xp) {
      u.level = res.level;
      u.xp = res.xp;
      decayed++;
      if (res.leveledDown) leveledDownUsers.push({ userId: u.userId, level: res.level, xp: res.xp });
    }
    ctx.store.setUser(u);
  }
  ctx.logger.info(`[xp-level-bot] Daily decay ${guild.name}: ${decayed} Nutzer angepasst, ${leveledDownUsers.length} Level-Downs`);
  await ctx.store.flush();
  for (const ld of leveledDownUsers) {
    try {
      let ch = await guild.channels.fetch(entry.mainChannelId).catch(()=>null);
      if (!ch || !ch.isTextBased()) continue;
      const { buildLevelDownEmbed } = require('./embed-builder');
      const container = buildLevelDownEmbed({ lang, userId: ld.userId, level: ld.level, xp: ld.xp });
      await ch.send(componentsV2Payload([container])).catch(()=>{});
      await refreshRankNicknames(ctx, guild, ld.userId, lang).catch(()=>{});
      await syncLevelRolesForUser({ ctx, guild, userId: ld.userId, level: ld.level }).catch(()=>{});
    } catch{}
  }
  // Nach dem Decay das Leaderboard direkt aktualisieren – zählt als stündliches Update
  await refreshLeaderboard(ctx, entry, guild, new Date(), { isHourly: true });
}

async function refreshLeaderboard(ctx, entry, guild, now, opts = {}){
  const isHourly = opts.isHourly !== false; // default true für Rückwärtskompatibilität, aber explizit false bei Level-Up
  // Wenn aufgerufen ohne opts (alte Aufrufe), behandle als hourly, damit nichts kaputt geht
  const treatAsHourly = opts.isHourly === true || (Object.keys(opts).length === 0);
  try {
    const channel = await ctx.client.channels.fetch(entry.leaderboardChannelId).catch(()=>null);
    if (!channel || !channel.isTextBased()) {
      ctx.logger.warn(`[xp-level-bot] Leaderboard-Kanal ${entry.leaderboardChannelId} nicht erreichbar (${guild.name})`);
      return false;
    }
    const entries = ctx.store.getLeaderboard(entry.guildId, 15);
    const container = buildLeaderboardEmbed({ lang: entry.lang, entries, now, guildName: guild.name });

    let msg = null;
    if (entry.leaderboardMessageId) msg = await channel.messages.fetch(entry.leaderboardMessageId).catch(()=>null);
    if (!msg) {
      const found = await ctx.store.findLeaderboardMessage(guild, ctx.client);
      if (found) {
        msg = found.message;
        entry.leaderboardChannelId = found.channel.id;
        entry.leaderboardMessageId = found.message.id;
      }
    }

    let success = false;
    if (msg) {
      try {
        await msg.edit(componentsV2Payload([container]));
        success = true;
      } catch (err) {
        ctx.logger.warn(`[xp-level-bot] Leaderboard-Edit fehlgeschlagen (${guild.name}): ${err.message} – sende neu.`);
        await msg.delete().catch(()=>{});
        msg = null;
      }
    }
    if (!msg) {
      const newMsg = await channel.send(componentsV2Payload([container])).catch((e)=>{
        ctx.logger.warn(`[xp-level-bot] Leaderboard-Send fehlgeschlagen (${guild.name}): ${e.message}`);
        return null;
      });
      if (!newMsg) return false;
      entry.leaderboardMessageId = newMsg.id;
      success = true;
    }

    if (success) {
      const ts = Date.now();
      noteLeaderboardRefresh(entry.guildId, ts);
      if (treatAsHourly) {
        noteHourlyRefresh(entry.guildId, ts);
      }
      ctx.store.setGuild(entry);
      ctx.logger.info(`[xp-level-bot] Leaderboard aktualisiert (${guild.name})${treatAsHourly ? ' [stündlich]' : ' [level]'}`);
      return true;
    }
    return false;
  } catch(e){
    ctx.logger.warn(`[xp-level-bot] Leaderboard refresh failed ${guild.name}:`, e.message);
    return false;
  }
}

module.exports = {
  startScheduler,
  tick,
  refreshLeaderboard,
  maybeRefreshLeaderboard,
  isLeaderboardRefreshDue,
  isHourlyRefreshDue,
  noteLeaderboardRefresh,
  noteHourlyRefresh,
  applyDailyDecayForGuild,
  LEADERBOARD_MIN_REFRESH_MS,
  LEADERBOARD_HOURLY_MS,
  // Expose maps for testing / debugging
  _lastLeaderboardRefresh: lastLeaderboardRefresh,
  _lastHourlyRefresh: lastHourlyRefresh,
  _lastLeaderboardAttempt: lastLeaderboardAttempt,
};
