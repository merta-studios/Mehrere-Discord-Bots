/**
 * ============================================================================
 *  ⭐ XP Level Bot – RAM-first, Turso-persistiert, 10 Sprachen, krasses Design
 *
 *  Features:
 *  - /setup [leaderboard] [mainchat] [language] – nur Admins, 10 Sprachen
 *  - XP pro Nachricht: Worte zählen (Leerzeichen+Zeilen), Spam-Erkennung krass,
 *    3XP pro Wort bis max 30XP, 30s Cooldown
 *  - Level-Kurve: Lvl1->2 80XP, Lvl99->100 ~2000XP, sanft quadratisch
 *  - Täglich 0 Uhr (TZ pro Sprache): 7% Decay, bei 0 => Level-1 und 93%
 *  - Voice 25XP/min: nicht muted, mit mind. 1 anderer, >=5s gesprochen, Pause nötig
 *  - Leaderboard stündlich, Container V2, Top15, Decay-Hinweis, Zeit+TZ
 *  - /rank für alle, /help, /admin_set_bot_profile, /adminpanel (Owner DM)
 *  - Nicknames: [Lvl X 🥇] Name (Top3 Medaillen), bei Erfolg sofort, 32 Zeichen
 *  - Bei Verlassen: Daten löschen
 *  - Turso: RAM-first, Dirty-Tracking, Batch-Flush bei SIGTERM + alle 5min Backup
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, ChannelType, PermissionsBitField } = require('discord.js');

const { createXpStore } = require('./src/store');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');
const { startScheduler } = require('./src/scheduler');
const { createVoiceTracker } = require('./src/voice');

module.exports = {
  id: 'xp-level-bot',
  name: 'XP Level Bot',
  tokenEnv: 'XP_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const { REST } = require('discord.js');
    const store = createXpStore({ logger, env });
    await store.init();
    store.startBackupInterval(5*60*1000);

    // Graceful flush on termination (Render SIGTERM)
    const flushAndLog = async (sig) => {
      logger.info(`[xp-level-bot] ${sig} – flushe RAM -> Turso/File...`);
      try { await store.flush({force:true}); logger.info('[xp-level-bot] Flush ok vor Shutdown'); } catch(e){ logger.error('[xp-level-bot] Flush fail', e.message); }
    };
    process.on('SIGTERM', ()=> void flushAndLog('SIGTERM'));
    process.on('SIGINT', ()=> void flushAndLog('SIGINT'));

    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(env('XP_BOT_OWNER_ID','') || env('BIRTHDAY_BOT_OWNER_ID','') || '').trim().replace(/^<@!?(\d+)>$/,'$1'),
      devGuildId: env('XP_BOT_GUILD_ID','') || env('BIRTHDAY_BOT_GUILD_ID',''),
      rest: new REST({version:'10'}).setToken(token),
      store,
      panelSessions: new Map(),
    };

    // Scheduler & VoiceTracker werden nach Ready gestartet, aber vorher initialisieren
    let schedulerStop = null;
    let voiceTracker = null;

    // Status: zeigt Anzahl der verwalteten Server
    const updatePresence = () => {
      const count = client.guilds.cache.size;
      client.user.setPresence({
        activities: [{ name: `Managing ${count} servers 🏆 | /help`, type: ActivityType.Playing }],
        status: 'online',
      }).catch(()=>{});
    };

    // ---- Nickname-Helfer: setzt den Nick, wenn möglich, sonst Hinweis ----
    // Cooldown gegen Hinweis-Spam pro Server+Nutzer (1h)
    const nickFailCooldown = new Map();

    function canManageNickname(guild, botMember, targetMember) {
      if (!botMember || !targetMember) return false;
      const perms = botMember.permissions;
      if (!perms?.has(PermissionsBitField.Flags.ManageNicknames) && !perms?.has(PermissionsBitField.Flags.Administrator)) return false;
      // Der Server-Owner steht immer über allen Rollen – der Bot kann ihn nicht umbenennen
      if (targetMember.id === guild.ownerId) return false;
      const botHigh = botMember.roles.highest.position;
      const targetHigh = targetMember.roles.highest.position;
      return botHigh > targetHigh;
    }

    async function sendNickFailHint(guild, userId, lang) {
      // Discord erlaubt es nie, den Server-Owner umzubenennen –
      // für den Owner gibt es daher keinen sinnvollen Hinweis (Ausnahme, Hinweis bleibt für alle anderen)
      if (String(userId) === String(guild.ownerId)) return;
      const cfg = store.getGuild(guild.id);
      const key = `${guild.id}:${userId}`;
      const now = Date.now();
      if (nickFailCooldown.has(key) && now - nickFailCooldown.get(key) < 3600000) return;
      nickFailCooldown.set(key, now);
      const { t } = require('./src/languages');
      const { smallContainer } = require('./src/embed-builder');
      const { componentsV2Payload } = require('./src/message-payload');
      const msgText = t('nickFail', lang, { user: `<@${userId}>` });
      const ch = await guild.channels.fetch(cfg?.mainChannelId).catch(()=>null);
      if (ch && ch.isTextBased()) {
        await ch.send(componentsV2Payload([smallContainer(null, msgText)])).catch(()=>{});
      }
    }

    async function ensureNickname(ctx, guild, userId, level, lang) {
      const member = await guild.members.fetch(userId).catch(()=>null);
      if (!member) return false;
      const rankInfo = store.getRank(guild.id, userId);
      const rank = rankInfo?.rank || null;
      const { formatNickname, stripLvlTag } = require('./src/logic');
      const display = stripLvlTag(member.displayName || member.user.username);
      const newNick = formatNickname(level, display, rank && rank<=3 ? rank : null);
      if (member.nickname === newNick) return true;
      if (!canManageNickname(guild, guild.members.me, member)) {
        await sendNickFailHint(guild, userId, lang);
        return false;
      }
      try {
        await member.setNickname(newNick);
        return true;
      } catch(err){
        await sendNickFailHint(guild, userId, lang);
        return false;
      }
    }

    client.once(Events.ClientReady, async () => {
      updatePresence();
      await registerCommands(ctx);
      // Scan for existing leaderboards that are not in store (self-healing find)
      for (const guild of client.guilds.cache.values()){
        if (store.getGuild(guild.id)) continue;
        try {
          const found = await store.findLeaderboardMessage(guild, client);
          if (found) {
            // Auto-recover config? We don't know lang/main – can't. Just log.
            logger.info(`[xp-level-bot] Leaderboard auf ${guild.name} gefunden aber kein Config – bitte /setup neu ausführen.`);
          }
        } catch {}
      }
      schedulerStop = startScheduler({ ctx });
      voiceTracker = createVoiceTracker({ client, store, logger, getGuildConfig: (gid)=> store.getGuild(gid) });
      voiceTracker.start();
      logger.info(`[xp-level-bot] Bereit auf ${client.guilds.cache.size} Servern – ${store.getAllUsersCount()} Nutzer im RAM`);
    });

    // ---------------- Interactions ----------------
    client.on('interactionCreate', (interaction)=>{ void handleInteraction(ctx, interaction); });

    // ---------------- Message XP ----------------
    client.on('messageCreate', async (msg)=>{
      try {
        if (msg.author?.bot) return;
        if (!msg.guild) return;
        if (msg.system) return;

        const cfg = store.getGuild(msg.guild.id);
        if (!cfg) return; // nicht eingerichtet

        // Optional: ignorieren falls Nachricht von Webhook? Lassen wir zu
        const content = msg.content || '';
        if (!content.trim()) return;

        const { calculateXpForMessage, isSpamMessage, isOnCooldown, applyXpGain } = require('./src/logic');

        // Spam Gesamtnachricht? Krass Erkennung – wenn Nachricht als Spam gilt, kein XP
        if (isSpamMessage(content)) return;

        const { valid, xp } = calculateXpForMessage(content);
        if (xp <= 0 || valid === 0) return;

        const user = store.ensureUser(msg.guild.id, msg.author.id);
        if (isOnCooldown(user.lastXpGain, Date.now())) return;

        // XP vergeben
        const beforeLevel = user.level;
        const res = applyXpGain(user, xp);
        user.level = res.level;
        user.xp = res.xp;
        user.lastXpGain = Date.now();
        store.setUser(user);
        // Nicht jede Nachricht flushen – Dirty tracking reicht, Backup alle 5min + SIGTERM
        // Bei Level-Up sofort flushen damit nichts verloren geht
        if (res.leveled) await store.flush();

        if (res.leveledUp || res.leveledDown) {
          await handleLevelChange(ctx, msg, user, res, cfg);
        }
      } catch(e){
        logger.warn('[xp-level-bot] messageCreate Fehler:', e.message);
      }
    });

    async function handleLevelChange(ctx, sourceMsg, user, res, cfg){
      const guild = sourceMsg.guild;
      const lang = cfg.lang || 'de';
      const { buildLevelUpEmbed, buildLevelDownEmbed, smallContainer } = require('./src/embed-builder');
      const { componentsV2Payload } = require('./src/message-payload');

      // Nickname sofort updaten (oder Hinweis senden, falls Rechte fehlen)
      try {
        await ensureNickname(ctx, guild, user.userId, res.level, lang);
      } catch(e){ logger.warn('[xp-level-bot] nick update fail', e.message); }

      // Announcement: versuche erst bei der Nachricht zu replyen, sonst Haupt-Chat
      const container = res.leveledUp ? buildLevelUpEmbed({lang, userId:user.userId, level:res.level, xp:res.xp})
                                     : buildLevelDownEmbed({lang, userId:user.userId, level:res.level, xp:res.xp});
      let sent = false;
      try {
        // Versuche reply auf die auslösende Nachricht
        if (sourceMsg.channel?.isTextBased() && sourceMsg.channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages)){
          await sourceMsg.reply(componentsV2Payload([container])).catch(()=>{});
          sent = true;
        }
      } catch{}
      if (!sent) {
        try {
          let ch = await guild.channels.fetch(cfg.mainChannelId).catch(()=>null);
          if (!ch || !ch.isTextBased()) ch = guild.systemChannel;
          if (ch && ch.isTextBased()) await ch.send(componentsV2Payload([container])).catch(()=>{});
        } catch{}
      }
    }

    // ---------------- Guild Member Remove: Daten löschen ----------------
    client.on('guildMemberRemove', async (member)=>{
      try {
        const guildId = member.guild?.id;
        if (!guildId) return;
        const u = store.getUser(guildId, member.id);
        if (u) {
          store.deleteUser(guildId, member.id);
          logger.info(`[xp-level-bot] Nutzer ${member.id} verließ ${member.guild.name} – XP Daten gelöscht (Lvl ${u.level})`);
          // sofort flushen damit Löschung persistiert
          await store.flush();
        }
      } catch(e){ logger.warn('[xp-level-bot] guildMemberRemove fail', e.message); }
    });

    // ---------------- Guild Delete / Create ----------------
    client.on('guildDelete', (guild)=>{
      store.deleteGuild(guild.id);
      void store.flush();
      logger.info(`[xp-level-bot] Server ${guild.name} verlassen – Daten bereinigt`);
      updatePresence();
    });
    client.on('guildCreate', (guild)=>{
      void sendJoinNotice(ctx, guild);
      updatePresence();
    });

    // ---------------- Nickname bei Serverbeitritt (ab Level 1) ----------------
    client.on('guildMemberAdd', async (member)=>{
      try {
        if (!member.guild) return;
        const cfg = store.getGuild(member.guild.id);
        if (!cfg) return;
        const existing = store.getUser(member.guild.id, member.id);
        const level = existing ? existing.level : 1;
        await ensureNickname(ctx, member.guild, member.id, level, cfg.lang);
      } catch(e){ logger.warn('[xp-level-bot] guildMemberAdd nick fail', e.message); }
    });

    // ---------------- Graceful shutdown helpers for loader ----------------
    // Der globale loader ruft client.destroy() auf – wir hooken davor
    const originalDestroy = client.destroy.bind(client);
    client.destroy = () => {
      try { if (schedulerStop) schedulerStop(); } catch{}
      try { if (voiceTracker) voiceTracker.stop(); } catch{}
      void store.flush({force:true}).catch(()=>{});
      store.stopBackupInterval();
      return originalDestroy();
    };
  },
};
