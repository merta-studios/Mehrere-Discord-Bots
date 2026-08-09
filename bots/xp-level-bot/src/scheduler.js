/**
 * Scheduler XP Bot:
 * - Minütlich: prüft ob Tag für Gilde gewechselt (0 Uhr in Guild-TZ) -> daily decay
 * - Stündlich: Leaderboard neu rendern
 * - 5min: Backup flush (über store interval)
 */

const { todayKey, tzParts } = require('./logic');
const { tzOf } = require('./languages');
const { buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

const MINUTE_MS = 60_000;

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
        // Nick update
        await updateNicknameForUser(ctx, guild, ld.userId, ld.level, lang);
      } catch{}
    }
    // Nach decay Leaderboard direkt aktualisieren
    await refreshLeaderboard(ctx, entry, guild, new Date());
  }
}

async function refreshLeaderboard(ctx, entry, guild, now){
  try {
    const channel = await ctx.client.channels.fetch(entry.leaderboardChannelId).catch(()=>null);
    if (!channel || !channel.isTextBased()) return;
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
      await msg.edit(componentsV2Payload([container])).catch(async ()=>{
        // Falls edit failed (z.B. gelöscht), neu senden
        const newMsg = await channel.send(componentsV2Payload([container])).catch(()=>null);
        if (newMsg) entry.leaderboardMessageId = newMsg.id;
      });
    } else {
      const newMsg = await channel.send(componentsV2Payload([container])).catch(()=>null);
      if (newMsg) entry.leaderboardMessageId = newMsg.id;
    }
    ctx.store.setGuild(entry);
  } catch(e){
    ctx.logger.warn(`[xp-level-bot] Leaderboard refresh failed ${guild.name}:`, e.message);
  }
}

async function updateNicknameForUser(ctx, guild, userId, level, lang){
  try {
    const member = await guild.members.fetch(userId).catch(()=>null);
    if (!member) return;
    const rankInfo = ctx.store.getRank(guild.id, userId);
    const rank = rankInfo?.rank || null;
    const { formatNickname, stripLvlTag } = require('./logic');
    const display = stripLvlTag(member.displayName || member.user.username);
    const newNick = formatNickname(level, display, rank && rank<=15 ? rank : null);
    if (member.nickname === newNick) return;
    await member.setNickname(newNick).catch(async (err)=>{
      if (err?.code === 50013 || err?.status===403){
        let ch=null;
        try{ ch= await guild.channels.fetch(ctx.store.getGuild(guild.id)?.mainChannelId).catch(()=>null);}catch{}
        if(!ch||!ch.isTextBased()) return;
        const { t } = require('./languages');
        const { smallContainer } = require('./embed-builder');
        const { componentsV2Payload } = require('./message-payload');
        const key = `_nickFail_${userId}`;
        if (Date.now() - (member._nickFailAt||0) < 3600000) return;
        member._nickFailAt = Date.now();
        const msg = t('nickFail', lang, {user:`<@${userId}>`});
        await ch.send(componentsV2Payload([smallContainer(null, msg)])).catch(()=>{});
      }
    });
  } catch{}
}

module.exports = { startScheduler, tick };
