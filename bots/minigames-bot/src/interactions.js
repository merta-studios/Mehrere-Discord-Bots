/** Zentraler Dispatcher für Slash-Commands, Battle-Buttons und Admin-Panel. */

const { t, langFromDiscord } = require('./languages');
const {
  STATUS_PENDING,
  STATUS_ACTIVE,
  STATUS_WON,
  STATUS_DRAW,
  acceptChallenge,
  declineChallenge,
  expireChallenge,
  applyMove,
  parseCustomId,
} = require('./games');
const { parseGameMessage, buildGamePayload, smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');

function privatePayload(text) {
  return componentsV2Payload([smallContainer(null, text)], {
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function privateReply(interaction, text) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(privatePayload(text));
    return await interaction.reply(privatePayload(text));
  } catch {
    return null;
  }
}

async function handleInteraction(ctx, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);
      const parsed = parseCustomId(interaction.customId);
      if (!parsed) return null;
      return await handleGameButton(ctx, interaction, parsed);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PANEL_PREFIX)) {
      return await handlePanelSelect(ctx, interaction);
    }
    return null;
  } catch (err) {
    ctx.logger.error('[minigames-bot] Interaction-Fehler:', err);
    const lang =
      (interaction.guildId && ctx.store.getServerLang(interaction.guildId)) ||
      langFromDiscord(interaction.locale);
    return privateReply(interaction, t('errGeneric', lang));
  }
}

async function latestMessage(interaction) {
  const channel = interaction.channel;
  if (channel?.messages?.fetch && interaction.message?.id) {
    return channel.messages.fetch(interaction.message.id).catch(() => interaction.message);
  }
  return interaction.message;
}

function errorText(error, lang) {
  const key = {
    not_opponent: 'notOpponent',
    not_player: 'notPlayer',
    not_turn: 'notTurn',
    cell_taken: 'cellTaken',
    column_full: 'columnFull',
    not_active: 'noLongerActive',
    not_pending: 'noLongerActive',
  }[error] || 'errState';
  return t(key, lang);
}

async function editGameMessage(ctx, interaction, message, state) {
  await interaction.deferUpdate();
  await message.edit(buildGamePayload(state));
  if ([STATUS_PENDING, STATUS_ACTIVE].includes(state.status)) {
    ctx.gameManager.track(message, state);
  } else {
    ctx.gameManager.untrack(message.guildId, message.channelId, message.id);
  }
}

async function handleGameButton(ctx, interaction, parsed) {
  if (!interaction.guildId || !interaction.message?.id) {
    return privateReply(interaction, t('errGuildOnly', langFromDiscord(interaction.locale)));
  }

  const lockKey = `${interaction.guildId}:${interaction.channelId}:${interaction.message.id}`;
  return ctx.store.withLock(lockKey, async () => {
    const message = await latestMessage(interaction);
    const state = parseGameMessage(message);
    const lang = state?.lang || ctx.store.getServerLang(interaction.guildId) || langFromDiscord(interaction.locale);
    if (!state) return privateReply(interaction, t('errState', lang));

    if (state.status === STATUS_PENDING && Date.now() >= state.expiresAt) {
      const expired = expireChallenge(state);
      return editGameMessage(ctx, interaction, message, expired);
    }

    if (parsed.kind === 'accept') {
      const result = acceptChallenge(state, interaction.user.id);
      if (result.error) return privateReply(interaction, errorText(result.error, lang));
      return editGameMessage(ctx, interaction, message, result.state);
    }

    if (parsed.kind === 'decline') {
      const result = declineChallenge(state, interaction.user.id);
      if (result.error) return privateReply(interaction, errorText(result.error, lang));
      return editGameMessage(ctx, interaction, message, result.state);
    }

    if (parsed.kind === 'move') {
      if (parsed.game !== state.game) return privateReply(interaction, t('errState', lang));
      const result = applyMove(state, interaction.user.id, parsed.position);
      if (result.error) return privateReply(interaction, errorText(result.error, lang));
      return editGameMessage(ctx, interaction, message, result.state);
    }

    return null;
  });
}

module.exports = {
  handleInteraction,
  handleGameButton,
  privatePayload,
  errorText,
};
