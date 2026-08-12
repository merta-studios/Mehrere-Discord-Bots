/**
 * Scheduler des Self-Roles-Bots – hält die Zähler krass aktuell und
 * repariert sich selbst.
 *
 * - Jede Minute: alle bekannten Nachrichten prüfen und nur dann editieren,
 *   wenn sich wirklich etwas geändert hat (Signatur-Vergleich im Store).
 *   So werden auch manuell vergebene/entzogene Rollen nachgezogen, selbst
 *   wenn das Gateway-Event mal verloren geht.
 * - Alle 15 Minuten: Mitglieder-Cache erzwungen neu laden (force), damit
 *   die Zahlen auch nach Gateway-Aussetzern stimmen.
 * - Alle 60 Minuten: komplette Nachrichten-Suche (Registry-Recovery nach
 *   Neustart oder Registry-Verlust).
 */

const MINUTE_MS = 60_000;
const FORCE_MEMBER_TICK = 15; // alle 15 Minuten members.fetch() erzwingen
const RESCAN_TICK = 60; // stündlich alle Gilden neu absuchen

function startScheduler({ ctx }) {
  let counter = 0;
  let running = false;

  const timer = setInterval(() => {
    if (running) return; // vorheriger Durchlauf hängt noch → überspringen
    counter += 1;
    running = true;
    void tick(ctx, counter)
      .catch((err) => ctx.logger.warn('[self-roles-bot] Scheduler-Fehler:', err.message))
      .finally(() => {
        running = false;
      });
  }, MINUTE_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}

async function tick(ctx, counter) {
  const ensureFresh = counter % FORCE_MEMBER_TICK === 0;

  // 1) Alle bekannten Nachrichten aktualisieren (nur bei echter Änderung)
  for (const guildId of ctx.store.guildIds()) {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) {
      ctx.store.deleteGuild(guildId);
      continue;
    }
    try {
      await ctx.store.refreshGuild(guildId, { ensureFresh });
    } catch (err) {
      ctx.logger.warn(`[self-roles-bot] Refresh auf Gilde ${guildId} fehlgeschlagen:`, err.message);
    }
  }

  // 2) Stündlich: neue/verlorene Nachrichten wiederfinden (Self-Healing)
  if (counter % RESCAN_TICK === 0) {
    for (const guild of ctx.client.guilds.cache.values()) {
      try {
        await ctx.store.scanGuild(guild);
      } catch (err) {
        ctx.logger.warn(`[self-roles-bot] Rescan von „${guild.name}“ fehlgeschlagen:`, err.message);
      }
    }
  }
}

module.exports = { startScheduler, tick, MINUTE_MS, FORCE_MEMBER_TICK, RESCAN_TICK };
