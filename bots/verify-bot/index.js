/**
 * ============================================================================
 *  ✅ Verify Bot – Regeln & Verifizierung, OHNE Datenbank
 *
 *  Genau wie der Geburtstags- und der Self-Roles-Bot speichert dieser Bot
 *  alles in der Nachricht selbst: Modus, Rollen, Log-Kanal, Prüf-Modus,
 *  Formularfelder und Bild-/Banner-URL stecken als unsichtbarer
 *  Zero-Width-Blob im Container (Components V2). Keine Datenbank, kein
 *  Datei-State – Neustarts und Ausfälle überlebt der Bot durch Selbstheilung.
 *
 *  Funktionen:
 *  - /create_verify_rules [channel] [logging] [unverified] [verified]
 *    & /create_classic_rules [channel] – Formular (große Textbox = Regeln,
 *    optional Button-Name), Bilder/Banner per Anhang, Absenden löscht
 *    alte Regeln
 *  - Grüner Verifizier-Button unter den Regeln: entfernt UNVERIFIED,
 *    gibt VERIFIED, loggt im Log-Kanal (Admins)
 *  - /set_verify_form [keine Prüfung | Prüfung | Prüfung mit Formular]
 *    → bei „Prüfung“: Anfrage mit Annehmen/Ablehnen (nur Admins),
 *      Ablehnen öffnet Grund-Formular, Nutzer wird anonym benachrichtigt
 *    → bei „Formular“: Editor für eigene Formular-Felder
 *  - /set_language [sprache] – Sprache pro Server
 *  - /admin_set_bot_profile, /help, /adminpanel wie bei den anderen Bots
 *
 *  Owner-ID: VERIFY_BOT_OWNER_ID (Fallback: BIRTHDAY_BOT_OWNER_ID)
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, REST } = require('discord.js');

const { createStore } = require('./src/store');
const { createSessionStore, handleUploadMessage } = require('./src/editor');
const { startScheduler } = require('./src/scheduler');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');

module.exports = {
  id: 'verify-bot',
  name: 'Verify Bot',
  tokenEnv: 'VERIFY_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privilegierter Intent – im Dev-Portal aktivieren!
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privilegierter Intent – für Anhang-Uploads
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(env('VERIFY_BOT_OWNER_ID', '') || env('BIRTHDAY_BOT_OWNER_ID', ''))
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId: env('VERIFY_BOT_GUILD_ID', ''),
      rest: new REST({ version: '10' }).setToken(token),
      store: createStore({ client, logger }),
      sessions: createSessionStore(),
      panelSessions: new Map(),
      createOpts: new Map(), // userId -> {mode, channelId, loggingChannelId, ...}
      uploads: new Map(), // `${channelId}:${userId}` -> {sessionId, target, expiresAt}
      pending: new Map(), // `${guildId}:${userId}` -> {channelId, messageId}
    };

    ctx.sessions.startSweeper();

    // ---------------- Ready ----------------
    const updatePresence = () => {
      let total = 0;
      for (const guildId of ctx.store.guildIds()) total += ctx.store.countMessages(guildId);
      client.user
        ?.setPresence({
          activities: [{ name: `${total} Regeln ✅ | /help`, type: ActivityType.Watching }],
          status: 'online',
        })
        ?.catch?.(() => {});
    };

    client.once(Events.ClientReady, async () => {
      try {
        await registerCommands(ctx);
        await ctx.store.scanGuilds(); // bestehende Nachrichten selbst wiederfinden
      } catch (err) {
        logger.error('[verify-bot] Start-Routine fehlgeschlagen:', err.message);
      }
      updatePresence();
      const presenceTimer = setInterval(updatePresence, 10 * 60 * 1000);
      presenceTimer.unref?.();
      logger.info(
        `[verify-bot] Bereit auf ${client.guilds.cache.size} Server(n)` +
          (ctx.ownerId ? ' – Owner-ID hinterlegt.' : ' – ⚠️ VERIFY_BOT_OWNER_ID fehlt!')
      );
    });

    // ---------------- Interaktionen ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Bild-/Banner-Anhänge ----------------
    client.on(Events.MessageCreate, (message) => {
      void handleUploadMessage(ctx, message).catch(() => {});
    });

    // ---------------- Nachricht gelöscht → Registry bereinigen ----------------
    client.on(Events.MessageDelete, (message) => {
      try {
        if (!message?.guildId) return;
        ctx.store.remove(message.guildId, message.channelId, message.id);
      } catch {
        /* egal */
      }
    });

    // ---------------- Owner-Benachrichtigung bei Server-Beitritt ----------------
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
      void ctx.store.scanGuild(guild).catch(() => {});
    });

    client.on('guildDelete', (guild) => {
      ctx.store.deleteGuild(guild.id);
      logger.info(`[verify-bot] Server „${guild.name}“ verlassen/entfernt – Registry bereinigt.`);
    });

    // ---------------- Scheduler ----------------
    startScheduler({ ctx });
  },
};
