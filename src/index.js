/**
 * Multi-Bot-Hoster – Einstiegspunkt.
 *
 * 1. Lädt .env (nur lokal; auf Render kommen die Variablen aus dem Dashboard)
 * 2. Startet alle Bots, deren Token gesetzt ist
 * 3. Startet den Health-Server (wird von UptimeRobot wach gehalten)
 */

require('dotenv').config();

const logger = require('./logger');
const loader = require('./loader');
const { startHealthServer } = require('./health');

const env = (key, fallback = '') => process.env[key] ?? fallback;

async function main() {
  logger.info('Multi-Bot-Hoster startet …');

  const started = await loader.startAll({ logger, env });

  const server = startHealthServer({
    env,
    logger,
    getStatuses: () => loader.getStatuses(),
  });

  logger.info(`Fertig – ${started.length} Bot(s) online. Warte auf Events …`);

  // Sauberes Herunterfahren (Ctrl+C / Render-Restart)
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} empfangen – fahre herunter …`);
    for (const { client } of started) {
      try {
        client.destroy();
      } catch {
        /* ignorieren */
      }
    }
    server.close();
    setTimeout(() => process.exit(0), 300);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fataler Fehler beim Start:', err);
  process.exit(1);
});
