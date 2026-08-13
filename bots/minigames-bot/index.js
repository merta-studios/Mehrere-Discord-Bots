/**
 * 🎮 Minigames Bot
 *
 * Der frühere Verify-Bot wurde vollständig durch einen Spiele-Bot ersetzt.
 * Enthalten sind Tic-Tac-Toe, Vier Gewinnt und das Counting-Spiel. Spielstände
 * liegen unsichtbar in der jeweiligen Discord-Nachricht (bzw. beim Counting im
 * Kanal-Thema) und überleben Neustarts.
 */

const { GatewayIntentBits, ActivityType, Events, REST } = require('discord.js');

const { createStore } = require('./src/store');
const { createGameManager } = require('./src/game-manager');
const { createCountingManager } = require('./src/counting');
const { startScheduler } = require('./src/scheduler');
const { registerCommands } = require('./src/commands');
const { handleInteraction } = require('./src/interactions');
const { sendJoinNotice } = require('./src/admin-panel');

module.exports = {
  id: 'minigames-bot',
  name: 'Minigames Bot',
  tokenEnv: 'MINIGAMES_BOT_TOKEN',
  tokenEnvFallbacks: ['VERIFY_BOT_TOKEN'],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    // Für das Counting-Spiel müssen die Zahlen im Channel gelesen werden.
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],

  async create({ client, token, logger, env }) {
    const ctx = {
      client,
      token,
      logger,
      env,
      ownerId: String(
        env('MINIGAMES_BOT_OWNER_ID', '') ||
        env('VERIFY_BOT_OWNER_ID', '') ||
        env('BIRTHDAY_BOT_OWNER_ID', '')
      )
        .trim()
        .replace(/^<@!?(\d+)>$/, '$1'),
      devGuildId: env('MINIGAMES_BOT_GUILD_ID', '') || env('VERIFY_BOT_GUILD_ID', ''),
      rest: new REST({ version: '10' }).setToken(token),
      store: createStore(),
      panelSessions: new Map(),
      commandIds: {},
    };
    ctx.gameManager = createGameManager(ctx);
    ctx.countingManager = createCountingManager(ctx);

    const updatePresence = () => {
      const activeGames = ctx.store.allGames().length;
      client.user
        ?.setPresence({
          activities: [{
            name: activeGames
              ? `${activeGames} laufende Battles | /play`
              : 'Tic-Tac-Toe & Vier Gewinnt | /play',
            type: ActivityType.Playing,
          }],
          status: 'online',
        })
        ?.catch?.(() => {});
    };

    client.once(Events.ClientReady, async () => {
      try {
        await registerCommands(ctx); // ersetzt zugleich alle alten Verify-Commands
        await ctx.gameManager.scanGuilds();
      } catch (err) {
        logger.error('[minigames-bot] Start-Routine fehlgeschlagen:', err.message);
      }

      // Der bestehende Discord-Bot-Account wird passend zur neuen Aufgabe
      // umbenannt. Nach erfolgreicher Umbenennung wird dies nicht erneut nötig.
      if (client.user?.username !== 'Minigames Bot') {
        await client.user?.setUsername?.('Minigames Bot').catch((err) => {
          logger.warn('[minigames-bot] Discord-Benutzername konnte nicht automatisch geändert werden:', err.message);
        });
      }

      updatePresence();
      const presenceTimer = setInterval(updatePresence, 5 * 60 * 1000);
      presenceTimer.unref?.();
      logger.info(
        `[minigames-bot] Bereit auf ${client.guilds.cache.size} Server(n)` +
          (ctx.ownerId ? ' – Owner-ID hinterlegt.' : ' – ⚠️ MINIGAMES_BOT_OWNER_ID fehlt!')
      );
    });

    client.on(Events.InteractionCreate, (interaction) => {
      void handleInteraction(ctx, interaction);
    });

    client.on(Events.MessageCreate, (message) => {
      if (!message.guildId) return;
      void ctx.countingManager.handleMessage(message).catch((err) => {
        logger.warn('[minigames-bot] Counting-Fehler:', err.message);
      });
    });

    client.on(Events.MessageDelete, (message) => {
      if (!message.guildId) return;
      ctx.gameManager.untrack(message.guildId, message.channelId, message.id);
    });

    client.on(Events.GuildCreate, (guild) => {
      void sendJoinNotice(ctx, guild);
      void ctx.gameManager.scanGuild(guild);
    });

    client.on(Events.GuildDelete, (guild) => {
      ctx.gameManager.deleteGuild(guild.id);
      ctx.countingManager.forgetGuild(guild.id);
      logger.info(`[minigames-bot] Server „${guild.name}“ verlassen/entfernt – Cache bereinigt.`);
    });

    startScheduler({ ctx });
  },
};
