/**
 * Container-Builder für den Sicherheitsbot – modern gestaltet mit Components V2.
 */

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const { t, tzOf, LANGS } = require('./languages');
const {
  CATEGORIES,
  CATEGORY_ICONS,
  getCategoryTranslationKey,
  getActionTranslationKey,
  progressBar,
  maskApiKey,
} = require('./rules');

function smallContainer(title, desc) {
  const container = new ContainerBuilder();
  let text = '';
  if (title) text += `# ${title}\n\n`;
  if (desc) text += desc;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim() || '…'));
  return container;
}

function formatDate(timestamp, lang = 'de') {
  if (!timestamp) return '—';
  try {
    const tz = tzOf(lang);
    return new Intl.DateTimeFormat(LANGS[lang]?.locale || 'de-DE', {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

/**
 * Erzeugt den Verwarnungs-Container für einen Regelverstoß im Chat.
 */
function buildViolationAlertContainer({
  lang = 'de',
  userId,
  category,
  warningNumber,
  maxWarnings = 3,
  action,
  expiresAt,
  messageDeleted = false,
}) {
  const container = new ContainerBuilder();
  const icon = CATEGORY_ICONS[category] || '⚠️';
  const catName = t(getCategoryTranslationKey(category), lang);
  const actionName = t(getActionTranslationKey(action), lang);
  const dateStr = formatDate(expiresAt, lang);

  const title = t('warnTitle', lang);
  const body = t('warnBody', lang, {
    user: `<@${userId}>`,
    category: `${icon} ${catName}`,
    current: warningNumber,
    max: maxWarnings,
    action: actionName,
    date: dateStr,
  });

  let content = `# ${title}\n\n${body}`;
  if (messageDeleted) {
    content += `\n\n*(Die verstoßende Nachricht wurde automatisch gelöscht)*`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  return container;
}

/**
 * Erzeugt den Status-Container für einen Benutzer (/status).
 */
function buildStatusContainer({
  lang = 'de',
  userId,
  activeViolations = [],
  maxWarnings = 3,
  isTimedOut = false,
  timeoutUntil = null,
}) {
  const container = new ContainerBuilder();
  const title = t('statusTitle', lang, { user: `<@${userId}>` });

  if (activeViolations.length === 0 && !isTimedOut) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${title}\n\n${t('statusClean', lang)}`)
    );
    return container;
  }

  const timeoutText = isTimedOut
    ? `⏱️ **Aktiv bis:** ${formatDate(timeoutUntil, lang)}`
    : `✅ **Kein aktiver Timeout**`;

  const lines = activeViolations.map((v) => {
    const icon = CATEGORY_ICONS[v.highestCategory] || '⚠️';
    const catName = t(getCategoryTranslationKey(v.highestCategory), lang);
    const actName = t(getActionTranslationKey(v.actionTaken), lang);
    const expStr = formatDate(v.expiresAt, lang);
    const scorePct = Math.round((v.highestScore || 0) * 100);
    return `- **#${v.id}** · ${icon} **${catName}** (${scorePct}%)\n  *Maßnahme:* ${actName} · *Verfällt:* ${expStr}`;
  });

  const body = t('statusSummary', lang, {
    current: activeViolations.length,
    max: maxWarnings,
    timeout: timeoutText,
    list: lines.length > 0 ? lines.join('\n') : '—',
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
  return container;
}

/**
 * Erzeugt die Admin-Verwaltungsübersicht für einen Benutzer (/manage_user).
 */
function buildManageUserContainer({
  lang = 'de',
  targetUser,
  activeViolations = [],
  allViolations = [],
  maxWarnings = 3,
  isTimedOut = false,
  timeoutUntil = null,
}) {
  const container = new ContainerBuilder();
  const title = t('manageTitle', lang, { user: targetUser?.tag || targetUser?.username || targetUser?.id });

  const timeoutText = isTimedOut
    ? `⏱️ **Aktiv bis:** ${formatDate(timeoutUntil, lang)}`
    : `✅ **Kein aktiver Timeout**`;

  const activeLines = activeViolations.map((v) => {
    const icon = CATEGORY_ICONS[v.highestCategory] || '⚠️';
    const catName = t(getCategoryTranslationKey(v.highestCategory), lang);
    const actName = t(getActionTranslationKey(v.actionTaken), lang);
    const expStr = formatDate(v.expiresAt, lang);
    return `- **ID \`${v.id}\`** · ${icon} **${catName}**\n  *Maßnahme:* ${actName} · *Verfällt:* ${expStr}`;
  });

  const summary = t('manageSummary', lang, {
    current: activeViolations.length,
    max: maxWarnings,
    total: allViolations.length,
    timeout: timeoutText,
    list: activeLines.length > 0 ? `### Aktive Verstöße:\n${activeLines.join('\n')}` : '✅ *Keine aktiven Verstöße vorhanden.*',
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${summary}`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  // Aktionen für Admins
  if (activeViolations.length > 0) {
    const selectOptions = activeViolations.slice(0, 25).map((v) => {
      const catName = t(getCategoryTranslationKey(v.highestCategory), lang);
      return {
        label: `Verstoß #${v.id.slice(-6)}: ${catName}`.slice(0, 95),
        description: `Verfällt: ${formatDate(v.expiresAt, lang)}`?.slice(0, 95),
        value: v.id,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId(`sec_del_viol_${targetUser.id}`)
      .setPlaceholder(t('manageSelectPlaceholder', lang))
      .addOptions(selectOptions);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  }

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`sec_clear_all_${targetUser.id}`)
      .setStyle(ButtonStyle.Danger)
      .setLabel(t('manageBtnClearAll', lang))
      .setDisabled(activeViolations.length === 0),
  ];

  if (isTimedOut) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`sec_unmute_${targetUser.id}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('manageBtnRemoveTimeout', lang))
    );
  }

  container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return container;
}

/**
 * Erzeugt den Analysebericht für /test_text.
 */
function buildTestReportContainer({ lang = 'de', text, evalRes, guildConfig }) {
  const container = new ContainerBuilder();
  const title = t('testTitle', lang);
  const snippet = text.length > 300 ? text.slice(0, 297) + '…' : text;

  let resultHeader = '';
  if (!evalRes.violated) {
    resultHeader = t('testClean', lang);
  } else {
    const icon = CATEGORY_ICONS[evalRes.highestCategory] || '⚠️';
    const catName = t(getCategoryTranslationKey(evalRes.highestCategory), lang);
    const scorePct = Math.round((evalRes.highestScore || 0) * 100);
    const actName = t(getActionTranslationKey(guildConfig?.warningActions?.[0]?.action || 'warn'), lang);
    resultHeader = t('testViolated', lang, {
      category: `${icon} ${catName}`,
      score: scorePct,
      action: actName,
      autoDelete: evalRes.shouldAutoDelete ? '✅ Ja' : '❌ Nein',
    });
  }

  const scoreLines = evalRes.details.map((d) => {
    const icon = CATEGORY_ICONS[d.category] || '🔹';
    const catName = t(getCategoryTranslationKey(d.category), lang);
    const scorePct = Math.round(d.score * 100);
    const threshPct = Math.round(d.threshold * 100);
    const bar = progressBar(d.score, 8);
    const status = !d.enabled
      ? '*(Deaktiviert)*'
      : d.violation
      ? '🚨 **VERSTOSS**'
      : '✅ OK';
    return `- ${icon} **${catName}**\n  \`[${bar}]\` **${scorePct}%** *(Schwelle: ${threshPct}% · ${status})*`;
  });

  const content = [
    `# ${title}`,
    '',
    `**${t('testInputLabel', lang)}**`,
    `> ${escapeBlockquotes(snippet)}`,
    '',
    resultHeader,
    '',
    '### Kategorie-Auswertung & Schwellenwerte:',
    scoreLines.join('\n'),
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  return container;
}

/**
 * Erzeugt die Übersicht für /set_warnings.
 */
function buildWarningsConfigContainer({ lang = 'de', guildConfig }) {
  const container = new ContainerBuilder();
  const title = t('warningsTitle', lang);
  const max = guildConfig.maxWarnings || 3;
  const days = guildConfig.violationExpiryDays || 14;
  const autoDel = guildConfig.defaultAutoDelete !== false ? '✅ Aktiviert' : '❌ Deaktiviert';

  const escalationLines = (guildConfig.warningActions || []).map((w) => {
    const actName = t(getActionTranslationKey(w.action), lang);
    return `- **Verwarnung #${w.warning}:** ${actName}`;
  });

  const summary = t('warningsSummary', lang, {
    max,
    days,
    autoDelete: autoDel,
    escalation: escalationLines.join('\n'),
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${summary}`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const buttons = [
    new ButtonBuilder()
      .setCustomId('sec_btn_warnings_modal')
      .setStyle(ButtonStyle.Primary)
      .setLabel('✏️ Werte & Verfall anpassen'),
    new ButtonBuilder()
      .setCustomId('sec_btn_toggle_autodelete')
      .setStyle(guildConfig.defaultAutoDelete !== false ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setLabel(guildConfig.defaultAutoDelete !== false ? '🗑️ Auto-Delete ausschalten' : '🗑️ Auto-Delete anschalten'),
    new ButtonBuilder()
      .setCustomId('sec_btn_warnings_reset')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('🔄 Standard-Eskalation'),
  ];

  container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return container;
}

/**
 * Erzeugt die Filter- & Regelwerksübersicht (/configure_rules).
 */
function buildRulesConfigContainer({ lang = 'de', guildConfig }) {
  const container = new ContainerBuilder();
  const title = t('rulesTitle', lang);
  const desc = t('rulesDesc', lang);

  const lines = CATEGORIES.map((cat) => {
    const icon = CATEGORY_ICONS[cat] || '🔹';
    const catName = t(getCategoryTranslationKey(cat), lang);
    const enabled = guildConfig.categoryEnabled?.[cat] !== false;
    const thresh = Math.round((guildConfig.categoryThresholds?.[cat] ?? 0.50) * 100);
    const autoDel = guildConfig.categoryAutoDelete?.[cat] !== false;
    const status = enabled ? `✅ Aktiv (Schwelle: ${thresh}%)` : `❌ Deaktiviert`;
    const delStatus = autoDel ? '🗑️ Auto-Delete' : '💬 Behalten';
    return `- ${icon} **${catName}**: ${status} · *${delStatus}*`;
  });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${title}\n\n${desc}\n\n${lines.join('\n')}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const selectOptions = CATEGORIES.slice(0, 25).map((cat) => ({
    label: t(getCategoryTranslationKey(cat), lang).slice(0, 95),
    description: `Schwelle: ${Math.round((guildConfig.categoryThresholds?.[cat] ?? 0.50) * 100)}% | Auto-Delete: ${guildConfig.categoryAutoDelete?.[cat] !== false ? 'Ja' : 'Nein'}`.slice(0, 95),
    value: cat,
  }));

  const select = new StringSelectMenuBuilder()
    .setCustomId('sec_rules_select_cat')
    .setPlaceholder(t('rulesCategorySelect', lang))
    .addOptions(selectOptions);

  const buttons = [
    new ButtonBuilder()
      .setCustomId('sec_rules_preset_strict')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Strikter Schutz'),
    new ButtonBuilder()
      .setCustomId('sec_rules_preset_balanced')
      .setStyle(ButtonStyle.Primary)
      .setLabel('Ausgewogen (Standard)'),
    new ButtonBuilder()
      .setCustomId('sec_rules_preset_relaxed')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Tolerant'),
    new ButtonBuilder()
      .setCustomId('sec_rules_reset')
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t('rulesBtnReset', lang)),
  ];

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(...buttons)
  );

  return container;
}

/**
 * Erzeugt die Übersicht für /set_sensitivity.
 */
function buildSensitivityContainer({ lang = 'de', guildConfig }) {
  const container = new ContainerBuilder();
  const title = t('sensitivityTitle', lang);
  const preset = guildConfig.sensitivity || 'balanced';
  const presetLabel = t(`preset_${preset}`, lang);

  const lines = [
    `# ${title}`,
    '',
    `**Aktuelles Schutzlevel:** \`${presetLabel}\``,
    '',
    '### Verfügbare Schutzlevel:',
    `- **Strikter Schutz:** ${t('preset_strict', lang)}`,
    `- **Ausgewogen (Standard):** ${t('preset_balanced', lang)}`,
    `- **Tolerant:** ${t('preset_relaxed', lang)}`,
    '',
    `API Key: \`${maskApiKey(guildConfig.openaiApiKey)}\``,
  ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  const buttons = [
    new ButtonBuilder()
      .setCustomId('sec_sens_btn_strict')
      .setStyle(preset === 'strict' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel('Strikt (30%)'),
    new ButtonBuilder()
      .setCustomId('sec_sens_btn_balanced')
      .setStyle(preset === 'balanced' ? ButtonStyle.Success : ButtonStyle.Primary)
      .setLabel('Ausgewogen (50%)'),
    new ButtonBuilder()
      .setCustomId('sec_sens_btn_relaxed')
      .setStyle(preset === 'relaxed' ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setLabel('Tolerant (75%)'),
  ];

  container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return container;
}

function escapeBlockquotes(text) {
  return String(text).replace(/\n/g, '\n> ');
}

module.exports = {
  smallContainer,
  formatDate,
  buildViolationAlertContainer,
  buildStatusContainer,
  buildManageUserContainer,
  buildTestReportContainer,
  buildWarningsConfigContainer,
  buildRulesConfigContainer,
  buildSensitivityContainer,
};
