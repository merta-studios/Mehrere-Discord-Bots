/**
 * Zuverlässiges Routing für Level-Up-/Level-Down-Ankündigungen.
 *
 * Regeln:
 * - Level-Up durch eine Textnachricht: zuerst als Reply auf genau diese Nachricht.
 * - Level-Up aus Voice/Bonus/anderen Quellen sowie Level-Down: Haupt-Chat aus /setup.
 * - Fällt das bevorzugte Ziel aus, werden sinnvolle Fallbacks versucht.
 * - Falls Discord Components V2 für eine Nachricht ablehnt, wird am selben Ziel
 *   noch eine normale Textnachricht versucht. So darf ein Darstellungsproblem
 *   niemals die eigentliche Ankündigung verschlucken.
 */

const { t } = require('./languages');
const { buildLevelUpEmbed, buildLevelDownEmbed } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');

function isSendableTextChannel(channel) {
  if (!channel || typeof channel.send !== 'function') return false;
  if (typeof channel.isTextBased === 'function' && !channel.isTextBased()) return false;
  return true;
}

function buildAnnouncement({ lang, userId, res }) {
  const isLevelUp = Boolean(res?.leveledUp);
  const container = isLevelUp
    ? buildLevelUpEmbed({ lang, userId, level: res.level, xp: res.xp })
    : buildLevelDownEmbed({ lang, userId, level: res.level, xp: res.xp });
  const text = t(isLevelUp ? 'levelUp' : 'levelDown', lang, {
    user: `<@${userId}>`,
    level: res.level,
    xp: res.xp,
    // Der Übersetzungsschlüssel berechnet "needed" nicht selbst.
    needed: require('./logic').xpNeeded(res.level),
  });
  return {
    componentsPayload: componentsV2Payload([container]),
    // Level-Up UND Level-Down nutzen das "## "-Heading (Markdown Lv2) – exakt
    // dieselbe Schriftgröße. So fällt ein Abstieg optisch nicht kleiner aus.
    textPayload: { content: `## ${text}` },
  };
}

/**
 * Versucht Components V2 und danach Plain-Text am selben Ziel.
 * `send` erhält jeweils das Payload und darf reply() oder channel.send() sein.
 */
async function sendWithTextFallback(send, payloads, errors, label) {
  try {
    await send(payloads.componentsPayload);
    return true;
  } catch (err) {
    errors.push(`${label}/components: ${err?.message || err}`);
  }
  try {
    await send(payloads.textPayload);
    return true;
  } catch (err) {
    errors.push(`${label}/text: ${err?.message || err}`);
    return false;
  }
}

