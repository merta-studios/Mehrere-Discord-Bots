/**
 * ============================================================================
 *  💘 Love Tester Bot
 *
 *  Schätzt die Liebe zwischen zwei Personen anhand eurer Chatverläufe –
 *  humorvoll, in 10 Sprachen, mit Components-V2-Container-Design wie die
 *  anderen Bots. Die Analyse macht Groq (llama-3.3-70b-versatile).
 *
 *  Features:
 *  - /setup (nur Admins): 3-Schritte-Wizard – Sprache → Kanäle → Groq-API-Key,
 *    mit Zurück/Weiter/Bestätigen/Abbrechen und guter Anleitung
 *  - /test_love [user1] [user2] (alle): Datenschutz-Bestätigung (öffentlich,
 *    Buttons nur für den Sender) → humorvolle Analyse mit Live-Fortschritt %
 *    → Ergebnis mit „### XX %“-Zeile
 *  - Scan: max. 500 Nachrichten über alle eingerichteten Kanäle; Ausschnitte
 *    mit 4 Nachrichten davor + Kern (max. 3 Fremde dazwischen) + Rest danach
 *  - Medien/Format-Umwandlung: Bilder, Videos, Sprachnachrichten, Antworten,
 *    Sticker, Server-Emojis, Erwähnungen → KI-freundlicher Text
 *  - Fehlerbehandlung: Groq-Limit, API-Fehler, Discord-Rate-Limits →
 *    Fehler-Container mit „Erneut versuchen“, „Weiter analysieren“,
 *    „Abbrechen“ (Fortschritt geht nie verloren)
 *  - Gleiche Datenbank wie der XP-Level-Bot (TURSO_DATABASE_URL /
 *    TURSO_AUTH_TOKEN), aber eigene Tabellen + kaum gespeicherte Daten
 *  - /help, /admin_set_bot_profile, /adminpanel (Owner-DM) wie die anderen Bots
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, Routes } = require('discord.js');

const { createLoveStore } = require('./src/store');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');
const { startCommandSelfHealing } = require('./src/scheduler');

module.exports = {
  id: 'love-tester-bot',
  name: 'Love Tester Bot',
  tokenEnv: 'LOVE_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const { REST } = require('discord.js');
    const store = createLoveStore({ logger, env });
    await store.init();
    store.startBackupInterval(10 * 60 * 1000);

    const flushAndLog = async (sig) => {
      logger.info(`[love-tester-bot] ${sig} – flushe RAM -> Turso/File...`);
      try {
        await store.flush({ force: true });
      } catch (e) {
        logger.error('[love-tester-bot] Flush fail', e.message);
      }
    };
    process.on('SIGTERM', () => void flushAndLog('SIGTERM'));
    process.on('SIGINT', () => void flushAndLog('SIGINT'));

    const devGuildId = String(env('LOVE_BOT_GUILD_ID', '')).trim().replace(/^<@!?(\d+)>$/, '$1') || null;

    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(
        env('LOVE_BOT_OWNER_ID', '') ||
        env('XP_BOT_OWNER_ID', '') ||
        env('BIRTHDAY_BOT_OWNER_ID', '') ||
        ''
      ).trim().replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId,
      rest: new REST({ version: '10' }).setToken(token),
      store,
      commandIds: store.getCommandIds ? store.getCommandIds() : {},
      commandIdScope: store.getCommandIdScope ? store.getCommandIdScope() : null,
      guildCommandIds: new Map(),
      // Wird bewusst vor dem ersten Ready-Event auf false gesetzt. So kann die
      // Selbstheilung auch dann einspringen, wenn die erste Registrierung
      // wegen eines unerwarteten Fehlers gar keinen Rückgabewert liefert.
      commandsRegistered: false,
      panelSessions: new Map(),
      setupSessions: new Map(), // token -> {token, userId, guildId, step, lang, channels, groqKey}
      loveSessions: new Map(), // token -> Analyse-Session
    };

    // Sessions begrenzen (Speicher-Hygiene auf langen Laufzeiten):
    // älteste zuerst verwerfen, wenn mehr als 500 offen sind.
    const capMap = (map, max = 500) => {
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    };

    const updatePresence = () => {
      const count = client.guilds.cache.size;
      client.user
        .setPresence({
          activities: [{ name: `${count} servers 💘 | /test_love`, type: ActivityType.Watching }],
          status: 'online',
        })
        .catch(() => {});
    };

    // Command-Selbstheilung: Falls die initiale Registrierung fehlschlägt,
    // alle 15 min erneut versuchen + alle 24h frisch registrieren.
    let stopSelfHealing = null;

    client.once(Events.ClientReady, async () => {
      try {
        updatePresence();
        await registerCommands(ctx);
      } catch (err) {
        // registerCommands behandelt REST-Fehler selbst. Dieser Fallback ist
        // trotzdem wichtig: auch Fehler beim Erzeugen des Payloads oder beim
        // Zugriff auf den Client dürfen die Selbstheilung nicht verhindern.
        ctx.commandsRegistered = false;
        logger.error('[love-tester-bot] Initial-Command-Registrierung fehlgeschlagen:', err.message);
      } finally {
        // Erst nach dem Initialversuch starten, damit die Retry-Schleife nicht
        // parallel zum ersten PUT läuft. Sie holt auch unerwartete Fehler nach.
        stopSelfHealing = startCommandSelfHealing({ ctx });
      }
      logger.info(
        `[love-tester-bot] Bereit auf ${client.guilds.cache.size} Server(n) – ` +
        `${store.getAllGuilds().filter((g) => g.setupComplete).length} Love-Setups aktiv` +
        (ctx.commandsRegistered !== true ? ' (Commands noch nicht registriert – Selbstheilung aktiv)' : '')
      );
    });

    client.on('interactionCreate', (interaction) => {
      capMap(ctx.setupSessions);
      capMap(ctx.loveSessions);
      void handleInteraction(ctx, interaction);
    });

    client.on('guildDelete', (guild) => {
      store.deleteGuild(guild.id);
      void store.flush();
      logger.info(`[love-tester-bot] Server ${guild.name} verlassen – Daten bereinigt`);
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

    // Graceful shutdown helpers
    const originalDestroy = client.destroy.bind(client);
    client.destroy = () => {
      try {
        if (stopSelfHealing) stopSelfHealing();
      } catch {}
      try {
        void store.flush({ force: true }).catch(() => {});
      } catch {}
      store.stopBackupInterval();
      return originalDestroy();
    };
  },
};
