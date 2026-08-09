/**
 * Nickname-Helfer für den XP Bot:
 * - Setzt das Level-Tag `[Lvl X 🥇] Name` (Top 3 mit Medaille)
 * - Aktualisiert Nicknames ZUVERLÄSSIG, wenn sich Ränge verschieben:
 *   Bei jedem Level-Up/Down werden Top 5 + der betroffene Nutzer geprüft,
 *   damit z.B. ein neuer Platz 2 auch wirklich 🥈 im Anzeigenamen bekommt.
 * - Cooldown gegen Hinweis-Spam (1h pro Server+Nutzer), Throttle für
 *   XP-only-Verschiebungen (2 Min pro Server).
 */

const { PermissionsBitField } = require('discord.js');

// Cooldown gegen Nickname-Fehler-Hinweise pro Server+Nutzer (1h)
const nickFailCooldown = new Map();
// Throttle für Medaillen-Refresh ohne Level-Change (XP-only-Verschiebungen)
const medalRefreshCooldown = new Map();
const MEDAL_REFRESH_MIN_MS = 2 * 60 * 1000;
const NICK_FAIL_COOLDOWN_MS = 60 * 60 * 1000;

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
  const member = await guild.members.fetch(userId).catch(()=>null);
  if (!member) return false;
  const newNick = expectedNicknameForMember(ctx.store, guild.id, userId, level, member);
  if (member.nickname === newNick) return true;
  if (!canManageNickname(guild, guild.members.me, member)) {
    await sendNickFailHint({ guild, userId, lang, store: ctx.store });
    return false;
  }
  try {
    await member.setNickname(newNick);
    return true;
  } catch (err) {
    await sendNickFailHint({ guild, userId, lang, store: ctx.store });
    return false;
  }
}

/**
 * Aktualisiert ZUVERLÄSSIG alle Nicknames, deren Medaille sich durch eine
 * Rang-Verschiebung geändert haben könnte: Top 5 der Rangliste + der
 * geänderte User. Deckt jeden einzelnen Rang-Sprung ab (auch von Platz 4
 * auf 1 oder von 1 auf 20 – die Verdrängten bleiben in den Top 5).
 */
async function refreshRankNicknames(ctx, guild, changedUserId, lang) {
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
  refreshRankNicknames,
  maybeRefreshRankNicknames,
  expectedNicknameForMember,
  MEDAL_REFRESH_MIN_MS,
};
