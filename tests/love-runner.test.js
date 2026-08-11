/**
 * Integration-Test für den Analyse-Ablauf des Love Testers (ohne echte API):
 * - createSession + runAnalysis mit gemocktem Discord-Client & Kanal
 * - Scan → Ausschnitte → Prompt → Groq (gemockt) → Ergebnis-Nachricht
 * - Fehlerfall: Groq 429 → Fehler-Container mit Retry-Buttons
 */

process.env.LOVE_TEST_FAST = 'true'; // schnelle Retry-Backoffs in Tests

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSession, runAnalysis, continueAnalysis } = require('../bots/love-tester-bot/src/runner');
const { extractAllText } = require('../bots/xp-level-bot/src/embed-builder'); // gleiche Helper-Logik

function fakeMessage(id, authorId, content, ts, extra = {}) {
  return {
    id,
    author: { id: authorId, username: `user${authorId}`, displayName: `Name${authorId}` },
    content,
    createdTimestamp: ts,
    attachments: extra.attachments || new Map(),
    stickers: extra.stickers || { size: 0, values: () => [] },
    embeds: extra.embeds || [],
    flags: extra.flags || { has: () => false },
    reference: extra.reference || null,
    channel: extra.channel || null,
  };
}

function makeChannel(id, messages) {
  // messages: Array chronologisch; fetch simuliert neueste-zuerst mit before
  const channel = {
    id,
    isTextBased: () => true,
    messages: {},
  };
  channel.messages.fetch = async (optsOrId) => {
    if (typeof optsOrId === 'string') {
      if (channel._targets && channel._targets.has(optsOrId)) return channel._targets.get(optsOrId);
      return messages.find((m) => m.id === optsOrId) || null;
    }
    let list = [...messages].reverse();
    if (optsOrId.before) {
      const idx = messages.findIndex((m) => m.id === optsOrId.before);
      list = messages.slice(0, idx).reverse();
    }
    const out = new Map();
    for (const m of list.slice(0, optsOrId.limit || 100)) out.set(m.id, m);
    return out;
  };
  return channel;
}

function makeCtx({ channels, groqResponse, groqStatus = 200 }) {
  const messages = new Map(); // messageId -> {edit(payload), payload}
  const guild = {
    id: 'g1',
    name: 'Testgilde',
    members: { cache: new Map([
      ['11', { displayName: 'Mia', user: { username: 'mia_2001', displayName: 'Mia', globalName: 'Mia' }, nickname: 'Mia' }],
      ['22', { displayName: 'Lukas', user: { username: 'luki', displayName: 'Lukas', globalName: 'Lukas' }, nickname: 'Lukas' }],
    ]) },
    roles: { cache: new Map() },
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
  };
  const client = {
    guilds: { cache: new Map([['g1', guild]]) },
    users: { cache: new Map() },
    channels: { async fetch(id) { return channels.find((c) => c.id === id) || null; } },
  };
  const store = {
    getGuild: () => ({ guildId: 'g1', lang: 'de', channels: channels.map((c) => c.id), groqApiKey: 'gsk_test_123', setupComplete: true }),
  };

  // Nachrichten mit channel-Verknüpfung (für Reply-Auflösung)
  for (const ch of channels) for (const m of ch._messages) m.channel = ch;

  // Groq mocken
  const originalFetch = global.fetch;
  const groqCalls = { count: 0 };
  global.fetch = async (url, opts) => {
    groqCalls.count += 1;
    assert.ok(url.includes('api.groq.com'), 'ruft Groq-API auf');
    const body = JSON.parse(opts.body);
    assert.ok(body.messages[0].role === 'system', 'System-Prompt vorhanden');
    assert.ok(body.messages[1].content.includes('USER 1'), 'User-Prompt mit USER-Infos');
    return {
      ok: groqStatus >= 200 && groqStatus < 300,
      status: groqStatus,
      async json() {
        if (groqStatus === 429) return { error: { message: 'rate limited' } };
        return { choices: [{ message: { content: groqResponse } }] };
      },
    };
  };

  return {
    client,
    store,
    logger: { info() {}, warn() {}, error() {} },
    loveSessions: new Map(),
    setupSessions: new Map(),
    panelSessions: new Map(),
    ownerId: '',
    _messages: messages,
    _channels: channels,
    _groqCalls: groqCalls,
    _restore: () => { global.fetch = originalFetch; },
  };
}

