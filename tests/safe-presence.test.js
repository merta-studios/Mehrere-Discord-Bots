/**
 * Regressionstests für den Produktionsfehler:
 *   "client.user?.setPresence(...).catch is not a function"
 *
 * ClientUser#setPresence() liefert in discord.js v14 SYNCHRON ein
 * ClientPresence-Objekt zurück. Ein `.catch()` darauf warf einen TypeError,
 * der im ClientReady-Handler des Security-Bots die komplette
 * Slash-Command-Registrierung verhinderte.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { safeSetPresence, createPresenceUpdater, redactSecrets } = require('../src/safe-presence');

function createLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logs,
    logger: {
      info: (...a) => logs.info.push(a.join(' ')),
      warn: (...a) => logs.warn.push(a.join(' ')),
      error: (...a) => logs.error.push(a.join(' ')),
    },
  };
}

test('safeSetPresence: synchroner Rückgabewert ohne .catch() wird akzeptiert', () => {
  const calls = [];
  // Exakt das discord.js-v14-Verhalten: ein Objekt OHNE .catch/.then
  const clientPresence = { status: 'online', activities: [] };
  const client = { user: { setPresence: (data) => { calls.push(data); return clientPresence; } } };
  const { logger, logs } = createLogger();

  const ok = safeSetPresence(client, { status: 'online' }, { logger, label: 'security-bot' });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(logs.warn.length, 0, 'kein Warn-Log bei erfolgreichem Presence-Update');
  assert.equal(logs.error.length, 0);
});

test('safeSetPresence: synchron geworfener Fehler wird isoliert und geloggt', () => {
  const client = {
    user: {
      setPresence: () => {
        throw new TypeError('client.user?.setPresence(...).catch is not a function');
      },
    },
  };
  const { logger, logs } = createLogger();

  let ok;
  assert.doesNotThrow(() => {
    ok = safeSetPresence(client, { status: 'online' }, { logger, label: 'security-bot' });
  });

  assert.equal(ok, false);
  assert.equal(logs.warn.length, 1);
  assert.match(logs.warn[0], /\[security-bot\] Presence-Update fehlgeschlagen/);
});

test('safeSetPresence: Promise-artiger Rückgabewert wird korrekt behandelt (Rejection verschluckt)', async () => {
  const client = { user: { setPresence: () => Promise.reject(new Error('gateway down')) } };
  const { logger, logs } = createLogger();

  const ok = safeSetPresence(client, { status: 'online' }, { logger, label: 'xp-level-bot' });
  assert.equal(ok, true, 'ein Promise-Rückgabewert gilt synchron als erfolgreich gestartet');

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.warn.length, 1);
  assert.match(logs.warn[0], /\[xp-level-bot\] Presence-Update fehlgeschlagen.*gateway down/);
});

test('safeSetPresence: erfüllte Promises erzeugen keinen Fehler-Log', async () => {
  const client = { user: { setPresence: () => Promise.resolve({ status: 'online' }) } };
  const { logger, logs } = createLogger();

  assert.equal(safeSetPresence(client, {}, { logger, label: 'birthday-bot' }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(logs.warn.length, 0);
  assert.equal(logs.error.length, 0);
});

test('safeSetPresence: fehlender client.user bricht nicht ab', () => {
  const { logger } = createLogger();
  assert.equal(safeSetPresence({}, {}, { logger }), false);
  assert.equal(safeSetPresence({ user: null }, {}, { logger }), false);
  assert.equal(safeSetPresence(null, {}, { logger }), false);
});

test('safeSetPresence / redactSecrets: es werden niemals Tokens oder Secrets geloggt', () => {
  const fakeToken = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GhIjKl.abcdefghijklmnopqrstuvwxyz0123456789';
  const client = {
    user: {
      setPresence: () => {
        throw new Error(`401 Unauthorized: Bot ${fakeToken} sk-abcdefghijklmnopqrstuvwx`);
      },
    },
  };
  const { logger, logs } = createLogger();
  safeSetPresence(client, {}, { logger, label: 'security-bot' });

  assert.equal(logs.warn.length, 1);
  assert.ok(!logs.warn[0].includes(fakeToken), 'Bot-Token darf nicht im Log stehen');
  assert.ok(!/sk-abcdefghijklmnopqrstuvwx/.test(logs.warn[0]), 'API-Key darf nicht im Log stehen');
  assert.match(logs.warn[0], /\[redacted\]/);
  assert.match(redactSecrets(fakeToken), /\[redacted\]/);
});

test('createPresenceUpdater: ein werfender build() stoppt den Aufrufer nicht', () => {
  const client = { user: { setPresence: () => ({}) } };
  const { logger, logs } = createLogger();
  const update = createPresenceUpdater({
    client,
    logger,
    label: 'security-bot',
    build: () => {
      throw new Error('guilds cache not ready');
    },
  });

  let result;
  assert.doesNotThrow(() => { result = update(); });
  assert.equal(result, false);
  assert.match(logs.warn[0], /guilds cache not ready/);
});

test('Bots rufen setPresence() nicht mehr direkt mit .catch() auf', () => {
  for (const bot of ['security-bot', 'birthday-bot', 'xp-level-bot']) {
    const file = path.join(__dirname, '..', 'bots', bot, 'index.js');
    const raw = fs.readFileSync(file, 'utf8');
    assert.ok(
      raw.includes("require('../../src/safe-presence')"),
      `${bot} nutzt den safe-presence Helper`
    );
    // Kommentare entfernen – nur echter Code darf geprüft werden.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
    assert.ok(
      !/setPresence\s*\([\s\S]*?\)\s*\??\.\s*catch/.test(source),
      `${bot} ruft kein .catch() direkt auf setPresence() auf`
    );
  }
});
