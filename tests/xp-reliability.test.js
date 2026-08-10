const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sendLevelAnnouncement } = require('../bots/xp-level-bot/src/level-announcements');
const { createXpStore } = require('../bots/xp-level-bot/src/store');
const {
  runLeaderboardTick,
  refreshLeaderboard,
  syncMapsFromEntry,
  _lastLeaderboardRefresh,
  _lastHourlyRefresh,
  _lastLeaderboardAttempt,
  LEADERBOARD_HOURLY_MS,
} = require('../bots/xp-level-bot/src/scheduler');

function loggerHarness() {
  const logs = [];
  return {
    logs,
    logger: {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  };
}

function announcementHarness() {
  const { logger, logs } = loggerHarness();
  const mainSends = [];
  const systemSends = [];
  const main = {
    id: 'main',
    isTextBased: () => true,
    send: async (payload) => { mainSends.push(payload); return { id: 'main-msg' }; },
  };
  const systemChannel = {
    id: 'system',
    isTextBased: () => true,
    send: async (payload) => { systemSends.push(payload); return { id: 'system-msg' }; },
  };
  const guild = {
    id: 'guild',
    name: 'Testserver',
    systemChannel,
    channels: {
      cache: new Map([['main', main]]),
      fetch: async (id) => (id === 'main' ? main : null),
    },
  };
  const cfg = { guildId: 'guild', mainChannelId: 'main', lang: 'de' };
  return { ctx: { logger }, logs, guild, cfg, main, mainSends, systemSends };
}

test('Level-Up aus Text antwortet auf die auslösende Nachricht – unabhängig vom Channel', async () => {
  const h = announcementHarness();
  const replies = [];
  const sourceSends = [];
  const sourceMsg = {
    channel: {
      id: 'beliebiger-channel',
      isTextBased: () => true,
      send: async (payload) => { sourceSends.push(payload); },
    },
    reply: async (payload) => { replies.push(payload); return { id: 'reply' }; },
  };

  const result = await sendLevelAnnouncement({
    ctx: h.ctx,
    guild: h.guild,
    cfg: h.cfg,
    userId: '123',
    res: { leveledUp: true, level: 2, xp: 0 },
    sourceMsg,
    source: 'text',
  });

  assert.equal(result.sent, true);
  assert.equal(result.destination, 'source-reply');
  assert.equal(replies.length, 1);
  assert.equal(sourceSends.length, 0);
  assert.equal(h.mainSends.length, 0);
  assert.match(JSON.stringify(replies[0]), /<@123>/);
});

test('Level-Up Reply fällt bei Components-Fehler am selben Ziel auf Plain-Text zurück', async () => {
  const h = announcementHarness();
  const replies = [];
  const sourceMsg = {
    channel: { isTextBased: () => true, send: async () => assert.fail('channel.send nicht nötig') },
    reply: async (payload) => {
      replies.push(payload);
      if (replies.length === 1) throw new Error('Components V2 rejected');
      return { id: 'plain-reply' };
    },
  };

  const result = await sendLevelAnnouncement({
    ctx: h.ctx,
    guild: h.guild,
    cfg: h.cfg,
    userId: '123',
    res: { leveledUp: true, level: 3, xp: 0 },
    sourceMsg,
    source: 'text',
  });

  assert.equal(result.destination, 'source-reply');
  assert.equal(replies.length, 2);
  assert.match(replies[1].content, /Level 3/);
  assert.equal(h.mainSends.length, 0);
});

test('Text-Level-Up nutzt Haupt-Chat, wenn Reply und Quellkanal nicht sendbar sind', async () => {
  const h = announcementHarness();
  const sourceMsg = {
    channel: {
      isTextBased: () => true,
      send: async () => { throw new Error('Missing Access'); },
    },
    reply: async () => { throw new Error('Missing Access'); },
  };

  const result = await sendLevelAnnouncement({
    ctx: h.ctx,
    guild: h.guild,
    cfg: h.cfg,
    userId: '123',
    res: { leveledUp: true, level: 4, xp: 0 },
    sourceMsg,
    source: 'text',
  });

  assert.equal(result.destination, 'main-channel');
  assert.equal(h.mainSends.length, 1);
});

test('Voice-/Bonus-Level-Up und Level-Down gehen direkt in den /setup-Haupt-Chat', async () => {
  for (const [source, res] of [
    ['voice', { leveledUp: true, level: 5, xp: 0 }],
    ['bonus', { leveledUp: true, level: 6, xp: 0 }],
    ['decay', { leveledDown: true, level: 4, xp: 70 }],
  ]) {
    const h = announcementHarness();
    let replyCalls = 0;
    const result = await sendLevelAnnouncement({
      ctx: h.ctx,
      guild: h.guild,
      cfg: h.cfg,
      userId: '123',
      res,
      sourceMsg: { reply: async () => { replyCalls += 1; } },
      source,
    });
    assert.equal(result.destination, 'main-channel', source);
    assert.equal(h.mainSends.length, 1, source);
    assert.equal(replyCalls, 0, source);
  }
});

function leaderboardHarness(guildId, entry) {
  const { logger, logs } = loggerHarness();
  let edits = 0;
  const message = {
    id: 'leader-message',
    edit: async () => { edits += 1; return message; },
    delete: async () => {},
  };
  const channel = {
    id: 'leader-channel',
    isTextBased: () => true,
    messages: { fetch: async () => message },
    send: async () => ({ id: 'replacement' }),
  };
  const guild = {
    id: guildId,
    name: 'Leaderboard Test',
    channels: {
      cache: new Map([['leader-channel', channel]]),
      fetch: async () => channel,
    },
  };
  const store = {
    getAllGuilds: () => [entry],
    getLeaderboard: () => [],
    setGuild: () => {},
    flush: async () => {},
    deleteGuild: () => {},
    findLeaderboardMessage: async () => null,
  };
  const client = {
    guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild },
    channels: { fetch: async () => channel },
    user: { id: 'bot' },
  };
  return {
    ctx: { client, store, logger },
    guild,
    channel,
    logs,
    editCount: () => edits,
  };
}

