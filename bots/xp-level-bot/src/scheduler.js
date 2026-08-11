/**
 * Scheduler des XP-Bots.
 *
 * Die drei zeitkritischen Aufgaben laufen absichtlich unabhängig voneinander:
 *  1. täglicher Decay / Command-Selbstheilung / Backup
 *  2. geplante Bonus-Drops
 *  3. stündliches Leaderboard
 *
 * Dadurch kann ein langsamer Discord-Request beim Leaderboard weder Bonus-Drops
 * noch den Tageswechsel blockieren. Ebenso besitzt das stündliche Leaderboard
 * einen EIGENEN, persistierten Zeitstempel. Level-Up-Refreshes verändern diesen
 * Zeitstempel nicht – genau diese Vermischung war die Ursache dafür, dass das
 * Board trotz angeblichem Stunden-Timer über viele Stunden stehen blieb.
 */

const { todayKey } = require('./logic');
const { buildLeaderboardEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { syncLevelRolesForUser } = require('./level-roles');
const { refreshRankNicknames } = require('./nicknames');
const { sendLevelAnnouncement } = require('./level-announcements');

const MINUTE_MS = 60_000;
const LEADERBOARD_MIN_REFRESH_MS = 10 * 60 * 1000;
// Prüfung erfolgt minütlich. 55 Minuten geben ausreichend Toleranz für einen
// verzögerten Event-Loop und halten den sichtbaren Zeitstempel sicher frisch.
const LEADERBOARD_HOURLY_MS = 55 * 60 * 1000;
const LEADERBOARD_HOURLY_RETRY_MS = 2 * 60 * 1000;
const COMMAND_RETRY_EVERY_TICKS = 15;
// Kein einzelner Discord-/Netzwerk-Request darf einen Scheduler dauerhaft
// einfrieren. Nach 45s wird der Lock freigegeben; der nächste Tick kann heilen.
const SCHEDULER_GUILD_TASK_TIMEOUT_MS = 45_000;

// Allgemeiner letzter erfolgreicher Edit (Throttle für Level-Up/-Down).
const lastLeaderboardRefresh = new Map();
// Ausschließlich letzter erfolgreicher Stunden-/Startup-/Decay-Edit.
const lastHourlyRefresh = new Map();
// Ausschließlich letzter VERSUCH des Stunden-Refreshs.
const lastLeaderboardAttempt = new Map();
// Manueller /update_leaderboard-Cooldown (5 Minuten pro Server).
const MANUAL_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
const lastManualRefresh = new Map();

/**
 * 5-Minuten-Cooldown für /update_leaderboard.
 * Rückgabe: 0 = sofort erlaubt, sonst verbleibende Millisekunden.
 */
function isManualRefreshDue(guildId, now = Date.now()) {
  const last = lastManualRefresh.get(guildId) || 0;
  const remaining = MANUAL_REFRESH_COOLDOWN_MS - (now - last);
  return remaining > 0 ? remaining : 0;
}

function noteManualRefresh(guildId, now = Date.now()) {
  lastManualRefresh.set(guildId, now);
}

function asTimestamp(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isLeaderboardRefreshDue(guildId, now = Date.now()) {
  const last = lastLeaderboardRefresh.get(guildId) || 0;
  return now - last >= LEADERBOARD_MIN_REFRESH_MS;
}

function isHourlyRefreshDue(guildId, now = Date.now()) {
  const last = lastHourlyRefresh.get(guildId) || 0;
  return now - last >= LEADERBOARD_HOURLY_MS;
}

function noteLeaderboardRefresh(guildId, now = Date.now()) {
  lastLeaderboardRefresh.set(guildId, now);
}

function noteHourlyRefresh(guildId, now = Date.now()) {
  lastHourlyRefresh.set(guildId, now);
  // Ein Stunden-Edit ist natürlich zugleich ein allgemeiner Edit.
  lastLeaderboardRefresh.set(guildId, now);
}

/**
 * Lädt die beiden UNABHÄNGIGEN Zeitstempel aus der Persistenz.
 *
 * Wichtig: Für `lastHourlyRefresh` gibt es absichtlich KEINEN Fallback auf das
 * alte Feld `lastLeaderboardRefresh`. Das alte Feld wurde von Level-Ups
 * überschrieben und ist daher als Stunden-Zeitstempel unbrauchbar. Bestehende
 * Installationen ohne das neue Feld erhalten beim nächsten Start sofort einen
 * frischen Stunden-Refresh und sind danach sauber migriert.
 */
function syncMapsFromEntry(entry) {
  if (!entry?.guildId) return;

  const persistedGeneral = asTimestamp(entry.lastLeaderboardRefresh || entry.lastLeaderboardUpdate);
  if (persistedGeneral > (lastLeaderboardRefresh.get(entry.guildId) || 0)) {
    lastLeaderboardRefresh.set(entry.guildId, persistedGeneral);
  }

  const persistedHourly = asTimestamp(entry.lastHourlyLeaderboardRefresh);
  if (persistedHourly > (lastHourlyRefresh.get(entry.guildId) || 0)) {
    lastHourlyRefresh.set(entry.guildId, persistedHourly);
  }
}

/**
 * Holt eine Gilde robust. Nur Discord-Code 10004 bedeutet definitiv, dass der
 * Bot entfernt wurde; bei Netz-/Cachefehlern bleibt die Konfiguration erhalten.
 */
async function resolveGuild(ctx, guildId) {
  const cached = ctx.client.guilds.cache.get(guildId);
  if (cached) return { guild: cached, gone: false };
  try {
    const guild = await ctx.client.guilds.fetch(guildId);
    return { guild: guild || null, gone: !guild };
  } catch (err) {
    if (err?.code === 10004) return { guild: null, gone: true };
    return { guild: null, gone: false };
  }
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} nach ${Math.round(ms / 1000)}s abgebrochen`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function forEachConfiguredGuild(ctx, taskName, handler) {
  const entries = ctx.store.getAllGuilds();
  const jobs = entries.map((entry) => {
    const job = (async () => {
      const { guild, gone } = await resolveGuild(ctx, entry.guildId);
      if (gone) {
        ctx.store.deleteGuild(entry.guildId);
        return;
      }
      if (!guild) {
        ctx.logger.warn(`[xp-level-bot] ${taskName}: Gilde ${entry.guildId} aktuell nicht erreichbar (Config bleibt)`);
        return;
      }
      await handler(entry, guild);
    })();
    return withTimeout(
      job,
      SCHEDULER_GUILD_TASK_TIMEOUT_MS,
      `${taskName} für Gilde ${entry.guildId}`
    );
  });
  const results = await Promise.allSettled(jobs);

  for (const result of results) {
    if (result.status === 'rejected') {
      ctx.logger.warn(`[xp-level-bot] ${taskName} fehlgeschlagen:`, result.reason?.message || result.reason);
    }
  }
}

async function runMaintenanceTick(ctx, counter, now = new Date()) {
  if (ctx.commandsRegistered === false && counter % COMMAND_RETRY_EVERY_TICKS === 1) {
    try {
      const { registerCommands } = require('./commands');
      await registerCommands(ctx);
    } catch (err) {
      ctx.logger.warn('[xp-level-bot] Command-Selbstheilung fehlgeschlagen:', err?.message || err);
    }
  }
  if (counter > 0 && counter % (24 * 60) === 0) ctx.commandsRegistered = false;

  await forEachConfiguredGuild(ctx, 'Maintenance', async (entry, guild) => {
    const dayKey = todayKey(entry.lang, now);
    if (entry.lastDailyDecay === dayKey) return;
    await applyDailyDecayForGuild(ctx, entry, guild);
    entry.lastDailyDecay = dayKey;
    ctx.store.setGuild(entry);
  });

  if (counter % 5 === 0) void ctx.store.flush().catch(() => {});
}

async function runBonusTick(ctx, now = new Date()) {
  if (!ctx.bonusDropper) return;
  await forEachConfiguredGuild(ctx, 'Bonus-Scheduler', async (entry, guild) => {
    try {
      await ctx.bonusDropper.checkScheduled(entry, guild, now);
    } catch (err) {
      ctx.logger.warn(`[xp-level-bot] Bonus-Scheduler Fehler Gilde ${entry.guildId}:`, err?.message || err);
    }
  });
}

async function runLeaderboardTick(ctx, now = new Date(), { force = false } = {}) {
  const nowMs = now.getTime();
  await forEachConfiguredGuild(ctx, 'Leaderboard-Scheduler', async (entry, guild) => {
    syncMapsFromEntry(entry);
    const lastHourly = lastHourlyRefresh.get(entry.guildId) || asTimestamp(entry.lastHourlyLeaderboardRefresh);
    const lastAttempt = lastLeaderboardAttempt.get(entry.guildId) || 0;
    const hourlyDue = nowMs - lastHourly >= LEADERBOARD_HOURLY_MS;
    const attemptReady = nowMs - lastAttempt >= LEADERBOARD_HOURLY_RETRY_MS;

    if (!force && (!hourlyDue || !attemptReady)) return;
    lastLeaderboardAttempt.set(entry.guildId, nowMs);
    await refreshLeaderboard(ctx, entry, guild, now, { isHourly: true });
  });
}

/**
 * Rückwärtskompatibler kombinierter Tick (und nützlich für Integrationstests).
 * Im echten Scheduler werden die drei Funktionen getrennt gestartet.
 */
async function tick(ctx, counter = 1, opts = {}) {
  const now = opts.now instanceof Date ? opts.now : new Date();
  await Promise.all([
    runMaintenanceTick(ctx, counter, now),
    runBonusTick(ctx, now),
    runLeaderboardTick(ctx, now, { force: opts.forceHourly === true || counter === 0 }),
  ]);
}

function startScheduler({ ctx }) {
  try {
    for (const entry of ctx.store.getAllGuilds()) syncMapsFromEntry(entry);
  } catch {}

  let counter = 0;
  let stopped = false;
  const running = new Set();
  const timers = new Set();

  const launch = (name, fn) => {
    if (stopped || running.has(name)) return;
    running.add(name);
    void Promise.resolve()
      .then(fn)
      .catch((err) => ctx.logger.warn(`[xp-level-bot] Scheduler-Task ${name} fehlgeschlagen:`, err?.message || err))
      .finally(() => running.delete(name));
  };

  const heartbeat = (startup = false) => {
    if (stopped) return;
    counter += 1;
    const now = new Date();
    // Getrennte Locks: Ein hängender Task blockiert die beiden anderen nicht.
    launch('maintenance', () => runMaintenanceTick(ctx, counter, now));
    launch('bonus', () => runBonusTick(ctx, now));
    launch('leaderboard', () => runLeaderboardTick(ctx, now, { force: startup }));
  };

  const startupTimer = setTimeout(() => heartbeat(true), 5_000);
  startupTimer.unref?.();
  timers.add(startupTimer);

  const interval = setInterval(() => heartbeat(false), MINUTE_MS);
  interval.unref?.();
  timers.add(interval);

  return () => {
    stopped = true;
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    timers.clear();
  };
}

/**
 * Zusätzlicher Leaderboard-Edit nach Level-Up/-Down, max. alle 10 Minuten.
 * Dieser Pfad verändert ausschließlich den allgemeinen Throttle, niemals den
 * unabhängigen Stunden-Zeitstempel.
 */
async function maybeRefreshLeaderboard(ctx, entry, guild) {
  syncMapsFromEntry(entry);
  if (!isLeaderboardRefreshDue(entry.guildId)) return false;
  return refreshLeaderboard(ctx, entry, guild, new Date(), { isHourly: false });
}

async function applyDailyDecayForGuild(ctx, entry, guild) {
  const lang = entry.lang || 'de';
  const users = ctx.store.getUsersForGuild(entry.guildId);
  if (!users.length) return;

  const { applyDailyDecay, nextDecayInfo } = require('./logic');
  let decayed = 0;
  const leveledDownUsers = [];
  for (const user of users) {
    const info = nextDecayInfo(user, Date.now());
    user.inactiveDays = info.inactiveDays;
    const before = { level: user.level, xp: user.xp };
    const res = applyDailyDecay(user, info.rate);
    if (res.level !== before.level || res.xp !== before.xp) {
      user.level = res.level;
      user.xp = res.xp;
      decayed += 1;
      if (res.leveledDown) leveledDownUsers.push({ userId: user.userId, level: res.level, xp: res.xp });
    }
    ctx.store.setUser(user);
  }

  ctx.logger.info(
    `[xp-level-bot] Daily decay ${guild.name}: ${decayed} Nutzer angepasst, ${leveledDownUsers.length} Level-Downs`
  );
  // Persistenz sofort parallel starten, aber auch Level-Down-Ankündigungen
  // niemals auf Turso warten lassen.
  const decayFlush = ctx.store
    .flush()
    .catch((err) => ctx.logger.warn('[xp-level-bot] Decay-Flush fehlgeschlagen:', err?.message || err));

  // Erst zuverlässig ankündigen, danach Nickname und Rollen nachziehen.
  for (const down of leveledDownUsers) {
    await sendLevelAnnouncement({
      ctx,
      guild,
      cfg: entry,
      userId: down.userId,
      res: { ...down, leveledUp: false, leveledDown: true, leveled: true },
      source: 'decay',
    });
    await Promise.allSettled([
      refreshRankNicknames(ctx, guild, down.userId, lang),
      syncLevelRolesForUser({ ctx, guild, userId: down.userId, level: down.level }),
    ]);
  }
  await decayFlush;

  // Nach dem Decay ist das Board ohnehin frisch; das zählt legitim als
  // Stunden-Refresh und verhindert einen zweiten gleichzeitigen Mitternachts-Edit.
  await refreshLeaderboard(ctx, entry, guild, new Date(), { isHourly: true });
}

async function fetchLeaderboardChannel(ctx, entry, guild) {
  let channel = guild.channels?.cache?.get?.(entry.leaderboardChannelId) || null;
  if (!channel) {
    try {
      channel = await ctx.client.channels.fetch(entry.leaderboardChannelId);
    } catch {}
  }
  if (!channel) {
    try {
      channel = await guild.channels.fetch(entry.leaderboardChannelId);
    } catch {}
  }
  if (channel?.isTextBased?.()) return channel;

  // Self-Healing über den unsichtbaren Marker der bestehenden Nachricht.
  try {
    const found = await ctx.store.findLeaderboardMessage(guild, ctx.client);
    if (found?.channel?.isTextBased?.()) {
      entry.leaderboardChannelId = found.channel.id;
      entry.leaderboardMessageId = found.message.id;
      ctx.logger.info(
        `[xp-level-bot] Leaderboard-Kanal via Marker gefunden (${guild.name} → ${found.channel.id})`
      );
      return found.channel;
    }
  } catch {}
  return null;
}

async function refreshLeaderboard(ctx, entry, guild, now = new Date(), opts = {}) {
  // Ohne opts bleibt das historische Verhalten "hourly" erhalten. Alle internen
  // Level-Up-Aufrufe übergeben dagegen explizit isHourly:false.
  const treatAsHourly = opts.isHourly === true || Object.keys(opts).length === 0;
  try {
    const channel = await fetchLeaderboardChannel(ctx, entry, guild);
    if (!channel) {
      ctx.logger.warn(
        `[xp-level-bot] Leaderboard-Kanal ${entry.leaderboardChannelId} nicht erreichbar (${guild.name})`
      );
      return false;
    }

    const entries = ctx.store.getLeaderboard(entry.guildId, 15);
    const container = buildLeaderboardEmbed({ lang: entry.lang, entries, now, guildName: guild.name });
    const payload = componentsV2Payload([container]);

    let message = null;
    if (entry.leaderboardMessageId) {
      message = await channel.messages.fetch(entry.leaderboardMessageId).catch(() => null);
    }
    if (!message) {
      const found = await ctx.store.findLeaderboardMessage(guild, ctx.client).catch(() => null);
      if (found) {
        message = found.message;
        entry.leaderboardChannelId = found.channel.id;
        entry.leaderboardMessageId = found.message.id;
      }
    }

    let success = false;
    let staleMessage = null;
    if (message) {
      try {
        await message.edit(payload);
        success = true;
      } catch (err) {
        // Alte Nachricht erst löschen, NACHDEM die Ersatznachricht erfolgreich
        // gesendet wurde. So bleibt bei einem zweiten API-Fehler wenigstens das
        // bestehende Board sichtbar.
        staleMessage = message;
        message = null;
        ctx.logger.warn(
          `[xp-level-bot] Leaderboard-Edit fehlgeschlagen (${guild.name}): ${err.message} – sende Ersatz.`
        );
      }
    }

    if (!message) {
      const replacement = await channel.send(payload).catch((err) => {
        ctx.logger.warn(`[xp-level-bot] Leaderboard-Send fehlgeschlagen (${guild.name}): ${err.message}`);
        return null;
      });
      if (!replacement) return false;
      entry.leaderboardMessageId = replacement.id;
      success = true;
      if (staleMessage) await staleMessage.delete().catch(() => {});
    }

    if (!success) return false;

    const ts = Date.now();
    noteLeaderboardRefresh(entry.guildId, ts);
    entry.lastLeaderboardRefresh = ts;
    entry.lastLeaderboardUpdate = ts; // Kompatibilität mit alten File-Fallbacks
    if (treatAsHourly) {
      noteHourlyRefresh(entry.guildId, ts);
      entry.lastHourlyLeaderboardRefresh = ts;
    }
    ctx.store.setGuild(entry);
    void ctx.store.flush().catch(() => {});
    ctx.logger.info(
      `[xp-level-bot] Leaderboard aktualisiert (${guild.name})${treatAsHourly ? ' [stündlich]' : ' [level]'}`
    );
    return true;
  } catch (err) {
    ctx.logger.warn(`[xp-level-bot] Leaderboard refresh failed ${guild.name}:`, err?.message || err);
    return false;
  }
}

module.exports = {
  startScheduler,
  tick,
  runMaintenanceTick,
  runBonusTick,
  runLeaderboardTick,
  refreshLeaderboard,
  maybeRefreshLeaderboard,
  isLeaderboardRefreshDue,
  isHourlyRefreshDue,
  noteLeaderboardRefresh,
  noteHourlyRefresh,
  syncMapsFromEntry,
  applyDailyDecayForGuild,
  isManualRefreshDue,
  noteManualRefresh,
  MANUAL_REFRESH_COOLDOWN_MS,
  LEADERBOARD_MIN_REFRESH_MS,
  LEADERBOARD_HOURLY_MS,
  LEADERBOARD_HOURLY_RETRY_MS,
  _lastLeaderboardRefresh: lastLeaderboardRefresh,
  _lastHourlyRefresh: lastHourlyRefresh,
  _lastLeaderboardAttempt: lastLeaderboardAttempt,
  _lastManualRefresh: lastManualRefresh,
};
