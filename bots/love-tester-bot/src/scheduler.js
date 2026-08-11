/**
 * Leichtgewichtiger Scheduler für den Love Tester Bot.
 *
 * Hauptaufgabe: Selbstheilung der Slash-Command-Registrierung.
 *
 * Die initiale Registrierung passiert genau einmal beim Start (ClientReady).
 * Schlägt sie fehl (Discord-Rate-Limit, 5xx, Netzwerk-Panne), bliebe der Bot
 * sonst dauerhaft OHNE Commands und wäre unbenutzbar – genau das ist der
 * gemeldete Fehler „Love Tester hat gar keine Commands". Deshalb:
 *
 *  1. Alle 15 Minuten erneut registrieren, solange `commandsRegistered === false`.
 *  2. Alle 24 Stunden die Registrierung bewusst neu anstoßen (frischer PUT
 *     ersetzt die komplette Command-Liste und heilt auch gelöschte Commands
 *     oder veraltete Snowflakes).
 */

const COMMAND_RETRY_EVERY_MS = 15 * 60 * 1000;
const COMMAND_REVERIFY_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Startet die Command-Selbstheilung. Gibt eine Stop-Funktion zurück.
 *
 * @param {object} options - `retryMs`/`revMs` sind nur für Tests überschreibbar.
 */
function startCommandSelfHealing({ ctx, retryMs = COMMAND_RETRY_EVERY_MS, revMs = COMMAND_REVERIFY_EVERY_MS } = {}) {
  let stopped = false;
  let running = false;

  const tryRegister = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (ctx.commandsRegistered === false) {
        const { registerCommands } = require('./commands');
        const ok = await registerCommands(ctx);
        if (ok) {
          ctx.logger?.info?.('[love-tester-bot] Command-Registrierung durch Selbstheilung erfolgreich.');
        } else {
          ctx.logger?.warn?.('[love-tester-bot] Command-Registrierung durch Selbstheilung fehlgeschlagen – nächster Versuch in 15 min.');
        }
      }
    } catch (err) {
      ctx.logger?.warn?.('[love-tester-bot] Command-Selbstheilung fehlgeschlagen:', err?.message || err);
    } finally {
      running = false;
    }
  };

  const retryTimer = setInterval(() => void tryRegister(), retryMs);
  if (retryTimer.unref) retryTimer.unref();

  const revTimer = setInterval(() => {
    // Stößt beim nächsten Retry-Tick einen frischen PUT an.
    ctx.commandsRegistered = false;
  }, revMs);
  if (revTimer.unref) revTimer.unref();

  return () => {
    stopped = true;
    clearInterval(retryTimer);
    clearInterval(revTimer);
  };
}

module.exports = { startCommandSelfHealing };
