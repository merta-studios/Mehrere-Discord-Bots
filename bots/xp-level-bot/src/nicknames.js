/**
 * Nickname-Helfer für den XP Bot:
 * - Setzt das Level-Tag `[Lvl X 🥇] Name` (Top 3 mit Medaille)
 * - Aktualisiert Nicknames ZUVERLÄSSIG, wenn sich Ränge verschieben:
 *   Bei jedem Level-Up/Down werden Top 5 + der betroffene Nutzer geprüft,
 *   damit z.B. ein neuer Platz 2 auch wirklich 🥈 im Anzeigenamen bekommt.
 * - Cooldown gegen Hinweis-Spam (1h pro Server+Nutzer), Throttle für
 *   XP-only-Verschiebungen (2 Min pro Server).
 * - `/toggle_nicknames` steuert, ob Tags überhaupt gesetzt werden (Standard: an).
 * - `/sync_nicknames` gleicht alle Mitglieder eines Servers ab.
 */

const { PermissionsBitField } = require('discord.js');

// Cooldown gegen Nickname-Fehler-Hinweise pro Server+Nutzer (1h)
const nickFailCooldown = new Map();
// Throttle für Medaillen-Refresh ohne Level-Change (XP-only-Verschiebungen)
const medalRefreshCooldown = new Map();
const MEDAL_REFRESH_MIN_MS = 2 * 60 * 1000;
const NICK_FAIL_COOLDOWN_MS = 60 * 60 * 1000;
// Guilds, auf denen gerade /sync_nicknames läuft
const syncLocks = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function canManageNickname(guild, botMember, targetMember) {
  if (!botMember || !targetMember) return false;
  const perms = botMember.permissions;
  if (!perms?.has(PermissionsBitField.Flags.ManageNicknames) && !perms?.has(PermissionsBitField.Flags.Administrator)) return false;
  // Der Server-Owner steht immer über allen Rollen – der Bot kann ihn nicht umbenennen
  if (targetMember.id === guild.ownerId) return false;
  const botHigh = botMember.roles.highest.position;
  const targetHigh = targetMember.roles.highest.position;
  return botHigh > targetHigh;
}

/**
 * Nickname-Tags sind standardmäßig AN. Nur ein explizites `false`
 * (gesetzt durch /toggle_nicknames) schaltet sie aus.
 */
