/**
 * Bot-Loader.
 *
 * Durchsucht den Ordner /bots nach Unterordnern, die eine index.js mit
 * einem Bot-Modul exportieren. Jedes Bot-Modul hat folgende Form:
 *
 *   module.exports = {
 *     id: 'mein-bot',
 *     name: 'Mein Bot',
 *     tokenEnv: 'MEIN_BOT_TOKEN',          // Name der Env-Variable mit dem Token
 *     intents: [GatewayIntentBits.Guilds], // gewünschte Intents
 *     async create({ client, token, logger, env, status }) { ... }
 *   };
 *
 * Ein Bot wird NUR gestartet, wenn sein Token als Umgebungsvariable
 * gesetzt ist. So kannst du beliebig viele Bots in den Ordner legen,
 * ohne dass sie alle laufen müssen.
 */

const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

const BOTS_DIR = path.join(__dirname, '..', 'bots');
const statuses = new Map(); // botId -> 'starting' | 'online' | 'error'

function discoverBots() {
  if (!fs.existsSync(BOTS_DIR)) return [];
  return fs
    .readdirSync(BOTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

async function startAll({ logger, env }) {
  const started = [];

  for (const dirName of discoverBots()) {
    const entryFile = path.join(BOTS_DIR, dirName, 'index.js');
    if (!fs.existsSync(entryFile)) continue;

    let bot;
    try {
      bot = require(entryFile);
    } catch (err) {
      logger.error(`[${dirName}] Konnte Bot-Modul nicht laden:`, err.message);
      continue;
    }

    const botId = bot.id || dirName;
    const tokenEnv = bot.tokenEnv || `${dirName.toUpperCase().replace(/-/g, '_')}_TOKEN`;
    const tokenEnvs = [tokenEnv, ...(Array.isArray(bot.tokenEnvFallbacks) ? bot.tokenEnvFallbacks : [])];
    const selectedTokenEnv = tokenEnvs.find((name) => env(name, ''));
    const token = selectedTokenEnv ? env(selectedTokenEnv, '') : '';

    if (!token) {
      logger.warn(
        `[${botId}] Kein Token gefunden (Umgebungsvariable${tokenEnvs.length > 1 ? 'n' : ''} ` +
          `${tokenEnvs.map((name) => `„${name}“`).join(', ')} leer) – Bot wird übersprungen.`
      );
      continue;
    }
    if (selectedTokenEnv !== tokenEnv) {
      logger.info(`[${botId}] Nutzt aus Kompatibilitätsgründen Token aus „${selectedTokenEnv}“`);
    }

    const client = new Client({ intents: bot.intents || [GatewayIntentBits.Guilds] });

    client.on('error', (err) => logger.error(`[${botId}] Client-Fehler:`, err.message));
    client.on('warn', (msg) => logger.warn(`[${botId}] Warnung:`, msg));

    statuses.set(botId, 'starting');
    try {
      await bot.create({
        client,
        token,
        logger,
        env,
        status: (s) => statuses.set(botId, s),
      });
      await client.login(token);
      started.push({ client, bot, id: botId });
      statuses.set(botId, 'online');
      logger.info(`[${botId}] Online als ${client.user?.tag || '?'}`);
    } catch (err) {
      statuses.set(botId, 'error');
      logger.error(`[${botId}] Start fehlgeschlagen:`, err);
    }
  }

  return started;
}

function getStatuses() {
  return [...statuses.entries()].map(([id, status]) => ({ id, status }));
}

module.exports = { startAll, getStatuses };
