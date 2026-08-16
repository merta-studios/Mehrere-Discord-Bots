/**
 * Interaktions-Router für Slash-Commands, Modals, Buttons und Select-Menus.
 */

const {
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const { handleChatInput } = require('./commands');
const { handlePanelButton, handlePanelSelect } = require('./admin-panel');
const {
  smallContainer,
  buildManageUserContainer,
  buildWarningsConfigContainer,
  buildRulesConfigContainer,
  buildSensitivityContainer,
} = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { t, langFromDiscord } = require('./languages');
const { callOpenAIModeration } = require('./moderation');
const {
  DEFAULT_WARNING_ESCALATION,
  PRESET_THRESHOLDS,
  getDefaultThresholdMap,
  getDefaultCategoryMap,
  maskApiKey,
} = require('./rules');

async function handleInteraction(ctx, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      return await handleChatInput(ctx, interaction);
    }

    if (interaction.isModalSubmit()) {
      return await handleModalSubmit(ctx, interaction);
    }

    if (interaction.isButton()) {
      return await handleButton(ctx, interaction);
    }

    if (interaction.isStringSelectMenu()) {
      return await handleSelectMenu(ctx, interaction);
    }
  } catch (err) {
    ctx.logger?.error?.('[security-bot] Fehler bei Interaction-Handling:', err);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(
          componentsV2Payload([smallContainer(null, '❌ Ein Fehler ist aufgetreten.')], { ephemeral: true })
        );
      }
    } catch {}
  }
}

// ----------------- Modal Handler -----------------

async function handleModalSubmit(ctx, interaction) {
  const id = interaction.customId;
  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  if (id === 'sec_modal_api_key') {
    const perms = interaction.memberPermissions ?? interaction.member?.permissions;
    if (!perms?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
      );
    }

    const rawKey = interaction.fields.getTextInputValue('sec_input_api_key')?.trim();
    if (!rawKey || rawKey.toLowerCase() === 'remove' || rawKey.toLowerCase() === 'delete') {
      cfg.openaiApiKey = null;
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('apiKeyRemoved', lang))], { ephemeral: true })
      );
    }

    // Wenn maskierter Key unverändert eingereicht wurde -> nichts tun
    if (rawKey.includes('...') && rawKey.startsWith('sk-') && cfg.openaiApiKey) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, 'ℹ️ Der bestehende API Key wurde beibehalten.')], { ephemeral: true })
      );
    }

    await interaction.deferReply({ ephemeral: true });

    // Test-Call mit dem neuen Key durchführen
    const testRes = await callOpenAIModeration({
      apiKey: rawKey,
      text: 'Test connection',
    });

    if (!testRes.ok && testRes.status === 401) {
      cfg.openaiApiKey = rawKey;
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
      const msg = t('apiKeySavedWarning', lang, { error: 'Ungültiger API-Schlüssel (401 Unauthorized)' });
      return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
    }

    cfg.openaiApiKey = rawKey;
    ctx.store.setGuild(cfg);
    await ctx.store.flush();

    const masked = maskApiKey(rawKey);
    const msg = t('apiKeySavedSuccess', lang, { key: masked });
    return interaction.editReply(componentsV2Payload([smallContainer(null, msg)]));
  }

  if (id === 'sec_modal_warnings') {
    const maxStr = interaction.fields.getTextInputValue('sec_input_max_warn')?.trim();
    const expStr = interaction.fields.getTextInputValue('sec_input_expiry_days')?.trim();

    const max = parseInt(maxStr, 10);
    const exp = parseInt(expStr, 10);

    if (Number.isFinite(max) && max >= 1 && max <= 10) cfg.maxWarnings = max;
    if (Number.isFinite(exp) && exp >= 1 && exp <= 365) cfg.violationExpiryDays = exp;

    ctx.store.setGuild(cfg);
    await ctx.store.flush();

    const container = buildWarningsConfigContainer({ lang, guildConfig: cfg });
    return interaction.reply(componentsV2Payload([container], { ephemeral: true }));
  }

  if (id.startsWith('sec_modal_cat_')) {
    const cat = id.replace('sec_modal_cat_', '');
    const threshStr = interaction.fields.getTextInputValue('sec_input_cat_thresh')?.trim();
    const threshPct = parseInt(threshStr, 10);

    if (Number.isFinite(threshPct) && threshPct >= 1 && threshPct <= 100) {
      cfg.categoryThresholds = cfg.categoryThresholds || {};
      cfg.categoryThresholds[cat] = threshPct / 100;
      cfg.sensitivity = 'custom';
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
    }

    const container = buildRulesConfigContainer({ lang, guildConfig: cfg });
    return interaction.reply(componentsV2Payload([container], { ephemeral: true }));
  }
}

