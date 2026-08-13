/**
 * Inaktivitäts-Rolle:
 * - /set_inactive_role schaltet die Funktion an/aus und legt Tage + Rolle fest
 * - Um 0 Uhr (nach dem Decay) bekommen Mitglieder mit genug inaktiven Tagen die Rolle
 * - Sobald wieder XP verdient wird, fällt die Rolle weg
 * - Beim Command (und beim Anschalten) werden alle Mitglieder wie bei /sync_nicknames abgeglichen
 */

const { PermissionsBitField } = require('discord.js');
const { currentInactiveDays, DAY_MS } = require('./logic');

const syncLocks = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isInactiveRoleEnabled(cfg) {
  return Boolean(cfg?.inactiveRoleEnabled)
    && Boolean(cfg?.inactiveRoleId)
    && Number(cfg?.inactiveRoleDays) >= 1;
}

function parseInactiveRoleDays(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(365, n);
}

function memberInactiveDays(store, guildId, member, now = Date.now()) {
  const user = store?.getUser?.(guildId, member.id);
  if (user) return currentInactiveDays(user, now);
  // Nie XP verdient: Tage seit Serverbeitritt, analog zum Mitternachts-Streak
  const joined = Number(member.joinedTimestamp) || 0;
  if (!joined) return 0;
  return Math.max(0, Math.floor((now - joined) / DAY_MS));
}

function shouldHaveInactiveRole(store, cfg, member, now = Date.now()) {
  if (!isInactiveRoleEnabled(cfg)) return false;
  const days = Number(cfg.inactiveRoleDays);
  return memberInactiveDays(store, cfg.guildId || member.guild?.id, member, now) >= days;
}

function canManageInactiveRole(guild, role) {
  const bot = guild?.members?.me;
  if (!bot || !role) return false;
  if (role.id === guild.id) return false;
  if (role.managed) return false;
  const perms = bot.permissions;
  if (!perms?.has(PermissionsBitField.Flags.ManageRoles) && !perms?.has(PermissionsBitField.Flags.Administrator)) {
    return false;
  }
  return bot.roles.highest.position > role.position;
}

function isRateLimitError(err) {
  return err?.status === 429 || err?.httpStatus === 429 || err?.code === 429 || err?.rawError?.retry_after != null;
}

function retryAfterMs(err) {
  const sec = Number(err?.retryAfter ?? err?.rawError?.retry_after ?? 1);
  return Math.min(15_000, Math.max(200, Math.ceil(sec * 1000) + 50));
}

async function setRoleWithRetry(member, roleId, add) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (add) await member.roles.add(roleId, 'Inaktivitäts-Rolle');
      else await member.roles.remove(roleId, 'Inaktivitäts-Rolle entfernt (wieder aktiv)');
      return true;
    } catch (err) {
      if (attempt < 3 && isRateLimitError(err)) {
        await sleep(retryAfterMs(err));
        continue;
      }
      throw err;
    }
  }
  return false;
}

async function resolveInactiveRole(guild, roleId) {
  if (!roleId || !guild) return null;
  const cached = guild.roles?.cache?.get?.(roleId);
  if (cached) return cached;
  if (typeof guild.roles?.fetch === 'function') {
    return guild.roles.fetch(roleId).catch(() => null);
  }
  return null;
}

/**
 * Wendet den Soll-Zustand der Inaktiv-Rolle auf ein Mitglied an.
 * @returns {Promise<'updated'|'unchanged'|'failed'|'skipped'>}
 */
async function applyInactiveRoleForMember(ctx, guild, member, { cfg, now = Date.now() } = {}) {
  const config = cfg || ctx.store.getGuild(guild.id);
  const roleId = config?.inactiveRoleId;
  if (!roleId || !member || member.user?.bot) return 'skipped';

  const role = await resolveInactiveRole(guild, roleId);
  if (!role) return 'failed';
  if (!canManageInactiveRole(guild, role)) return 'failed';

  const has = Boolean(member.roles?.cache?.has?.(roleId));
  const want = shouldHaveInactiveRole(ctx.store, config, member, now);
  if (want === has) return 'unchanged';
  try {
    await setRoleWithRetry(member, roleId, want);
    return 'updated';
  } catch {
    return 'failed';
  }
}

