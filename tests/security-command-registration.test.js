/** Regression tests for the Security Bot's command registration strategy. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  ALL_COMMAND_NAMES,
  GUILD_COMMAND_NAMES,
  GLOBAL_COMMAND_NAMES,
  guildCommandJson,
  allCommandJson,
  registerCommands,
  verifyCommandsLive,
} = require('../bots/security-bot/src/commands');

const APP_ID = '100000000000000001';
const GUILD_1 = '200000000000000001';
const GUILD_2 = '200000000000000002';

function responseFor(body, scope = 'test') {
  return body.map((command, index) => ({ ...command, id: `${scope}-${index + 1}` }));
}

function createContext(rest, { guildIds = [GUILD_1], devGuildId = null } = {}) {
  const logs = { info: [], warn: [], error: [] };
  const stored = { global: null, guilds: new Map() };
  const logger = {
    info: (...args) => logs.info.push(args.join(' ')),
    warn: (...args) => logs.warn.push(args.join(' ')),
    error: (...args) => logs.error.push(args.join(' ')),
  };
  const ctx = {
    token: 'test-token',
    rest,
    logger,
    devGuildId,
    deployCommit: 'test-commit',
    client: {
      application: { id: APP_ID },
      user: { id: APP_ID },
      guilds: { cache: new Map(guildIds.map((id) => [id, { id }])) },
    },
    store: {
      setCommandIds: (ids) => { stored.global = ids; },
      setGuildCommandIds: (id, ids) => stored.guilds.set(id, ids),
    },
    commandIds: {},
    guildCommandIds: new Map(),
    commandsRegistered: false,
  };
  return { ctx, logs, stored };
}

test('Security Commands: globaler Payload enthält den vollständigen Satz mit korrekten Contexts', () => {
  const globalPayload = allCommandJson();
  const guildPayload = guildCommandJson();

  assert.deepEqual(globalPayload.map((command) => command.name), ALL_COMMAND_NAMES);
  assert.deepEqual(GLOBAL_COMMAND_NAMES, ALL_COMMAND_NAMES);
  assert.deepEqual(guildPayload.map((command) => command.name), GUILD_COMMAND_NAMES);

  const adminPanel = globalPayload.find((command) => command.name === 'adminpanel');
  assert.deepEqual(adminPanel.contexts, [1], '/adminpanel ist ausschließlich Bot-DM');
  for (const command of globalPayload.filter((item) => item.name !== 'adminpanel')) {
    assert.deepEqual(command.contexts, [0], `/${command.name} ist ausschließlich Guild-Context`);
  }
  for (const command of guildPayload) {
    assert.equal(command.contexts, undefined);
    assert.equal(command.integration_types, undefined);
    assert.equal(command.dm_permission, undefined);
  }
});

test('Security Commands: Reihenfolge ist globaler PUT, optionale Guild, dann alte Guild-Cleanups', async () => {
  const calls = [];
  const rest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return responseFor(body, route.includes('/guilds/') ? 'guild' : 'global');
    },
  };
  const { ctx, stored, logs } = createContext(rest, {
    guildIds: [GUILD_1, GUILD_2],
    devGuildId: GUILD_1,
  });

  const ok = await registerCommands(ctx, { retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[0].route, /\/guilds\//);
  assert.deepEqual(calls[0].body.map((command) => command.name), ALL_COMMAND_NAMES);
  assert.match(calls[1].route, new RegExp(`/guilds/${GUILD_1}/commands$`));
  assert.deepEqual(calls[1].body.map((command) => command.name), GUILD_COMMAND_NAMES);
  assert.match(calls[2].route, new RegExp(`/guilds/${GUILD_2}/commands$`));
  assert.deepEqual(calls[2].body, []);
  assert.deepEqual(Object.keys(stored.global), ALL_COMMAND_NAMES);
  assert.ok(stored.guilds.get(GUILD_1).help);
  assert.deepEqual(stored.guilds.get(GUILD_2), {});
  assert.ok(logs.info.some((line) => line.includes(`Application-ID=${APP_ID}`)));
  assert.ok(logs.info.some((line) => line.includes('Deploy-Commit=test-commit')));
  assert.ok(logs.info.some((line) => line.includes('/set_api_key (global-1)')));
});

test('Security Commands: fehlerhafte optionale Guild blockiert den globalen Fallback nicht', async () => {
  const calls = [];
  const rest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      if (route.includes(`/guilds/${GUILD_1}/`)) {
        const error = new Error('Missing Access');
        error.status = 403;
        error.code = 50001;
        error.rawError = { message: 'Missing Access', code: 50001 };
        throw error;
      }
      return responseFor(body, 'global');
    },
  };
  const { ctx, logs } = createContext(rest, { devGuildId: GUILD_1 });

  const ok = await registerCommands(ctx, { retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.deepEqual(calls[0].body.map((command) => command.name), ALL_COMMAND_NAMES);
  assert.deepEqual(ctx.commandIds && Object.keys(ctx.commandIds), ALL_COMMAND_NAMES);
  assert.ok(logs.warn.some((line) =>
    line.includes('globale Commands bleiben aktiv') &&
    line.includes('status=403') &&
    line.includes('code=50001') &&
    line.includes('rawError=')
  ));
});

test('Security Commands: globaler Fehler berührt keinen Guild-Command-Satz', async () => {
  const calls = [];
  const rest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      throw new Error('Discord unavailable');
    },
  };
  const { ctx } = createContext(rest, { devGuildId: GUILD_1 });

  const ok = await registerCommands(ctx, { retryDelays: [0, 0] });

  assert.equal(ok, false);
  assert.equal(ctx.commandsRegistered, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.route.includes('/guilds/')));
  assert.ok(calls.every((call) => call.body.length === ALL_COMMAND_NAMES.length));
});

test('Security Commands: falsche SECURITY_BOT_GUILD_ID wird übersprungen, global bleibt vollständig', async () => {
  const calls = [];
  const rest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return responseFor(body, 'accepted');
    },
  };
  const { ctx, logs } = createContext(rest, { devGuildId: 'not-a-snowflake' });

  const ok = await registerCommands(ctx, { retryDelays: [0] });

  assert.equal(ok, true);
  assert.deepEqual(calls[0].body.map((command) => command.name), ALL_COMMAND_NAMES);
  assert.equal(calls.filter((call) => call.body.length > 0).length, 1);
  assert.ok(logs.error.some((line) => line.includes('keine gültige Discord-Snowflake')));
});

test('Security Commands: Live-Verifikation liest den vollständigen globalen Satz zurück', async () => {
  const globalResponse = responseFor(allCommandJson(), 'live');
  const gets = [];
  const rest = {
    get: async (route) => {
      gets.push(route);
      return globalResponse;
    },
    put: async () => { throw new Error('kein Repair erwartet'); },
  };
  const { ctx, logs } = createContext(rest);

  const ok = await verifyCommandsLive(ctx);

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.equal(gets.length, 1);
  assert.deepEqual(Object.keys(ctx.commandIds), ALL_COMMAND_NAMES);
  assert.ok(logs.info.some((line) => line.includes('Discord GET global zurückgegeben')));
  assert.ok(logs.info.some((line) => line.includes('/adminpanel (live-11)')));
});

test('Security Commands: Live-Verifikation repariert einen unvollständigen globalen Satz', async () => {
  const puts = [];
  const rest = {
    get: async () => [],
    put: async (route, { body }) => {
      puts.push({ route, body });
      return responseFor(body, 'repair');
    },
  };
  const { ctx } = createContext(rest);

  const ok = await verifyCommandsLive(ctx);

  assert.equal(ok, true);
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].body.map((command) => command.name), ALL_COMMAND_NAMES);
});
