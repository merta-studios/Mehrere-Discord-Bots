/**
 * Scheduler: hält die Listen frisch und erledigt den Tages-Check.
 *
 * - Jede Minute: prüft, ob der Tag (in der Zeitzone der Sprache)
 *   gewechselt hat → dann Embed neu rendern + Geburtstags-Check.
 * - Jede 60. Minute: Embed zusätzlich neu rendern („aktualisiert“-
 *   Zeitstempel und evtl. geänderte Sprache bleiben aktuell).
 */

const { todayKey } = require('./logic');

const MINUTE_MS = 60_000;
const HOURLY_TICK = 60;

function startScheduler({ ctx }) {
  let counter = 0;

  const timer = setInterval(() => {
    counter += 1;
    void tick(ctx, counter);
  }, MINUTE_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}

async function tick(ctx, counter) {
  for (const [guildId, entry] of ctx.store.entries()) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) {
      ctx.store.delete(guildId);
      continue;
    }

    try {
      const dayKey = todayKey(entry.lang);
      const dayChanged = entry.lastRenderDay !== dayKey;
      let refreshed = false;

      if (dayChanged || counter % HOURLY_TICK === 0) {
        await ctx.store.refresh(entry);
        refreshed = true;
        // Geburtstagsrollen zurücknehmen, deren 24h vorbei sind (self-healing
        // auch nach Neustarts: entscheidend ist, ob HEUTE Geburtstag ist)
        if (ctx.store.cleanupBirthdayRoles) {
          await ctx.store.cleanupBirthdayRoles(entry).catch(() => {});
        }
      }

      // Neuer Tag (0 Uhr in der Sprach-Zeitzone) → Geburtstags-Check.
      // Beim Start ist lastBirthdayCheckDay = null, damit auch nach
      // einem Restart geprüft wird (Doppel-Sendungen verhindert der
      // Marker im Gruß-Embed).
      if (entry.lastBirthdayCheckDay !== dayKey) {
        if (!refreshed) await ctx.store.refresh(entry);
        await ctx.store.birthdayCheck(entry);
        entry.lastBirthdayCheckDay = dayKey;
      }
    } catch (err) {
      ctx.logger.warn(`[birthday-bot] Tick-Fehler auf Gilde ${guildId}:`, err.message);
    }
  }
}

module.exports = { startScheduler };
