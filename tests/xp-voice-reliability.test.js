const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createXpStore } = require('../bots/xp-level-bot/src/store');
const {
  createVoiceTracker,
  VOICE_XP_PER_MINUTE,
  VOICE_SCAN_INTERVAL_MS,
} = require('../bots/xp-level-bot/src/voice');

function makeStore() {
  const store = createXpStore({
    env: (key, fallback = '') => key === 'XP_STORE_DISABLE_FILE_BACKUP' ? 'true' : fallback,
  });
  store.setGuild({
    guildId: 'g1',
    leaderboardChannelId: 'leaderboard',
    mainChannelId: 'main',
    lang: 'de',
    // Nickname-REST-Arbeit gehört nicht zum Voice-Tracker-Test.
    nicknamesEnabled: false,
  });
  return store;
}

function human(id, channelId = 'vc') {
  return {
    id,
    user: { id, username: id, bot: false },
    voice: { channelId },
    roles: { cache: new Map() },
  };
}

function makeHarness({ voiceStateMembers = [], channelMembers = [], startNow = 1_000_000 } = {}) {
  let clock = startNow;
  const store = makeStore();
  const voiceStates = new Map();
  const memberCache = new Map();
  for (const member of voiceStateMembers) {
    memberCache.set(member.id, member);
    voiceStates.set(member.id, {
      id: member.id,
      channelId: member.voice.channelId,
      member,
    });
  }
  for (const member of channelMembers) memberCache.set(member.id, member);

  const channelMemberMap = new Map(channelMembers.map((member) => [member.id, member]));
  const voiceChannel = {
    id: 'vc',
    isVoiceBased: () => true,
    members: channelMemberMap,
  };
  const guild = {
    id: 'g1',
    name: 'Voice Reliability',
    ownerId: 'owner',
    voiceStates: { cache: voiceStates },
    channels: {
      cache: new Map([['vc', voiceChannel]]),
      fetch: async () => null,
    },
    members: {
      cache: memberCache,
      me: null,
      fetch: async (id) => {
        const member = memberCache.get(id);
        if (!member) throw new Error('Unknown Member');
        return member;
      },
    },
  };
  const client = new EventEmitter();
  client.guilds = { cache: new Map([['g1', guild]]) };
  client.user = { id: 'bot' };
  const logs = [];
  const tracker = createVoiceTracker({
    client,
    store,
    getGuildConfig: (guildId) => store.getGuild(guildId),
    now: () => clock,
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  });

  return {
    store,
    guild,
    client,
    tracker,
    logs,
    setClock(value) { clock = value; },
    advance(ms) { clock += ms; },
  };
}

test('Voice V3: bestehender Call wird direkt aus VoiceStates rekonstruiert, ohne Channel-REST-Abhängigkeit', async () => {
  const member = human('u1');
  const h = makeHarness({ voiceStateMembers: [member] });
  // Der Channel-Cache darf für die XP-Entscheidung sogar fehlen. Der aktuelle
  // VoiceState mit channelId ist bereits die autoritative Anwesenheit.
  h.guild.channels.cache.clear();

  assert.equal(h.tracker.populateAllSessions(), 1);
  assert.ok(h.tracker.sessions.has('g1:u1'));
  h.advance(60_001);
  const result = await h.tracker.tickMinute();

  assert.equal(result.grantedMinutes, 1);
  assert.equal(h.store.getUser('g1', 'u1').xp, VOICE_XP_PER_MINUTE);
});

test('Voice V3: channel.members heilt einen leeren VoiceState-Cache', async () => {
  const member = human('u2');
  const h = makeHarness({ channelMembers: [member] });
  assert.equal(h.guild.voiceStates.cache.size, 0);

  assert.equal(h.tracker.populateAllSessions(), 1);
  h.advance(60_000);
  await h.tracker.tickMinute();

  assert.equal(h.store.getUser('g1', 'u2').xp, 10);
});

test('Voice V3: ein Voice-Channel-Wechsel setzt die laufende XP-Minute nicht zurück', async () => {
  const member = human('u3', 'vc');
  const h = makeHarness({ voiceStateMembers: [member] });
  h.tracker.populateAllSessions();
  const before = h.tracker.sessions.get('g1:u3').lastMinuteStart;

  h.advance(45_000);
  member.voice.channelId = 'vc2';
  h.guild.voiceStates.cache.get('u3').channelId = 'vc2';
  h.tracker.onVoiceStateUpdate(
    { guild: h.guild, id: 'u3', channelId: 'vc', member },
    { guild: h.guild, id: 'u3', channelId: 'vc2', member }
  );

  const session = h.tracker.sessions.get('g1:u3');
  assert.equal(session.channelId, 'vc2');
  assert.equal(session.lastMinuteStart, before, '45 Sekunden Anwesenheit dürfen nicht verloren gehen');
});

test('Voice V3: verspäteter Watchdog holt vollständig abgelaufene Minuten nach', async () => {
  const member = human('u4');
  const h = makeHarness({ voiceStateMembers: [member] });
  h.tracker.populateAllSessions();

  h.advance(2 * 60_000 + 5_000);
  const result = await h.tracker.tickMinute();

  assert.equal(result.grantedMinutes, 2);
  assert.equal(h.store.getUser('g1', 'u4').xp, 20);
  assert.equal(h.tracker.stats.grantedMinutes, 2);
  assert.equal(h.tracker.stats.grantedXp, 20);
});

test('Voice V3: parallele Watchdog-Ticks können keine doppelten XP vergeben', async () => {
  const member = human('u5');
  const h = makeHarness({ voiceStateMembers: [member] });
  h.tracker.populateAllSessions();
  h.advance(60_000);

  const first = h.tracker.tickMinute();
  const second = await h.tracker.tickMinute();
  const firstResult = await first;

  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already-running');
  assert.equal(firstResult.grantedMinutes, 1);
  assert.equal(h.store.getUser('g1', 'u5').xp, 10);
  assert.equal(h.tracker.stats.skippedOverlappingTicks, 1);
});

test('Voice V3: start ist idempotent und lauscht schon vor einem späteren Ready-Bootstrap', () => {
  const h = makeHarness();
  h.client.guilds.cache.clear(); // simuliert create() vor client.login()/Ready

  assert.equal(h.tracker.start(), true);
  assert.equal(h.tracker.start(), false);
  assert.equal(h.client.listenerCount('voiceStateUpdate'), 1);
  assert.equal(VOICE_SCAN_INTERVAL_MS, 15_000);

  h.tracker.stop();
  assert.equal(h.client.listenerCount('voiceStateUpdate'), 0);
});
