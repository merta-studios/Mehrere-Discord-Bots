/**
 * ============================================================================
 *  🎭 Self-Roles Bot – Rollen zum Selbstbedienen, OHNE Datenbank
 *
 *  Genau wie der Geburtstags-Bot speichert dieser Bot alles in der
 *  Nachricht selbst: Titel, Beschreibung, Sprache, Auswahl-Modus und die
 *  komplette Rollenliste stecken als unsichtbarer Zero-Width-Blob im
 *  Container (Components V2). Keine Datenbank, kein Datei-State –
 *  Neustarts und Ausfälle überlebt der Bot durch Selbstheilung.
 *
 *  Funktionen:
 *  - /create_self_role [channel] – Formular (große Textbox = Beschreibung,
 *    kleines Feld = Titel) → Editor mit Bestätigung, Rollen-Buttons
 *    (min. 2, max. 20), Auswahl-Modus (eine oder mehrere Rollen)
 *  - Beim Absenden werden die Rollen ERST DANN erstellt – automatisch
 *    ganz unten in der Rollenliste, erwähnbar, ohne Berechtigungen
 *  - Finale Nachricht: „Platzhalter (Anzahl) - @Rolle“ je Zeile, darunter
 *    alle Buttons in Grau mit „Platzhalter (Anzahl)“
 *  - Jeder darf klicken: Rolle bekommen, oder – wenn schon vorhanden –
 *    Rückfrage mit Button zum Abgeben
 *  - Die Anzahlen aktualisieren sich krass: bei jedem Klick, bei manuellen
 *    Rollenänderungen (guildMemberUpdate), beim Löschen von Rollen und
 *    zusätzlich minütlich über den Scheduler
 *  - /edit_self_role – bestehende Nachricht auswählen und bearbeiten
 *  - Maximal 10 Self-Roles-Nachrichten pro Server
 *  - /admin_set_bot_profile, /help, /adminpanel wie bei den anderen Bots
 *
 *  Owner-ID: SELF_ROLES_BOT_OWNER_ID (Fallback: BIRTHDAY_BOT_OWNER_ID)
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType, Events, REST } = require('discord.js');

const { createStore } = require('./src/store');
const { createSessionStore } = require('./src/editor');
const { startScheduler } = require('./src/scheduler');
const { registerCommands } = require('./src/commands');
const { handleInteraction, handleGuildMemberUpdate } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');

module.exports = {
  id: 'self-roles-bot',
  name: 'Self Roles Bot',
  tokenEnv: 'SELF_ROLES_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privilegierter Intent – im Dev-Portal aktivieren!
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const ctx = {
      client,
      token,
      logger,
      env,
      // Render-Variablen kommen gelegentlich mit Leerzeichen oder als Mention.
      ownerId: String(env('SELF_ROLES_BOT_OWNER_ID', '') || env('BIRTHDAY_BOT_OWNER_ID', ''))
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId: env('SELF_ROLES_BOT_GUILD_ID', ''),
      rest: new REST({ version: '10' }).setToken(token),
      store: createStore({ client, logger }),
      sessions: createSessionStore(),
      panelSessions: new Map(),
    };

    ctx.sessions.startSweeper();

    // ---------------- Ready ----------------
    const updatePresence = () => {
      let total = 0;
      for (const guildId of ctx.store.guildIds()) total += ctx.store.totalRoles(guildId);
      client.user
        ?.setPresence({
          activities: [{ name: `${total} self roles 🎭 | /help`, type: ActivityType.Watching }],
          status: 'online',
        })
        ?.catch?.(() => {});
    };

    client.once(Events.ClientReady, async () => {
      try {
        await registerCommands(ctx);
        await ctx.store.scanGuilds(); // bestehende Nachrichten selbst wiederfinden
        // Direkt einmal alles frisch zählen (Zähler nach Downtime korrigieren)
        await ctx.store.refreshAll({ ensureFresh: true }).catch(() => {});
      } catch (err) {
        logger.error('[self-roles-bot] Start-Routine fehlgeschlagen:', err.message);
      }
      updatePresence();
      const presenceTimer = setInterval(updatePresence, 10 * 60 * 1000);
      presenceTimer.unref?.();
      logger.info(
        `[self-roles-bot] Bereit auf ${client.guilds.cache.size} Server(n)` +
          (ctx.ownerId ? ' – Owner-ID hinterlegt.' : ' – ⚠️ SELF_ROLES_BOT_OWNER_ID fehlt!')
      );
    });

    // ---------------- Interaktionen ----------------
    client.on('interactionCreate', (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    // ---------------- Zähler live halten + Rollen-Logging ----------------
    // Wenn irgendjemand (Admin, anderer Bot, Self-Role-Button, …) eine Rolle
    // bekommt oder verliert, aktualisieren wir die Zähler unserer eigenen
    // Nachrichten UND schicken dem Nutzer eine humorvolle Privat-DM – für
    // ALLE Rollen des Servers, nicht nur die Self-Roles-Rollen.
    // Die eigentliche Logik lebt in interactions.js, damit sie testbar ist.
    client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      void handleGuildMemberUpdate(ctx, oldMember, newMember);
    });

    // Rolle gelöscht → betroffene Nachrichten neu bauen (Rolle verschwindet)
    client.on(Events.GuildRoleDelete, (role) => {
      void ctx.store
        .refreshForRole(role.guild.id, role.id, { force: true })
        .catch((err) => logger.warn('[self-roles-bot] Rollen-Löschung nicht verarbeitet:', err.message));
    });

    // Rolle umbenannt o. Ä. → Zähler/Anzeige neu rendern
    client.on(Events.GuildRoleUpdate, (oldRole, newRole) => {
      if (oldRole?.name === newRole?.name) return;
      void ctx.store
        .refreshForRole(newRole.guild.id, newRole.id, { force: true })
        .catch(() => {});
    });

    // Nachricht gelöscht → Registry bereinigen (kein Zombie-Eintrag)
    client.on(Events.MessageDelete, (message) => {
      try {
        if (!message?.guildId) return;
        ctx.store.remove(message.guildId, message.channelId, message.id);
      } catch {
        /* egal */
      }
    });

    // Neue Mitglieder / Austritte verändern die Zählung ebenfalls
    client.on(Events.GuildMemberRemove, (member) => {
      try {
        const guildId = member.guild?.id;
        if (!guildId) return;
        for (const roleId of member.roles?.cache?.keys?.() || []) {
          void ctx.store.refreshForRole(guildId, roleId, { force: false }).catch(() => {});
        }
      } catch {
        /* egal */
      }
    });

    // ---------------- Owner-Benachrichtigung bei Server-Beitritt ----------------
    client.on('guildCreate', (guild) => {
      void sendJoinNotice(ctx, guild);
      void ctx.store.scanGuild(guild).catch(() => {});
      const { registerGuildCommands } = require('./src/commands');
      void registerGuildCommands(ctx, guild.id);
    });

    // ---------------- Registry sauber halten ----------------
    client.on('guildDelete', (guild) => {
      ctx.store.deleteGuild(guild.id);
      logger.info(`[self-roles-bot] Server „${guild.name}“ verlassen/entfernt – Registry bereinigt.`);
    });

    // ---------------- Scheduler ----------------
    startScheduler({ ctx });
  },
};
