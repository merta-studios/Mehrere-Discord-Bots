/**
 * ============================================================================
 *  🎂 Birthday Bot – Geburtstagsliste ohne Datenbank
 *
 *  Der Bot sendet eine wunderschöne Geburtstagsliste als modernes
 *  Container-Layout (Components V2) und liest sie später einfach selbst
 *  wieder aus (Marker, Einträge im Text). Keine Datenbank nötig –
 *  alles steckt in den Komponenten selbst!
 *
 *  Funktionen:
 *  - /setup [language] [channel] – Liste einrichten (nur für Admins, 10 Sprachen)
 *  - „Geburtstag eintragen“-Button mit Modal (Tag + Monat, Fuzzy-Erkennung
 *    für Monatsnamen in allen Sprachen, auch mit Tippfehlern)
 *  - Bestätigung mit 3 Buttons (Bestätigen / Bearbeiten / Abbrechen)
 *  - 7-Tage-Regel als Spam-Schutz
 *  - Stündliches Self-Healing-Refresh: liest den Container neu, entfernt
 *    Nutzer, die den Server verlassen haben, dreht Monate zum aktuellen
 *    Monat um – und hält die Liste so ohne DB aktuell
 *  - Täglicher Check um 0 Uhr: Geburtstagskinder bekommen einen Gruß-Container
 *    mit „Gratulieren“-Button (Glückwünsche & Anzahl im Container)
 *  - /admin_set_bot_profile – serverspezifisches Bot-Profilbild (nur Admins)
 *  - /admin_set_birthday – Admins setzen Geburtstage für andere (nur Admins)
 *  - /help – Befehlsübersicht (ohne /adminpanel)
 *  - /adminpanel – Owner-Panel im Privatchat (Serverliste, Einladung, Leave)
 *  - Max. 3 Nachrichten unter der Liste (wird automatisch aufgeräumt)
 *
 *  Owner-ID: kommt aus der Umgebungsvariable BIRTHDAY_BOT_OWNER_ID
 *  (siehe .env.example bzw. Render-Dashboard).
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events } = require('discord.js');

const { createStore } = require('./src/store');
const { startScheduler } = require('./src/scheduler');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');

module.exports = {
  id: 'birthday-bot',
  name: 'Birthday Bot',
  tokenEnv: 'BIRTHDAY_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // privilegierter Intent – im Dev-Portal aktivieren!
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const { REST } = require('discord.js');

    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: env('BIRTHDAY_BOT_OWNER_ID', ''),
      devGuildId: env('BIRTHDAY_BOT_GUILD_ID', ''),
      rest: new REST({ version: '10' }).setToken(token),
      store: createStore({ client, logger }),
      pending: new Map(), // userId -> {day, month, input, fuzzy, lang}
      pendingAdmin: new Map(), // userId -> {targetId, guildId}
      panelSessions: new Map(), // userId -> {page, guildId, leaving, inviteUrl}
    };

    // ---------------- Ready ----------------
    client.once(Events.ClientReady, async () => {
      try {
        await client.user.setPresence({
          activities: [{ name: '🎂 Geburtstage', type: ActivityType.Watching }],
          status: 'online',
        });
      } catch {
        /* Status ist optional */
      }

      await registerCommands(ctx);
      await ctx.store.scanGuilds(); // bestehende Listen selbst wiederfinden
      logger.info(
        `[birthday-bot] Bereit auf ${client.guilds.cache.size} Server(n)` +
          (ctx.ownerId ? ` – Owner-ID hinterlegt.` : ' – ⚠️ BIRTHDAY_BOT_OWNER_ID fehlt!')
      );
    });

    // ---------------- Interaktionen ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Aufräum-Logik: max. 3 Nachrichten unter der Liste ----------------
    // Neue Nachrichten unter dem Listen-Container (egal ob vom Bot oder von
    // Nutzern) werden begrenzt: die oberste Nachricht direkt unter dem
    // Container wird gelöscht, bis nur noch 3 übrig sind.
    client.on('messageCreate', (msg) => {
      if (!msg.guild) return;
      const entry = ctx.store.get(msg.guild.id);
      if (!entry || entry.channelId !== msg.channel.id) return;

      // Die Liste selbst nie löschen (auch kurz nach /setup, wenn die
      // messageId im Store noch nicht aktuell ist).
      const isList =
        msg.id === entry.messageId ||
        JSON.stringify(msg.components || []).includes('bday::v1::') ||
        JSON.stringify(msg.components || []).includes('bday_add') ||
        msg.embeds?.some((e) => (e.footer?.text || '').includes('bday::v1::'));
      if (isList) return;

      void (async () => {
        try {
          const after = await msg.channel.messages.fetch({ after: entry.messageId, limit: 100 });
          const below = [...after.values()]
            .filter((m) => !m.pinned)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          while (below.length > 3) {
            const oldest = below.shift();
            await oldest.delete().catch(() => {});
          }
        } catch {
          /* aufräumen ist nett, aber kein Weltuntergang */
        }
      })();
    });

    // ---------------- Owner-Benachrichtigung bei Server-Beitritt ----------------
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
    });

    // ---------------- Registry sauber halten ----------------
    client.on('guildDelete', (guild) => {
      ctx.store.delete(guild.id);
      logger.info(`[birthday-bot] Server „${guild.name}“ verlassen/entfernt – Registry bereinigt.`);
    });

    // ---------------- Scheduler (stündliches Refresh + 0-Uhr-Check) ----------------
    startScheduler({ ctx });
  },
};
