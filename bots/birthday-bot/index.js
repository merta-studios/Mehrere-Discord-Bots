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
 *  - /setup [language] [channel] – Liste einrichten (Channel erforderlich) (nur für Admins, 10 Sprachen)
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
 *  - 7-Tage-Regel unter der Liste: Geburtstags- & Event-Posts bleiben 7 Tage,
 *    danach werden sie samt aller Nachrichten darüber bis zur Liste gelöscht
 *
 *  Owner-ID: kommt aus der Umgebungsvariable BIRTHDAY_BOT_OWNER_ID
 *  (siehe .env.example bzw. Render-Dashboard).
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events } = require('discord.js');

const { createPresenceUpdater } = require('../../src/safe-presence');
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
      // Render-Variablen werden gelegentlich mit Leerzeichen oder als Discord-
      // Mention eingefügt. Für den Berechtigungsvergleich brauchen wir stets
      // die reine Snowflake-ID.
      ownerId: String(env('BIRTHDAY_BOT_OWNER_ID', ''))
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId: String(env('BIRTHDAY_BOT_GUILD_ID', '')).trim().replace(/^<@!?(\d+)>$/, '$1') || null,
      rest: new REST({ version: '10' }).setToken(token),
      store: createStore({ client, logger }),
      pending: new Map(), // userId -> {day, month, input, fuzzy, lang}
      pendingAdmin: new Map(), // userId -> {targetId, guildId}
      pendingEvent: new Map(), // userId -> {day, month, name, lang, guildId}
      panelSessions: new Map(), // userId -> {page, guildId, leaving, inviteUrl}
      commandIds: {},
      guildCommandIds: new Map(),
    };

    // ---------------- Ready ----------------
    // Status: zeigt die Gesamtzahl aller notierten Geburtstage über alle Server
    // setPresence() ist in discord.js v14 synchron (kein Promise) – ein `.catch()`
    // darauf warf in Produktion einen TypeError. Der Helper kapselt das sicher ab.
    const updatePresence = createPresenceUpdater({
      client,
      logger,
      label: 'birthday-bot',
      build: () => {
        let total = 0;
        for (const [, entry] of ctx.store.entries()) {
          if (entry && Array.isArray(entry.birthdays)) total += entry.birthdays.length;
        }
        return {
          activities: [{ name: `${total} birthdays collected 🎂 | /help`, type: ActivityType.Watching }],
          status: 'online',
        };
      },
    });

    client.once(Events.ClientReady, async () => {
      await registerCommands(ctx);
      await ctx.store.scanGuilds(); // bestehende Listen selbst wiederfinden
      updatePresence();
      // Anzahl regelmäßig aktualisieren, damit der Status aktuell bleibt
      const presenceTimer = setInterval(updatePresence, 10*60*1000);
      if (presenceTimer.unref) presenceTimer.unref();
      logger.info(
        `[birthday-bot] Bereit auf ${client.guilds.cache.size} Server(n)` +
          (ctx.ownerId ? ` – Owner-ID hinterlegt.` : ' – ⚠️ BIRTHDAY_BOT_OWNER_ID fehlt!')
      );
    });

    // ---------------- Interaktionen ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Aufräum-Logik: 7-Tage-Regel unter der Liste ----------------
    // Früher: max. 3 Nachrichten unter der Liste, älteste wurde gelöscht.
    // Jetzt: Geburtstags-Grüße & Event-Posts bleiben insgesamt 7 Tage stehen.
    // Danach werden sie gelöscht – zusammen mit ALLEN Nachrichten, die
    // darüber (zwischen Post und Liste) liegen. Das Aufräumen läuft stündlich
    // über den Scheduler (siehe src/scheduler.js → cleanupExpired), damit die
    // frischen Posts und die Konversation darunter in Ruhe leben können.

    // ---------------- Owner-Benachrichtigung bei Server-Beitritt ----------------
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
      const { registerGuildCommands } = require('./src/commands');
      void registerGuildCommands(ctx, guild.id).catch(() => {});
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