// ----------------- Button Handler -----------------

async function handleButton(ctx, interaction) {
  const id = interaction.customId;

  if (id.startsWith('sec_ap_')) {
    return handlePanelButton(ctx, interaction);
  }

  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  // Admin-Prüfung für Konfigurations-Buttons
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }

  if (id.startsWith('sec_clear_all_')) {
    const targetUserId = id.replace('sec_clear_all_', '');
    ctx.store.clearUserViolations(interaction.guildId, targetUserId, { deletedBy: interaction.user.id });
    await ctx.store.flush();

    let member = null;
    let targetUser = null;
    try {
      member = await interaction.guild.members.fetch(targetUserId);
      targetUser = member.user;
    } catch {
      targetUser = { id: targetUserId, tag: targetUserId };
    }

    const isTimedOut = Boolean(
      member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now()
    );
    const timeoutUntil = isTimedOut ? new Date(member.communicationDisabledUntil).getTime() : null;

    const container = buildManageUserContainer({
      lang,
      targetUser,
      activeViolations: [],
      allViolations: ctx.store.getViolations(interaction.guildId, targetUserId, { activeOnly: false }),
      maxWarnings: cfg.maxWarnings || 3,
      isTimedOut,
      timeoutUntil,
    });

    await interaction.update(componentsV2Payload([container]));
    return;
  }

  if (id.startsWith('sec_unmute_')) {
    const targetUserId = id.replace('sec_unmute_', '');
    try {
      const member = await interaction.guild.members.fetch(targetUserId);
      if (member && member.moderatable) {
        await member.timeout(null, `Timeout durch Admin ${interaction.user.tag} aufgehoben.`);
      }
    } catch {}

    let targetUser = null;
    try {
      const member = await interaction.guild.members.fetch(targetUserId);
      targetUser = member.user;
    } catch {
      targetUser = { id: targetUserId, tag: targetUserId };
    }

    const activeViolations = ctx.store.getViolations(interaction.guildId, targetUserId, { activeOnly: true });
    const allViolations = ctx.store.getViolations(interaction.guildId, targetUserId, { activeOnly: false });

    const container = buildManageUserContainer({
      lang,
      targetUser,
      activeViolations,
      allViolations,
      maxWarnings: cfg.maxWarnings || 3,
      isTimedOut: false,
      timeoutUntil: null,
    });

    await interaction.update(componentsV2Payload([container]));
    return;
  }

  if (id === 'sec_btn_warnings_modal') {
    const modal = new ModalBuilder()
      .setCustomId('sec_modal_warnings')
      .setTitle('Verwarnungseinstellungen')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('sec_input_max_warn')
            .setLabel('Maximale Verwarnungen (1-10)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(cfg.maxWarnings || 3))
            .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('sec_input_expiry_days')
            .setLabel('Verfallsdauer in Tagen (1-365)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(cfg.violationExpiryDays || 14))
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }

  if (id === 'sec_btn_toggle_autodelete') {
    cfg.defaultAutoDelete = !cfg.defaultAutoDelete;
    ctx.store.setGuild(cfg);
    await ctx.store.flush();
    const container = buildWarningsConfigContainer({ lang, guildConfig: cfg });
    return interaction.update(componentsV2Payload([container]));
  }

  if (id === 'sec_btn_warnings_reset') {
    cfg.warningActions = [...DEFAULT_WARNING_ESCALATION];
    cfg.maxWarnings = 3;
    cfg.violationExpiryDays = 14;
    cfg.defaultAutoDelete = true;
    ctx.store.setGuild(cfg);
    await ctx.store.flush();
    const container = buildWarningsConfigContainer({ lang, guildConfig: cfg });
    return interaction.update(componentsV2Payload([container]));
  }

  if (id.startsWith('sec_sens_btn_')) {
    const preset = id.replace('sec_sens_btn_', '');
    if (PRESET_THRESHOLDS[preset] !== undefined) {
      cfg.sensitivity = preset;
      cfg.categoryThresholds = getDefaultThresholdMap(preset);
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
    }
    const container = buildSensitivityContainer({ lang, guildConfig: cfg });
    return interaction.update(componentsV2Payload([container]));
  }

  if (id.startsWith('sec_rules_preset_')) {
    const preset = id.replace('sec_rules_preset_', '');
    if (PRESET_THRESHOLDS[preset] !== undefined) {
      cfg.sensitivity = preset;
      cfg.categoryThresholds = getDefaultThresholdMap(preset);
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
    }
    const container = buildRulesConfigContainer({ lang, guildConfig: cfg });
    return interaction.update(componentsV2Payload([container]));
  }

  if (id === 'sec_rules_reset') {
    cfg.sensitivity = 'balanced';
    cfg.categoryThresholds = getDefaultThresholdMap('balanced');
    cfg.categoryEnabled = getDefaultCategoryMap(true);
    cfg.categoryAutoDelete = getDefaultCategoryMap(true);
    ctx.store.setGuild(cfg);
    await ctx.store.flush();
    const container = buildRulesConfigContainer({ lang, guildConfig: cfg });
    return interaction.update(componentsV2Payload([container]));
  }
}

// ----------------- Select Menu Handler -----------------

async function handleSelectMenu(ctx, interaction) {
  const id = interaction.customId;

  if (id.startsWith('sec_ap_')) {
    return handlePanelSelect(ctx, interaction);
  }

  const cfg = ctx.store.ensureGuild(interaction.guildId);
  const lang = cfg.lang || langFromDiscord(interaction.locale);

  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }

  if (id.startsWith('sec_del_viol_')) {
    const targetUserId = id.replace('sec_del_viol_', '');
    const violationId = interaction.values?.[0];
    if (violationId) {
      ctx.store.deleteViolation(violationId, { deletedBy: interaction.user.id });
      await ctx.store.flush();
    }

    let member = null;
    let targetUser = null;
    try {
      member = await interaction.guild.members.fetch(targetUserId);
      targetUser = member.user;
    } catch {
      targetUser = { id: targetUserId, tag: targetUserId };
    }

    const isTimedOut = Boolean(
      member?.communicationDisabledUntil && new Date(member.communicationDisabledUntil).getTime() > Date.now()
    );
    const timeoutUntil = isTimedOut ? new Date(member.communicationDisabledUntil).getTime() : null;

    const activeViolations = ctx.store.getViolations(interaction.guildId, targetUserId, { activeOnly: true });
    const allViolations = ctx.store.getViolations(interaction.guildId, targetUserId, { activeOnly: false });

    const container = buildManageUserContainer({
      lang,
      targetUser,
      activeViolations,
      allViolations,
      maxWarnings: cfg.maxWarnings || 3,
      isTimedOut,
      timeoutUntil,
    });

    await interaction.update(componentsV2Payload([container]));
    return;
  }

  if (id === 'sec_rules_select_cat') {
    const cat = interaction.values?.[0];
    if (!cat) return;

    const currentThresh = Math.round((cfg.categoryThresholds?.[cat] ?? 0.50) * 100);
    const modal = new ModalBuilder()
      .setCustomId(`sec_modal_cat_${cat}`)
      .setTitle(`Filter: ${cat}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('sec_input_cat_thresh')
            .setLabel('Schwellenwert in % (1-100)')
            .setStyle(TextInputStyle.Short)
            .setValue(String(currentThresh))
            .setRequired(true)
        )
      );

    return interaction.showModal(modal);
  }
}

module.exports = { handleInteraction };
