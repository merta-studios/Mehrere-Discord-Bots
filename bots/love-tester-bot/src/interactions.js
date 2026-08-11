/**
 * Alle Nicht-Slash-Interaktionen des Love Testers:
 * - Setup-Wizard: Sprach-Select, Kanal-Select, Zurück/Weiter/Bestätigen/
 *   Abbrechen, API-Key-Modal
 * - /test_love: Annehmen/Ablehnen, Fortschritt-Stopp, Fehler-Retry,
 *   „Weiter analysieren“
 *
 * WICHTIG: Die Buttons der öffentlichen Love-Test-Nachricht dürfen nur vom
 * Command-Sender benutzt werden – alle anderen bekommen eine ephemere
 * Fehlermeldung.
 */

const { MessageFlags } = require('discord.js');

const { t, langFromDiscord } = require('./languages');
const { smallContainer, componentsV2Payload } = require('./embed-builder');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');
const { runAnalysis, continueAnalysis } = require('./runner');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handleInteraction(ctx, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }
    if (interaction.isButton()) {
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);
      if (interaction.customId.startsWith('love_setup_')) return await handleSetupButton(ctx, interaction);
      if (interaction.customId.startsWith('love_')) return await handleLoveButton(ctx, interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelSelect(ctx, interaction);
      if (interaction.customId.startsWith('love_setup_')) return await handleSetupSelect(ctx, interaction);
    }
    if (interaction.isChannelSelectMenu()) {
      if (interaction.customId.startsWith('love_setup_')) return await handleSetupSelect(ctx, interaction);
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('love_key_')) return await handleKeyModal(ctx, interaction);
    }
    return null;
  } catch (err) {
    ctx.logger.error('[love-tester-bot] Interaction-Fehler:', err);
    const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
    const payload = componentsV2Payload([smallContainer(null, t('errGeneric', lang, { error: err.message }))], { ephemeral: true });
    try {
      if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
      return await interaction.reply(payload);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Setup-Wizard
// ---------------------------------------------------------------------------

function validSetupSession(ctx, interaction, token) {
  const session = ctx.setupSessions.get(token);
  if (!session || session.guildId !== interaction.guildId || session.userId !== interaction.user.id) return null;
  return session;
}

async function handleSetupSelect(ctx, interaction) {
  const id = interaction.customId;
  const token = id.split('_')[2];
  const session = validSetupSession(ctx, interaction, token);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', 'en', { error: 'Session abgelaufen' }))], { ephemeral: true })
    );
  }

  if (id.endsWith('_lang')) {
    const value = interaction.values?.[0];
    if (value && require('./languages').LANGS[value]) {
      session.lang = value;
    }
    const { buildSetupStep1 } = require('./embed-builder');
    return interaction.update(componentsV2Payload([buildSetupStep1({ lang: session.lang, session })]));
  }

  if (id.endsWith('_ch')) {
    session.channels = [...(interaction.values || [])];
    const { buildSetupStep2 } = require('./embed-builder');
    return interaction.update(componentsV2Payload([buildSetupStep2({ lang: session.lang || 'de', session })]));
  }

  return null;
}

async function handleSetupButton(ctx, interaction) {
  const parts = interaction.customId.split('_'); // love_setup_<token>_<action>
  const token = parts[2];
  const action = parts.slice(3).join('_');
  const session = validSetupSession(ctx, interaction, token);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', 'en', { error: 'Session abgelaufen' }))], { ephemeral: true })
    );
  }
  const lang = session.lang || langFromDiscord(interaction.locale);
  const { buildSetupStep1, buildSetupStep2, buildSetupStep3, buildSetupSuccess } = require('./embed-builder');

  switch (action) {
    case 'back': {
      if (session.step === 3) session.step = 2;
      else if (session.step === 2) session.step = 1;
      const container = session.step === 1
        ? buildSetupStep1({ lang, session })
        : buildSetupStep2({ lang, session });
      return interaction.update(componentsV2Payload([container]));
    }
    case 'next': {
      if (session.step === 1) {
        if (!session.lang) {
          return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNeedLang', lang))], { ephemeral: true }));
        }
        session.step = 2;
        return interaction.update(componentsV2Payload([buildSetupStep2({ lang, session })]));
      }
      if (session.step === 2) {
        if (!session.channels || !session.channels.length) {
          return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNeedChannels', lang))], { ephemeral: true }));
        }
        // Bot-Rechte in den Kanälen prüfen (lesen reicht für die Analyse)
        const guild = ctx.client.guilds.cache.get(session.guildId);
        for (const chId of session.channels) {
          const ch = guild?.channels?.cache?.get(chId);
          if (ch && !ch.permissionsFor(ctx.client.user)?.has(['ViewChannel', 'ReadMessageHistory'])) {
            return interaction.reply(
              componentsV2Payload([smallContainer(null, t('errBotPerms', lang, { channel: `<#${chId}>` }))], { ephemeral: true })
            );
          }
        }
        session.step = 3;
        return interaction.update(componentsV2Payload([buildSetupStep3({ lang, session })]));
      }
      return null;
    }
    case 'key': {
      const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
      const input = new TextInputBuilder()
        .setCustomId('groq_key')
        .setLabel(t('setupKeyLabel', lang).slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(200)
        .setPlaceholder(t('setupKeyPlaceholder', lang).slice(0, 100));
      if (session.groqKey) input.setValue(session.groqKey);
      const modal = new ModalBuilder()
        .setCustomId(`love_key_${token}`)
        .setTitle(t('setupKeyModalTitle', lang).slice(0, 45))
        .addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }
    case 'confirm': {
      if (!session.lang) return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNeedLang', lang))], { ephemeral: true }));
      if (!session.channels || !session.channels.length) {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNeedChannels', lang))], { ephemeral: true }));
      }
      if (!session.groqKey) {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('setupNeedKey', lang))], { ephemeral: true }));
      }
      const cfg = {
        guildId: session.guildId,
        lang: session.lang,
        channels: [...session.channels],
        groqApiKey: session.groqKey,
        setupComplete: true,
      };
      ctx.store.setGuild(cfg);
      await ctx.store.flush();
      ctx.setupSessions.delete(token);
      return interaction.update(componentsV2Payload([buildSetupSuccess({ lang: cfg.lang, session: cfg })]));
    }
    case 'cancel': {
      ctx.setupSessions.delete(token);
      return interaction.update(componentsV2Payload([smallContainer(null, t('setupCancelNote', lang))]));
    }
    default:
      return null;
  }
}

