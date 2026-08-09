/**
 * Baut Payloads für Discord Components V2.
 * Container (Komponententyp 17) werden von Discord nur akzeptiert, wenn
 * jede neue oder bearbeitete Nachricht das Flag `IsComponentsV2` trägt.
 */

const { MessageFlags } = require('discord.js');

function componentsV2Payload(components, { ephemeral = false, ...options } = {}) {
  const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);
  return { ...options, components, flags };
}

module.exports = { componentsV2Payload };
