/**
 * Scheduler des Verify-Bots – hält die In-Memory-Registry frisch.
 *
 * - Stündlich: komplette Nachrichten-Suche (Registry-Recovery nach
 *   Neustart oder Registry-Verlust). Die eigentliche „Datenbank“ steckt
 *   ohnehin in den Nachrichten selbst – der Bot liest bei jedem Klick
 *   frisch daraus.
 */

const RESCAN_TICK = 60; // stündlich alle Gilden neu absuchen

function startScheduler({ ctx }) {
  let running = false;
  let counter = 0;

  const timer = setInterval(() => {
    if (running) return;
    counter += 1;
    running = true;
    void tick(ctx, counter)
      .catch((err) => ctx.logger.warn('[verify-bot] Scheduler-Fehler:', err.message))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref?.();

  return () => clearInterval(timer);
}

async function tick(ctx, counter) {
  if (counter % RESCAN_TICK === 0) {
    for (const guild of ctx.client.guilds.cache.values()) {
      try {
        await ctx.store.scanGuild(guild);
      } catch (err) {
        ctx.logger.warn(`[verify-bot] Rescan von „${guild.name}“ fehlgeschlagen:`, err.message);
      }
    }
  }
}

module.exports = { startScheduler, tick, RESCAN_TICK };
