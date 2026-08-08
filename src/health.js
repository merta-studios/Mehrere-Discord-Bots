/**
 * Minimaler HTTP-Health-Server.
 *
 * Render Free fährt Web-Services nach ~15 Minuten Inaktivität herunter.
 * Damit der Server (und damit ALLE Bots) am Leben bleibt, pinguft
 * UptimeRobot den Endpunkt /healthz regelmäßig (z. B. alle 5 Minuten).
 *
 * Der Server bindet an 0.0.0.0 und lauscht auf dem Port aus der
 * Umgebungsvariable PORT (Render vergibt diesen automatisch).
 */

const http = require('http');

function startHealthServer({ env, logger, getStatuses }) {
  const port = Number(env('PORT') || 10000);

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/healthz' || url === '/health' || url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          uptimeSeconds: Math.round(process.uptime()),
          timestamp: new Date().toISOString(),
          bots: getStatuses(),
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`Health-Server lauscht auf Port ${port} (UptimeRobot → /healthz)`);
  });

  server.on('error', (err) => {
    logger.error('Health-Server-Fehler:', err.message);
  });

  return server;
}

module.exports = { startHealthServer };
