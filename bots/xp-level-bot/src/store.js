/**
 * XP Store – RAM-first mit Turso Persistenz.
 * Minimiert reads/writes: alles im RAM, flush nur bei SIGTERM, periodischem Backup (5min) und stündlichem Leaderboard.
 * Robust mit Dirty-Tracking + Batch-Transaktionen.
 */

const fs = require('fs');
const path = require('path');

function createXpStore({ logger, env } = {}) {
  const guilds = new Map(); // guildId -> {guildId, leaderboardChannelId, mainChannelId, lang, leaderboardMessageId, lastDailyDecay}
  const users = new Map(); // guildId -> Map(userId -> {guildId,userId,level,xp,lastXpGain})
  let commandIds = {}; // cmdName -> id
  const guildCommandIds = new Map(); // guildId -> { [cmdName]: id }
  let dirtyMetadata = false;

  const dirtyGuilds = new Set();
  const dirtyUsers = new Set(); // "guildId:userId"
  const deletedUsers = new Set(); // to track deletions for flush
  const deletedGuilds = new Set();
  let db = null;
  let flushInProgress = false;
  let fallbackPath = path.join(__dirname, '..', '..', '..', 'data', 'xp-store.json');
  // alternative path inside xp-level-bot folder for fallback
  let localFallback = path.join(__dirname, '..', 'xp-data.json');

  const envFn = typeof env === 'function' ? env : ((key, fb = '') => process.env[key] ?? fb);
  const tursoUrl = envFn('TURSO_DATABASE_URL', '') || envFn('XP_BOT_TURSO_URL', '') || envFn('XP_TURSO_DATABASE_URL', '') || '';
  const tursoToken = envFn('TURSO_AUTH_TOKEN', '') || envFn('XP_BOT_TURSO_AUTH_TOKEN', '') || envFn('XP_TURSO_AUTH_TOKEN', '') || '';

  async function init() {
    // Try Turso
    if (tursoUrl) {
      try {
        const { createClient } = require('@libsql/client');
        db = createClient({ url: tursoUrl, authToken: tursoToken || undefined });
        logger?.info?.('[xp-level-bot] Verbinde zu Turso...');
        await ensureTables();
        await loadFromDb();
        logger?.info?.(`[xp-level-bot] Turso geladen: ${guilds.size} Gilden, ${[...users.values()].reduce((a,m)=>a+m.size,0)} Nutzer`);
        return;
      } catch (e) {
        logger?.error?.('[xp-level-bot] Turso Verbindung fehlgeschlagen, fallback auf RAM+File:', e.message);
        db = null;
      }
    } else {
      logger?.warn?.('[xp-level-bot] Keine TURSO_DATABASE_URL gesetzt – nutze reinen RAM + Datei-Fallback (Daten gehen bei Crash ohne Backup verloren, aber stündlich wird gesichert).');
    }
    // Fallback file load
    tryLoadFile();
  }

  async function ensureTables() {
    if (!db) return;
    await db.execute(`CREATE TABLE IF NOT EXISTS guild_configs (
      guild_id TEXT PRIMARY KEY,
      leaderboard_channel_id TEXT NOT NULL,
      main_channel_id TEXT NOT NULL,
      lang TEXT NOT NULL,
      leaderboard_message_id TEXT,
      last_daily_decay TEXT,
      level_role_template TEXT,
      level_role_levels TEXT,
      level_role_ids TEXT
    );`);
    // Migration für Bestands-Tabellen (ältere DBs ohne die Level-Rollen-Spalten)
    for (const col of ['level_role_template TEXT', 'level_role_levels TEXT', 'level_role_ids TEXT', 'bonus_state TEXT']) {
      try { await db.execute(`ALTER TABLE guild_configs ADD COLUMN ${col}`); } catch {}
    }
    await db.execute(`CREATE TABLE IF NOT EXISTS user_levels (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      xp INTEGER NOT NULL,
      last_xp_gain INTEGER NOT NULL,
      inactive_days INTEGER,
      last_activity INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );`);
    // Migration für Bestands-Tabellen (ältere DBs ohne Inaktivitäts-/Aktivitäts-Spalten)
    for (const col of ['inactive_days INTEGER', 'last_activity INTEGER']) {
      try { await db.execute(`ALTER TABLE user_levels ADD COLUMN ${col}`); } catch {}
    }
    await db.execute(`CREATE TABLE IF NOT EXISTS bot_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`);
    // Index für schnelle leaderboard queries falls direkt DB genutzt wird
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_user_levels_guild ON user_levels(guild_id);`);
  }

  function parseJsonCol(value, fallback = null) {
    if (value == null || value === '') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  async function loadFromDb() {
    if (!db) return;
    const gRes = await db.execute('SELECT * FROM guild_configs');
    for (const row of gRes.rows) {
      guilds.set(row.guild_id, {
        guildId: row.guild_id,
        leaderboardChannelId: row.leaderboard_channel_id,
        mainChannelId: row.main_channel_id,
        lang: row.lang,
        leaderboardMessageId: row.leaderboard_message_id || null,
        lastDailyDecay: row.last_daily_decay || null,
        levelRoleTemplate: row.level_role_template || null,
        levelRoleLevels: parseJsonCol(row.level_role_levels, null),
        levelRoleIds: parseJsonCol(row.level_role_ids, null),
        bonusState: parseJsonCol(row.bonus_state, null),
      });
    }
    const uRes = await db.execute('SELECT * FROM user_levels');
    for (const row of uRes.rows) {
      let m = users.get(row.guild_id);
      if (!m) { m = new Map(); users.set(row.guild_id, m); }
      m.set(row.user_id, {
        guildId: row.guild_id,
        userId: row.user_id,
        level: row.level,
        xp: row.xp,
        lastXpGain: row.last_xp_gain || 0,
        inactiveDays: row.inactive_days || 0,
        lastActivity: row.last_activity || 0,
      });
    }
    try {
      const metaRes = await db.execute("SELECT key, value FROM bot_metadata WHERE key IN ('command_ids', 'guild_command_ids')");
      for (const row of metaRes.rows) {
        if (row.key === 'command_ids') {
          const parsed = parseJsonCol(row.value, {});
          if (parsed && typeof parsed === 'object') commandIds = { ...parsed };
        } else if (row.key === 'guild_command_ids') {
          const parsed = parseJsonCol(row.value, {});
          if (parsed && typeof parsed === 'object') {
            for (const [gid, ids] of Object.entries(parsed)) guildCommandIds.set(gid, ids);
          }
        }
      }
    } catch (e) {
      logger?.warn?.('[xp-level-bot] Laden der bot_metadata fehlgeschlagen:', e.message);
    }
  }

  function tryLoadFile() {
    let data = null;
    for (const p of [localFallback, fallbackPath]) {
      try {
        if (fs.existsSync(p)) {
          data = JSON.parse(fs.readFileSync(p, 'utf8'));
          logger?.info?.(`[xp-level-bot] Fallback-Datei geladen: ${p}`);
          break;
        }
      } catch {}
    }
    if (!data) return;
    try {
      if (data.guilds) {
        for (const [gid, cfg] of Object.entries(data.guilds)) guilds.set(gid, cfg);
      }
      if (data.users) {
        for (const [gid, umap] of Object.entries(data.users)) {
          const m = new Map();
          for (const [uid, u] of Object.entries(umap)) m.set(uid, u);
          users.set(gid, m);
        }
      }
      if (data.commandIds && typeof data.commandIds === 'object') {
        commandIds = { ...data.commandIds };
      }
      if (data.guildCommandIds && typeof data.guildCommandIds === 'object') {
        for (const [gid, ids] of Object.entries(data.guildCommandIds)) {
          guildCommandIds.set(gid, ids);
        }
      }
    } catch (e) {
      logger?.warn?.('[xp-level-bot] Fallback-Datei korrupt:', e.message);
    }
  }

  function saveToFile() {
    const obj = {
      guilds: Object.fromEntries([...guilds.entries()]),
      users: {},
      commandIds,
      guildCommandIds: Object.fromEntries([...guildCommandIds.entries()]),
    };
    for (const [gid, m] of users.entries()) obj.users[gid] = Object.fromEntries([...m.entries()]);
    const json = JSON.stringify(obj);
    for (const p of [localFallback, fallbackPath]) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, json);
      } catch {}
    }
  }

  // ----------------- Command IDs API -----------------
  function getCommandIds() {
    return { ...commandIds };
  }
  function getCommandId(name) {
    return commandIds[name] || null;
  }
  function setCommandIds(ids) {
    if (ids && typeof ids === 'object') {
      commandIds = { ...commandIds, ...ids };
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getGuildCommandIds(guildId) {
    return guildCommandIds.get(guildId) || null;
  }
  function setGuildCommandIds(guildId, ids) {
    if (guildId && ids && typeof ids === 'object') {
      guildCommandIds.set(guildId, { ...(guildCommandIds.get(guildId) || {}), ...ids });
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function deleteGuildCommandIds(guildId) {
    if (guildId && guildCommandIds.has(guildId)) {
      guildCommandIds.delete(guildId);
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function clearGuildCommandIds() {
    if (guildCommandIds.size > 0) {
      guildCommandIds.clear();
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }

  // ----------------- Guild API -----------------
  function getGuild(guildId) { return guilds.get(guildId) || null; }
  function setGuild(cfg) {
    guilds.set(cfg.guildId, cfg);
    dirtyGuilds.add(cfg.guildId);
    deletedGuilds.delete(cfg.guildId);
  }
  function deleteGuild(guildId) {
    guilds.delete(guildId);
    users.delete(guildId);
    guildCommandIds.delete(guildId);
    dirtyGuilds.delete(guildId);
    deletedGuilds.add(guildId);
  }
  function getAllGuilds() { return [...guilds.values()]; }
  function getGuildIds() { return [...guilds.keys()]; }

  // ----------------- User API -----------------
  function getUser(guildId, userId) {
    const m = users.get(guildId);
    if (!m) return null;
    return m.get(userId) || null;
  }
  function ensureUser(guildId, userId) {
    let m = users.get(guildId);
    if (!m) { m = new Map(); users.set(guildId, m); }
    let u = m.get(userId);
    if (!u) {
      u = { guildId, userId, level: 1, xp: 0, lastXpGain: 0, inactiveDays: 0, lastActivity: 0 };
      m.set(userId, u);
      dirtyUsers.add(`${guildId}:${userId}`);
    }
    return u;
  }
  function setUser(user) {
    let m = users.get(user.guildId);
    if (!m) { m = new Map(); users.set(user.guildId, m); }
    m.set(user.userId, user);
    dirtyUsers.add(`${user.guildId}:${user.userId}`);
    deletedUsers.delete(`${user.guildId}:${user.userId}`);
  }
  function deleteUser(guildId, userId) {
    const m = users.get(guildId);
    if (m) m.delete(userId);
    dirtyUsers.delete(`${guildId}:${userId}`);
    deletedUsers.add(`${guildId}:${userId}`);
  }
  function getUsersForGuild(guildId) {
    const m = users.get(guildId);
    if (!m) return [];
    return [...m.values()];
  }
  function getLeaderboard(guildId, limit = 15) {
    const list = getUsersForGuild(guildId);
    list.sort((a,b) => {
      if (b.level !== a.level) return b.level - a.level;
      if (b.xp !== a.xp) return b.xp - a.xp;
      // tie breaker: userId lexical for determinism
      return a.userId.localeCompare(b.userId);
    });
    return list.slice(0, limit);
  }
  function getRank(guildId, userId) {
    const list = getUsersForGuild(guildId);
    list.sort((a,b) => b.level - a.level || b.xp - a.xp);
    const idx = list.findIndex(u => u.userId === userId);
    if (idx === -1) return null;
    return { rank: idx+1, total: list.length, user: list[idx] };
  }
  function getAllUsersCount() {
    let c=0; for(const m of users.values()) c+=m.size; return c;
  }

  // ----------------- Persistence -----------------
  async function flush({ force = false } = {}) {
    if (flushInProgress) return;
    if (!dirtyGuilds.size && !dirtyUsers.size && !deletedUsers.size && !deletedGuilds.size && !dirtyMetadata && !force) return;
    flushInProgress = true;
    const start = Date.now();
    try {
      if (db) {
        // Use transaction batch
        const statements = [];
        // deletions
        for (const gid of deletedGuilds) {
          statements.push({ sql: 'DELETE FROM guild_configs WHERE guild_id = ?', args: [gid] });
          statements.push({ sql: 'DELETE FROM user_levels WHERE guild_id = ?', args: [gid] });
        }
        for (const key of deletedUsers) {
          const [gid, uid] = key.split(':');
          statements.push({ sql: 'DELETE FROM user_levels WHERE guild_id = ? AND user_id = ?', args: [gid, uid] });
        }
        // upserts guilds
        for (const gid of dirtyGuilds) {
          const g = guilds.get(gid);
          if (!g) continue;
          statements.push({
            sql: `INSERT INTO guild_configs (guild_id, leaderboard_channel_id, main_channel_id, lang, leaderboard_message_id, last_daily_decay, level_role_template, level_role_levels, level_role_ids, bonus_state)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET
                    leaderboard_channel_id=excluded.leaderboard_channel_id,
                    main_channel_id=excluded.main_channel_id,
                    lang=excluded.lang,
                    leaderboard_message_id=excluded.leaderboard_message_id,
                    last_daily_decay=excluded.last_daily_decay,
                    level_role_template=excluded.level_role_template,
                    level_role_levels=excluded.level_role_levels,
                    level_role_ids=excluded.level_role_ids,
                    bonus_state=excluded.bonus_state`,
            args: [
              g.guildId,
              g.leaderboardChannelId || '',
              g.mainChannelId || '',
              g.lang || 'de',
              g.leaderboardMessageId || null,
              g.lastDailyDecay || null,
              g.levelRoleTemplate || null,
              g.levelRoleLevels ? JSON.stringify(g.levelRoleLevels) : null,
              g.levelRoleIds ? JSON.stringify(g.levelRoleIds) : null,
              g.bonusState ? JSON.stringify(g.bonusState) : null,
            ]
          });
        }
        for (const key of dirtyUsers) {
          const [gid, uid] = key.split(':');
          const m = users.get(gid);
          const u = m?.get(uid);
          if (!u) continue;
          statements.push({
            sql: `INSERT INTO user_levels (guild_id, user_id, level, xp, last_xp_gain, inactive_days, last_activity)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    level=excluded.level, xp=excluded.xp, last_xp_gain=excluded.last_xp_gain,
                    inactive_days=excluded.inactive_days, last_activity=excluded.last_activity`,
            args: [u.guildId, u.userId, u.level, u.xp, u.lastXpGain || 0, u.inactiveDays || 0, u.lastActivity || 0]
          });
        }
        if (dirtyMetadata) {
          statements.push({
            sql: `INSERT INTO bot_metadata (key, value) VALUES ('command_ids', ?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(commandIds)],
          });
          statements.push({
            sql: `INSERT INTO bot_metadata (key, value) VALUES ('guild_command_ids', ?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(Object.fromEntries([...guildCommandIds.entries()]))],
          });
          dirtyMetadata = false;
        }
        if (statements.length) {
          // batch execute in chunks of 50 to avoid too large
          const chunk = 50;
          for (let i=0; i<statements.length; i+=chunk) {
            const batch = statements.slice(i, i+chunk);
            await db.batch(batch);
          }
          logger?.info?.(`[xp-level-bot] Flush: ${statements.length} ops in ${Date.now()-start}ms (guilds:${dirtyGuilds.size} users:${dirtyUsers.size} delG:${deletedGuilds.size} delU:${deletedUsers.size})`);
        }
        dirtyGuilds.clear();
        dirtyUsers.clear();
        deletedGuilds.clear();
        deletedUsers.clear();
        // also save to file as backup (parallel)
        try { saveToFile(); } catch {}
      } else {
        // no DB, just file backup
        saveToFile();
        const flushedG = dirtyGuilds.size;
        const flushedU = dirtyUsers.size;
        dirtyGuilds.clear(); dirtyUsers.clear(); deletedGuilds.clear(); deletedUsers.clear(); dirtyMetadata = false;
        logger?.info?.(`[xp-level-bot] File-Backup gesichert (guilds:${flushedG} users:${flushedU}) in ${Date.now()-start}ms`);
      }
    } catch (e) {
      logger?.error?.('[xp-level-bot] Flush fehlgeschlagen:', e.message);
    } finally {
      flushInProgress = false;
    }
  }

  // Periodic auto flush every 5 minutes as safety net (Render crash backup)
  let backupTimer = null;
  function startBackupInterval(ms = 5*60*1000) {
    if (backupTimer) clearInterval(backupTimer);
    backupTimer = setInterval(() => { void flush(); }, ms);
    if (backupTimer.unref) backupTimer.unref();
  }
  function stopBackupInterval() { if (backupTimer) clearInterval(backupTimer); }

  // For scanning leaderboard message like birthday bot
  async function findLeaderboardMessage(guild, client) {
    const { ChannelType } = require('discord.js');
    const marker = 'xp_leader::v1::';
    let channels;
    try { channels = await guild.channels.fetch(); } catch { return null; }
    for (const channel of channels.filter(c => c.type === ChannelType.GuildText && c.viewable).values()) {
      try {
        // 100 Nachrichten scannen, damit die Leaderboard-Nachricht auch in
        // sehr aktiven Kanälen zuverlässig gefunden wird (sie wandert nach
        // unten, je mehr neue Nachrichten dazukommen)
        const messages = await channel.messages.fetch({ limit: 100 });
        const found = messages.find(m => m.author?.id === client.user.id && JSON.stringify(m.components||[]).includes(marker));
        if (found) return { channel, message: found };
      } catch {}
    }
    return null;
  }

  return {
    init,
    getGuild, setGuild, deleteGuild, getAllGuilds, getGuildIds,
    getUser, ensureUser, setUser, deleteUser, getUsersForGuild, getLeaderboard, getRank, getAllUsersCount,
    getCommandIds, getCommandId, setCommandIds, getGuildCommandIds, setGuildCommandIds, deleteGuildCommandIds, clearGuildCommandIds,
    flush,
    startBackupInterval, stopBackupInterval,
    findLeaderboardMessage,
    _guilds: guilds,
    _users: users,
    _dirtyGuilds: dirtyGuilds,
    _dirtyUsers: dirtyUsers,
    _db: () => db,
  };
}

module.exports = { createXpStore };