test('runAnalysis: Scan → Ausschnitte → Groq → Ergebnis mit ### XX %', async () => {
  const now = Date.now();
  const chMessages = [
    fakeMessage('m1', '99', 'hi leute', now - 60_000),
    fakeMessage('m2', '99', 'wie gehts', now - 50_000),
    fakeMessage('m3', '99', 'alles gut?', now - 40_000),
    fakeMessage('m4', '99', 'hallo zusammen', now - 30_000),
    fakeMessage('m5', '11', 'hey Lukas', now - 20_000), // USER1
    fakeMessage('m6', '99', 'oha', now - 15_000),
    fakeMessage('m7', '22', 'hey Mia <3', now - 10_000), // USER2
    fakeMessage('m8', '99', 'süß', now - 5_000),
    fakeMessage('m9', '99', 'aber wirklich', now - 4_000),
    fakeMessage('m10', '99', 'haha', now - 3_000),
  ];
  const channel = makeChannel('c1', chMessages);
  channel._messages = chMessages;
  const ctx = makeCtx({
    channels: [channel],
    groqResponse: 'Mia schreibt ständig „hey“.\n\nLukas antwortet nur mit „ok.“\n\nZusammen knallt das.\n\nUrteil: ich ship das.\n\n### 87%',
  });

  const session = createSession({
    ctx,
    interaction: { user: { id: '55' }, guildId: 'g1' },
    cfg: { lang: 'de', channels: ['c1'], groqApiKey: 'gsk_test_123', setupComplete: true },
    user1: { id: '11', name: 'Mia', displayName: 'Mia', username: 'mia_2001', globalName: 'Mia', nickname: 'Mia' },
    user2: { id: '22', name: 'Lukas', displayName: 'Lukas', username: 'luki', globalName: 'Lukas', nickname: 'Lukas' },
    token: 'tok1',
  });
  session.channelId = 'c1';
  session.messageId = 'msg1';
  const target1 = { id: 'msg1', edit: async (payload) => { target1.payload = payload; } };
  ctx._messages.set('msg1', target1);
  channel._targets = new Map([['msg1', target1]]);

  await runAnalysis(ctx, session);

  const final = ctx._messages.get('msg1').payload;
  const text = extractAllText(final);
  assert.ok(text.includes('### 87%'), `Prozentzeile fehlt: ${text}`);
  assert.ok(text.includes('-# <@11>'), `User1-Mention im Urteil fehlt: ${text}`);
  assert.ok(text.includes('-# <@22>'), `User2-Mention im Urteil fehlt: ${text}`);
  assert.ok(!/\n\n.*\n\n/.test(text.replace(/-# /g, '')), `Urteil ist nicht dicht genug: ${text}`);
  assert.ok(text.includes('-# '), `kleine Begründungszeilen fehlen: ${text}`);
  assert.ok(text.includes('Love') || text.includes('Urteil'), text);
  assert.equal(session.status, 'done');
  ctx._restore();
});

test('runAnalysis: Groq 429 → Fehler-Container mit Retry + Weiter analysieren', async () => {
  const now = Date.now();
  const chMessages = [
    fakeMessage('m1', '11', 'hey', now - 60_000),
    fakeMessage('m2', '22', 'hallo', now - 50_000),
  ];
  const channel = makeChannel('c1', chMessages);
  channel._messages = chMessages;
  const ctx = makeCtx({ channels: [channel], groqStatus: 429, groqResponse: '' });

  const session = createSession({
    ctx,
    interaction: { user: { id: '55' }, guildId: 'g1' },
    cfg: { lang: 'de', channels: ['c1'], groqApiKey: 'gsk_test_123', setupComplete: true },
    user1: { id: '11', name: 'Mia', displayName: 'Mia', username: 'mia_2001', globalName: 'Mia', nickname: 'Mia' },
    user2: { id: '22', name: 'Lukas', displayName: 'Lukas', username: 'luki', globalName: 'Lukas', nickname: 'Lukas' },
    token: 'tok2',
  });
  session.channelId = 'c1';
  session.messageId = 'msg2';
  const target2 = { id: 'msg2', edit: async (payload) => { target2.payload = payload; } };
  ctx._messages.set('msg2', target2);
  channel._targets = new Map([['msg2', target2]]);

  await runAnalysis(ctx, session);

  const final = ctx._messages.get('msg2').payload;
  const text = extractAllText(final);
  assert.equal(session.status, 'error');
  assert.ok(/Nutzungslimit|rate/i.test(text), `Rate-Limit-Meldung fehlt: ${text}`);
  // Buttons: Retry + Weiter + Stopp (Custom-IDs im JSON)
  const json = JSON.stringify(final);
  assert.ok(json.includes('love_retry_tok2'), 'Retry-Button fehlt');
  assert.ok(json.includes('love_more_tok2'), 'Weiter-analysieren-Button fehlt');
  ctx._restore();
});

test('runAnalysis: keine Nachrichten → verständliche Fehlermeldung', async () => {
  const channel = makeChannel('c1', []);
  channel._messages = [];
  const ctx = makeCtx({ channels: [channel], groqResponse: 'x' });

  const session = createSession({
    ctx,
    interaction: { user: { id: '55' }, guildId: 'g1' },
    cfg: { lang: 'de', channels: ['c1'], groqApiKey: 'gsk_test_123', setupComplete: true },
    user1: { id: '11', name: 'Mia', displayName: 'Mia', username: 'mia_2001', globalName: 'Mia', nickname: 'Mia' },
    user2: { id: '22', name: 'Lukas', displayName: 'Lukas', username: 'luki', globalName: 'Lukas', nickname: 'Lukas' },
    token: 'tok3',
  });
  session.channelId = 'c1';
  session.messageId = 'msg3';
  const target3 = { id: 'msg3', edit: async (payload) => { target3.payload = payload; } };
  ctx._messages.set('msg3', target3);
  channel._targets = new Map([['msg3', target3]]);

  await runAnalysis(ctx, session);

  const text = extractAllText(ctx._messages.get('msg3').payload);
  assert.equal(session.status, 'error');
  assert.ok(/Keine brauchbaren Nachrichten/i.test(text), text);
  ctx._restore();
});

test('continueAnalysis: scannt weitere Nachrichten (ältere) nach', async () => {
  // 550 Nachrichten: erster Scan holt die 500 neuesten (Budget), der zweite
  // Lauf die restlichen 50 älteren über den before-Cursor.
  const base = Date.now();
  const chMessages = Array.from({ length: 550 }, (_, i) => fakeMessage(`m${i}`, i % 10 === 0 ? '11' : '99', `nachricht ${i}`, base - (550 - i) * 1000));
  const channel = makeChannel('c1', chMessages);
  channel._messages = chMessages;

  const ctx = makeCtx({ channels: [channel], groqResponse: 'analyse\n\n### 50%' });

  const session = createSession({
    ctx,
    interaction: { user: { id: '55' }, guildId: 'g1' },
    cfg: { lang: 'de', channels: ['c1'], groqApiKey: 'gsk_test_123', setupComplete: true },
    user1: { id: '11', name: 'Mia', displayName: 'Mia', username: 'mia_2001', globalName: 'Mia', nickname: 'Mia' },
    user2: { id: '22', name: 'Lukas', displayName: 'Lukas', username: 'luki', globalName: 'Lukas', nickname: 'Lukas' },
    token: 'tok4',
  });
  session.channelId = 'c1';
  session.messageId = 'msg4';
  const target4 = { id: 'msg4', edit: async (payload) => { target4.payload = payload; } };
  ctx._messages.set('msg4', target4);
  channel._targets = new Map([['msg4', target4]]);

  await runAnalysis(ctx, session);
  assert.equal(session.status, 'done', 'erster Lauf fertig');
  assert.equal(session.scannedTotal, 500, 'Budget von 500 erreicht');
  assert.equal(ctx._groqCalls.count, 1);
  // Cursor steht auf der ältesten gelesenen Nachricht (m50)
  assert.equal(session.channelState.get('c1').before, 'm50');
  assert.equal(session.canContinue, true, 'ältere Nachrichten sind noch da');

  // Zweiter Lauf: holt die restlichen 50 älteren Nachrichten
  await continueAnalysis(ctx, session);
  assert.equal(session.status, 'done');
  assert.equal(ctx._groqCalls.count, 2, 'Groq wurde erneut befragt');
  assert.equal(session.scannedTotal, 550, 'alle Nachrichten gescannt');
  assert.equal(session.channelState.get('c1').before, 'done', 'Kanal ist jetzt erschöpft');
  assert.equal(session.canContinue, false, 'nichts mehr zu holen');
  const text = extractAllText(ctx._messages.get('msg4').payload);
  assert.ok(text.includes('### 50%'), text);
  ctx._restore();
});
