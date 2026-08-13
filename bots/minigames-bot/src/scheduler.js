/** Minuten-Tick für abgelaufene Anfragen, stündlicher Self-Healing-Scan. */

const RESCAN_EVERY_TICKS = 60;

function startScheduler({ ctx }) {
  let running = false;
  let ticks = 0;

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    ticks += 1;
    void tick(ctx, ticks)
      .catch((err) => ctx.logger.warn('[minigames-bot] Scheduler-Fehler:', err.message))
      .finally(() => {
        running = false;
      });
  }, 60_000);
  timer.unref?.();

  return () => {
    clearInterval(timer);
    ctx.gameManager?.shutdown?.();
  };
}

async function tick(ctx, ticks) {
  await ctx.gameManager?.expireDue?.();
  if (ticks % RESCAN_EVERY_TICKS === 0) await ctx.gameManager?.scanGuilds?.();
}

module.exports = { startScheduler, tick, RESCAN_EVERY_TICKS };
