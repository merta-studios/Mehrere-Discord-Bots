/**
 * Regressionstest für den bestätigten Produktionsfehler des Security-Bots:
 *
 *   21:09:11 INFO  [security-bot] Online als Sicherheitssystem#8614
 *   21:09:11 ERROR [security-bot] Client-Fehler: client.user?.setPresence(...).catch is not a function
 *
 * Der ClientReady-Handler brach bei updatePresence() ab, weshalb
 * registerCommands() und die Live-Verifikation nie ausgeführt wurden.
 * Dieser Test fährt den echten Ready-Handler mit einem gemockten Client hoch
 * und stellt sicher, dass ein Presence-Fehler keinen der Folgeschritte stoppt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Das Command-Modul wird VOR dem Bot-Modul in den require-Cache gelegt.
// index.js destrukturiert registerCommands/verifyCommandsLive beim Laden – nur so
// lassen sich die echten Discord-REST-Aufrufe im Test durch Zähler ersetzen.
const commandsPath = require.resolve('../bots/security-bot/src/commands');
const realCommands = require(commandsPath);

const calls = { register: 0, verify: 0 };

require.cache[commandsPath].exports = {
  ...realCommands,
  registerCommands: async (ctx) => {
    calls.register += 1;
    ctx.commandsRegistered = true;
    return true;
  },
  verifyCommandsLive: async () => {
    calls.verify += 1;
    return true;
  },
};

const securityBot = require('../bots/security-bot/index.js');

function createHarness(setPresence) {
  const logs = { info: [], warn: [], error: [] };
  const logger = {
    info: (...a) => logs.info.push(a.join(' ')),
    warn: (...a) => logs.warn.push(a.join(' ')),
    error: (...a) => logs.error.push(a.join(' ')),
    debug: () => {},
  };
  const handlers = { once: new Map(), on: new Map() };
  const client = {
    application: { id: '100000000000000001' },
    user: { id: '100000000000000001', tag: 'Sicherheitssystem#8614', setPresence },
    guilds: { cache: new Map([['200000000000000001', { id: '200000000000000001' }]]) },
    once: (event, handler) => handlers.once.set(String(event), handler),
    on: (event, handler) => handlers.on.set(String(event), handler),
    destroy: () => {},
  };
  const env = (key, fallback = '') =>
    key === 'SECURITY_STORE_DISABLE_FILE_BACKUP' ? 'true' : fallback;
  return { logs, logger, client, handlers, env };
}

async function runReady(setPresence) {
  {
    calls.register = 0;
    calls.verify = 0;
    const h = createHarness(setPresence);
    const before = process.listenerCount('SIGTERM');
    await securityBot.create({
      client: h.client,
      token: 'test-token-not-a-real-secret',
      logger: h.logger,
      env: h.env,
    });

    const ready = h.handlers.once.get('ready') || h.handlers.once.get('clientReady');
    assert.equal(typeof ready, 'function', 'ClientReady-Handler ist registriert');
    await ready();

    // Timer/Listener wieder abräumen, damit der Testlauf sauber endet.
    h.client.destroy();
    for (const name of ['SIGTERM', 'SIGINT']) {
      const listeners = process.listeners(name);
      for (const l of listeners.slice(before)) process.off(name, l);
    }
    return { ...h, calls };
  }
}

test('Security Ready: synchrones setPresence()-Objekt ohne .catch() bricht den Ready-Handler nicht ab', async () => {
  const seen = [];
  const { logs } = await runReady((data) => {
    seen.push(data);
    return { status: 'online', activities: [] }; // discord.js v14: kein Promise
  });

  assert.equal(seen.length, 1);
  assert.equal(calls.register, 1, 'registerCommands() wurde ausgeführt');
  assert.equal(calls.verify, 1, 'Live-Verifikation wurde ausgeführt');
  assert.ok(logs.info.some((line) => line.includes('[security-bot] Bereit auf')));
});

test('Security Ready: synchron werfendes setPresence() verhindert die Command-Registrierung nicht', async () => {
  const { logs } = await runReady(() => {
    throw new TypeError('client.user?.setPresence(...).catch is not a function');
  });

  assert.equal(calls.register, 1, 'registerCommands() läuft trotz Presence-Fehler');
  assert.equal(calls.verify, 1, 'Live-Verifikation läuft trotz Presence-Fehler');
  assert.ok(logs.info.some((line) => line.includes('[security-bot] Bereit auf')));
  assert.ok(logs.warn.some((line) => line.includes('Presence-Update fehlgeschlagen')));
  assert.ok(
    !logs.error.some((line) => line.includes('catch is not a function')),
    'der TypeError erreicht den Client-Error-Handler nicht mehr'
  );
});

test('Security Ready: Promise-Rejection aus setPresence() bricht den Ready-Handler nicht ab', async () => {
  const { logs } = await runReady(() => Promise.reject(new Error('gateway hiccup')));

  assert.equal(calls.register, 1);
  assert.equal(calls.verify, 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(logs.warn.some((line) => line.includes('gateway hiccup')));
});
