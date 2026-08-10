/**
 * Container & Embeds für XP Bot – alles Components V2, krass designt wie Birthday Bot
 */

const {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const { LANGS, t, tzOf, formatToday } = require('./languages');
const { xpNeeded, getMedal, nextDecayInfo } = require('./logic');

const LEADERBOARD_MARKER = 'xp_leader::v1::';

function extractAllText(obj) {
  let out = '';
  if (!obj) return out;
  if (typeof obj === 'string') return obj + '\n';
  if (Array.isArray(obj)) { for (const item of obj) out += extractAllText(item); return out; }
  if (typeof obj === 'object') {
    if (obj.content) out += obj.content + '\n';
    if (obj.data?.content) out += obj.data.content + '\n';
    if (obj.title) out += obj.title + '\n';
    if (obj.description) out += obj.description + '\n';
    if (obj.footer?.text) out += obj.footer.text + '\n';
    if (obj.fields && Array.isArray(obj.fields)) for (const f of obj.fields) out += (f.name||'')+'\n'+(f.value||'')+'\n';
    if (obj.components) out += extractAllText(obj.components);
    if (obj.embeds) out += extractAllText(obj.embeds);
  }
  return out;
}

/**
 * Baut den Leaderboard-Container.
 * @param {Object} opts
 * @param {string} opts.lang
 * @param {Array} opts.entries - sorted top 15 [{userId, level, xp}]
 * @param {Date} opts.now
 * @param {string} opts.guildName
 */
function buildLeaderboardEmbed({ lang='de', entries=[], now=new Date(), guildName='' }) {
  const tz = tzOf(lang);
  const timeStr = new Intl.DateTimeFormat(LANGS[lang]?.locale || 'de-DE', {
    timeZone: tz, dateStyle:'full', timeStyle:'short'
  }).format(now);

  const container = new ContainerBuilder();

  const header = [
    `# ${t('lbTitle', lang)}`,
    t('lbTagline', lang),
    `\u200B${LEADERBOARD_MARKER}${lang}\u200B`,
  ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  if (!entries.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`✨ ${t('lbEmpty', lang)}`));
  } else {
    // header for table
    const lines = entries.map((e, idx) => {
      const rank = idx+1;
      const needed = xpNeeded(e.level);
      const medal = rank<=3 ? getMedal(rank) : '';
      const medalStr = medal ? ` ${medal}` : '';
      // Format: #1 @User — Lvl 12 · 45/100 XP 🥇
      // Use translation lbEntryLine but we build directly for stability
      // Show bar?
      return `\`#${rank}\` <@${e.userId}> — **Lvl ${e.level}** · ${e.xp}/${needed} XP${medalStr}`;
    });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  // Decay notice
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t('lbDecayNotice', lang)));

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const footer = [
    t('lbUpdated', lang, { time: timeStr, tz }),
    t('lbNextUpdate', lang),
  ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  return container;
}

// Rank Container für /rank (ephemeral oder public) – Components V2 mit Thumbnail statt Embed
function buildRankEmbed({ lang, userId, rankInfo, avatarUrl, now=new Date() }) {
  // rankInfo: {rank, total, user:{level,xp}} or null
  const container = new ContainerBuilder();
  if (!rankInfo) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `# ${t('rankTitle', lang)}\n\n${t('rankNotFound', lang)}`
    ));
    return { container, embed: null };
  }
  const lvl = rankInfo.user.level;
  const xp = rankInfo.user.xp;
  const needed = xpNeeded(lvl);
  const nextLevel = Math.min(lvl+1, 100);
  const percent = Math.round((xp/needed)*100);
  const BAR_SEGMENTS = 8;
  const filled = Math.round((percent/100)*BAR_SEGMENTS);
  const bar = '⬛'.repeat(filled) + '⬜'.repeat(BAR_SEGMENTS-filled);
  const remaining = Math.max(0, needed - xp);
  // Wie viele XP gehen heute Nacht um 0 Uhr verloren? (5%, bei Inaktivität mehr)
  const decayInfo = nextDecayInfo(rankInfo.user, now.getTime());
  const body = t('rankBody', lang, {
    user: `<@${userId}>`,
    rank: rankInfo.rank,
    total: rankInfo.total,
    level: lvl,
    xp, needed, nextLevel,
    bar, percent, remaining,
    decayXp: decayInfo.decay,
    decayPercent: decayInfo.percent,
  });
  const content = `# ${t('rankTitle', lang)}\n\n${body}`;
  if (avatarUrl) {
    try {
      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
      container.addSectionComponents(section);
    } catch {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  }
  return { container, embed: null };
}

// Level Up/Down Container (für Haupt-Chat)
function buildLevelUpEmbed({ lang, userId, level, xp }) {
  const needed = xpNeeded(level);
  const desc = t('levelUp', lang, { user: `<@${userId}>`, level, xp, needed });
  // "## " – die Level-Up-Zeile als Markdown-Überschrift (Level 2), damit der Text größer auffällt
  const content = `## ${desc}`;
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  return container;
}
function buildLevelDownEmbed({ lang, userId, level, xp }) {
  const needed = xpNeeded(level);
  const desc = t('levelDown', lang, { user: `<@${userId}>`, level, xp, needed });
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));
  return container;
}

function smallContainer(title, desc) {
  const container = new ContainerBuilder();
  let text = '';
  if (title) text += `# ${title}\n\n`;
  if (desc) text += desc;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim()||'…'));
  return container;
}

function smallEmbed(_c, title, desc){ return smallContainer(title,desc); }

// ---------------------------------------------------------------------------
// Bonus-Belohnungen (Zufalls-XP-Geschenke im Haupt-Chat)
// ---------------------------------------------------------------------------

/**
 * Offener Bonus-Drop: Text nennt die genaue XP-Zahl, der „Einsammeln“-Button
 * ist aktiv. Der Marker `xp-bonus:` dient der Wiedererkennung.
 */
function buildBonusDropEmbed({ lang, xp, dropId }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ${t('bonusTitle', lang)}\n\n${t('bonusBody', lang, { xp })}\n\u200Bxp-bonus:${dropId}\u200B`
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`xp_bonus_claim_${dropId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('bonusBtn', lang))
    )
  );
  return container;
}

/** Eingeforderter Drop: Button bleibt sichtbar, aber deaktiviert; Text pingt den Schnellsten. */
function buildBonusClaimedEmbed({ lang, xp, claimerId, dropId }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ${t('bonusClaimedTitle', lang)}\n\n${t('bonusClaimedBody', lang, { user: `<@${claimerId}>`, xp })}\n\u200Bxp-bonus:${dropId}\u200B`
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`xp_bonus_claim_${dropId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('bonusBtn', lang))
        .setDisabled(true)
    )
  );
  return container;
}

/** Verfallener Drop (niemand war schnell genug), Button deaktiviert. */
function buildBonusExpiredEmbed({ lang, xp, dropId }) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `# ${t('bonusExpiredTitle', lang)}\n\n${t('bonusExpiredBody', lang, { xp })}\n\u200Bxp-bonus:${dropId}\u200B`
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`xp_bonus_claim_${dropId}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('bonusBtn', lang))
        .setDisabled(true)
    )
  );
  return container;
}

module.exports = {
  LEADERBOARD_MARKER,
  extractAllText,
  buildLeaderboardEmbed,
  buildRankEmbed,
  buildLevelUpEmbed,
  buildLevelDownEmbed,
  buildBonusDropEmbed,
  buildBonusClaimedEmbed,
  buildBonusExpiredEmbed,
  smallContainer,
  smallEmbed,
};
