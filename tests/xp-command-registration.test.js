/**
 * Tests für die Slash-Command-Registrierung und den /help Command des XP-Bots:
 * 1. Discord-API-Validierung aller 6 Commands (inkl. /level_roles)
 * 2. Saubere globale Registrierung ohne Dev-Gilden-Verwechslung + Shadowing-Cleanup
 * 3. Spezifische Dev-Gilden-Registrierung bei gesetzter XP_BOT_GUILD_ID
 * 4. Whitespace-Toleranz bei Env-Variablen
 * 5. Speicherung und Persistierung der Discord-Command-IDs (überlebt Bot-Restarts)
 * 6. ensureCommandIds: Nachladen von Discord REST API bei leerem RAM
 * 7. /help zeigt alle Commands anklickbar als </name:id> Mentions (keine reinen Text-Fallbacks)
 * 8. Nachvollziehbares Logging mit Route, Guild und Command-IDs
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Routes } = require('discord.js');

const { defineCommands, registerCommands, ensureCommandIds, commandMention, handleChatInput } = require('../bots/xp-level-bot/src/commands');
const { createXpStore } = require('../bots/xp-level-bot/src/store');

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
  const store = createXpStore({ env: () => '' });
  return {
    token: 'test-token',
    logger: { info() {}, warn() {}, error() {} },
    client: { user: { id: 'app1' }, guilds: { cache: new Map([['g1', { id: 'g1' }]]) } },
    devGuildId: null,
    store,
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

test('registerCommands registriert global (inkl. /level_roles) und räumt alte Guild-Commands auf', async () => {
  const calls = [];
  const fakeRest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return (body || []).map((c, i) => ({ id: `id-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx();
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);

  // Erster Call: globaler PUT mit ALLEN Commands
  assert.equal(calls[0].route, Routes.applicationCommands('app1'));
  const names = calls[0].body.map((c) => c.name);
  assert.ok(names.includes('level_roles'), `/level_roles fehlt im Registrierungs-Payload! Enthalten: ${names.join(', ')}`);
  assert.deepEqual(names, ['setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles', 'adminpanel']);

  // Zweiter Call: alte Guild-Commands auf g1 geleert ({ body: [] }), damit kein Shadowing entsteht
  assert.equal(calls[1].route, Routes.applicationGuildCommands('app1', 'g1'));
  assert.deepEqual(calls[1].body, []);

  // IDs in memory und im Store gespeichert
  assert.equal(ctx.commandIds.level_roles, 'id-level_roles');
  assert.equal(ctx.store.getCommandId('level_roles'), 'id-level_roles');
});

test('registerCommands mit Dev-Gilde registriert gezielt dort inkl. /level_roles', async () => {
  const calls = [];
  const fakeRest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return (body || []).map((c) => ({ id: `dev-id-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx({ devGuildId: '123456789012345678' });
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, Routes.applicationGuildCommands('app1', '123456789012345678'));
  assert.ok(calls[0].body.some((c) => c.name === 'level_roles'));
  assert.equal(ctx.commandIds.level_roles, 'dev-id-level_roles');
  assert.equal(ctx.guildCommandIds.get('123456789012345678').level_roles, 'dev-id-level_roles');
});

test('registerCommands ignoriert leere/Whitespace Dev-Gilde und registriert global', async () => {
  const calls = [];
  const fakeRest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return (body || []).map((c) => ({ id: `id-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx({ devGuildId: '   ' });
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(calls[0].route, Routes.applicationCommands('app1'));
});

test('registerCommands wiederholt nach Fehlschlag und meldet Erfolg erst nach echtem PUT', async () => {
  let attempts = 0;
  const fakeRest = {
    put: async () => {
      attempts++;
      if (attempts < 3) {
        const e = new Error('rate limited');
        e.rawError = { message: 'You are being rate limited.' };
        throw e;
      }
      return [{ id: '101', name: 'setup' }, { id: '102', name: 'level_roles' }];
    },
  };
  const ctx = makeCtx({ client: { user: { id: 'app1' }, guilds: { cache: new Map() } } });
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0, 1, 1] });

  assert.equal(ok, true, 'nach Retries erfolgreich');
  assert.equal(attempts, 3, 'genau 3 Versuche');
  assert.equal(ctx.commandsRegistered, true);
});

test('registerCommands setzt bei Dauerfehler commandsRegistered=false (Scheduler heilt weiter)', async () => {
  const fakeRest = {
    put: async () => {
      throw new Error('500 Internal Server Error');
    },
  };
  const ctx = makeCtx();
  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0, 1] });

  assert.equal(ok, false);
  assert.equal(ctx.commandsRegistered, false, 'false = Scheduler versucht alle 15 min erneut');
});

test('ensureCommandIds lädt IDs von Discord REST GET nach wenn RAM und Store leer sind', async () => {
  const fakeRest = {
    get: async (route) => {
      assert.equal(route, Routes.applicationCommands('app1'));
      return [
        { id: '1001', name: 'setup' },
        { id: '1002', name: 'rank' },
        { id: '1003', name: 'help' },
        { id: '1004', name: 'admin_set_bot_profile' },
        { id: '1005', name: 'level_roles' },
        { id: '1006', name: 'adminpanel' },
      ];
    },
  };
  const ctx = makeCtx({ rest: fakeRest, commandIds: {} });
  const ids = await ensureCommandIds(ctx);

  assert.equal(ids.level_roles, '1005');
  assert.equal(ctx.commandIds.level_roles, '1005');
  assert.equal(ctx.store.getCommandId('level_roles'), '1005');
});

test('commandMention nutzt Memory, Store und Guild-IDs und formatiert </name:id>', () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIds({ setup: 'store-setup' });

  const ctx = {
    store,
    commandIds: { help: 'global-help', level_roles: 'global-level' },
    guildCommandIds: new Map([['g1', { help: 'guild-help', level_roles: 'guild-level' }]]),
  };

  assert.equal(commandMention(ctx, 'level_roles', 'g1'), '</level_roles:guild-level>');
  assert.equal(commandMention(ctx, 'help', 'g2'), '</help:global-help>');
  assert.equal(commandMention(ctx, 'setup', 'g2'), '</setup:store-setup>');
  assert.equal(commandMention(ctx, 'missing', 'g1'), '/missing');
});

test('/help rendert alle 5 Chat-Commands als klickbare Mentions </name:id>', async () => {
  let replyPayload = null;
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', lang: 'de' });
  store.setCommandIds({
    setup: '2001',
    rank: '2002',
    help: '2003',
    admin_set_bot_profile: '2004',
    level_roles: '2005',
  });

  // Simulation Bot-Restart: ctx.commandIds ist anfangs leer, wird aus Store geladen
  const ctx = {
    store,
    token: 'test-token',
    client: { user: { id: 'app1' } },
    commandIds: {},
    guildCommandIds: new Map(),
  };

  const interaction = {
    commandName: 'help',
    guildId: 'g1',
    locale: 'de',
    isChatInputCommand: () => true,
    reply: async (payload) => {
      replyPayload = payload;
      return payload;
    },
  };

  await handleChatInput(ctx, interaction);

  const text = JSON.stringify(replyPayload.components.map((c) => (c.toJSON ? c.toJSON() : c)));
  assert.ok(text.includes('</setup:2001>'), 'setup muss klickbar sein');
  assert.ok(text.includes('</rank:2002>'), 'rank muss klickbar sein');
  assert.ok(text.includes('</admin_set_bot_profile:2004>'), 'admin_set_bot_profile muss klickbar sein');
  assert.ok(text.includes('</level_roles:2005>'), 'level_roles muss klickbar sein');
  assert.ok(text.includes('</help:2003>'), 'help muss klickbar sein');
  // Keine unklickbaren reinen Text-Befehle wie "**/level_roles**" ohne ID
  assert.ok(!text.includes('**`/level_roles`**') && !text.includes('**/level_roles**\n'), 'darf kein Text-Fallback sein');
});

