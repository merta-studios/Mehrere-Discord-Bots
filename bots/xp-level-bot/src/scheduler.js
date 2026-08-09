/**
 * Scheduler XP Bot:
 * - Minütlich: prüft ob Tag für Gilde gewechselt (0 Uhr in Guild-TZ) -> daily decay
 * - Stündlich: Leaderboard neu rendern
 * - Zusätzlich bei Level-Up/Down: Leaderboard aktualisieren, wenn die letzte
 *   Aktualisierung länger als 10 Minuten her ist (Throttle)
 * - 5min: Backup flush (über store interval)
 */

const { todayKey } = require('./logic');
const { buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { syncLevelRolesForUser } = require('./level-roles');
const { refreshRankNicknames } = require('./nicknames');

const MINUTE_MS = 60_000;
const LEADERBOARD_MIN_REFRESH_MS = 10 * 60 * 1000;

// Wann wurde das Leaderboard pro Gilde zuletzt (erfolgreich) aktualisiert?
const lastLeaderboardRefresh = new Map(); // guildId -> timestamp

function isLeaderboardRefreshDue(guildId, now = Date.now()) {
  const last = lastLeaderboardRefresh.get(guildId) || 0;
  return (now - last) >= LEADERBOARD_MIN_REFRESH_MS;
}

function noteLeaderboardRefresh(guildId, now = Date.now()) {
  lastLeaderboardRefresh.set(guildId, now);
}

function startScheduler({ ctx }){
  let counter = 0;
  const timer = setInterval(()=>{ counter+=1; void tick(ctx, counter); }, MINUTE_MS);
  timer.unref?.();
  // initial tick after 10s for faster first leaderboard
  setTimeout(()=> void tick(ctx, 0), 10_000);
  return ()=> clearInterval(timer);
}

async function tick(ctx, counter){
  const now = new Date();
  for (const entry of ctx.store.getAllGuilds()){
    const guild = ctx.client.guilds.cache.get(entry.guildId);
    if (!guild){ ctx.store.deleteGuild(entry.guildId); continue; }
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

      // Stündlich Leaderboard – counter %60 ==0 oder beim Start (counter 0)
      const hourly = counter % 60 === 0;
      if (hourly) {
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
  const { applyDailyDecay } = require('./logic');
  let decayed = 0;
  let leveledDownUsers = [];
  for (const u of users){
    const before = { level: u.level, xp: u.xp };
    const res = applyDailyDecay(u);
    if (res.level !== before.level || res.xp !== before.xp) {
      u.level = res.level;
      u.xp = res.xp;
      ctx.store.setUser(u);
      decayed++;
      if (res.leveledDown) leveledDownUsers.push({ userId: u.userId, level: res.level, xp: res.xp });
    }
  }
  if (decayed) {
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
    // Nach decay Leaderboard direkt aktualisieren
    await refreshLeaderboard(ctx, entry, guild, new Date());
  }
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
  LEADERBOARD_MIN_REFRESH_MS,
};
