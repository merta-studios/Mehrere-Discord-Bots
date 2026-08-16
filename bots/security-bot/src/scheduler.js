/**
 * Scheduler für den Sicherheitsbot.
 * Bereinigt regelmäßig abgelaufene Verstöße und sichert Daten.
 */

function startScheduler({ ctx }) {
  const pruneIntervalMs = 60 * 60 * 1000; // Stündlich abgelaufene Verstöße prüfen

  const timer = setInterval(() => {
    try {
      const removed = ctx.store.pruneExpiredViolations();
      if (removed > 0) {
        ctx.logger?.info?.(`[security-bot] Scheduler: ${removed} uralte/gelöschte Verstöße bereinigt.`);
        void ctx.store.flush();
      }
    } catch (e) {
      ctx.logger?.warn?.('[security-bot] Scheduler-Fehler:', e.message);
    }
  }, pruneIntervalMs);

  if (timer.unref) timer.unref();

  return () => {
    clearInterval(timer);
  };
}

module.exports = { startScheduler };
