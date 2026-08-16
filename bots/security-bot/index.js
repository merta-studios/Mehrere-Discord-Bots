/**
 * ============================================================================
 *  🛡️ Security Bot – Automatischer KI-Sicherheitsbot mit OpenAI Moderation
 *
 *  Funktionen:
 *  - /set_api_key – OpenAI API Key für den Server hinterlegen (Modal-Formular, nur Admins)
 *  - /set_language – 10 Sprachen zur Auswahl, dauerhaft für den Server (nur Admins)
 *  - /set_sensitivity – Schutzlevel anpassen (Strikt: 30%, Ausgewogen: 50%, Tolerant: 75%)
 *  - /configure_rules – Interaktives Menü für Kategorien, Schwellenwerte & Auto-Delete
 *  - /set_warnings – Verwarnungsstufen, Timeouts, Verfallszeit & Auto-Delete konfigurieren
 *  - /status – Eigene aktive Verwarnungen und Sicherheitsstatus einsehen (für alle!)
 *  - /manage_user [user] – Status beliebiger Nutzer einsehen und Verwarnungen löschen (nur Admins)
 *  - /test_text [text] – Text mit OpenAI Moderation auf Regelverstöße analysieren (nur Admins)
 *  - /admin_set_bot_profile – Server-Profilbild des Bots anpassen (nur Admins)
 *  - /help – Befehlsübersicht mit klickbaren Mentions
 *  - /adminpanel – Owner-Admin-Panel im Bot-DM
 *  - Automatische Überwachung aller Text- und Bildnachrichten von Nicht-Admins
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, REST } = require('discord.js');

const { createSecurityStore } = require('./src/store');
const {
  registerCommands,
  registerGuildCommands,
  verifyCommandsLive,
} = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { handleMessageModeration } = require('./src/moderation');
const { sendJoinNotice } = require('./src/admin-panel');
const { startScheduler } = require('./src/scheduler');

module.exports = {
  id: 'security-bot',
  name: 'Security Bot',
  tokenEnv: 'SECURITY_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const store = createSecurityStore({ logger, env });
    await store.init();
    store.startBackupInterval(5 * 60 * 1000);

    const flushAndLog = async (sig) => {
      logger.info(`[security-bot] ${sig} – flushe RAM -> DB/File...`);
      try {
        await store.flush({ force: true });
        logger.info('[security-bot] Flush ok vor Shutdown');
      } catch (e) {
        logger.error('[security-bot] Flush fail:', e.message);
      }
    };
    process.on('SIGTERM', () => void flushAndLog('SIGTERM'));
    process.on('SIGINT', () => void flushAndLog('SIGINT'));

    const devGuildId =
      String(env('SECURITY_BOT_GUILD_ID', '')).trim().replace(/^<@!?(\d+)>$/, '$1') || null;

    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(
        env('SECURITY_BOT_OWNER_ID', '') ||
          env('XP_BOT_OWNER_ID', '') ||
          env('BIRTHDAY_BOT_OWNER_ID', '') ||
          ''
      )
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId,
      rest: new REST({ version: '10' }).setToken(token),
      store,
      commandIds: {},
      guildCommandIds: new Map(),
      commandsRegistered: false,
      panelSessions: new Map(),
    };

    let schedulerStop = null;
    let commandRepairTimer = null;
    let commandSyncRunning = false;

    const syncCommands = async (options = {}) => {
      if (commandSyncRunning) return ctx.commandsRegistered;
      commandSyncRunning = true;
      try {
        await registerCommands(ctx, options);
        // Der Rücklese-Check ist maßgeblich: Er erkennt leere/veraltete Sätze
        // und schreibt fehlende Commands sofort noch einmal zu Discord.
        return await verifyCommandsLive(ctx);
      } catch (err) {
        ctx.commandsRegistered = false;
        logger.error('[security-bot] Command-Synchronisierung fehlgeschlagen:', err.message);
        return false;
      } finally {
        commandSyncRunning = false;
      }
    };

    const updatePresence = () => {
      const count = client.guilds.cache.size;
      client.user
        ?.setPresence({
          activities: [
            {
              name: `Protecting ${count} server(s) 🛡️ | /help`,
              type: ActivityType.Watching,
            },
          ],
          status: 'online',
        })
        .catch(() => {});
    };

    client.once(Events.ClientReady, async () => {
      updatePresence();
      schedulerStop = startScheduler({ ctx });
      logger.info(
        `[security-bot] Bereit auf ${client.guilds.cache.size} Servern, ${store.getAllGuilds().length} Gilden in RAM`
      );

      const commandsLive = await syncCommands();
      if (!commandsLive) {
        logger.error(
          '[security-bot] Commands sind noch nicht vollständig live – automatische Reparatur läuft alle 5 Minuten.'
        );
      }

      // Falls Discord beim Deployment vorübergehend nicht erreichbar war, darf
      // der Bot nicht bis zum nächsten Render-Restart ohne Commands bleiben.
      commandRepairTimer = setInterval(() => {
        if (ctx.commandsRegistered || commandSyncRunning) return;
        void syncCommands({ retryDelays: [0] });
      }, 5 * 60 * 1000);
      commandRepairTimer.unref?.();
    });

    // ---------------- Interactions ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Message Moderation ----------------
    client.on('messageCreate', async (msg) => {
      void handleMessageModeration({ ctx, msg });
    });

    // ---------------- Guild Create / Delete ----------------
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
      updatePresence();
      void registerGuildCommands(ctx, guild.id).catch((e) => {
        ctx.commandsRegistered = false;
        logger.warn('[security-bot] guildCreate Command-Registrierung fehlgeschlagen:', e.message);
      });
    });

    client.on('guildDelete', (guild) => {
      store.deleteGuild(guild.id);
      void store.flush();
      logger.info(`[security-bot] Server ${guild.name} verlassen – Daten bereinigt`);
      updatePresence();
    });

    // ---------------- Graceful shutdown ----------------
    const originalDestroy = client.destroy.bind(client);
    client.destroy = () => {
      try {
        if (schedulerStop) schedulerStop();
        if (commandRepairTimer) clearInterval(commandRepairTimer);
      } catch {}
      void store.flush({ force: true }).catch(() => {});
      store.stopBackupInterval();
      return originalDestroy();
    };
  },
};
