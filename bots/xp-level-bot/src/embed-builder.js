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
} = require('discord.js');

const { LANGS, t, tzOf, formatToday } = require('./languages');
const { xpNeeded, getMedal } = require('./logic');

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
  const body = t('rankBody', lang, {
    user: `<@${userId}>`,
    rank: rankInfo.rank,
    total: rankInfo.total,
    level: lvl,
    xp, needed, nextLevel,
    bar, percent, remaining
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
  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(desc));
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

module.exports = {
  LEADERBOARD_MARKER,
  extractAllText,
  buildLeaderboardEmbed,
  buildRankEmbed,
  buildLevelUpEmbed,
  buildLevelDownEmbed,
  smallContainer,
  smallEmbed,
};