test('store persistiert commandIds über setCommandIds und getCommandIds', () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIds({ level_roles: '9999', setup: '8888' });
  assert.equal(store.getCommandId('level_roles'), '9999');
  assert.equal(store.getCommandId('setup'), '8888');
  assert.deepEqual(store.getCommandIds(), { level_roles: '9999', setup: '8888' });
});

test('ensureCommandIds registriert automatisch neu, falls REST GET unvollständig ist (z.B. /level_roles fehlt)', async () => {
  let putCalled = false;
  const fakeRest = {
    get: async (route) => {
      assert.equal(route, Routes.applicationCommands('app1'));
      // Unvollständige Antwort von Discord (ohne level_roles)
      return [
        { id: '3001', name: 'setup' },
        { id: '3002', name: 'rank' },
        { id: '3003', name: 'help' },
      ];
    },
    put: async (route, { body }) => {
      putCalled = true;
      return (body || []).map((c) => ({ id: `new-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx({ rest: fakeRest, commandIds: {} });
  const ids = await ensureCommandIds(ctx);

  assert.equal(putCalled, true, 'Sollte registerCommands ausführen, um fehlenden Command /level_roles zu registrieren');
  assert.equal(ids.level_roles, 'new-level_roles');
  assert.equal(ctx.commandIds.level_roles, 'new-level_roles');
});
