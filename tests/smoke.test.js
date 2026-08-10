/**
 * Smoke-Test: lädt alle Module, baut das Commands-JSON, startet den
 * Health-Server und prüft, dass der Loader ohne Tokens sauber durchläuft.
 * Läuft komplett ohne Discord-Verbindung.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

let healthServer = null;
const logger = { info: () => {}, warn: () => {}, error: () => {} };

test('Bot-Module haben die erwartete Form', () => {
  const bday = require('../bots/birthday-bot/index.js');
  assert.equal(bday.id, 'birthday-bot');
  assert.equal(bday.tokenEnv, 'BIRTHDAY_BOT_TOKEN');
  assert.equal(typeof bday.create, 'function');
  assert.ok(Array.isArray(bday.intents));

  const xp = require('../bots/xp-level-bot/index.js');
  assert.equal(xp.id, 'xp-level-bot');
  assert.equal(xp.tokenEnv, 'XP_BOT_TOKEN');
  assert.equal(typeof xp.create, 'function');
});

test('Slash-Commands sind gültiges Discord-JSON (10 Sprachen, 9 Commands)', () => {
  const { defineCommands } = require('../bots/birthday-bot/src/commands');
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 9);
  const names = cmds.map((c) => c.name).sort();
  assert.deepEqual(names, [
    'admin_set_birthday',
    'admin_set_bot_profile',
    'adminpanel',
    'event',
    'help',
    'set_birthday_role',
    'set_channel',
    'set_language',
    'setup',
  ]);
  const event = cmds.find((c) => c.name === 'event');
  assert.deepEqual(event.options[0].choices.map((c) => c.value), ['create', 'delete']);
  const setupRole = cmds.find((c) => c.name === 'setup').options.find((o) => o.name === 'birthday_role');
  assert.ok(setupRole, 'Setup hat die optionale Geburtstagsrolle');
  assert.ok(!setupRole.required, 'Geburtstagsrolle ist optional');
  const setup = cmds.find((c) => c.name === 'setup');
  assert.equal(setup.options.find((o) => o.name === 'language').choices.length, 10); // 10 Sprachen
  const profile = cmds.find((c) => c.name === 'admin_set_bot_profile');
  assert.deepEqual(profile.options[0].choices.map((c) => c.value), ['standard', 'server', 'owner']);

  // Die neuen Einzel-Config-Befehle sind ausschließlich für Admins gedacht.
  for (const name of ['set_language', 'set_channel', 'set_birthday_role']) {
    const cmd = cmds.find((c) => c.name === name);
    assert.ok(cmd, `Befehl /${name} existiert`);
    assert.equal(cmd.default_member_permissions, '8', `/${name} ist nur für Admins (Bit 8)`);
  }

  // Discord API Anforderung: erforderliche Optionen müssen vor optionalen Optionen stehen
  for (const cmd of cmds) {
    if (!cmd.options) continue;
    let seenOptional = false;
    for (const opt of cmd.options) {
      if (opt.required) {
        assert.equal(
          seenOptional,
          false,
          `In Befehl "/${cmd.name}": erforderliche Option "${opt.name}" darf nicht nach einer optionalen Option stehen`
        );
      } else {
        seenOptional = true;
      }
    }
  }
});

test('Loader startet ohne Tokens sauber (0 Bots, kein Crash)', async () => {
  const loader = require('../src/loader');
  const env = (k, d) => process.env[k] ?? d;
  const started = await loader.startAll({ logger, env });
  assert.equal(started.length, 0);
});

before(async () => {
  const { startHealthServer } = require('../src/health');
  healthServer = startHealthServer({
    env: (k, d) => (k === 'PORT' ? '18123' : d),
    logger,
    getStatuses: () => [{ id: 'x', status: 'online' }],
  });
  await new Promise((r) => healthServer.once('listening', r));
});

after(() => {
  if (healthServer) healthServer.close();
});

test('Health-Server antwortet mit 200 + Bots-Status', async () => {
  const res = await new Promise((resolve, reject) => {
    http
      .get('http://127.0.0.1:18123/healthz', (r) => {
        let body = '';
        r.on('data', (c) => (body += c));
        r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.bots[0].status, 'online');
});