async function handleKeyModal(ctx, interaction) {
  const token = interaction.customId.split('_')[2];
  const session = validSetupSession(ctx, interaction, token);
  if (!session) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', 'en', { error: 'Session abgelaufen' }))], { ephemeral: true })
    );
  }
  const lang = session.lang || langFromDiscord(interaction.locale);
  const key = (interaction.fields.getTextInputValue('groq_key') || '').trim();
  if (!/^gsk_[A-Za-z0-9_-]{10,}$/.test(key)) {
    return interaction.reply(componentsV2Payload([smallContainer(null, t('setupInvalidKey', lang))], { ephemeral: true }));
  }
  session.groqKey = key;
  const { buildSetupStep3 } = require('./embed-builder');
  return interaction.update(componentsV2Payload([buildSetupStep3({ lang, session })]));
}

// ---------------------------------------------------------------------------
// /test_love – Buttons (öffentliche Nachricht)
// ---------------------------------------------------------------------------

function canControl(ctx, interaction, session) {
  return Boolean(session) && session.userId === interaction.user.id;
}

function ownerOnlyReply(ctx, interaction, session) {
  const lang = session?.lang || langFromDiscord(interaction.locale);
  return interaction.reply(
    componentsV2Payload(
      [smallContainer(null, t('loveButtonsOwnerOnly', lang, { user: `<@${session?.userId || '?'}>` }))],
      { ephemeral: true }
    )
  );
}

async function handleLoveButton(ctx, interaction) {
  const parts = interaction.customId.split('_'); // love_<action>_<token>
  const action = parts[1];
  const token = parts.slice(2).join('_');
  const session = ctx.loveSessions.get(token);

  if (!canControl(ctx, interaction, session)) {
    return ownerOnlyReply(ctx, interaction, session);
  }

  const lang = session.lang;

  switch (action) {
    case 'accept': {
      if (session.status === 'running') {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('loveBusy', lang))], { ephemeral: true }));
      }
      session.channelId = interaction.channel.id;
      session.messageId = interaction.message.id;
      // Erste Bearbeitung über update() (ersetzt die Bestätigungs-Buttons)
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply(
        componentsV2Payload([require('./embed-builder').buildProgress({ lang, token, pct: 0, phase: t('loveAccepted', lang) })])
      );
      void runAnalysis(ctx, session);
      return null;
    }
    case 'decline': {
      session.status = 'stopped';
      ctx.loveSessions.delete(token);
      return interaction.update(
        componentsV2Payload([require('./embed-builder').buildStopped({ lang, text: t('loveDeclined', lang) })])
      );
    }
    case 'stop': {
      session.status = 'stopped';
      ctx.loveSessions.delete(token);
      return interaction.update(
        componentsV2Payload([require('./embed-builder').buildStopped({ lang, text: t('loveStopped', lang) })])
      );
    }
    case 'retry': {
      if (session.status === 'running') {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('loveBusy', lang))], { ephemeral: true }));
      }
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply(
        componentsV2Payload([require('./embed-builder').buildProgress({ lang, token, pct: 90, phase: t('analysingFinal', lang) })])
      );
      session.status = 'running';
      void (async () => {
        // Retry = Groq erneut mit dem bereits gebauten Prompt befragen
        const { runGroqPhase, errorText, editSessionMessage } = require('./runner');
        const { buildResult, buildError } = require('./embed-builder');
        try {
          const result = await runGroqPhase(ctx, session);
          session.status = 'done';
          const { extractPercent } = require('./analyzer');
          const percent = extractPercent(result.content);
          let finalText = result.content;
          if (percent !== null) {
            finalText = `${result.content.replace(/###\s*\d{1,3}\s*%.*$/i, '').trim()}\n### ${percent}%`;
          }
          await editSessionMessage(ctx, session, componentsV2Payload([buildResult({ lang, token, aiText: finalText })]));
        } catch (err) {
          session.status = 'error';
          session.lastError = err;
          await editSessionMessage(ctx, session, componentsV2Payload([
            buildError({ lang, token, message: errorText(ctx, session, err), canContinue: session.canContinue }),
          ]));
        } finally {
          session.running = false;
        }
      })();
      return null;
    }
    case 'more': {
      if (session.status === 'running') {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('loveBusy', lang))], { ephemeral: true }));
      }
      if (!session.canContinue) {
        return interaction.reply(componentsV2Payload([smallContainer(null, t('loveNoMore', lang))], { ephemeral: true }));
      }
      await interaction.deferUpdate().catch(() => {});
      await interaction.editReply(
        componentsV2Payload([require('./embed-builder').buildProgress({ lang, token, pct: 90, phase: t('analysingFinal', lang) })])
      );
      void continueAnalysis(ctx, session);
      return null;
    }
    default:
      return null;
  }
}

module.exports = { handleInteraction };