function areNicknamesEnabled(store, guildId) {
  if (!store || typeof store.getGuild !== 'function') return true;
  const cfg = store.getGuild(guildId);
  if (!cfg) return true;
  return cfg.nicknamesEnabled !== false;
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

function isRateLimitError(err) {
  return err?.status === 429 || err?.httpStatus === 429 || err?.code === 429 || err?.rawError?.retry_after != null;
}

function retryAfterMs(err) {
  const sec = Number(err?.retryAfter ?? err?.rawError?.retry_after ?? 1);
  return Math.min(15_000, Math.max(200, Math.ceil(sec * 1000) + 50));
}

async function setNicknameWithRetry(member, nick) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await member.setNickname(nick);
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

async function sendNickFailHint({ guild, userId, lang, store }) {
  // Discord erlaubt es nie, den Server-Owner umzubenennen –
  // für den Owner gibt es daher keinen sinnvollen Hinweis (Ausnahme, Hinweis bleibt für alle anderen)
  if (String(userId) === String(guild.ownerId)) return;
  const cfg = store.getGuild(guild.id);
  const key = `${guild.id}:${userId}`;
  const now = Date.now();
  if (nickFailCooldown.has(key) && now - nickFailCooldown.get(key) < NICK_FAIL_COOLDOWN_MS) return;
  nickFailCooldown.set(key, now);
  const { t } = require('./languages');
  const { smallContainer } = require('./embed-builder');
  const { componentsV2Payload } = require('./message-payload');
  const msgText = t('nickFail', lang, { user: `<@${userId}>` });
  const ch = await guild.channels.fetch(cfg?.mainChannelId).catch(()=>null);
  if (ch && ch.isTextBased()) {
    await ch.send(componentsV2Payload([smallContainer(null, msgText)])).catch(()=>{});
  }
}

/** Berechnet den SOLL-Nickname (Level-Tag + Medaille für Top 3). */
function expectedNicknameForMember(store, guildId, userId, level, member) {
  const rankInfo = store.getRank(guildId, userId);
  const rank = rankInfo?.rank || null;
  const { formatNickname, stripLvlTag } = require('./logic');
  const display = stripLvlTag(member.displayName || member.user.username);
  return formatNickname(level, display, rank && rank <= 3 ? rank : null);
}

/**
 * Setzt den Nickname eines Users auf den SOLL-Wert, wenn er abweicht.
 * @returns {Promise<boolean>} true wenn Nickname aktuell ist/gesetzt wurde
 */
async function ensureNickname(ctx, guild, userId, level, lang) {
  if (!areNicknamesEnabled(ctx.store, guild.id)) return false;
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (!member) return false;
  const result = await applyExpectedNickname(ctx, guild, member, lang, { level });
  return result !== 'failed';
}

/**
 * Wendet den SOLL-Tag an (oder belässt ihn).
 * @returns {Promise<'updated'|'unchanged'|'failed'>}
 */
async function applyExpectedNickname(ctx, guild, member, lang, { level, silent = false } = {}) {
  // Zweite Sicherung: auch direkte Aufrufe (nicht nur refreshRankNicknames)
  // dürfen nach /toggle_nicknames off keine Tags mehr setzen.
  if (!areNicknamesEnabled(ctx.store, guild.id)) return 'unchanged';
  const stored = ctx.store.getUser(guild.id, member.id);
  const resolvedLevel = level ?? stored?.level ?? 1;
  const newNick = expectedNicknameForMember(ctx.store, guild.id, member.id, resolvedLevel, member);
  if (member.nickname === newNick) return 'unchanged';
  if (!canManageNickname(guild, guild.members.me, member)) {
    if (!silent) await sendNickFailHint({ guild, userId: member.id, lang, store: ctx.store });
    return 'failed';
  }
  try {
    await setNicknameWithRetry(member, newNick);
    return 'updated';
  } catch {
    if (!silent) await sendNickFailHint({ guild, userId: member.id, lang, store: ctx.store });
    return 'failed';
  }
}

/**
 * Entfernt ein vorhandenes `[Lvl …]`-Tag aus dem Nickname.
 * @returns {Promise<'updated'|'unchanged'|'failed'>}
 */
async function removeNicknameTag(ctx, guild, member, lang, { silent = false } = {}) {
  const { stripLvlTag, hasLvlTag } = require('./logic');
  const current = member.nickname;
  if (!current || !hasLvlTag(current)) return 'unchanged';
  const stripped = stripLvlTag(current);
  const username = member.user?.username || '';
  const target = (!stripped || stripped === username) ? null : stripped;
  if (current === target) return 'unchanged';
  if (!canManageNickname(guild, guild.members.me, member)) {
    if (!silent) await sendNickFailHint({ guild, userId: member.id, lang, store: ctx.store });
    return 'failed';
  }
  try {
    await setNicknameWithRetry(member, target);
    return 'updated';
  } catch {
    if (!silent) await sendNickFailHint({ guild, userId: member.id, lang, store: ctx.store });
    return 'failed';
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

/**
 * Geht ALLE menschlichen Mitglieder durch und korrigiert Nicknames:
 * - Tags an: fehlende/falsche Tags setzen, Medaillen prüfen
 * - Tags aus: vorhandene Tags entfernen
 *
 * onProgress wird regelmäßig aufgerufen, damit /sync_nicknames einen
 * Lade-/Fortschrittsbildschirm anzeigen kann.
 */
async function syncAllNicknames(ctx, guild, lang, { onProgress } = {}) {
  const members = await fetchAllMembers(guild);
  const botId = ctx.client?.user?.id || guild.members?.me?.id;
  const humans = members.filter((m) => m && !m.user?.bot && m.id !== botId);
  const enabled = areNicknamesEnabled(ctx.store, guild.id);
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

  let lastReport = Date.now();
  for (const member of humans) {
    try {
      const result = enabled
        ? await applyExpectedNickname(ctx, guild, member, lang, { silent: true })
        : await removeNicknameTag(ctx, guild, member, lang, { silent: true });
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

/**
 * Aktualisiert ZUVERLÄSSIG alle Nicknames, deren Medaille sich durch eine
 * Rang-Verschiebung geändert haben könnte: Top 5 der Rangliste + der
 * geänderte User. Deckt jeden einzelnen Rang-Sprung ab (auch von Platz 4
 * auf 1 oder von 1 auf 20 – die Verdrängten bleiben in den Top 5).
 */
async function refreshRankNicknames(ctx, guild, changedUserId, lang) {
  if (!areNicknamesEnabled(ctx.store, guild.id)) return;
  const users = ctx.store.getLeaderboard(guild.id, 5);
  const ids = new Set(users.map((u) => u.userId));
  if (changedUserId) ids.add(String(changedUserId));
  for (const id of ids) {
    const u = ctx.store.getUser(guild.id, id);
    if (!u) continue;
    try {
      await ensureNickname(ctx, guild, id, u.level, lang);
    } catch {}
  }
}

/**
 * Gedrosselte Variante für XP-only-Verschiebungen (kein Level-Change):
 * Wenn z.B. zwei Nutzer dasselbe Level haben und einer durch XP den anderen
 * überholt, ändert sich die Medaille im Nickname. Passiert nur selten,
 * daher reicht ein Check alle 2 Minuten pro Server.
 */
async function maybeRefreshRankNicknames(ctx, guild, changedUserId, lang, minIntervalMs = MEDAL_REFRESH_MIN_MS) {
  if (!areNicknamesEnabled(ctx.store, guild.id)) return false;
  const now = Date.now();
  const last = medalRefreshCooldown.get(guild.id) || 0;
  if (now - last < minIntervalMs) return false;
  medalRefreshCooldown.set(guild.id, now);
  await refreshRankNicknames(ctx, guild, changedUserId, lang);
  return true;
}

module.exports = {
  canManageNickname,
  sendNickFailHint,
  ensureNickname,
  applyExpectedNickname,
  removeNicknameTag,
  refreshRankNicknames,
  maybeRefreshRankNicknames,
  expectedNicknameForMember,
  areNicknamesEnabled,
  isSyncRunning,
  withSyncLock,
  syncAllNicknames,
  MEDAL_REFRESH_MIN_MS,
};
