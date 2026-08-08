/**
 * ============================================================================
 *  ⚒️ XP Level Bot – PLATZHALTER
 *
 *  Das XP-Level-System wird später hier eingebaut (siehe README.md
 *  in diesem Ordner für die Roadmap). Der Platzhalter meldet sich
 *  bereits mit dem Token an, damit die Token-Verwaltung über
 *  Umgebungsvariablen von Anfang an funktioniert.
 * ============================================================================
 */

const { GatewayIntentBits, ActivityType } = require('discord.js');

module.exports = {
  id: 'xp-level-bot',
  name: 'XP Level Bot',
  tokenEnv: 'XP_BOT_TOKEN',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],

  async create({ client, logger }) {
    client.once('ready', async () => {
      logger.info('[xp-level-bot] Platzhalter ist online – XP-System wird in einem späteren Update ergänzt.');
      try {
        await client.user.setPresence({
          activities: [{ name: '⚒️ XP-System in Entwicklung', type: ActivityType.Playing }],
          status: 'idle',
        });
      } catch {
        /* Status ist optional */
      }
    });
  },
};
