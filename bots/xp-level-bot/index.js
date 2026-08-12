/**
 * ============================================================================
 *  ⭐ XP Level Bot – RAM-first, Turso-persistiert, 10 Sprachen, krasses Design
 *
 *  Features:
 *  - /setup [leaderboard] [mainchat] [language] – nur Admins, 10 Sprachen
 *  - XP pro Nachricht: Worte zählen (Leerzeichen+Zeilen), Spam-Erkennung krass,
 *    3XP pro Wort bis max 30XP, 30s Cooldown
 *  - Medien-XP: Bilder, Videos, Sprachnachrichten & Sticker geben ausgeglichen 15XP
 *  - Level-Up-Zeile als "## "-Heading (Markdown Lv2) – größerer Text
 *  - Level-Rollen: /level_roles (Admin-Formular) erstellt/sortiert Belohnungsrollen,
 *    Sync bei Level Up/Down (mehrere Rollen, nie entfernen)
 *  - Level-Kurve: Lvl1->2 80XP, Lvl99->100 ~2000XP, sanft quadratisch
 *  - Bonus-Drops: Geplant & zeitgesteuert – 2–4 feste Termine pro Tag (06:00–23:59
 *    Ortszeit, mind. 1h Abstand, pro Server unterschiedlich & stabil) senden eine
 *    XP-Belohnung (20–40 XP) mit „Einsammeln“-Button; der erste Klick gewinnt,
 *    der Drop ist 1 Stunde gültig und überlebt Restarts. Einsammeln setzt den Decay wieder auf 5%
 *  - Täglich 0 Uhr (TZ pro Sprache): 5% Decay; wer 24h keine XP verdient hat,
 *    bekommt +3 Prozentpunkte pro weiterem inaktivem Tag (5→8→11→14%…),
 *    Restbetrag wird bei Level-Down korrekt ins vorige Level übernommen
 *  - Voice 25XP/min: nicht muted, mit mind. 1 anderer, >=5s gesprochen, Pause nötig
 *  - Leaderboard stündlich + bei Level-Up/Down (max alle 10 Min), Container V2,
 *    Top15, kurzer Decay-Hinweis, Zeit+TZ, Self-Healing über Marker
 *  - /rank für alle, /help, /admin_set_bot_profile, /adminpanel (Owner DM)
 *  - /toggle_nicknames (Admin, nach /setup): Level-Tags in Nicknames an/aus (Standard: an)
 *  - /sync_nicknames (Admin, nach /setup): alle Mitglieder-Nicknames mit Ladeanzeige abgleichen
 *  - Nicknames: [Lvl X 🥇] Name (Top3 Medaillen), bei Erfolg sofort, 32 Zeichen
 *  - Bei Verlassen: Daten löschen
 *  - Turso: RAM-first, Dirty-Tracking, Batch-Flush bei SIGTERM + alle 5min Backup
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, MessageFlags, Routes } = require('discord.js');

const { createXpStore } = require('./src/store');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');
const { startScheduler } = require('./src/scheduler');
const { createVoiceTracker } = require('./src/voice');
const { syncLevelRolesForUser } = require('./src/level-roles');
const { ensureNickname, refreshRankNicknames, maybeRefreshRankNicknames } = require('./src/nicknames');
const { sendLevelAnnouncement } = require('./src/level-announcements');

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
    store.startBackupInterval(5 * 60 * 1000);

    // Graceful flush on termination (Render SIGTERM)
    const flushAndLog = async (sig) => {
      logger.info(`[xp-level-bot] ${sig} – flushe RAM -> Turso/File...`);
      try {
        await store.flush({ force: true });
        logger.info('[xp-level-bot] Flush ok vor Shutdown');
      } catch (e) {
        logger.error('[xp-level-bot] Flush fail', e.message);
      }
    };
    process.on('SIGTERM', () => void flushAndLog('SIGTERM'));
    process.on('SIGINT', () => void flushAndLog('SIGINT'));

    const devGuildId = String(env('XP_BOT_GUILD_ID', '')).trim().replace(/^<@!?(\d+)>$/, '$1') || null;

    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(env('XP_BOT_OWNER_ID', '') || env('BIRTHDAY_BOT_OWNER_ID', '') || '')
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      // Wichtig: Der XP-Bot darf NICHT auf BIRTHDAY_BOT_GUILD_ID zurückfallen.
      // Sonst werden XP-Commands nur in dieser einen Birthday-Dev-Gilde
      // registriert; neue globale Commands wie /level_roles tauchen dann auf
      // den echten Servern nicht auf.
      devGuildId,
      rest: new REST({ version: '10' }).setToken(token),
      store,
      // WICHTIG: bewusst NICHT mit Store-IDs vorbefüllen! Ungeprüfte persistierte
      // Snowflakes (z. B. alte Dev-Guild-IDs im globalen Slot) wurden sonst vor
      // jeder Verifizierung in /help gerendert und erzeugten die gemeldeten
      // toten Chips von /toggle_nicknames & /sync_nicknames („Kein Befehl
      // gefunden“). ensureCommandIds füllt den Slot ausschließlich mit gegen
      // Discord geprüften oder frisch registrierten IDs.
      commandIds: {},
      // Scope der gespeicherten Command-IDs: 'global' | 'guild:<id>' | null
      commandIdScope: store.getCommandIdScope ? store.getCommandIdScope() : null,
      guildCommandIds: new Map(),
      panelSessions: new Map(),
    };

    // Scheduler & VoiceTracker werden nach Ready gestartet, aber vorher initialisieren
    let schedulerStop = null;
    let voiceTracker = null;

    // Status: zeigt Anzahl der verwalteten Server
    const updatePresence = () => {
      const count = client.guilds.cache.size;
      client.user
        .setPresence({
          activities: [{ name: `Managing ${count} servers 🏆 | /help`, type: ActivityType.Playing }],
          status: 'online',
        })
        .catch(() => {});
    };

    client.once(Events.ClientReady, async () => {
      updatePresence();

      // Laute, sofort sichtbare Warnung: mit gesetztem Dev-Guild-Scope werden
      // ALLE Commands (inkl. /toggle_nicknames & /sync_nicknames) NUR in dieser
      // einen Gilde registriert – auf normalen Servern fehlen sie dann und
      // Discord meldet beim Anklicken „Kein Befehl gefunden“. Häufige Ursache
      // für genau den gemeldeten Fehler!
      if (ctx.devGuildId) {
        logger.warn(
          `[xp-level-bot] XP_BOT_GUILD_ID ist gesetzt (${ctx.devGuildId}) – die Commands existieren NUR in dieser einen Gilde. ` +
            'Auf allen anderen Servern erscheinen /toggle_nicknames, /sync_nicknames & Co. NICHT. ' +
            'Für den Produktivbetrieb die Variable in Render leeren/entfernen, damit global registriert wird!'
        );
      }

      // Command-Registrierung beim Start zuverlässig ausführen und awaiten
      try {
        await registerCommands(ctx);
        // Direkt danach prüfen (und laut loggen), ob Discord wirklich ALLE
        // Commands serviert – fehlende werden dabei sofort nachregistriert.
        const { verifyCommandsLive } = require('./src/commands');
        await verifyCommandsLive(ctx);
      } catch (err) {
        logger.error('[xp-level-bot] Initial-Command-Registrierung fehlgeschlagen:', err.message);
      }

      // Scan for existing leaderboards that are not in store (self-healing find)
      for (const guild of client.guilds.cache.values()) {
        if (store.getGuild(guild.id)) continue;
        try {
          const found = await store.findLeaderboardMessage(guild, client);
          if (found) {
            logger.info(
              `[xp-level-bot] Leaderboard auf ${guild.name} gefunden aber kein Config – bitte /setup neu ausführen.`
            );
          }
        } catch {}
      }
      schedulerStop = startScheduler({ ctx });
      voiceTracker = createVoiceTracker({ client, store, logger, getGuildConfig: (gid) => store.getGuild(gid) });
      voiceTracker.start();
      logger.info(
        `[xp-level-bot] Bereit auf ${client.guilds.cache.size} Servern – ${store.getAllUsersCount()} Nutzer im RAM`
      );
    });

    // ---------------- Bonus-Belohnungen (Zufalls-XP-Drops im Haupt-Chat) ----------------
    const { createBonusDropper } = require('./src/bonus');
    const bonusDropper = createBonusDropper({
      ctx,
      // Level-Up/Down eines Bonus-Gewinners: gleiche Nachbereitung wie Chat-XP
      // Quelle ist Bonus (nicht Text) -> Level-Up immer in Haupt-Chat
      onLevelChange: async (guild, cfg, user, res, sourceMsg) => {
        try {
          await handleLevelChange(
            ctx,
            sourceMsg && sourceMsg.guild ? sourceMsg : { guild, channel: null },
            user,
            res,
            cfg,
            { source: 'bonus' }
          );
        } catch {}
      },
      onXpOnly: async (guild, cfg, user, userId) => {
        try {
          const rankInfo = store.getRank(guild.id, userId);
          if (rankInfo && rankInfo.rank <= 3) {
            await maybeRefreshRankNicknames(ctx, guild, userId, cfg.lang || 'de');
          }
        } catch {}
      },
    });
    ctx.bonusDropper = bonusDropper;

    // ---------------- Interactions ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Message XP ----------------
    client.on('messageCreate', async (msg) => {
      try {
        // Bots UND Webhooks bekommen nichts: kein XP, kein Level, kein Nickname, keine Boni
        if (msg.author?.bot) return;
        if (msg.webhookId) return;
        if (!msg.guild) return;
        if (msg.system) return;

        const cfg = store.getGuild(msg.guild.id);
        // nicht eingerichtet (oder nur Level-Rollen ohne /setup): kein XP, kein Bonus
        if (!cfg || !cfg.leaderboardChannelId) return;

        // Bonus-System läuft zeitgesteuert (geplante Drops, siehe Scheduler) –
        // es hängt nicht mehr an Nachrichten-Aktivität im Haupt-Chat.

        const content = msg.content || '';

        // Medien (Bilder, Videos, Sprachnachrichten, Sticker) zählen als XP-Träger
        const hasMedia = Boolean(
          (msg.attachments &&
            msg.attachments.some((a) =>
              /^(image|video|audio)\//i.test(a.contentType || a.content_type || '')
            )) ||
            (msg.stickers && msg.stickers.size > 0) ||
            (msg.flags && msg.flags.has(MessageFlags.IsVoiceMessage))
        );
        if (!content.trim() && !hasMedia) return;

        const { calculateXpForMessage, isSpamMessage, isOnCooldown, applyXpGain } = require('./src/logic');

        // Spam Gesamtnachricht? Krass Erkennung – wenn Nachricht als Spam gilt, kein XP
        // (nur bei Text-Inhalt; reine Medien-Nachrichten sind von Natur aus nicht spam-bar)
        if (content.trim() && isSpamMessage(content)) return;

        const { valid, xp } = calculateXpForMessage(content, { hasMedia });
        if (xp <= 0) return;

        // Merken, ob der Nutzer ganz neu ist: Wer bei Level 1 seine allerersten
        // XP bekommt, soll SOFORT den Nickname-Tag [Lvl 1] tragen – nicht erst
        // ab dem ersten Level-Aufstieg.
        const isFirstEverXp = !store.getUser(msg.guild.id, msg.author.id);
        const user = store.ensureUser(msg.guild.id, msg.author.id);
        const now = Date.now();
        if (isOnCooldown(user.lastXpGain, now)) return;

        // XP vergeben
        const res = applyXpGain(user, xp);
        user.level = res.level;
        user.xp = res.xp;
        user.lastXpGain = now;
        user.lastActivity = now; // Aktivitäts-Stempel für den Inaktivitäts-Decay
        store.setUser(user);
        // Bei einem Levelwechsel sofort persistieren, aber die Discord-Ankündigung
        // NIEMALS auf Turso warten lassen. Ein langsamer DB-Request war bisher in
        // der Lage, die sichtbare Level-Up-Antwort minutenlang zu blockieren.
        const levelFlush = res.leveled
          ? store.flush().catch((e) => logger.warn('[xp-level-bot] Level-Flush fehlgeschlagen:', e.message))
          : null;

        if (res.leveledUp || res.leveledDown) {
          await handleLevelChange(ctx, msg, user, res, cfg, { source: 'text' });
          if (levelFlush) await levelFlush;
        } else if (isFirstEverXp) {
          // Erste XP überhaupt → Nickname-Tag [Lvl 1] sofort setzen
          try {
            await refreshRankNicknames(ctx, msg.guild, msg.author.id, cfg.lang || 'de');
          } catch (e) {
            logger.warn('[xp-level-bot] first-xp nick fail', e.message);
          }
        } else {
          // XP-only-Gewinn: Bei gleichem Level können sich die Ränge trotzdem
          // verschieben (mehr XP überholt weniger XP). Wenn der Nutzer damit
          // in die Top 3 rutscht, ändert sich die Medaille im Nickname.
          try {
            const rankInfo = store.getRank(msg.guild.id, msg.author.id);
            if (rankInfo && rankInfo.rank <= 3) {
              await maybeRefreshRankNicknames(ctx, msg.guild, msg.author.id, cfg.lang);
            }
          } catch (e) {
            logger.warn('[xp-level-bot] medal refresh fail', e.message);
          }
        }
      } catch (e) {
        logger.warn('[xp-level-bot] messageCreate Fehler:', e.message);
      }
    });

    async function handleLevelChange(ctx, sourceMsg, user, res, cfg, opts = {}) {
      // sourceMsg kann bei Bonus-/Voice-XP fehlen oder nur partiell gecacht sein.
      let guild = sourceMsg?.guild || null;
      if (!guild) {
        try {
          guild = ctx.client.guilds.cache.get(cfg.guildId) || (await ctx.client.guilds.fetch(cfg.guildId).catch(() => null));
        } catch {}
      }
      if (!guild) {
        logger.warn(`[xp-level-bot] handleLevelChange: keine Gilde für ${cfg.guildId} gefunden`);
        return false;
      }

      const lang = cfg.lang || 'de';
      const source = opts.source || 'other';

      // WICHTIG: Die sichtbare Ankündigung kommt als ALLERERSTES. Nickname-,
      // Rollen-, Leaderboard- und DB-Requests dürfen sie nicht mehr blockieren.
      const announcement = await sendLevelAnnouncement({
        ctx,
        guild,
        cfg,
        userId: user.userId,
        res,
        sourceMsg,
        source,
      });
      if (announcement.sent) {
        logger.info(
          `[xp-level-bot] Level-${res.leveledUp ? 'Up' : 'Down'} ${user.userId} → Lvl ${res.level} ` +
          `in ${guild.name} (${announcement.destination}, Quelle ${source})`
        );
      }

      // Nachbereitung unabhängig voneinander ausführen. Ein fehlender Nickname
      // oder eine nicht verwaltbare Rolle darf kein anderes Feature verhindern.
      const jobs = [
        refreshRankNicknames(ctx, guild, user.userId, lang),
        syncLevelRolesForUser({ ctx, guild, userId: user.userId, level: res.level }),
      ];
      if (cfg.leaderboardChannelId) {
        const { maybeRefreshLeaderboard } = require('./src/scheduler');
        jobs.push(maybeRefreshLeaderboard(ctx, cfg, guild));
      }

      const settled = await Promise.allSettled(jobs);
      for (const result of settled) {
        if (result.status === 'rejected') {
          logger.warn('[xp-level-bot] Levelwechsel-Nachbereitung fehlgeschlagen:', result.reason?.message || result.reason);
        }
      }
      return announcement.sent;
    }

    // ---------------- Guild Member Remove: Daten löschen ----------------
    client.on('guildMemberRemove', async (member) => {
      try {
        const guildId = member.guild?.id;
        if (!guildId) return;
        const u = store.getUser(guildId, member.id);
        if (u) {
          store.deleteUser(guildId, member.id);
          logger.info(
            `[xp-level-bot] Nutzer ${member.id} verließ ${member.guild.name} – XP Daten gelöscht (Lvl ${u.level})`
          );
          // sofort flushen damit Löschung persistiert
          await store.flush();
        }
      } catch (e) {
        logger.warn('[xp-level-bot] guildMemberRemove fail', e.message);
      }
    });

    // ---------------- Guild Delete / Create ----------------
    client.on('guildDelete', (guild) => {
      store.deleteGuild(guild.id);
      void store.flush();
      logger.info(`[xp-level-bot] Server ${guild.name} verlassen – Daten bereinigt`);
      updatePresence();
    });
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
      updatePresence();
      if (!ctx.devGuildId) {
        const clientId = client.user?.id;
        if (clientId) {
          ctx.rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] }).catch(() => {});
        }
      }
    });

    // ---------------- Nickname bei Serverbeitritt (ab Level 1) ----------------
    client.on('guildMemberAdd', async (member) => {
      try {
        if (!member.guild) return;
        // Bots (und damit auch andere Bots) bekommen weder Rollen noch Nickname-Tags
        if (member.user?.bot) return;
        const cfg = store.getGuild(member.guild.id);
        if (!cfg) return;
        const existing = store.getUser(member.guild.id, member.id);
        const level = existing ? existing.level : 1;
        // Level-Rollen beim Beitritt direkt vergeben (unabhängig vom /setup-Status)
        await syncLevelRolesForUser({ ctx, guild: member.guild, userId: member.id, level }).catch(() => {});
        if (!cfg.leaderboardChannelId) return; // kein XP-Setup -> Nickname erst nach /setup
        await ensureNickname(ctx, member.guild, member.id, level, cfg.lang).catch(() => {});
      } catch (e) {
        logger.warn('[xp-level-bot] guildMemberAdd nick fail', e.message);
      }
    });

    // ---------------- Graceful shutdown helpers for loader ----------------
    // Der globale loader ruft client.destroy() auf – wir hooken davor
    const originalDestroy = client.destroy.bind(client);
    client.destroy = () => {
      try {
        if (schedulerStop) schedulerStop();
      } catch {}
      try {
        if (voiceTracker) voiceTracker.stop();
      } catch {}
      void store.flush({ force: true }).catch(() => {});
      store.stopBackupInterval();
      return originalDestroy();
    };
  },
};
