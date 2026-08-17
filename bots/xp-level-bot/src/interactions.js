const { MessageFlags } = require('discord.js');
const { t, langFromDiscord } = require('./languages');
const { smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');
const { MODAL_ID, handleLevelRolesModalSubmit } = require('./level-roles');
const { PING_MODAL_PREFIX, handlePingModalSubmit } = require('./ping-inactive');
const { BONUS_CLAIM_PREFIX } = require('./bonus');
const giveaway = require('./giveaway');

async function handleInteraction(ctx, interaction){
  try {
    if (interaction.isChatInputCommand()){
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }
    if (interaction.isButton()){
      if (interaction.customId.startsWith(giveaway.DRAFT_ACTION_PREFIX) || interaction.customId.startsWith(giveaway.JOIN_PREFIX) || interaction.customId.startsWith(giveaway.PROGRESS_PREFIX)) return await giveaway.handleButton(ctx, interaction);
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);
      // „Einsammeln“-Button der Bonus-Belohnung (wer zuerst klickt, gewinnt)
      if (interaction.customId.startsWith(BONUS_CLAIM_PREFIX) && ctx.bonusDropper){
        return await ctx.bonusDropper.handleClaim(interaction);
      }
    }
    if (interaction.isStringSelectMenu()){
      if (giveaway.isSettingsSelect(interaction.customId)) return await giveaway.settingSelect(ctx, interaction);
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelSelect(ctx, interaction);
    }
    if (interaction.isModalSubmit()){
      if (interaction.customId.startsWith(giveaway.FORM_PREFIX)) return await giveaway.formSubmit(ctx, interaction);
      if (interaction.customId === MODAL_ID) return await handleLevelRolesModalSubmit(ctx, interaction);
      if (interaction.customId.startsWith(PING_MODAL_PREFIX)) return await handlePingModalSubmit(ctx, interaction);
    }
    return null;
  } catch(err){
    ctx.logger.error('[xp-level-bot] Interaction-Fehler:', err);
    const lang = ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
    const payload = componentsV2Payload([smallContainer(null, t('errGeneric', lang))], {ephemeral:true});
    try {
      if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
      return await interaction.reply(payload);
    } catch { return null; }
  }
}

module.exports = { handleInteraction };
