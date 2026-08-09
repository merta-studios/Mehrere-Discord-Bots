const { MessageFlags } = require('discord.js');
const { t, langFromDiscord } = require('./languages');
const { smallContainer } = require('./embed-builder');
const { componentsV2Payload } = require('./message-payload');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');

async function handleInteraction(ctx, interaction){
  try {
    if (interaction.isChatInputCommand()){
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }
    if (interaction.isButton()){
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);
    }
    if (interaction.isStringSelectMenu()){
      if (interaction.customId.startsWith(PANEL_PREFIX)) return await handlePanelSelect(ctx, interaction);
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
