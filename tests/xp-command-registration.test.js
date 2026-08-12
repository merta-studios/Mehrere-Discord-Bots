/**
 * Tests für die Slash-Command-Registrierung und den /help Command des XP-Bots:
 * 1. Discord-API-Validierung aller 9 Commands (inkl. /toggle_nicknames & /sync_nicknames)
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
    commandIds: {},
    guildCommandIds: new Map(),
    ...overrides,
  };
}

const ALL_CMD_NAMES = ['setup', 'rank', 'help', 'admin_set_bot_profile', 'level_roles', 'update_leaderboard', 'toggle_nicknames', 'sync_nicknames', 'adminpanel'];

function fakeCommandList(idFor = (name) => `id-${name}`) {
  const idFn = typeof idFor === 'function' ? idFor : (name) => `${idFor}${name}`;
  return ALL_CMD_NAMES.map((name) => ({ id: idFn(name), name }));
}

test('alle 9 Command-JSONs sind Discord-API-valide (inkl. /toggle_nicknames & /sync_nicknames)', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 9);
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
  assert.deepEqual(names, ALL_CMD_NAMES);

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

  // WICHTIG (Versuch 5): Dev-Guild-IDs gehören NUR in den Guild-Slot –
  // der globale Slot und der Store-Global-Slot dürfen NICHT verschmutzt werden,
  // sonst rendert /help auf normalen Servern </level_roles:DEV_GUILD_ID>
  // („Kein Befehl gefunden").
  assert.equal(ctx.commandIds?.level_roles, undefined, 'Dev-ID darf nicht im globalen Memory-Slot landen');
  assert.equal(ctx.store.getCommandId('level_roles'), null, 'Dev-ID darf nicht im globalen Store-Slot landen');

  // Guild-Slot enthält die Dev-Guild-IDs
  assert.equal(ctx.guildCommandIds.get('123456789012345678').level_roles, 'dev-id-level_roles');
  assert.equal(ctx.store.getGuildCommandIds('123456789012345678').level_roles, 'dev-id-level_roles');

  // Scope ist als Guild-Scope markiert
  assert.equal(ctx.commandIdScope, 'guild:123456789012345678');
  assert.equal(ctx.store.getCommandIdScope(), 'guild:123456789012345678');
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
        { id: '1006', name: 'update_leaderboard' },
        { id: '1008', name: 'toggle_nicknames' },
        { id: '1009', name: 'sync_nicknames' },
        { id: '1007', name: 'adminpanel' },
      ];
    },
  };
  const ctx = makeCtx({ rest: fakeRest, commandIds: {} });
  const ids = await ensureCommandIds(ctx);

  assert.equal(ids.level_roles, '1005');
  assert.equal(ctx.commandIds.level_roles, '1005');
  assert.equal(ctx.store.getCommandId('level_roles'), '1005');
});

test('commandMention: Guild-IDs NUR auf der Dev-Gilde, sonst zwingend globale IDs', () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIds({ setup: 'store-setup' });

  const ctx = {
    store,
    devGuildId: 'g1',
    commandIds: { help: 'global-help', level_roles: 'global-level' },
    guildCommandIds: new Map([['g1', { help: 'guild-help', level_roles: 'guild-level' }]]),
  };

  // Auf der Dev-Gilde selbst: Guild-IDs erlaubt
  assert.equal(commandMention(ctx, 'level_roles', 'g1'), '</level_roles:guild-level>');
  assert.equal(commandMention(ctx, 'help', 'g1'), '</help:guild-help>');
  // Auf normalen Servern: NIE Guild-IDs, IMMER die globale ID
  assert.equal(commandMention(ctx, 'level_roles', 'g2'), '</level_roles:global-level>');
  assert.equal(commandMention(ctx, 'help', 'g2'), '</help:global-help>');
  assert.equal(commandMention(ctx, 'setup', 'g2'), '</setup:store-setup>');
  assert.equal(commandMention(ctx, 'missing', 'g1'), '/missing');
});

test('commandMention: ohne Dev-Gilde werden vorhandene Guild-IDs komplett ignoriert', () => {
  const store = createXpStore({ env: () => '' });
  store.setGuildCommandIds('g1', { level_roles: 'stored-guild-level' });

  const ctx = {
    store,
    devGuildId: null,
    commandIds: { level_roles: 'global-level' },
    guildCommandIds: new Map([['g1', { level_roles: 'guild-level' }]]),
  };

  // Keine Dev-Gilde konfiguriert -> Guild-IDs dürfen nie verwendet werden
  assert.equal(commandMention(ctx, 'level_roles', 'g1'), '</level_roles:global-level>');
  // Wenn keine globale ID existiert: reiner Text-Fallback, NICHT die fremde Guild-ID
  assert.equal(commandMention(ctx, 'level_roles', 'g1').includes('guild-level'), false);
});

test('commandMention: Dev-Guild-ID aus Store wird auf normalen Servern nie verwendet (Prüfpunkt 1)', () => {
  // Szenario: Bot lief früher mit XP_BOT_GUILD_ID (Dev-Modus). Der Store enthält
  // noch Dev-Guild-IDs im Guild-Slot. Auf einem NORMALEN Server darf /help daraus
  // niemals </level_roles:DEV_ID> bauen, sondern nur die globale ID nutzen –
  // bzw. den Text-Fallback, wenn keine globale ID existiert.
  const store = createXpStore({ env: () => '' });
  store.setGuildCommandIds('999999999', { level_roles: 'dev-snowflake-111', setup: 'dev-snowflake-222' });
  store.setCommandIdScope('guild:999999999');

  const ctx = {
    store,
    devGuildId: '999999999',
    commandIds: {},
    guildCommandIds: new Map([['999999999', { level_roles: 'dev-snowflake-111' }]]),
  };

  // Normaler Server (g2 != Dev-Gilde 999999999):
  assert.equal(commandMention(ctx, 'level_roles', 'g2'), '/level_roles');
  // Dev-Gilde selbst: Guild-ID ok
  assert.equal(commandMention(ctx, 'level_roles', '999999999'), '</level_roles:dev-snowflake-111>');
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
    update_leaderboard: '2006',
    toggle_nicknames: '2008',
    sync_nicknames: '2009',
    adminpanel: '2007',
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
  assert.ok(text.includes('</toggle_nicknames:2008>'), 'toggle_nicknames muss klickbar sein');
  assert.ok(text.includes('</sync_nicknames:2009>'), 'sync_nicknames muss klickbar sein');
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

test('/level_roles ist ein valider Admin-Command für globale Registrierung (Prüfpunkt 2)', () => {
  const cmd = defineCommands().map((c) => c.toJSON()).find((c) => c.name === 'level_roles');
  assert.ok(cmd, '/level_roles muss definiert sein');

  // default_member_permissions: Administrator (Bit "8") als String – exakt das
  // Format, das Discord für globale Commands verlangt. Admin-Mitglieder sehen
  // den Befehl im /-Menü, normale Mitglieder nicht (Discord-Design).
  assert.equal(cmd.default_member_permissions, '8', 'Administrator-Permission muss als String "8" gesetzt sein');
  assert.equal(typeof cmd.description, 'string');
  assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);

  // Keine Pflicht-Optionen nach optionalen, valide Optionsnamen – wird von
  // validateCommand abgedeckt, hier explizit nochmal für level_roles:
  assert.deepEqual(validateCommand(cmd), [], 'level_roles-JSON muss Discord-API-valide sein');
});

test('globale Registrierung löscht alte Guild-Command-IDs aus dem Store (Prüfpunkt 3)', async () => {
  const calls = [];
  const fakeRest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return (body || []).map((c) => ({ id: `global-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx({
    // Simuliert veralteten Store aus der Dev-Gilden-Zeit:
    store: (() => {
      const s = createXpStore({ env: () => '' });
      s.setGuildCommandIds('111111111', { level_roles: 'old-dev-id', setup: 'old-dev-setup' });
      s.setGuildCommandIds('222222222', { level_roles: 'old-dev-id-2' });
      return s;
    })(),
    guildCommandIds: new Map([['111111111', { level_roles: 'old-dev-id' }]]),
  });

  const ok = await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });
  assert.equal(ok, true);

  // Alte Guild-IDs sind aus Memory UND Store entfernt
  assert.equal(ctx.guildCommandIds.size, 0);
  assert.deepEqual(ctx.store.getAllGuildCommandIds(), {}, 'keine Guild-IDs mehr im Store');
  // Globale IDs sind die einzige Quelle
  assert.equal(ctx.commandIds.level_roles, 'global-level_roles');
  assert.equal(ctx.store.getCommandId('level_roles'), 'global-level_roles');
  // Scope als global markiert
  assert.equal(ctx.commandIdScope, 'global');
  assert.equal(ctx.store.getCommandIdScope(), 'global');
});

test('ensureCommandIds lädt auf normalen Servern GLOBALE Commands, auch wenn Dev-Gilde gesetzt ist (Prüfpunkt 1)', async () => {
  const routes = [];
  const fakeRest = {
    get: async (route) => {
      routes.push(route);
      return [
        { id: '4001', name: 'setup' },
        { id: '4002', name: 'rank' },
        { id: '4003', name: 'help' },
        { id: '4004', name: 'admin_set_bot_profile' },
        { id: '4005', name: 'level_roles' },
        { id: '4006', name: 'update_leaderboard' },
        { id: '4008', name: 'toggle_nicknames' },
        { id: '4009', name: 'sync_nicknames' },
        { id: '4007', name: 'adminpanel' },
      ];
    },
  };
  // Bot ist in der Dev-Gilde konfiguriert, /help wird aber auf normalem Server g2 aufgerufen
  const ctx = makeCtx({ devGuildId: '123456789012345678', rest: fakeRest, commandIds: {} });
  const ids = await ensureCommandIds(ctx, 'g2');

  assert.equal(routes.length, 1, 'exakt ein REST-Aufruf');
  assert.equal(routes[0], Routes.applicationCommands('app1'), 'muss die GLOBALE Route laden, nicht die Dev-Gilden-Route');
  assert.equal(ids.level_roles, '4005');
  // Keine Dev-Guild-IDs im globalen Slot
  assert.equal(ctx.guildCommandIds.has('123456789012345678'), false);
});

test('ensureCommandIds lädt auf der Dev-Gilde die Guild-Commands und verschmutzt den globalen Slot nicht', async () => {
  const routes = [];
  const fakeRest = {
    get: async (route) => {
      routes.push(route);
      return [
        { id: '5001', name: 'setup' },
        { id: '5002', name: 'rank' },
        { id: '5003', name: 'help' },
        { id: '5004', name: 'admin_set_bot_profile' },
        { id: '5005', name: 'level_roles' },
        { id: '5006', name: 'update_leaderboard' },
        { id: '5008', name: 'toggle_nicknames' },
        { id: '5009', name: 'sync_nicknames' },
        { id: '5007', name: 'adminpanel' },
      ];
    },
  };
  const ctx = makeCtx({ devGuildId: '123456789012345678', rest: fakeRest, commandIds: {} });
  const ids = await ensureCommandIds(ctx, '123456789012345678');

  assert.equal(routes[0], Routes.applicationGuildCommands('app1', '123456789012345678'));
  assert.equal(ids.level_roles, '5005');
  assert.equal(ctx.guildCommandIds.get('123456789012345678').level_roles, '5005');
  // Globaler Slot bleibt unangetastet (keine Dev-Pollution!)
  assert.equal(ctx.commandIds.level_roles, undefined);
  assert.equal(ctx.store.getCommandId('level_roles'), null);
});

test('Logging nennt Scope und die Discord-Snowflake pro Command, inkl. /level_roles (Prüfpunkt 4)', async () => {
  const logs = [];
  const fakeRest = {
    put: async (route, { body }) => {
      return (body || []).map((c) => ({ id: `sf-${c.name}`, name: c.name }));
    },
  };
  const ctx = makeCtx({
    logger: { info: (m) => logs.push(m), warn() {}, error() {} },
  });

  await registerCommands(ctx, { restFactory: () => fakeRest, retryDelays: [0] });

  const joined = logs.join('\n');
  // Scope-Typ explizit geloggt
  assert.ok(/Scope: global/.test(joined), `Scope fehlt im Log:\n${joined}`);
  // Snowflake pro Befehl geloggt – insbesondere level_roles
  assert.ok(/\/level_roles -> snowflake sf-level_roles/.test(joined), `level_roles-Snowflake fehlt im Log:\n${joined}`);
  assert.ok(/\/setup -> snowflake sf-setup/.test(joined), `setup-Snowflake fehlt im Log:\n${joined}`);

  // Auch im Dev-Gilden-Modus: Scope nennt die Guild-ID
  logs.length = 0;
  const ctxDev = makeCtx({
    devGuildId: '123456789012345678',
    logger: { info: (m) => logs.push(m), warn() {}, error() {} },
  });
  await registerCommands(ctxDev, { restFactory: () => fakeRest, retryDelays: [0] });
  const joinedDev = logs.join('\n');
  assert.ok(/Scope: guild 123456789012345678/.test(joinedDev), `Guild-Scope fehlt im Log:\n${joinedDev}`);
  assert.ok(/\/level_roles -> snowflake sf-level_roles/.test(joinedDev), `level_roles-Snowflake fehlt im Dev-Log:\n${joinedDev}`);
});

test('store persistiert den Command-ID-Scope über Datei-Neustart hinweg', async () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIdScope('global');
  assert.equal(store.getCommandIdScope(), 'global');

  // Neuer Store (simulierter Bot-Restart) lädt aus der Fallback-Datei
  const store2 = createXpStore({ env: () => '' });
  await store2.init();
  assert.equal(store2.getCommandIdScope(), 'global', 'Scope muss nach Restart aus dem Store geladen werden');

  // Guild-Scope-Roundtrip
  const store3 = createXpStore({ env: () => '' });
  store3.setCommandIdScope('guild:123456789012345678');
  const store4 = createXpStore({ env: () => '' });
  await store4.init();
  assert.equal(store4.getCommandIdScope(), 'guild:123456789012345678');
});

// ---------------------------------------------------------------------------
// Bugfix-Regressionstests: verwaiste (stale) Command-IDs
//
// Gemeldeter Bug: /update_leaderboard stand in der /help-Übersicht blau
// (klickbar), aber Discord meldete beim Klick „KEIN BEFEHL GEFUNDEN / Dieser
// Befehl ist nicht verfügbar". Ursache: Der Store enthielt eine ALTE Snowflake
// für /update_leaderboard (Discord hatte den Command zwischenzeitlich neu
// angelegt und damit eine neue ID vergeben). ensureCommandIds hat die
// gespeicherten IDs blind vertraut, solange alle Namen vorhanden waren –
// /help rendert dann </update_leaderboard:ALTE_ID>.
// ---------------------------------------------------------------------------

test('ensureCommandIds korrigiert verwaiste Store-Snowflakes gegen Discord REST (Bugfix /update_leaderboard)', async () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIds({
    setup: '1001',
    rank: '1002',
    help: '1003',
    admin_set_bot_profile: '1004',
    level_roles: '1005',
    update_leaderboard: 'DEAD-BEEF-OLD', // ← verwaiste ID aus früherer Registrierung
    toggle_nicknames: '1008',
    sync_nicknames: '1009',
    adminpanel: '1007',
  });

  const routes = [];
  const fakeRest = {
    get: async (route) => {
      routes.push(route);
      // Discord kennt /update_leaderboard unter einer NEUEN Snowflake:
      return [
        { id: '1001', name: 'setup' },
        { id: '1002', name: 'rank' },
        { id: '1003', name: 'help' },
        { id: '1004', name: 'admin_set_bot_profile' },
        { id: '1005', name: 'level_roles' },
        { id: '2006', name: 'update_leaderboard' },
        { id: '1008', name: 'toggle_nicknames' },
        { id: '1009', name: 'sync_nicknames' },
        { id: '1007', name: 'adminpanel' },
      ];
    },
  };

  const ctx = makeCtx({ store, rest: fakeRest, commandIds: store.getCommandIds() });
  const ids = await ensureCommandIds(ctx, 'g1');

  assert.equal(routes[0], Routes.applicationCommands('app1'), 'muss gegen Discord verifizieren (global)');
  assert.equal(ids.update_leaderboard, '2006', 'verwaiste ID muss durch die frische ersetzt werden');
  assert.equal(ctx.commandIds.update_leaderboard, '2006');
  assert.equal(ctx.store.getCommandId('update_leaderboard'), '2006', 'Store muss korrigiert werden');
});

test('verifizierte IDs werden innerhalb der TTL aus dem Memory genutzt (kein REST-Spam bei /help)', async () => {
  let getCalls = 0;
  const fakeRest = {
    get: async () => {
      getCalls++;
      return [
        { id: '1', name: 'setup' },
        { id: '2', name: 'rank' },
        { id: '3', name: 'help' },
        { id: '4', name: 'admin_set_bot_profile' },
        { id: '5', name: 'level_roles' },
        { id: '6', name: 'update_leaderboard' },
        { id: '8', name: 'toggle_nicknames' },
        { id: '9', name: 'sync_nicknames' },
        { id: '7', name: 'adminpanel' },
      ];
    },
  };
  const ctx = makeCtx({ rest: fakeRest, commandIds: {} });
  const first = await ensureCommandIds(ctx, 'g1');
  assert.equal(getCalls, 1);
  assert.equal(first.update_leaderboard, '6');

  // Zweiter Aufruf direkt danach: frisch verifiziert → kein weiterer REST-Call
  const second = await ensureCommandIds(ctx, 'g1');
  assert.equal(getCalls, 1, 'TTL verhindert unnötige REST-Aufrufe');
  assert.equal(second.update_leaderboard, '6');
});

test('store.setCommandIds ERSTZT die komplette Liste (verwaiste IDs überleben keinen Merge)', () => {
  const store = createXpStore({ env: () => '' });
  store.setCommandIds({ setup: '111', update_leaderboard: 'STALE' });
  // Frische, vollständige Registrierungsantwort von Discord:
  store.setCommandIds({ setup: '222', rank: '333' });
  assert.equal(store.getCommandId('update_leaderboard'), null, 'verwaiste ID darf nicht weiterleben');
  assert.equal(store.getCommandId('setup'), '222');
  assert.equal(store.getCommandId('rank'), '333');
});

test('/help rendert /update_leaderboard mit frischer ID statt der verwaisten Store-ID (End-to-End-Bugfix)', async () => {
  let replyPayload = null;
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', lang: 'de' });
  store.setCommandIds({
    setup: '3001',
    rank: '3002',
    help: '3003',
    admin_set_bot_profile: '3004',
    level_roles: '3005',
    update_leaderboard: 'DEAD-BEEF-OLD', // ← verwaist (der gemeldete Bug)
    toggle_nicknames: '3008',
    sync_nicknames: '3009',
    adminpanel: '3007',
  });

  const fakeRest = {
    get: async () => [
      { id: '3001', name: 'setup' },
      { id: '3002', name: 'rank' },
      { id: '3003', name: 'help' },
      { id: '3004', name: 'admin_set_bot_profile' },
      { id: '3005', name: 'level_roles' },
      { id: '4006', name: 'update_leaderboard' }, // frische Snowflake von Discord
      { id: '3008', name: 'toggle_nicknames' },
      { id: '3009', name: 'sync_nicknames' },
      { id: '3007', name: 'adminpanel' },
    ],
  };

  const ctx = {
    store,
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' } },
    commandIds: store.getCommandIds(),
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
  assert.ok(text.includes('</update_leaderboard:4006>'), '/help muss die frische ID rendern');
  assert.ok(!text.includes('DEAD-BEEF-OLD'), 'verwaiste Store-ID darf nie gerendert werden');
});

test('/toggle_nicknames und /sync_nicknames sind valide Admin-Commands mit Setup-Pflicht', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  const toggle = cmds.find((c) => c.name === 'toggle_nicknames');
  const sync = cmds.find((c) => c.name === 'sync_nicknames');
  assert.ok(toggle, '/toggle_nicknames muss definiert sein');
  assert.ok(sync, '/sync_nicknames muss definiert sein');
  assert.equal(toggle.default_member_permissions, '8');
  assert.equal(sync.default_member_permissions, '8');
  assert.deepEqual(validateCommand(toggle), []);
  assert.deepEqual(validateCommand(sync), []);
  const enabled = (toggle.options || []).find((o) => o.name === 'enabled');
  assert.ok(enabled, 'Boolean-Option enabled muss existieren');
  assert.equal(enabled.required, true);
  assert.equal(enabled.type, 5, 'Discord Boolean-Option ist Typ 5');
});

function payloadText(payload) {
  return JSON.stringify(payload?.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || payload);
}

function makeAdminInteraction({ commandName, options = {}, guild, perms = true }) {
  const replies = [];
  const edits = [];
  const interaction = {
    commandName,
    guildId: 'g1',
    guild,
    locale: 'de',
    inGuild: () => true,
    memberPermissions: { has: () => perms },
    options: {
      getBoolean: (name) => options[name],
    },
    deferred: false,
    replied: false,
    reply: async (payload) => {
      replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      edits.push(payload);
      return payload;
    },
    replies,
    edits,
  };
  return interaction;
}

test('/toggle_nicknames braucht Setup und speichert den Schalter', async () => {
  const store = createXpStore({ env: () => '' });
  const ctx = { store, logger: { info() {}, warn() {}, error() {} } };

  const noSetup = makeAdminInteraction({ commandName: 'toggle_nicknames', options: { enabled: false } });
  await handleChatInput(ctx, noSetup);
  assert.match(payloadText(noSetup.replies[0]), /noch kein XP-System|Bitte nutze zuerst/i);

  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de' });
  const denied = makeAdminInteraction({ commandName: 'toggle_nicknames', options: { enabled: false }, perms: false });
  await handleChatInput(ctx, denied);
  assert.match(payloadText(denied.replies[0]), /Administrator/);

  const off = makeAdminInteraction({ commandName: 'toggle_nicknames', options: { enabled: false } });
  await handleChatInput(ctx, off);
  assert.equal(store.getGuild('g1').nicknamesEnabled, false);
  assert.match(payloadText(off.replies[0]), /aus/i);

  const on = makeAdminInteraction({ commandName: 'toggle_nicknames', options: { enabled: true } });
  await handleChatInput(ctx, on);
  assert.equal(store.getGuild('g1').nicknamesEnabled, true);
  assert.match(payloadText(on.replies[0]), /an/i);
});

test('/sync_nicknames braucht Setup, deferrt den Ladebildschirm und gleicht Nicknames ab', async () => {
  const store = createXpStore({ env: () => '' });
  const noSetup = makeAdminInteraction({ commandName: 'sync_nicknames' });
  await handleChatInput({ store, logger: { info() {}, warn() {}, error() {} } }, noSetup);
  assert.match(payloadText(noSetup.replies[0]), /noch kein XP-System|Bitte nutze zuerst/i);
  assert.equal(noSetup.deferred, false);

  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', nicknamesEnabled: true });
  store.setUser({ guildId: 'g1', userId: 'a', level: 4, xp: 10 });

  const members = new Map();
  const alice = {
    id: 'a',
    nickname: 'Alice',
    displayName: 'Alice',
    user: { username: 'Alice' },
    roles: { highest: { position: 1 } },
    setNickname: async (nick) => { alice.nickname = nick; },
  };
  members.set('a', alice);
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    members: {
      me: { id: 'bot', permissions: { has: () => true }, roles: { highest: { position: 100 } } },
      fetch: async () => members,
    },
  };
  const interaction = makeAdminInteraction({ commandName: 'sync_nicknames', guild });
  await handleChatInput({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);

  assert.equal(interaction.deferred, true, 'Discord-Ladebildschirm (defer) muss erscheinen');
  assert.ok(interaction.edits.length >= 1, 'Fortschritt/Ergebnis wird in die Command-Antwort geschrieben');
  assert.equal(alice.nickname, '[Lvl 4 🥇] Alice');
  const last = payloadText(interaction.edits[interaction.edits.length - 1]);
  assert.match(last, /fertig|Sync/i);
});
