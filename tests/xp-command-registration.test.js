/**
 * Beweis, dass /level_roles bei Discord wirklich angelegt wird:
 * 1. Jeder Command wird gegen die Discord-API-Regeln validiert – ein einziges
 *    ungültiges Feld führt nämlich zu einem 400er für den GANZEN Batch, und
 *    dann fehlen neue Commands (z.B. /level_roles) dauerhaft.
 * 2. registerCommands() läuft hier mit einem gefälschten REST-Client: wir
 *    prüfen die gerufene Route und den exakten Payload-Body.
 * 3. Retry-Verhalten: bei Fehlschlag wird erneut versucht (mit kurzen Delays).
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Routes } = require('discord.js');

const { defineCommands, registerCommands } = require('../bots/xp-level-bot/src/commands');

// Gültige Discord-Locale-Keys für *_localizations (Stand API v10)
const VALID_LOCALES = new Set([
  'id', 'da', 'de', 'en-GB', 'en-US', 'es-ES', 'es-419', 'fr', 'hr', 'it', 'lt',
  'hu', 'nl', 'no', 'pl', 'pt-BR', 'ro', 'fi', 'sv-SE', 'vi', 'tr', 'cs', 'el',
  'bg', 'ru', 'uk', 'hi', 'th', 'zh-CN', 'ja', 'zh-TW', 'ko',
]);

const NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;

function validateOption(opt, path) {
  const errors = [];
  if (!NAME_RE.test(opt.name)) errors.push(`${path}: Optionsname ungültig: "${opt.name}"`);
  if (opt.name !== opt.name.toLowerCase()) errors.push(`${path}: Optionsname muss lowercase sein: "${opt.name}"`);
  if (typeof opt.description !== 'string' || opt.description.length < 1 || opt.description.length > 100) {
    errors.push(`${path}: Optionsbeschreibung muss 1-100 Zeichen haben (hat ${opt.description?.length})`);
  }
  for (const [k, v] of Object.entries(opt.name_localizations || {})) {
    if (!VALID_LOCALES.has(k)) errors.push(`${path}: ungültige Locale "${k}" in name_localizations`);
    if (!NAME_RE.test(v)) errors.push(`${path}: lokalisierter Name ungültig: "${v}"`);
  }
  for (const [k, v] of Object.entries(opt.description_localizations || {})) {
    if (!VALID_LOCALES.has(k)) errors.push(`${path}: ungültige Locale "${k}" in description_localizations`);
    if (typeof v !== 'string' || v.length > 100) errors.push(`${path}: lokalisierte Beschreibung "${k}" zu lang (${v?.length})`);
  }
  if (opt.choices) {
    if (opt.choices.length > 25) errors.push(`${path}: mehr als 25 Choices (${opt.choices.length})`);
    for (const ch of opt.choices) {
      if (typeof ch.name !== 'string' || ch.name.length < 1 || ch.name.length > 100) {
        errors.push(`${path}: Choice-Name ungültig: "${ch.name}"`);
      }
      if (typeof ch.value === 'string' && ch.value.length > 100) errors.push(`${path}: Choice-Value zu lang`);
      for (const k of Object.keys(ch.name_localizations || {})) {
        if (!VALID_LOCALES.has(k)) errors.push(`${path}: ungültige Locale "${k}" in Choice`);
      }
    }
  }
  return errors;
}

function validateCommand(json) {
  const errors = [];
  if (!NAME_RE.test(json.name)) errors.push(`Command-Name ungültig: "${json.name}"`);
  if (json.name !== json.name.toLowerCase()) errors.push(`Command-Name muss lowercase sein: "${json.name}"`);
  if (typeof json.description !== 'string' || json.description.length < 1 || json.description.length > 100) {
    errors.push(`${json.name}: Beschreibung muss 1-100 Zeichen haben (hat ${json.description?.length})`);
  }
  for (const [k, v] of Object.entries(json.name_localizations || {})) {
    if (!VALID_LOCALES.has(k)) errors.push(`${json.name}: ungültige Locale "${k}" in name_localizations`);
  }
  for (const [k, v] of Object.entries(json.description_localizations || {})) {
    if (!VALID_LOCALES.has(k)) errors.push(`${json.name}: ungültige Locale "${k}" in description_localizations`);
    if (typeof v !== 'string' || v.length > 100) errors.push(`${json.name}: lokalisierte Beschreibung "${k}" zu lang (${v?.length}) Zeichen – Discord lehnt den GANZEN Batch ab!`);
  }
  if (json.default_member_permissions != null && typeof json.default_member_permissions !== 'string') {
    errors.push(`${json.name}: default_member_permissions muss String sein`);
  }
  if (json.contexts && !json.contexts.every((c) => [0, 1, 2].includes(c))) {
    errors.push(`${json.name}: ungültige contexts`);
  }
  const opts = json.options || [];
  if (opts.length > 25) errors.push(`${json.name}: mehr als 25 Optionen`);
  let optionalSeen = false;
  for (const opt of opts) {
    if (opt.required && optionalSeen) errors.push(`${json.name}: Pflicht-Option "${opt.name}" steht NACH einer optionalen – Discord lehnt ab!`);
    if (!opt.required) optionalSeen = true;
    errors.push(...validateOption(opt, `${json.name}.${opt.name}`));
  }
  return errors;
}

function makeCtx(overrides = {}) {
  return {
    token: 'test-token',
    logger: { info() {}, warn() {}, error() {} },
    client: { user: { id: 'app1' }, guilds: { cache: new Map([['g1', { id: 'g1' }]]) } },
    devGuildId: null,
    ...overrides,
  };
}

test('alle 6 Command-JSONs sind Discord-API-valide (inkl. /level_roles)', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 6);
  for (const c of cmds) {
    assert.deepEqual(validateCommand(c), [], `Command "${c.name}" würde von Discord abgelehnt`);
  }
});

test('registerCommands PUT-t den kompletten Satz inkl. /level_roles global UND sofort in bekannte Gilden', async () => {
  const calls = [];
  const fakeRest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return (body || []).map((c, i) => ({ id: `${route}:${i}`, name: c.name }));
    },
  };
  const ctx = makeCtx();
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);

  // Erster Call: globaler Put mit ALLEN Commands
  assert.equal(calls[0].route, Routes.applicationCommands('app1'));
  const names = calls[0].body.map((c) => c.name);
  assert.ok(names.includes('level_roles'), `/level_roles fehlt im Registrierungs-Payload! Enthalten: ${names.join(', ')}`);
  assert.deepEqual(names, ['setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles', 'adminpanel']);

  // Danach: gleiches vollständiges Set als Guild-Commands, damit neue Commands
  // ohne Discords globale Cache-Wartezeit sofort sichtbar sind.
  assert.equal(calls[1].route, Routes.applicationGuildCommands('app1', 'g1'));
  assert.deepEqual(calls[1].body.map((c) => c.name), names);
  assert.ok(ctx.guildCommandIds.get('g1').level_roles, 'Guild-spezifische /level_roles-ID wurde gespeichert');
});

test('registerCommands mit Dev-Gilde registriert dort (sofort sichtbar) inkl. /level_roles', async () => {
  const calls = [];
  const fakeRest = { put: async (route, { body }) => { calls.push({ route, body }); return body.map((c) => ({ name: c.name })); } };
  const ctx = makeCtx({ devGuildId: 'gDev' });
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, Routes.applicationGuildCommands('app1', 'gDev'));
  assert.ok(calls[0].body.some((c) => c.name === 'level_roles'));
});

test('registerCommands wiederholt nach Fehlschlag und meldet Erfolg erst nach echtem PUT', async () => {
  let attempts = 0;
  const fakeRest = {
    put: async () => {
      attempts++;
      if (attempts < 3) { const e = new Error('rate limited'); e.rawError = { message: 'You are being rate limited.' }; throw e; }
      return [{ name: 'level_roles' }];
    },
  };
  // leere Guild-Liste, damit nur die globalen PUTs gezählt werden
  const ctx = makeCtx({ client: { user: { id: 'app1' }, guilds: { cache: new Map() } } });
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0, 1, 1] });

  assert.equal(ok, true, 'nach Retries erfolgreich');
  assert.equal(attempts, 3, 'genau 3 Versuche');
  assert.equal(ctx.commandsRegistered, true);
});

test('registerCommands setzt bei Dauerfehler commandsRegistered=false (Scheduler heilt weiter)', async () => {
  const fakeRest = { put: async () => { throw new Error('500 Internal Server Error'); } };
  const ctx = makeCtx();
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0, 1] });

  assert.equal(ok, false);
  assert.equal(ctx.commandsRegistered, false, 'false = Scheduler versucht alle 15 min erneut');
});

test('commandMention nutzt Guild-Command-IDs und fällt sonst sauber auf /name zurück', () => {
  const { commandMention } = require('../bots/xp-level-bot/src/commands');
  const ctx = {
    commandIds: { help: 'global-help', level_roles: 'global-level' },
    guildCommandIds: new Map([['g1', { help: 'guild-help', level_roles: 'guild-level' }]]),
  };
  assert.equal(commandMention(ctx, 'level_roles', 'g1'), '</level_roles:guild-level>');
  assert.equal(commandMention(ctx, 'help', 'g2'), '</help:global-help>');
  assert.equal(commandMention(ctx, 'missing', 'g1'), '/missing');
});

test('/help antwortet ohne ReferenceError und enthält /level_roles', async () => {
  const { handleChatInput } = require('../bots/xp-level-bot/src/commands');
  let replyPayload = null;
  const ctx = {
    store: { getGuild: () => ({ lang: 'de' }) },
    commandIds: { help: '1', setup: '2', rank: '3', admin_set_bot_profile: '4', level_roles: '5' },
    guildCommandIds: new Map([['g1', { help: '11', setup: '12', rank: '13', admin_set_bot_profile: '14', level_roles: '15' }]]),
  };
  const interaction = {
    commandName: 'help',
    guildId: 'g1',
    locale: 'de',
    isChatInputCommand: () => true,
    reply: async (payload) => { replyPayload = payload; return payload; },
  };

  await handleChatInput(ctx, interaction);

  const text = JSON.stringify(replyPayload.components.map((c) => c.toJSON ? c.toJSON() : c));
  assert.ok(text.includes('</level_roles:15>'), text);
});
