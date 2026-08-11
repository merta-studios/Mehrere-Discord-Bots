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
      // Alles außer dem expliziten Erfolgszustand gilt als unsicher. Das
      // deckt auch ältere/unerwartete Contexts ab, bei denen das Flag noch
      // `undefined` ist.
      if (ctx.commandsRegistered !== true) {
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

  // Nicht erst 15 Minuten warten: ein fehlgeschlagener Initialversuch wird
  // direkt nach dem Start der Selbstheilung erneut versucht. Der Timer bleibt
  // unref'ed, weil die Discord-Verbindung den Prozess am Leben hält.
  const initialTimer = setTimeout(() => void tryRegister(), 0);
  if (initialTimer.unref) initialTimer.unref();

  const retryTimer = setInterval(() => void tryRegister(), retryMs);
  if (retryTimer.unref) retryTimer.unref();

  const revTimer = setInterval(() => {
    // Nach 24h sofort einen frischen PUT anstoßen statt bis zum nächsten
    // 15-Minuten-Tick auf veralteten/gelöschten Commands zu bleiben.
    ctx.commandsRegistered = false;
    void tryRegister();
  }, revMs);
  if (revTimer.unref) revTimer.unref();

  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(retryTimer);
    clearInterval(revTimer);
  };
}

module.exports = { startCommandSelfHealing };