test('echter Stunden-Tick läuft trotz eines viel neueren Level-Up-Timestamps', async () => {
  const guildId = 'scheduler-hourly-proof';
  _lastLeaderboardRefresh.delete(guildId);
  _lastHourlyRefresh.delete(guildId);
  _lastLeaderboardAttempt.delete(guildId);
  const now = Date.now();
  const entry = {
    guildId,
    leaderboardChannelId: 'leader-channel',
    leaderboardMessageId: 'leader-message',
    mainChannelId: 'main',
    lang: 'de',
    lastDailyDecay: 'irrelevant',
    // Level-Up erst vor einer Minute, Stunden-Edit aber vor 55 Minuten.
    lastLeaderboardRefresh: now - 60_000,
    lastHourlyLeaderboardRefresh: now - LEADERBOARD_HOURLY_MS,
  };
  const h = leaderboardHarness(guildId, entry);
  syncMapsFromEntry(entry);

  await runLeaderboardTick(h.ctx, new Date(now));

  assert.equal(h.editCount(), 1, 'Stunden-Scheduler muss editieren');
  assert.ok(entry.lastHourlyLeaderboardRefresh > now - 10_000, 'eigener Stunden-Timestamp wurde erneuert');
});

test('Level-Up-Refresh verändert den persistierten Stunden-Timestamp nicht', async () => {
  const guildId = 'scheduler-level-proof';
  _lastLeaderboardRefresh.delete(guildId);
  _lastHourlyRefresh.delete(guildId);
  const hourlyAt = Date.now() - 20 * 60 * 1000;
  const entry = {
    guildId,
    leaderboardChannelId: 'leader-channel',
    leaderboardMessageId: 'leader-message',
    mainChannelId: 'main',
    lang: 'de',
    lastHourlyLeaderboardRefresh: hourlyAt,
  };
  const h = leaderboardHarness(guildId, entry);

  const success = await refreshLeaderboard(h.ctx, entry, h.guild, new Date(), { isHourly: false });

  assert.equal(success, true);
  assert.equal(entry.lastHourlyLeaderboardRefresh, hourlyAt);
  assert.ok(entry.lastLeaderboardRefresh > hourlyAt);
});

test('Store verliert Änderungen während eines laufenden Turso-Flushs nicht', async () => {
  const { logger } = loggerHarness();
  const store = createXpStore({
    logger,
    env: (key, fallback = '') => {
      if (key === 'TURSO_DATABASE_URL') return 'file::memory:';
      if (key === 'XP_STORE_DISABLE_FILE_BACKUP') return 'true';
      return fallback;
    },
  });
  await store.init();
  const db = store._db();
  const realBatch = db.batch.bind(db);

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  let signalSecondDone;
  const secondDone = new Promise((resolve) => { signalSecondDone = resolve; });
  let batches = 0;

  db.batch = async (...args) => {
    batches += 1;
    const thisBatch = batches;
    if (thisBatch === 1) {
      signalFirstStarted();
      await firstGate;
    }
    const result = await realBatch(...args);
    if (thisBatch === 2) signalSecondDone();
    return result;
  };

  const cfg = {
    guildId: 'concurrent-flush',
    leaderboardChannelId: 'leader',
    mainChannelId: 'main',
    lang: 'de',
    lastHourlyLeaderboardRefresh: 1,
  };
  store.setGuild(cfg);
  const firstFlush = store.flush();
  await firstStarted;

  // Exakt der Problemfall: Der Stunden-Timestamp ändert sich, während Turso
  // noch den vorigen Snapshot schreibt.
  cfg.lastHourlyLeaderboardRefresh = 2;
  store.setGuild(cfg);
  await store.flush();
  releaseFirst();
  await firstFlush;
  await secondDone;

  const result = await db.execute({
    sql: 'SELECT last_hourly_leaderboard_refresh FROM guild_configs WHERE guild_id = ?',
    args: [cfg.guildId],
  });
  assert.equal(batches, 2, 'Änderung wurde automatisch in einem Folge-Batch geschrieben');
  assert.equal(Number(result.rows[0].last_hourly_leaderboard_refresh), 2);
});
