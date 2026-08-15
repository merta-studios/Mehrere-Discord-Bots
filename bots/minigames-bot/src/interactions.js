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
  moveCursor,
  parseCustomId,
} = require('./games');
const {
  SOLO_PREFIX,
  SOLO_OVER,
  parseSoloCustomId,
  moveSolo,
  undoSolo,
  resumeSolo,
  restartSolo,
} = require('./game-2048');
const { parseGameMessage, buildGamePayload, smallContainer } = require('./embed-builder');
const { parseSoloMessage, buildSoloPayload } = require('./solo-ui');
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
      if (interaction.customId.startsWith(SOLO_PREFIX)) {
        const solo = parseSoloCustomId(interaction.customId);
        if (!solo) return null;
        return await handleSoloButton(ctx, interaction, solo);
      }
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
    not_challenger: 'notChallenger',
    self_join: 'selfJoin',
    cancelled: 'noLongerActive',
    invalid_move: 'errState',
    expired: 'noLongerActive',
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

    if (parsed.kind === 'cursor') {
      if (parsed.game !== state.game) return privateReply(interaction, t('errState', lang));
      const result = moveCursor(state, interaction.user.id, parsed.action);
      if (result.error) return privateReply(interaction, errorText(result.error, lang));
      // Nichts bewegt (z. B. nur eine freie Spalte) → Nachricht unverändert lassen.
      if (!result.moved) return interaction.deferUpdate().catch(() => null);
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

/* ------------------------------------------------------------------ *
 * Single-Player (2048)
 * ------------------------------------------------------------------ */

function soloErrorText(error, lang) {
  const key = {
    not_owner: 'soloNotOwner',
    no_move: 'soloNoMove',
    no_undo: 'soloNoUndo',
    game_over: 'soloOverHint',
    not_won: 'soloOverHint',
    invalid_move: 'soloState',
    invalid_state: 'soloState',
  }[error] || 'soloState';
  return t(key, lang);
}

/**
 * Alle Solo-Buttons laufen – wie die Battles – über das Nachrichten-Lock und
 * lesen den Spielstand IMMER frisch aus der Nachricht. Zwei schnelle Klicks
 * hintereinander können sich deshalb nicht überholen, und die Runde
 * funktioniert auch nach einem Bot-Neustart weiter.
 */
async function handleSoloButton(ctx, interaction, parsed) {
  if (parsed.kind === 'noop') return interaction.deferUpdate().catch(() => null);
  if (!interaction.guildId || !interaction.message?.id) {
    return privateReply(interaction, t('errGuildOnly', langFromDiscord(interaction.locale)));
  }

  const lockKey = `solo:${interaction.guildId}:${interaction.channelId}:${interaction.message.id}`;
  return ctx.store.withLock(lockKey, async () => {
    const message = await latestMessage(interaction);
    const state = parseSoloMessage(message);
    const lang =
      state?.lang || ctx.store.getServerLang(interaction.guildId) || langFromDiscord(interaction.locale);
    if (!state) return privateReply(interaction, t('soloState', lang));

    let result;
    if (parsed.kind === 'move') result = moveSolo(state, interaction.user.id, parsed.direction);
    else if (parsed.kind === 'undo') result = undoSolo(state, interaction.user.id);
    else if (parsed.kind === 'resume') result = resumeSolo(state, interaction.user.id);
    else if (parsed.kind === 'restart') result = restartSolo(state, interaction.user.id);
    else return null;

    if (result.error) return privateReply(interaction, soloErrorText(result.error, lang));

    await interaction.deferUpdate();
    await message.edit(buildSoloPayload(result.state));
    return result.state;
  });
}

module.exports = {
  handleInteraction,
  handleGameButton,
  handleSoloButton,
  privatePayload,
  errorText,
  soloErrorText,
};