async function resolveMainChannel(guild, mainChannelId) {
  if (!guild || !mainChannelId) return null;
  const cached = guild.channels?.cache?.get?.(mainChannelId);
  if (isSendableTextChannel(cached)) return cached;
  try {
    const fetched = await guild.channels?.fetch?.(mainChannelId);
    return isSendableTextChannel(fetched) ? fetched : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{sent:boolean,destination:string|null,errors:string[]}>}
 */
async function sendLevelAnnouncement({ ctx, guild, cfg, userId, res, sourceMsg = null, source = 'other' }) {
  const lang = cfg?.lang || 'de';
  const errors = [];
  const payloads = buildAnnouncement({ lang, userId, res });
  const textTriggeredLevelUp = Boolean(res?.leveledUp) && source === 'text';

  // 1) Ein Chat-Level-Up gehört als Antwort direkt unter die auslösende Nachricht.
  // Sofern es nicht auf den Level-Chat beschränkt ist (only_level_chat), darf die
  // Nachricht sonst in jedem Textkanal erscheinen, in dem geschrieben wurde.
  if (textTriggeredLevelUp && !cfg?.levelMessagesMainOnly && sourceMsg && typeof sourceMsg.reply === 'function') {
    if (await sendWithTextFallback((payload) => sourceMsg.reply(payload), payloads, errors, 'source-reply')) {
      return { sent: true, destination: 'source-reply', errors };
    }
  }

  // Falls Replys im Kanal verboten sind oder die Message-Referenz scheitert,
  // wenigstens normal in denselben Textkanal schreiben. Auch hier nur, wenn
  // die Nachricht nicht auf den Level-Chat beschränkt ist.
  if (textTriggeredLevelUp && !cfg?.levelMessagesMainOnly && isSendableTextChannel(sourceMsg?.channel)) {
    if (await sendWithTextFallback((payload) => sourceMsg.channel.send(payload), payloads, errors, 'source-channel')) {
      return { sent: true, destination: 'source-channel', errors };
    }
  }

  // 2) Vorgesehenes Ziel für alle Nicht-Chat-Level-Ups und sämtliche Level-Downs,
  // außerdem Fallback für einen fehlgeschlagenen Chat-Reply.
  const main = await resolveMainChannel(guild, cfg?.mainChannelId);
  if (main) {
    if (await sendWithTextFallback((payload) => main.send(payload), payloads, errors, 'main-channel')) {
      return { sent: true, destination: 'main-channel', errors };
    }
  } else {
    errors.push(`main-channel: ${cfg?.mainChannelId || 'nicht konfiguriert'} nicht erreichbar`);
  }

  // 3) Systemkanal als serverweiter Notfall-Fallback.
  if (isSendableTextChannel(guild?.systemChannel)) {
    if (await sendWithTextFallback((payload) => guild.systemChannel.send(payload), payloads, errors, 'system-channel')) {
      return { sent: true, destination: 'system-channel', errors };
    }
  }

  // 4) Bei Voice/Bonus/Decay kann sourceMsg trotzdem eine Bot-Nachricht sein.
  // Nur nutzen, wenn sie nicht bereits oben als Chat-Quelle versucht wurde.
  if (!textTriggeredLevelUp && sourceMsg && typeof sourceMsg.reply === 'function') {
    if (await sendWithTextFallback((payload) => sourceMsg.reply(payload), payloads, errors, 'source-fallback')) {
      return { sent: true, destination: 'source-fallback', errors };
    }
  }

  ctx?.logger?.error?.(
    `[xp-level-bot] Level-Ankündigung endgültig fehlgeschlagen (${guild?.name || cfg?.guildId || '?'}, User ${userId}): ${errors.join(' | ')}`
  );
  return { sent: false, destination: null, errors };
}

/**
 * Benachrichtigung für den /give_xp-Befehl des Server-Owners.
 * Sie erscheint immer im Level-Chat (/setup `levelchat`) – wie die anderen
 * Level-Nachrichten als „## “-Heading, aber mit Owner- UND Nutzer-mention.
 * Nennt die vergebene/abgezogene XP-Zahl und wie sich das Level verändert hat.
 */
async function sendOwnerXpAnnouncement({
  ctx,
  guild,
  cfg,
  ownerId,
  userId,
  amount,
  beforeLevel,
  afterLevel,
  leveledUp = false,
  leveledDown = false,
  lang = 'de',
}) {
  const n = Math.trunc(Number(amount) || 0);
  const abs = Math.abs(n);
  const key = n < 0
    ? (leveledDown ? 'giveXpTaken' : 'giveXpTakenSame')
    : (leveledUp ? 'giveXpGiven' : 'giveXpGivenSame');
  const text = `## ${t(key, lang, {
    admin: `<@${ownerId}>`,
    user: `<@${userId}>`,
    amount: abs,
    before: beforeLevel,
    after: afterLevel,
  })}`;
  const payloads = {
    componentsPayload: { content: text },
    textPayload: { content: text },
  };
  const errors = [];

  const main = await resolveMainChannel(guild, cfg?.mainChannelId);
  if (main) {
    if (await sendWithTextFallback((p) => main.send(p), payloads, errors, 'owner-main')) {
      return { sent: true, destination: 'owner-main', errors };
    }
  } else {
    errors.push(`owner-main: ${cfg?.mainChannelId || 'nicht konfiguriert'} nicht erreichbar`);
  }

  if (isSendableTextChannel(guild?.systemChannel)) {
    if (await sendWithTextFallback((p) => guild.systemChannel.send(p), payloads, errors, 'owner-system')) {
      return { sent: true, destination: 'owner-system', errors };
    }
  }

  ctx?.logger?.error?.(
    `[xp-level-bot] /give_xp-Ankündigung endgültig fehlgeschlagen (${guild?.name || cfg?.guildId || '?'}, User ${userId}): ${errors.join(' | ')}`
  );
  return { sent: false, destination: null, errors };
}

module.exports = {
  isSendableTextChannel,
  buildAnnouncement,
  sendWithTextFallback,
  resolveMainChannel,
  sendLevelAnnouncement,
  sendOwnerXpAnnouncement,
};
