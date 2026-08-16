/**
 * Regressionstests für die Slash-Command-Registrierung des Security-Bots.
 * Discord wird vollständig gemockt; es findet kein Netzwerkzugriff statt.
 */

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

function responseFor(body, scope = 'test') {
  return body.map((command, index) => ({
    ...command,
    id: `${scope}-${index + 1}`,
  }));
}

function createContext(rest, guildIds = ['guild-1']) {
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
    client: {
      user: { id: 'application-1' },
      guilds: {
        cache: new Map(guildIds.map((id) => [id, { id }])),
      },
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

test('Security Commands: Guild-Payload enthält alle Server-Commands ohne globale Context-Felder', () => {
  const guildPayload = guildCommandJson();
  const globalPayload = allCommandJson();

  assert.deepEqual(guildPayload.map((command) => command.name), GUILD_COMMAND_NAMES);
  assert.deepEqual(globalPayload.map((command) => command.name), GLOBAL_COMMAND_NAMES);
  assert.equal(guildPayload.length, ALL_COMMAND_NAMES.length - 1);

  for (const command of guildPayload) {
    assert.equal(command.contexts, undefined, `/${command.name}: contexts gehört nicht in Guild-PUT`);
    assert.equal(
      command.integration_types,
      undefined,
      `/${command.name}: integration_types gehört nicht in Guild-PUT`
    );
    assert.equal(command.dm_permission, undefined, `/${command.name}: kein DM-Feld in Guild-PUT`);
  }

  assert.deepEqual(globalPayload[0].contexts, [1], '/adminpanel bleibt global auf Bot-DMs begrenzt');
});

test('Security Commands: registriert zuerst jede Guild und danach /adminpanel global', async () => {
  const calls = [];
  const rest = {
    put: async (route, { body }) => {
      calls.push({ route, body });
      return responseFor(body, route.includes('/guilds/') ? 'guild' : 'global');
    },
  };
  const { ctx, stored } = createContext(rest, ['guild-1', 'guild-2']);

  const ok = await registerCommands(ctx, { retryDelays: [0] });

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].route, /\/guilds\/guild-1\/commands$/);
  assert.match(calls[1].route, /\/guilds\/guild-2\/commands$/);
  assert.doesNotMatch(calls[2].route, /\/guilds\//);
  assert.deepEqual(calls[0].body.map((command) => command.name), GUILD_COMMAND_NAMES);
  assert.deepEqual(calls[2].body.map((command) => command.name), GLOBAL_COMMAND_NAMES);
  assert.ok(stored.global.adminpanel);
  assert.equal(stored.guilds.size, 2);
  assert.equal(Object.keys(ctx.guildCommandIds.get('guild-1')).length, GUILD_COMMAND_NAMES.length);
});

test('Security Commands: wiederholt einen vorübergehend fehlgeschlagenen Guild-PUT', async () => {
  let guildAttempts = 0;
  const rest = {
    put: async (route, { body }) => {
      if (route.includes('/guilds/')) {
        guildAttempts += 1;
        if (guildAttempts === 1) throw new Error('Discord temporarily unavailable');
      }
      return responseFor(body, route.includes('/guilds/') ? 'guild' : 'global');
    },
  };
  const { ctx, logs } = createContext(rest);

  const ok = await registerCommands(ctx, { retryDelays: [0, 0] });

  assert.equal(ok, true);
  assert.equal(guildAttempts, 2);
  assert.equal(ctx.commandsRegistered, true);
  assert.ok(logs.warn.some((line) => line.includes('Versuch 1/2')));
});

test('Security Commands: meldet dauerhaften REST-Fehler als Fehler statt als Erfolg', async () => {
  let globalWrites = 0;
  const rest = {
    put: async (route) => {
      if (route.includes('/guilds/')) throw new Error('Missing Access');
      globalWrites += 1;
      return [];
    },
  };
  const { ctx, logs } = createContext(rest);

  const ok = await registerCommands(ctx, { retryDelays: [0, 0] });

  assert.equal(ok, false);
  assert.equal(ctx.commandsRegistered, false);
  assert.equal(globalWrites, 0, 'alte globale Commands werden bei Guild-Fehler nicht gelöscht');
  assert.ok(logs.error.some((line) => line.includes('nicht vollständig')));
});

test('Security Commands: Live-Verifikation repariert leere Discord-Sätze', async () => {
  const gets = [];
  const puts = [];
  const rest = {
    get: async (route) => {
      gets.push(route);
      return [];
    },
    put: async (route, { body }) => {
      puts.push({ route, body });
      return responseFor(body, route.includes('/guilds/') ? 'guild-repair' : 'global-repair');
    },
  };
  const { ctx } = createContext(rest);

  const ok = await verifyCommandsLive(ctx);

  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.equal(gets.length, 2);
  assert.equal(puts.length, 2);
  assert.ok(ctx.commandIds.adminpanel);
  assert.equal(Object.keys(ctx.guildCommandIds.get('guild-1')).length, GUILD_COMMAND_NAMES.length);
});
