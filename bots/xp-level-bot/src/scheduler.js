/**
 * Scheduler XP Bot:
 * - Minütlich: prüft ob Tag für Gilde gewechselt (0 Uhr in Guild-TZ) -> daily decay
 *   (10% Basis, +5 Prozentpunkte pro zusätzlichem inaktivem Tag)
 * - Stündlich: Leaderboard neu rendern (zeitbasiert: wenn >55min seit letztem Refresh)
 * - Zusätzlich bei Level-Up/Down: Leaderboard aktualisieren, wenn die letzte
 *   Aktualisierung länger als 10 Minuten her ist (Throttle)
 * - Selbstheilung: schlägt die Command-Registrierung beim Start fehl (z.B.
 *   Discord-Hickup), wird sie hier regelmäßig erneut versucht, bis sie klappt –
 *   sonst würden neue Commands (z.B. /level_roles) dauerhaft fehlen.
 * - 5min: Backup flush (über store interval)
 */

const { todayKey } = require('./logic');
const { buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { syncLevelRolesForUser } = require('./level-roles');
const { refreshRankNicknames } = require('./nicknames');

const MINUTE_MS = 60_000;
const LEADERBOARD_MIN_REFRESH_MS = 10 * 60 * 1000;
const LEADERBOARD_HOURLY_MS = 55 * 60 * 1000; // stündlich (mit Alter-Toleranz)
const COMMAND_RETRY_EVERY_TICKS = 15; // alle 15 min erneut versuchen

// Wann wurde das Leaderboard pro Gilde zuletzt (erfolgreich) aktualisiert?
const lastLeaderboardRefresh = new Map(); // guildId -> timestamp
// Wann wurde es zuletzt VERSUCHT (dämpft Log-/API-Spam bei dauerhaften Fehlern)
const lastLeaderboardAttempt = new Map(); // guildId -> timestamp

function isLeaderboardRefreshDue(guildId, now = Date.now()) {
  const last = lastLeaderboardRefresh.get(guildId) || 0;
  return (now - last) >= LEADERBOARD_MIN_REFRESH_MS;
}

function noteLeaderboardRefresh(guildId, now = Date.now()) {
  lastLeaderboardRefresh.set(guildId, now);
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
 * Konfiguration verworfen. Ein kurzer Cache-/API-Aussetzer löscht sie NICHT –
 * sonst würden Leaderboard-Refresh & Decay nach jedem Discord-Hickup ausfallen,
 * bis jemand /setup erneut ausführt.
 */
async function resolveGuild(ctx, guildId){
  const cached = ctx.client.guilds.cache.get(guildId);
  if (cached) return { guild: cached, gone: false };
  try {
    const guild = await ctx.client.guilds.fetch(guildId);
    return { guild: guild || null, gone: !guild };
  } catch (err) {
    if (err?.code === 10004) return { guild: null, gone: true }; // Unknown Guild
    return { guild: null, gone: false }; // transient – nächstes Mal wieder
  }
}

let tickRunning = false;

async function tick(ctx, counter){
  // Kein Überlappen: Wenn ein Tick (z.B. durch Registrierungs-Retries) lange
  // läuft, wird der nächste minütliche Tick übersprungen statt parallel zu laufen.
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

  // Selbstheilende Command-Registrierung: wenn der Start-Versuch scheiterte
  // (false), hier alle 15 Minuten erneut versuchen. undefined = läuft gerade,
  // true = erfolgreich → dann nichts tun.
  if (ctx.commandsRegistered === false && counter % COMMAND_RETRY_EVERY_TICKS === 1) {
    try {
      const { registerCommands } = require('./commands');
      await registerCommands(ctx);
    } catch {}
  }
  // Alle 24h einmal proaktiv neu registrieren (idempotent), damit sich das
  // Command-Set auch ohne Neustart selbst heilt.
  if (counter > 0 && counter % (24 * 60) === 0) {
    ctx.commandsRegistered = false;
  }

  for (const entry of ctx.store.getAllGuilds()){
    const { guild, gone } = await resolveGuild(ctx, entry.guildId);
    if (gone){ ctx.store.deleteGuild(entry.guildId); continue; }
    if (!guild){ ctx.logger.warn(`[xp-level-bot] Gilde ${entry.guildId} aktuell nicht erreichbar – überspringe Tick (Config bleibt)`); continue; }
    try {
      // Daily decay check – needs per guild tz
      const dayKey = todayKey(entry.lang);
      if (entry.lastDailyDecay !== dayKey) {
        // ist es gerade nach 0 Uhr? Wir nehmen am einfachsten: wenn Tag gewechselt hat, decay ausführen
        // Aber sicherstellen dass nicht bei Setup Tag erneut decay passiert sofort: lastDailyDecay beim Setup = todayKey, daher heute kein decay
        // Beim ersten Tick nach Mitternacht dayKey != lastDailyDecay => decay
        await applyDailyDecayForGuild(ctx, entry, guild);
        entry.lastDailyDecay = dayKey;
        ctx.store.setGuild(entry);
      }

      // Geplante Bonus-Belohnungen (2–4 Drops/Tag, zeitgesteuert) prüfen.
      if (ctx.bonusDropper) {
        try {
          await ctx.bonusDropper.checkScheduled(entry, guild, now);
        } catch (e) {
          ctx.logger.warn(`[xp-level-bot] Bonus-Scheduler Fehler Gilde ${entry.guildId}:`, e.message);
        }
      }

      // Stündlich Leaderboard – zeitbasiert statt Tick-Zähler, damit es auch
      // nach Prozess-Pausen/Restarts zuverlässig (und sofort beim Start) kommt.
      // Bei dauerhaften Fehlern (z.B. Rechte weg) frühestens alle 10 min erneut.
      const lastLb = lastLeaderboardRefresh.get(entry.guildId) || 0;
      const lastLbTry = lastLeaderboardAttempt.get(entry.guildId) || 0;
      if (counter === 0 || (Date.now() - lastLb >= LEADERBOARD_HOURLY_MS && Date.now() - lastLbTry >= LEADERBOARD_MIN_REFRESH_MS)) {
        lastLeaderboardAttempt.set(entry.guildId, Date.now());
        await refreshLeaderboard(ctx, entry, guild, now);
      }
    } catch(err){
      ctx.logger.warn(`[xp-level-bot] Tick Fehler Gilde ${entry.guildId}:`, err.message);
    }
  }

  // Auf überschüssige flushes verzichten – store backup intervall macht das
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
  await refreshLeaderboard(ctx, entry, guild, new Date());
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
    // Aktivitäts-Streak führen: wer in den letzten 24h XP verdient hat, bleibt
    // bei 10%. Ohne verdiente XP steigt der Anteil pro inaktivem Tag um 5 Punkte
    // (1. inaktiver Tag = 10%, dann 15%, 20%, 25%, …).
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
    ctx.store.setUser(u); // auch den Inaktivitäts-Streak persistieren
  }
  ctx.logger.info(`[xp-level-bot] Daily decay ${guild.name}: ${decayed} Nutzer angepasst, ${leveledDownUsers.length} Level-Downs`);
  await ctx.store.flush();
  // Announcements für Level-Downs im Haupt-Chat
  for (const ld of leveledDownUsers) {
    try {
      let ch = await guild.channels.fetch(entry.mainChannelId).catch(()=>null);
      if (!ch || !ch.isTextBased()) continue;
      const { buildLevelDownEmbed } = require('./embed-builder');
      const container = buildLevelDownEmbed({ lang, userId: ld.userId, level: ld.level, xp: ld.xp });
      await ch.send(componentsV2Payload([container])).catch(()=>{});
      // Nickname: Medaillen zuverlässig aktualisieren (Top 5 + betroffener Nutzer),
      // damit verrückte Plätze auch im Anzeigenamen ankommen
      await refreshRankNicknames(ctx, guild, ld.userId, lang).catch(()=>{});
      // Level-Rollen: fehlende adden, vorhandene werden nie entfernt
      await syncLevelRolesForUser({ ctx, guild, userId: ld.userId, level: ld.level }).catch(()=>{});
    } catch{}
  }
  // Nach dem Decay das Leaderboard direkt aktualisieren – auch wenn sich keine
  // Werte geändert haben, damit der „zuletzt aktualisiert“-Stempel stimmt.
  await refreshLeaderboard(ctx, entry, guild, new Date());
}

async function refreshLeaderboard(ctx, entry, guild, now){
  try {
    const channel = await ctx.client.channels.fetch(entry.leaderboardChannelId).catch(()=>null);
    if (!channel || !channel.isTextBased()) {
      ctx.logger.warn(`[xp-level-bot] Leaderboard-Kanal ${entry.leaderboardChannelId} nicht erreichbar (${guild.name})`);
      return;
    }
    const entries = ctx.store.getLeaderboard(entry.guildId, 15);
    const container = buildLeaderboardEmbed({ lang: entry.lang, entries, now, guildName: guild.name });

    let msg = null;
    if (entry.leaderboardMessageId) msg = await channel.messages.fetch(entry.leaderboardMessageId).catch(()=>null);
    // Falls Nachricht nicht gefunden, suche via Marker
    if (!msg) {
      const found = await ctx.store.findLeaderboardMessage(guild, ctx.client);
      if (found) {
        msg = found.message;
        entry.leaderboardChannelId = found.channel.id;
        entry.leaderboardMessageId = found.message.id;
      }
    }

    if (msg) {
      try {
        await msg.edit(componentsV2Payload([container]));
        noteLeaderboardRefresh(entry.guildId);
        ctx.store.setGuild(entry);
        ctx.logger.info(`[xp-level-bot] Leaderboard aktualisiert (${guild.name})`);
        return;
      } catch (err) {
        // Edit fehlgeschlagen (z.B. Nachricht gelöscht oder Rechte weg) ->
        // alte Nachricht entfernen und neu senden, damit keine veraltete Zeit stehen bleibt
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
      if (!newMsg) return;
      entry.leaderboardMessageId = newMsg.id;
      noteLeaderboardRefresh(entry.guildId);
      ctx.store.setGuild(entry);
      ctx.logger.info(`[xp-level-bot] Leaderboard neu gesendet (${guild.name})`);
    }
  } catch(e){
    ctx.logger.warn(`[xp-level-bot] Leaderboard refresh failed ${guild.name}:`, e.message);
  }
}

module.exports = {
  startScheduler,
  tick,
  refreshLeaderboard,
  maybeRefreshLeaderboard,
  isLeaderboardRefreshDue,
  noteLeaderboardRefresh,
  applyDailyDecayForGuild,
  LEADERBOARD_MIN_REFRESH_MS,
  LEADERBOARD_HOURLY_MS,
};
