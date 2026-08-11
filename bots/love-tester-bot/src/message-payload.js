/**
 * Baut Payloads für Discord Components V2 (identisch zu den anderen Bots).
 */

const { MessageFlags } = require('discord.js');

function componentsV2Payload(components, { ephemeral = false, ...options } = {}) {
  const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
  return { ...options, components, flags };
}

module.exports = { componentsV2Payload };
