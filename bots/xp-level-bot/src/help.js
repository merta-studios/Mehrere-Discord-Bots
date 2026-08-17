'use strict';

/**
 * /help – Hilfe in drei klaren Seiten statt einer Textwand:
 *   1. Befehle     – jeder Command mit seinen Optionen im Klartext (Startseite)
 *   2. Überblick   – wie XP verdient wird und was der Bot automatisch macht
 *   3. Platzhalter – jeder {PLATZHALTER} mit Bedeutung und Beispiel
 *
 * Umgeschaltet wird per Select-Menü (Components V2), die Antwort bleibt
 * öffentlich wie bisher. Damit bleibt jede Seite weit unter dem
 * 4000-Zeichen-Limit einer Components-V2-Nachricht.
 */

const {
  ActionRowBuilder,
  ContainerBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const { t } = require('./languages');
const { componentsV2Payload } = require('./message-payload');

const HELP_SELECT_PREFIX = 'xp_help:';
const HELP_PAGES = ['commands', 'overview', 'placeholders'];
const DEFAULT_PAGE = 'commands';
const PAGE_LABEL_KEY = {
  overview: 'helpPageOverview',
  commands: 'helpPageCommands',
  placeholders: 'helpPagePlaceholders',
};
const PAGE_EMOJI = { overview: '⭐', commands: '💬', placeholders: '🔤' };
/** Discord erlaubt 4000 Zeichen pro TextDisplay – wir bleiben klar darunter. */
const MAX_BLOCK = 3500;

function normalizePage(page) {
  return HELP_PAGES.includes(page) ? page : DEFAULT_PAGE;
}

/** Lazy require, sonst gäbe es einen Zyklus commands.js ↔ help.js. */
function mention(ctx, name, guildId) {
  const { commandMention } = require('./commands');
  return commandMention(ctx, name, guildId);
}

/**
 * Ein Command-Eintrag: fette Command-Mention, darunter „was macht das“
 * und – wenn es Optionen gibt – „was bedeuten die Optionen“.
 */
function commandEntry(ctx, guildId, name, descKey, optionKey = null, lang = 'de') {
  const lines = [`**${mention(ctx, name, guildId)}**`, `› ${t(descKey, lang)}`];
  if (optionKey) lines.push(`› ${t(optionKey, lang)}`);
  return lines.join('\n');
}

function overviewPage(ctx, guildId, lang) {
  return [t('helpOverviewBody', lang)];
}

function commandsPage(ctx, guildId, lang) {
  const entry = (name, descKey, optionKey) => commandEntry(ctx, guildId, name, descKey, optionKey, lang);
  return [
    [
      t('helpGroupEveryone', lang),
      entry('rank', 'helpRank'),
      entry('help', 'helpHelp'),
      '',
      t('helpGroupSetup', lang),
      entry('setup', 'helpSetup', 'helpOptSetup'),
      entry('level_roles', 'levelRolesHelp', 'helpOptLevelRoles'),
      entry('update_leaderboard', 'updateLeaderboardHelp'),
      entry('toggle_nicknames', 'toggleNicknamesHelp', 'helpOptToggleNicknames'),
      entry('sync_nicknames', 'syncNicknamesHelp'),
      entry('set_inactive_role', 'setInactiveRoleHelp', 'helpOptInactiveRole'),
      entry('ping_inactive_people', 'pingInactiveHelp', 'helpOptPingInactive'),
      entry('admin_set_bot_profile', 'helpSetProfile', 'helpOptProfile'),
    ].join('\n'),
    [
      t('helpGroupGiveaway', lang),
      entry('start_giveaway', 'giveawayHelp', 'helpOptStartGiveaway'),
      entry('giveaway_admin', 'giveawayAdminHelp', 'helpOptGiveawayAdmin'),
      '',
      t('helpGroupOwner', lang),
      entry('adminpanel', 'helpAdminPanel'),
    ].join('\n'),
  ];
}

function placeholdersPage(ctx, guildId, lang) {
  return [
    [
      t('helpPhIntro', lang),
      '',
      t('helpPhLevelRoles', lang),
      '',
      t('helpPhPingInactive', lang),
    ].join('\n'),
    [
      t('helpPhGiveawayText', lang),
      '',
      t('helpPhGiveawayWinner', lang),
      '',
      t('helpPhExample', lang),
    ].join('\n'),
  ];
}

const PAGE_BUILDER = { overview: overviewPage, commands: commandsPage, placeholders: placeholdersPage };

function pageSelect(lang, page) {
  return new StringSelectMenuBuilder()
    .setCustomId(`${HELP_SELECT_PREFIX}${page}`)
    .setPlaceholder(t('helpNavPlaceholder', lang))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(HELP_PAGES.map((p) => ({
      label: t(PAGE_LABEL_KEY[p], lang).slice(0, 100),
      value: p,
      emoji: PAGE_EMOJI[p],
      default: p === page,
    })));
}

/** Baut die komplette /help-Nachricht für eine Seite. */
function buildHelpPayload(ctx, { lang = 'de', guildId = null, page = DEFAULT_PAGE } = {}) {
  const current = normalizePage(page);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${t('helpTitle', lang)}`,
    t('helpDesc', lang),
    `## ${t(PAGE_LABEL_KEY[current], lang)}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder());
  for (const block of PAGE_BUILDER[current](ctx, guildId, lang)) {
    if (!block) continue;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.slice(0, MAX_BLOCK)));
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(t('helpHint', lang)));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(pageSelect(lang, current)));
  return componentsV2Payload([container], { allowedMentions: { parse: [] } });
}

function isHelpSelect(customId) {
  return typeof customId === 'string' && customId.startsWith(HELP_SELECT_PREFIX);
}

/** Select-Menü unter /help: Seite wechseln, ohne eine neue Nachricht zu senden. */
async function handleHelpSelect(ctx, interaction) {
  const { langFromDiscord } = require('./languages');
  const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
  const page = normalizePage(interaction.values?.[0]);
  return interaction.update(buildHelpPayload(ctx, { lang, guildId: interaction.guildId, page }));
}

module.exports = {
  HELP_SELECT_PREFIX,
  HELP_PAGES,
  DEFAULT_PAGE,
  buildHelpPayload,
  isHelpSelect,
  handleHelpSelect,
  normalizePage,
};
