/**
 * Tests für die neuen /setup-Optionen des XP-Bots:
 * 1. Level-Down-Nachricht nutzt dieselbe Schriftgröße wie Level-Up ("## "-Heading)
 * 2. setup-Option `only_level_chat` lenkt Chat-Level-Ups auf den Level-Chat um
 * 3. Kombinierter Modus (Level-Chat == Leaderboard): repinLeaderboard sendet
 *    das Board neu und löscht die alte Nachricht, damit es die neueste bleibt.
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildLevelDownEmbed } = require('../bots/xp-level-bot/src/embed-builder');
const { sendLevelAnnouncement } = require('../bots/xp-level-bot/src/level-announcements');
const { repinLeaderboard } = require('../bots/xp-level-bot/src/scheduler');

test('buildLevelDownEmbed: nutzt "## "-Heading (gleiche Schriftgröße wie Level-Up)', () => {
  const container = buildLevelDownEmbed({ lang: 'de', userId: '123', level: 4, xp: 70 });
  const text = JSON.stringify(container.toJSON());
  assert.ok(text.includes('## 😢 Oh nein! <@123> ist auf **Level 4** abgerutscht'), `Level-Down-Text fehlt oder ohne ##: ${text}`);
  // Keine XP-Zahlen mehr in der Level-Down-Nachricht
  assert.ok(!text.includes('/'), 'Level-Down darf keine XP-Bruchangabe mehr enthalten');
});

test('only_level_chat:true lenkt Chat-Level-Up auf den Level-Chat um (kein Reply im Quellkanal)', async () => {
  const ctx = { logger: { info() {}, warn() {}, error() {} } };
  const mainSends = [];
  const main = {
    id: 'main',
    isTextBased: () => true,
    send: async (payload) => { mainSends.push(payload); return { id: 'main-msg' }; },
  };
  const guild = {
    id: 'guild',
    name: 'Testserver',
    systemChannel: null,
    channels: { cache: new Map([['main', main]]), fetch: async (id) => (id === 'main' ? main : null) },
  };
  const cfg = { guildId: 'guild', mainChannelId: 'main', levelMessagesMainOnly: true, lang: 'de' };

  const replies = [];
  const sourceSends = [];
  const sourceMsg = {
    channel: { id: 'beliebiger-channel', isTextBased: () => true, send: async (p) => sourceSends.push(p) },
    reply: async (p) => { replies.push(p); return { id: 'reply' }; },
  };

  const result = await sendLevelAnnouncement({
    ctx, guild, cfg, userId: '123',
    res: { leveledUp: true, level: 2, xp: 0 },
    sourceMsg, source: 'text',
  });

  assert.equal(result.sent, true);
  assert.equal(result.destination, 'main-channel', 'muss in den Level-Chat gehen');
  assert.equal(replies.length, 0, 'darf nicht im Quellkanal antworten');
  assert.equal(sourceSends.length, 0, 'darf nicht in den Quellkanal senden');
  assert.equal(mainSends.length, 1);
});

test('only_level_chat:false (Default) erlaubt weiterhin Reply im Quellkanal', async () => {
  const ctx = { logger: { info() {}, warn() {}, error() {} } };
  const main = { id: 'main', isTextBased: () => true, send: async () => ({ id: 'm' }) };
  const guild = {
    id: 'guild', name: 'Testserver', systemChannel: null,
    channels: { cache: new Map([['main', main]]), fetch: async (id) => (id === 'main' ? main : null) },
  };
  const cfg = { guildId: 'guild', mainChannelId: 'main', levelMessagesMainOnly: false, lang: 'de' };

  const replies = [];
  const sourceMsg = {
    channel: { id: 'x', isTextBased: () => true, send: async () => assert.fail('nicht nötig') },
    reply: async (p) => { replies.push(p); return { id: 'r' }; },
  };
  const result = await sendLevelAnnouncement({
    ctx, guild, cfg, userId: '7',
    res: { leveledUp: true, level: 3, xp: 0 },
    sourceMsg, source: 'text',
  });
  assert.equal(result.destination, 'source-reply');
  assert.equal(replies.length, 1);
});

function repinHarness(guildId, entry, { slowSend = false } = {}) {
  let sentCount = 0;
  const oldMessage = { id: 'leader-old', delete: async () => { oldMessage.deleted = true; return oldMessage; } };
  const newMessage = { id: 'leader-new' };
  const channel = {
    id: entry.leaderboardChannelId,
    isTextBased: () => true,
    messages: { fetch: async (id) => (id === 'leader-old' ? oldMessage : null) },
    send: async () => {
      // Simuliert eine echte, langsame Discord-API-Antwort: erst dann lässt
      // sich der Nebenläufigkeits-Bug (mehrere Boards pro Chat-Burst) testen.
      if (slowSend) await new Promise((resolve) => setTimeout(resolve, 25));
      sentCount += 1; return newMessage;
    },
  };
  const guild = {
    id: guildId, name: 'Repin Test',
    channels: { cache: new Map([[entry.leaderboardChannelId, channel]]), fetch: async () => channel },
  };
  const store = {
    getLeaderboard: () => [],
    setGuild: (g) => { Object.assign(entry, g); },
    flush: async () => {},
    findLeaderboardMessage: async () => null,
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild },
    channels: { fetch: async () => channel },
    user: { id: 'bot' },
  };
  return { ctx: { client, store, logger: { info() {}, warn() {}, error() {} } }, guild, channel, entry, oldMessage, getSent: () => sentCount };
}

test('repinLeaderboard: sendet das Board neu und löscht die alte Nachricht (kombinierter Modus)', async () => {
  const entry = {
    guildId: 'repin-guild',
    leaderboardChannelId: 'lb',
    leaderboardMessageId: 'leader-old',
    mainChannelId: 'lb', // kombiniert
    lang: 'de',
  };
  const h = repinHarness('repin-guild', entry);

  const ok = await repinLeaderboard(h.ctx, entry, h.guild, { throttle: false });

  assert.equal(ok, true);
  assert.equal(h.getSent(), 1, 'genau eine neue Board-Nachricht');
  assert.equal(entry.leaderboardMessageId, 'leader-new', 'neue Nachricht wird gemerkt');
  assert.equal(h.oldMessage.deleted, true, 'alte Nachricht wird entfernt');
});

test('repinLeaderboard: Throttle verhindert zu häufiges Neu-Senden', async () => {
  const entry = {
    guildId: 'repin-throttle',
    leaderboardChannelId: 'lb',
    leaderboardMessageId: 'leader-old',
    mainChannelId: 'lb',
    lang: 'de',
  };
  const h = repinHarness('repin-throttle', entry);

  const first = await repinLeaderboard(h.ctx, entry, h.guild, { throttle: true });
  const second = await repinLeaderboard(h.ctx, entry, h.guild, { throttle: true });

  assert.equal(first, true);
  assert.equal(second, false, 'zweiter Aufruf innerhalb des Throttles wird übersprungen');
  assert.equal(h.getSent(), 1);
});

test('repinLeaderboard: Message-Burst sendet nur EIN Board (Race-Fix)', async () => {
  const entry = {
    guildId: 'repin-race',
    leaderboardChannelId: 'lb',
    leaderboardMessageId: 'leader-old',
    mainChannelId: 'lb',
    lang: 'de',
  };
  // Langsamer Send simuliert die Discord-API-Latenz: Früher durchliefen alle
  // gleichzeitig eintreffenden Chat-Nachrichten den Throttle-Check, bevor der
  // erste Repin seinen Zeitstempel schrieb → pro Nachricht ein neues Board.
  const h = repinHarness('repin-race', entry, { slowSend: true });

  // Fünf "Nachrichten" kommen praktisch gleichzeitig an (fire-and-forget).
  const results = await Promise.all(
    Array.from({ length: 5 }, () => repinLeaderboard(h.ctx, entry, h.guild, { throttle: true }))
  );

  assert.equal(results.filter(Boolean).length, 1, 'genau ein Repin wird ausgeführt');
  assert.equal(h.getSent(), 1, 'genau EINE neue Board-Nachricht, keine Duplikate');
});

test('repinLeaderboard: throttle:false blockt nicht an einem laufenden Repin vorbei', async () => {
  const entry = {
    guildId: 'repin-lock',
    leaderboardChannelId: 'lb',
    leaderboardMessageId: 'leader-old',
    mainChannelId: 'lb',
    lang: 'de',
  };
  const h = repinHarness('repin-lock', entry, { slowSend: true });

  // Fremd-Nachricht im kombinierten Kanal startet einen Repin; während der
  // Send läuft, feuert ein Level-Up mit throttle:false (z. B. handleLevelChange).
  const [foreign, levelUp] = await Promise.all([
    repinLeaderboard(h.ctx, entry, h.guild, { throttle: true }),
    repinLeaderboard(h.ctx, entry, h.guild, { throttle: false }),
  ]);

  assert.equal(foreign, true);
  assert.equal(levelUp, false, 'Level-Up-Repin während eines laufenden Repins wird übersprungen');
  assert.equal(h.getSent(), 1, 'kein doppeltes Board durch parallele Sends');
});
