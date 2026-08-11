/**
 * Tests für die neue 7-Tage-Aufräumregel des Geburtstags-Bots:
 * - Geburtstags-/Event-Posts bleiben 7 Tage stehen
 * - Abgelaufene Posts werden gelöscht – samt ALLER Nachrichten darüber bis zur Liste
 * - Frische Posts und Konversation bleiben unangetastet
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createStore } = require('../bots/birthday-bot/src/store');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function fakeMessage(id, ts, { components = [], content = '' } = {}) {
  return {
    id,
    createdTimestamp: ts,
    author: { id: 'bot' },
    components,
    content,
    delete: async () => {},
  };
}

// Echte Container-JSON-Struktur (wie buildCongratsEmbed/buildEventCongratsEmbed):
// Der Marker steckt im TextDisplay-Content, der Button-CustomId nur als Bonus.
const congratsComponents = [{ type: 17, components: [{ type: 10, content: '🎂\u200Bbday-congrats:2026-08-01:123\u200B' }] }];
const eventComponents = [{ type: 17, components: [{ type: 10, content: '🚀\u200Bbday-event:2026-08-01:686578\u200B' }] }];

function makeHarness() {
  const messages = []; // chronologisch (index 0 = älteste)
  const deleted = [];

  const listMsg = fakeMessage('list1', now - 30 * DAY, {
    components: [{ type: 1, components: [{ customId: 'bday_add' }] }],
  });
  messages.push(listMsg);

  const channel = {
    isTextBased: () => true,
    messages: {
      async fetch(optsOrId) {
        if (typeof optsOrId === 'string') {
          const m = messages.find((x) => x.id === optsOrId);
          return m || null;
        }
        // Simuliert Discord: neueste zuerst, limit + before-Cursor
        let list = [...messages].reverse();
        if (optsOrId.before) {
          const idx = messages.findIndex((m) => m.id === optsOrId.before);
          list = messages.slice(0, idx).reverse();
        }
        const out = new Map();
        for (const m of list.slice(0, optsOrId.limit || 100)) out.set(m.id, m);
        return out;
      },
    },
    async bulkDelete(ids) {
      for (const id of ids) {
        const idx = messages.findIndex((m) => m.id === id);
        if (idx !== -1) {
          deleted.push(id);
          messages.splice(idx, 1);
        }
      }
      return new Set(ids);
    },
  };
  // Nachricht-Objekte mit channel-Verknüpfung
  for (const m of messages) m.channel = channel;

  const guild = { id: 'g1', name: 'Testgilde' };
  const client = {
    guilds: { cache: new Map([['g1', guild]]) },
    channels: { async fetch() { return channel; } },
  };

  const store = createStore({ client, logger: { info() {}, warn() {}, error() {} } });
  const entry = {
    guildId: 'g1',
    channelId: 'c1',
    messageId: 'list1',
    lang: 'de',
    birthdays: [],
    events: [],
  };
  store.set(entry);

  return { store, channel, messages, deleted, entry };
}

test('Cleanup: 7 Tage alter Post wird gelöscht, samt Nachrichten darüber bis zur Liste', async () => {
  const h = makeHarness();
  // Konversation zwischen Liste und altem Post
  h.messages.push(fakeMessage('conv1', now - 10 * DAY, { content: 'altes Zeug' }));
  h.messages.push(fakeMessage('conv2', now - 8 * DAY, { content: 'noch älter' }));
  // Abgelaufener Geburtstags-Gruß (8 Tage alt)
  h.messages.push(fakeMessage('post_old', now - 8 * DAY + 3600_000, { components: congratsComponents }));
  // Frische Konversation + frischer Post (2 Tage alt)
  h.messages.push(fakeMessage('conv3', now - 2 * DAY, { content: 'frisch' }));
  h.messages.push(fakeMessage('post_new', now - 2 * DAY + 3600_000, { components: eventComponents }));

  const result = await h.store.cleanupExpired(h.entry);

  assert.equal(result.deleted, 3, 'alter Post + 2 Konversations-Nachrichten darüber gelöscht');
  assert.deepEqual(h.deleted.sort(), ['conv1', 'conv2', 'post_old'].sort());

  // Frische Nachrichten bleiben
  assert.ok(h.messages.some((m) => m.id === 'post_new'), 'frischer Post bleibt');
  assert.ok(h.messages.some((m) => m.id === 'conv3'), 'frische Konversation bleibt');
  assert.ok(h.messages.some((m) => m.id === 'list1'), 'Liste bleibt immer');
});

test('Cleanup: nichts passiert, wenn alle Posts jünger als 7 Tage sind', async () => {
  const h = makeHarness();
  h.messages.push(fakeMessage('conv1', now - 2 * DAY, { content: 'hi' }));
  h.messages.push(fakeMessage('post1', now - 6 * DAY + 3600_000, { components: congratsComponents }));
  h.messages.push(fakeMessage('post2', now - 1 * DAY, { components: eventComponents }));

  const result = await h.store.cleanupExpired(h.entry);
  assert.equal(result.deleted, 0);
  assert.equal(h.deleted.length, 0);
  assert.equal(h.messages.length, 4);
});

test('Cleanup: mehrere abgelaufene Posts → alles bis zum neuesten abgelaufenen Post weg', async () => {
  const h = makeHarness();
  h.messages.push(fakeMessage('old_conv', now - 20 * DAY, { content: 'ur-alt' }));
  h.messages.push(fakeMessage('post_a', now - 12 * DAY, { components: congratsComponents }));
  h.messages.push(fakeMessage('mid_conv', now - 10 * DAY, { content: 'mittel' }));
  h.messages.push(fakeMessage('post_b', now - 8 * DAY, { components: congratsComponents }));
  h.messages.push(fakeMessage('fresh', now - 1 * DAY, { content: 'neu' }));

  const result = await h.store.cleanupExpired(h.entry);
  assert.equal(result.deleted, 4, 'beide alten Posts + Konversation dazwischen/darüber gelöscht');
  assert.ok(h.messages.some((m) => m.id === 'fresh'), 'frische Nachricht bleibt');
  assert.ok(h.messages.some((m) => m.id === 'list1'), 'Liste bleibt');
});

test('Cleanup: normale Bot-Nachrichten ohne Post-Marker werden nicht als Posts gewertet', async () => {
  const h = makeHarness();
  h.messages.push(fakeMessage('bot_msg', now - 20 * DAY, { content: 'irgendeine alte Bot-Nachricht' }));
  const result = await h.store.cleanupExpired(h.entry);
  assert.equal(result.deleted, 0, 'keine Post-Marker → nichts löschen');
});