/** Entfernt die Inaktiv-Rolle, sobald wieder XP verdient wurde (unabhängig vom Schalter). */
async function clearInactiveRoleForUser(ctx, guild, userId) {
  if (!guild || !userId) return false;
  const cfg = ctx.store?.getGuild?.(guild.id);
  const roleId = cfg?.inactiveRoleId;
  if (!roleId) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !member.roles?.cache?.has?.(roleId)) return false;
  const role = await resolveInactiveRole(guild, roleId);
  if (!role || !canManageInactiveRole(guild, role)) return false;
  try {
    await setRoleWithRetry(member, roleId, false);
    return true;
  } catch {
    return false;
  }
}

async function fetchAllMembers(guild) {
  try {
    if (typeof guild.members?.fetch === 'function') {
      const fetched = await guild.members.fetch();
      if (fetched && typeof fetched.values === 'function') return [...fetched.values()];
    }
  } catch {}
  if (guild.members?.cache && typeof guild.members.cache.values === 'function') {
    return [...guild.members.cache.values()];
  }
  return [];
}

function isSyncRunning(guildId) {
  return syncLocks.has(String(guildId));
}

async function withSyncLock(guildId, fn) {
  const id = String(guildId);
  if (syncLocks.has(id)) return { alreadyRunning: true };
  syncLocks.add(id);
  try {
    return await fn();
  } finally {
    syncLocks.delete(id);
  }
}

/**
 * Gleicht ALLE menschlichen Mitglieder mit der Inaktiv-Rolle ab.
 * An: Rolle vergeben/entfernen je nach inaktiven Tagen.
 * Aus: vorhandene Inaktiv-Rolle entfernen.
 */
async function syncAllInactiveRoles(ctx, guild, lang, { onProgress, cfg, now = Date.now() } = {}) {
  const config = cfg || ctx.store.getGuild(guild.id) || {};
  const enabled = isInactiveRoleEnabled(config);
  const members = await fetchAllMembers(guild);
  const botId = ctx.client?.user?.id || guild.members?.me?.id;
  const humans = members.filter((m) => m && !m.user?.bot && m.id !== botId);
  const stats = {
    total: humans.length,
    done: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    enabled,
  };

  const report = async () => {
    if (typeof onProgress === 'function') {
      try { await onProgress({ ...stats }); } catch {}
    }
  };
  await report();

  if (!config.inactiveRoleId) return stats;

  let lastReport = Date.now();
  for (const member of humans) {
    try {
      const result = await applyInactiveRoleForMember(ctx, guild, member, { cfg: config, now });
      if (result === 'updated') stats.updated += 1;
      else if (result === 'failed') stats.failed += 1;
      else stats.unchanged += 1;
    } catch {
      stats.failed += 1;
    }
    stats.done += 1;
    if (Date.now() - lastReport >= 1500 || stats.done === stats.total) {
      lastReport = Date.now();
      await report();
    }
  }
  return stats;
}

/** Nach dem 0-Uhr-Decay: alle Mitglieder mit aktuellem inactiveDays abgleichen. */
async function applyInactiveRolesAfterDecay(ctx, guild, cfg) {
  if (!cfg?.inactiveRoleId) return { updated: 0, skipped: true };
  const stats = await syncAllInactiveRoles(ctx, guild, cfg.lang || 'de', { cfg });
  ctx.logger?.info?.(
    `[xp-level-bot] Inaktiv-Rolle ${guild.name}: ${stats.updated} angepasst ` +
    `(${stats.unchanged} unverändert, ${stats.failed} fehlgeschlagen, an=${stats.enabled})`
  );
  return stats;
}

module.exports = {
  isInactiveRoleEnabled,
  parseInactiveRoleDays,
  memberInactiveDays,
  shouldHaveInactiveRole,
  canManageInactiveRole,
  applyInactiveRoleForMember,
  clearInactiveRoleForUser,
  isSyncRunning,
  withSyncLock,
  syncAllInactiveRoles,
  applyInactiveRolesAfterDecay,
};
