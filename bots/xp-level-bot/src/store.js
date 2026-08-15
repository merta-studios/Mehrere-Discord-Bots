/**
 * XP Store – RAM-first mit Turso Persistenz.
 * Minimiert reads/writes: alles im RAM, flush nur bei SIGTERM, periodischem Backup (5min) und stündlichem Leaderboard.
 * Robust mit Dirty-Tracking + Batch-Transaktionen.
 */

const fs = require('fs');
const path = require('path');

const { extractAllText } = require('./embed-builder');
const { decodeHidden } = require('./zw-marker');
const LEADERBOARD_MARKER = 'xp_leader::v1::';

function createXpStore({ logger, env } = {}) {
  const guilds = new Map(); // guildId -> {guildId, leaderboardChannelId, mainChannelId, lang, leaderboardMessageId, lastDailyDecay, nicknamesEnabled, inactiveRoleEnabled, inactiveRoleDays, inactiveRoleId}
  const users = new Map(); // guildId -> Map(userId -> {guildId,userId,level,xp,lastXpGain})
  // Invite-XP: Snapshot aller Invites (code -> uses) pro Server + Leave-Log für
  // den 7-Tage-Rejoin-Schutz. Beides MUSS das Löschen von User-Daten überleben
  // (guildMemberRemove löscht user_levels), deshalb eigene Tabellen/Maps.
  const inviteSnapshots = new Map(); // guildId -> { data: {code:uses}, updatedAt }
  const inviteLeaves = new Map();    // guildId -> Map(userId -> leftAt)
  let commandIds = {}; // cmdName -> id  (NUR globale Command-IDs!)
  const guildCommandIds = new Map(); // guildId -> { [cmdName]: id } (nur Dev-Gilde)
  // Merkt sich, in welchem Scope die gespeicherten IDs zuletzt registriert wurden:
  //   'global'      -> commandIds enthält echte globale Snowflakes
  //   'guild:<id>'  -> commandIds darf NICHT als global behandelt werden (nur Guild-Slot vertrauenswürdig)
  let commandIdScope = null;
  let dirtyMetadata = false;

  const dirtyGuilds = new Set();
  const dirtyUsers = new Set(); // "guildId:userId"
  const deletedUsers = new Set(); // to track deletions for flush
  const deletedGuilds = new Set();
  const dirtyInviteSnapshots = new Set(); // guildId
  const dirtyInviteLeaves = new Set();    // "guildId:userId"
  const deletedInviteLeaves = new Set();  // "guildId:userId"
  let db = null;
  let flushInProgress = false;
  let flushRequested = false;
  let fallbackPath = path.join(__dirname, '..', '..', '..', 'data', 'xp-store.json');
  // alternative path inside xp-level-bot folder for fallback
  let localFallback = path.join(__dirname, '..', 'xp-data.json');

  const envFn = typeof env === 'function' ? env : ((key, fb = '') => process.env[key] ?? fb);
  const tursoUrl = envFn('TURSO_DATABASE_URL', '') || envFn('XP_BOT_TURSO_URL', '') || envFn('XP_TURSO_DATABASE_URL', '') || '';
  const tursoToken = envFn('TURSO_AUTH_TOKEN', '') || envFn('XP_BOT_TURSO_AUTH_TOKEN', '') || envFn('XP_TURSO_AUTH_TOKEN', '') || '';
  // Nur für isolierte Tests; im normalen Betrieb bleibt das zusätzliche
  // File-Backup immer aktiv.
  const disableFileBackup = envFn('XP_STORE_DISABLE_FILE_BACKUP', '') === 'true';

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
      level_role_ids TEXT,
      bonus_state TEXT,
      last_leaderboard_refresh INTEGER,
      last_hourly_leaderboard_refresh INTEGER,
      nicknames_enabled INTEGER,
      inactive_role_enabled INTEGER,
      inactive_role_days INTEGER,
      inactive_role_id TEXT
    );`);
    // Migration für Bestands-Tabellen. Allgemeiner und stündlicher
    // Leaderboard-Zeitstempel sind absichtlich getrennt: Level-Ups dürfen den
    // echten Stunden-Timer nicht nach hinten verschieben.
    for (const col of [
      'level_role_template TEXT',
      'level_role_levels TEXT',
      'level_role_ids TEXT',
      'bonus_state TEXT',
      'last_leaderboard_refresh INTEGER',
      'last_hourly_leaderboard_refresh INTEGER',
      'nicknames_enabled INTEGER',
      'inactive_role_enabled INTEGER',
      'inactive_role_days INTEGER',
      'inactive_role_id TEXT',
    ]) {
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
    // Invite-XP: Invite-Snapshots (code -> uses) und Leave-Log für den
    // 7-Tage-Rejoin-Schutz. Bewusst getrennt von user_levels, weil Nutzerdaten
    // beim Verlassen gelöscht werden – das Leave-Log muss das überleben.
    await db.execute(`CREATE TABLE IF NOT EXISTS invite_snapshots (
      guild_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
    await db.execute(`CREATE TABLE IF NOT EXISTS invite_leave_log (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      left_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );`);
    // Index für schnelle leaderboard queries falls direkt DB genutzt wird
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_user_levels_guild ON user_levels(guild_id);`);
  }

  function parseJsonCol(value, fallback = null) {
    if (value == null || value === '') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  /**
   * Standard: an. Nur ein explizites Aus schaltet die Tags ab.
   * Turso/libsql liefert INTEGER oft als BigInt (0n !== 0) – das hat nach
   * Restarts /toggle_nicknames off wieder als „an“ interpretiert.
   */
  function parseNicknamesEnabled(value) {
    if (value == null || value === '') return true;
    if (typeof value === 'bigint') return value !== 0n;
    if (typeof value === 'number') return value !== 0 && Number.isFinite(value);
    if (typeof value === 'boolean') return value;
    const s = String(value).trim().toLowerCase();
    return !(s === '0' || s === 'false' || s === 'off' || s === 'no');
  }

  /** Standard: aus. Nur ein explizites true/1 schaltet die Inaktiv-Rolle ein. */
  function parseInactiveRoleEnabled(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
  }

  function parseInactiveRoleDays(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
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
        lastLeaderboardRefresh: row.last_leaderboard_refresh ? Number(row.last_leaderboard_refresh) : null,
        lastLeaderboardUpdate: row.last_leaderboard_refresh ? Number(row.last_leaderboard_refresh) : null,
        lastHourlyLeaderboardRefresh: row.last_hourly_leaderboard_refresh
          ? Number(row.last_hourly_leaderboard_refresh)
          : null,
        nicknamesEnabled: parseNicknamesEnabled(row.nicknames_enabled),
        inactiveRoleEnabled: parseInactiveRoleEnabled(row.inactive_role_enabled),
        inactiveRoleDays: parseInactiveRoleDays(row.inactive_role_days),
        inactiveRoleId: row.inactive_role_id || null,
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
      const metaRes = await db.execute("SELECT key, value FROM bot_metadata WHERE key IN ('command_ids', 'guild_command_ids', 'command_id_scope')");
      for (const row of metaRes.rows) {
        if (row.key === 'command_ids') {
          const parsed = parseJsonCol(row.value, {});
          if (parsed && typeof parsed === 'object') commandIds = { ...parsed };
        } else if (row.key === 'guild_command_ids') {
          const parsed = parseJsonCol(row.value, {});
          if (parsed && typeof parsed === 'object') {
            for (const [gid, ids] of Object.entries(parsed)) guildCommandIds.set(gid, ids);
          }
        } else if (row.key === 'command_id_scope') {
          const parsed = parseJsonCol(row.value, null);
          if (typeof parsed === 'string' && parsed !== '') commandIdScope = parsed;
        }
      }
    } catch (e) {
      logger?.warn?.('[xp-level-bot] Laden der bot_metadata fehlgeschlagen:', e.message);
    }
    // Invite-XP Daten nachladen (Snapshots + Leave-Log)
    try {
      const invRes = await db.execute('SELECT guild_id, data, updated_at FROM invite_snapshots');
      for (const row of invRes.rows) {
        const data = parseJsonCol(row.data, {});
        if (data && typeof data === 'object') {
          inviteSnapshots.set(row.guild_id, { data, updatedAt: Number(row.updated_at) || 0 });
        }
      }
      const leaveRes = await db.execute('SELECT guild_id, user_id, left_at FROM invite_leave_log');
      for (const row of leaveRes.rows) {
        let m = inviteLeaves.get(row.guild_id);
        if (!m) { m = new Map(); inviteLeaves.set(row.guild_id, m); }
        m.set(row.user_id, Number(row.left_at) || 0);
      }
    } catch (e) {
      logger?.warn?.('[xp-level-bot] Laden der Invite-XP Daten fehlgeschlagen:', e.message);
    }
  }

  function tryLoadFile() {
    if (disableFileBackup) return;
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
        for (const [gid, cfg] of Object.entries(data.guilds)) {
          const next = cfg && typeof cfg === 'object' ? { ...cfg } : { guildId: gid };
          next.guildId = next.guildId || gid;
          next.nicknamesEnabled = parseNicknamesEnabled(next.nicknamesEnabled);
          guilds.set(String(gid), next);
        }
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
      if (data.commandIdScope && typeof data.commandIdScope === 'string') {
        commandIdScope = data.commandIdScope;
      }
      if (data.guildCommandIds && typeof data.guildCommandIds === 'object') {
        for (const [gid, ids] of Object.entries(data.guildCommandIds)) {
          guildCommandIds.set(gid, ids);
        }
      }
      if (data.inviteSnapshots && typeof data.inviteSnapshots === 'object') {
        for (const [gid, snap] of Object.entries(data.inviteSnapshots)) {
          const dataMap = snap && typeof snap === 'object' && snap.data ? snap.data : snap;
          if (dataMap && typeof dataMap === 'object') {
            inviteSnapshots.set(String(gid), { data: { ...dataMap }, updatedAt: Number(snap?.updatedAt) || 0 });
          }
        }
      }
      if (data.inviteLeaves && typeof data.inviteLeaves === 'object') {
        for (const [gid, umap] of Object.entries(data.inviteLeaves)) {
          if (!umap || typeof umap !== 'object') continue;
          const m = new Map();
          for (const [uid, leftAt] of Object.entries(umap)) m.set(uid, Number(leftAt) || 0);
          inviteLeaves.set(gid, m);
        }
      }
    } catch (e) {
      logger?.warn?.('[xp-level-bot] Fallback-Datei korrupt:', e.message);
    }
  }

  function saveToFile() {
    if (disableFileBackup) return;
    const obj = {
      guilds: Object.fromEntries([...guilds.entries()]),
      users: {},
      commandIds,
      commandIdScope,
      guildCommandIds: Object.fromEntries([...guildCommandIds.entries()]),
      inviteSnapshots: {},
      inviteLeaves: {},
    };
    for (const [gid, m] of users.entries()) obj.users[gid] = Object.fromEntries([...m.entries()]);
    for (const [gid, snap] of inviteSnapshots.entries()) obj.inviteSnapshots[gid] = { ...snap };
    for (const [gid, m] of inviteLeaves.entries()) obj.inviteLeaves[gid] = Object.fromEntries([...m.entries()]);
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
      // ERSTZEN statt mergen: `ids` ist immer die vollständige, autoritative
      // Liste von Discord (PUT-Antwort oder REST-GET). Verwaiste Snowflakes
      // (z.B. /update_leaderboard, das Discord neu angelegt hat) dürfen beim
      // Merge sonst als alte ID überleben und in /help „Kein Befehl gefunden"
      // auslösen.
      commandIds = { ...ids };
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getCommandIdScope() {
    return commandIdScope;
  }
  function setCommandIdScope(scope) {
    if (typeof scope === 'string') {
      commandIdScope = scope;
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getGuildCommandIds(guildId) {
    return guildCommandIds.get(guildId) || null;
  }
  function getAllGuildCommandIds() {
    return Object.fromEntries([...guildCommandIds.entries()]);
  }
  function setGuildCommandIds(guildId, ids) {
    if (guildId && ids && typeof ids === 'object') {
      // ERSETZEN statt mergen – analog zu setCommandIds. `ids` ist immer die
      // vollständige, autoritative Antwort von Discord (PUT/GET). Beim Merge
      // überlebten verwaiste Guild-Snowflakes (z. B. gelöschte & von Discord
      // mit neuer ID neu angelegte Commands) und wurden in /help als blaue,
      // aber tote </name:alt>-Chips gerendert („Kein Befehl gefunden“).
      guildCommandIds.set(guildId, { ...ids });
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
  function getGuild(guildId) { return guilds.get(String(guildId)) || null; }
  function setGuild(cfg) {
    if (!cfg?.guildId) return;
    const id = String(cfg.guildId);
    let target = guilds.get(id);
    // In-Place mergen: Bonus/Scheduler halten oft dieselbe Objektreferenz
    // und mutieren danach weiter. Ein Austausch würde die Flagge verlieren.
    if (!target) {
      target = { guildId: id, nicknamesEnabled: true };
      guilds.set(id, target);
    }
    const keepNicknames = !Object.prototype.hasOwnProperty.call(cfg, 'nicknamesEnabled');
    const prevNick = target.nicknamesEnabled;
    if (target !== cfg) Object.assign(target, cfg);
    target.guildId = id;
    target.nicknamesEnabled = parseNicknamesEnabled(keepNicknames ? prevNick : cfg.nicknamesEnabled);
    dirtyGuilds.add(id);
    deletedGuilds.delete(id);
  }
  function deleteGuild(guildId) {
    const id = String(guildId);
    guilds.delete(id);
    users.delete(id);
    guildCommandIds.delete(id);
    inviteSnapshots.delete(id);
    inviteLeaves.delete(id);
    dirtyGuilds.delete(id);
    dirtyInviteSnapshots.delete(id);
    // Leave-Log-Zeilen der Gilde sind über pendingDeletedGuilds abgedeckt
    for (const key of [...dirtyInviteLeaves]) {
      if (key.startsWith(`${id}:`)) dirtyInviteLeaves.delete(key);
    }
    deletedGuilds.add(id);
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

  // ----------------- Invite-XP API -----------------
  // Invite-Snapshot (code -> uses) für die Delta-Erkennung beim Serverbeitritt.
  function getInviteSnapshot(guildId) {
    const s = inviteSnapshots.get(String(guildId));
    if (!s) return null;
    return { data: s.data ? { ...s.data } : {}, updatedAt: s.updatedAt || 0 };
  }
  function setInviteSnapshot(guildId, data, updatedAt = Date.now()) {
    const id = String(guildId);
    inviteSnapshots.set(id, { data: data && typeof data === 'object' ? { ...data } : {}, updatedAt });
    dirtyInviteSnapshots.add(id);
  }
  function deleteInviteSnapshot(guildId) {
    const id = String(guildId);
    inviteSnapshots.delete(id);
    dirtyInviteSnapshots.delete(id);
  }

  // Leave-Log für den 7-Tage-Rejoin-Schutz: Merkt, wann ein Nutzer gegangen ist.
  // Bewusst getrennt von user_levels – der XP-Datensatz wird beim Verlassen
  // gelöscht, das Leave-Log muss den Rejoin-Schutz trotzdem überleben.
  function getLeaveRecord(guildId, userId) {
    const v = inviteLeaves.get(String(guildId))?.get(String(userId));
    return v == null ? null : v;
  }
  function setLeaveRecord(guildId, userId, leftAt = Date.now()) {
    const gid = String(guildId);
    const uid = String(userId);
    let m = inviteLeaves.get(gid);
    if (!m) { m = new Map(); inviteLeaves.set(gid, m); }
    m.set(uid, Number(leftAt) || Date.now());
    dirtyInviteLeaves.add(`${gid}:${uid}`);
    deletedInviteLeaves.delete(`${gid}:${uid}`);
  }
  function deleteLeaveRecord(guildId, userId) {
    const gid = String(guildId);
    const uid = String(userId);
    const m = inviteLeaves.get(gid);
    if (m) m.delete(uid);
    dirtyInviteLeaves.delete(`${gid}:${uid}`);
    deletedInviteLeaves.add(`${gid}:${uid}`);
  }
  /** Entfernt Leave-Einträge, die älter als `before` (ms) sind. */
  function pruneLeaveRecords(guildId, before = Date.now()) {
    const gid = String(guildId);
    const m = inviteLeaves.get(gid);
    if (!m) return 0;
    let removed = 0;
    for (const [uid, leftAt] of [...m.entries()]) {
      if (Number(leftAt) < before) {
        m.delete(uid);
        dirtyInviteLeaves.delete(`${gid}:${uid}`);
        deletedInviteLeaves.add(`${gid}:${uid}`);
        removed++;
      }
    }
    return removed;
  }

  // ----------------- Persistence -----------------
  async function flush({ force = false } = {}) {
    if (flushInProgress) {
      // Nicht einfach verwerfen: Stunden-Timestamps, Level und offene Bonus-
      // Drops können genau während eines laufenden Turso-Batches geändert werden.
      flushRequested = true;
      return;
    }
    if (!dirtyGuilds.size && !dirtyUsers.size && !deletedUsers.size && !deletedGuilds.size && !dirtyMetadata && !dirtyInviteSnapshots.size && !dirtyInviteLeaves.size && !deletedInviteLeaves.size && !force) return;
    flushInProgress = true;
    flushRequested = false;
    const start = Date.now();

    // Snapshot VOR dem ersten await aus den Live-Sets entfernen. Änderungen,
    // die während des DB-Requests passieren, werden dadurch neu eingetragen
    // und am Ende in einem Folge-Flush verarbeitet statt versehentlich durch
    // ein pauschales clear() verloren zu gehen.
    const pendingGuilds = new Set(dirtyGuilds);
    const pendingUsers = new Set(dirtyUsers);
    const pendingDeletedUsers = new Set(deletedUsers);
    const pendingDeletedGuilds = new Set(deletedGuilds);
    const pendingMetadata = dirtyMetadata;
    const pendingInviteSnapshots = new Set(dirtyInviteSnapshots);
    const pendingInviteLeaves = new Set(dirtyInviteLeaves);
    const pendingDeletedInviteLeaves = new Set(deletedInviteLeaves);
    for (const key of pendingGuilds) dirtyGuilds.delete(key);
    for (const key of pendingUsers) dirtyUsers.delete(key);
    for (const key of pendingDeletedUsers) deletedUsers.delete(key);
    for (const key of pendingDeletedGuilds) deletedGuilds.delete(key);
    for (const key of pendingInviteSnapshots) dirtyInviteSnapshots.delete(key);
    for (const key of pendingInviteLeaves) dirtyInviteLeaves.delete(key);
    for (const key of pendingDeletedInviteLeaves) deletedInviteLeaves.delete(key);
    if (pendingMetadata) dirtyMetadata = false;

    let flushSucceeded = false;
    try {
      if (db) {
        // Use transaction batch
        const statements = [];
        // deletions
        for (const gid of pendingDeletedGuilds) {
          statements.push({ sql: 'DELETE FROM guild_configs WHERE guild_id = ?', args: [gid] });
          statements.push({ sql: 'DELETE FROM user_levels WHERE guild_id = ?', args: [gid] });
          statements.push({ sql: 'DELETE FROM invite_snapshots WHERE guild_id = ?', args: [gid] });
          statements.push({ sql: 'DELETE FROM invite_leave_log WHERE guild_id = ?', args: [gid] });
        }
        for (const key of pendingDeletedUsers) {
          const [gid, uid] = key.split(':');
          statements.push({ sql: 'DELETE FROM user_levels WHERE guild_id = ? AND user_id = ?', args: [gid, uid] });
        }
        // upserts guilds
        for (const gid of pendingGuilds) {
          const g = guilds.get(gid);
          if (!g) continue;
          statements.push({
            sql: `INSERT INTO guild_configs (guild_id, leaderboard_channel_id, main_channel_id, lang, leaderboard_message_id, last_daily_decay, level_role_template, level_role_levels, level_role_ids, bonus_state, last_leaderboard_refresh, last_hourly_leaderboard_refresh, nicknames_enabled, inactive_role_enabled, inactive_role_days, inactive_role_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET
                    leaderboard_channel_id=excluded.leaderboard_channel_id,
                    main_channel_id=excluded.main_channel_id,
                    lang=excluded.lang,
                    leaderboard_message_id=excluded.leaderboard_message_id,
                    last_daily_decay=excluded.last_daily_decay,
                    level_role_template=excluded.level_role_template,
                    level_role_levels=excluded.level_role_levels,
                    level_role_ids=excluded.level_role_ids,
                    bonus_state=excluded.bonus_state,
                    last_leaderboard_refresh=excluded.last_leaderboard_refresh,
                    last_hourly_leaderboard_refresh=excluded.last_hourly_leaderboard_refresh,
                    nicknames_enabled=excluded.nicknames_enabled,
                    inactive_role_enabled=excluded.inactive_role_enabled,
                    inactive_role_days=excluded.inactive_role_days,
                    inactive_role_id=excluded.inactive_role_id`,
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
              g.lastLeaderboardRefresh || g.lastLeaderboardUpdate || null,
              g.lastHourlyLeaderboardRefresh || null,
              g.nicknamesEnabled === false ? 0 : 1,
              g.inactiveRoleEnabled ? 1 : 0,
              g.inactiveRoleDays || null,
              g.inactiveRoleId || null,
            ]
          });
        }
        for (const key of pendingUsers) {
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
        // upserts/deletes Invite-XP
        for (const gid of pendingInviteSnapshots) {
          const s = inviteSnapshots.get(gid);
          if (!s) continue;
          statements.push({
            sql: `INSERT INTO invite_snapshots (guild_id, data, updated_at)
                  VALUES (?, ?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET
                    data=excluded.data, updated_at=excluded.updated_at`,
            args: [gid, JSON.stringify(s.data || {}), s.updatedAt || Date.now()],
          });
        }
        for (const key of pendingInviteLeaves) {
          const [gid, uid] = key.split(':');
          const leftAt = inviteLeaves.get(gid)?.get(uid);
          if (leftAt == null) continue;
          statements.push({
            sql: `INSERT INTO invite_leave_log (guild_id, user_id, left_at)
                  VALUES (?, ?, ?)
                  ON CONFLICT(guild_id, user_id) DO UPDATE SET
                    left_at=excluded.left_at`,
            args: [gid, uid, leftAt],
          });
        }
        for (const key of pendingDeletedInviteLeaves) {
          const [gid, uid] = key.split(':');
          statements.push({ sql: 'DELETE FROM invite_leave_log WHERE guild_id = ? AND user_id = ?', args: [gid, uid] });
        }
        if (pendingMetadata) {
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
          statements.push({
            sql: `INSERT INTO bot_metadata (key, value) VALUES ('command_id_scope', ?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(commandIdScope)],
          });
        }
        if (statements.length) {
          // batch execute in chunks of 50 to avoid too large
          const chunk = 50;
          for (let i=0; i<statements.length; i+=chunk) {
            const batch = statements.slice(i, i+chunk);
            await db.batch(batch);
          }
          logger?.info?.(
            `[xp-level-bot] Flush: ${statements.length} ops in ${Date.now()-start}ms ` +
            `(guilds:${pendingGuilds.size} users:${pendingUsers.size} ` +
            `delG:${pendingDeletedGuilds.size} delU:${pendingDeletedUsers.size} ` +
            `invSnap:${pendingInviteSnapshots.size} invLeave:${pendingInviteLeaves.size})`
          );
        }
        // Zusätzlich vollständige Datei-Sicherung. Währenddessen entstandene
        // Dirty-Einträge bleiben für den folgenden DB-Flush im Live-Set.
        try { saveToFile(); } catch {}
      } else {
        // Ohne DB ist saveToFile synchron und enthält bereits den aktuellsten RAM-Stand.
        saveToFile();
        logger?.info?.(
          `[xp-level-bot] File-Backup gesichert (guilds:${pendingGuilds.size} users:${pendingUsers.size}) ` +
          `in ${Date.now()-start}ms`
        );
      }
      flushSucceeded = true;
    } catch (e) {
      // Snapshot bei Fehler wieder einreihen, aber nur wenn der Datensatz im RAM
      // noch denselben Zustandstyp hat (zwischenzeitliches Set/Delete gewinnt).
      for (const gid of pendingGuilds) {
        if (guilds.has(gid) && !deletedGuilds.has(gid)) dirtyGuilds.add(gid);
      }
      for (const gid of pendingDeletedGuilds) {
        if (!guilds.has(gid)) deletedGuilds.add(gid);
      }
      for (const key of pendingUsers) {
        const [gid, uid] = key.split(':');
        if (users.get(gid)?.has(uid) && !deletedUsers.has(key)) dirtyUsers.add(key);
      }
      for (const key of pendingDeletedUsers) {
        const [gid, uid] = key.split(':');
        if (!users.get(gid)?.has(uid)) deletedUsers.add(key);
      }
      for (const gid of pendingInviteSnapshots) {
        if (inviteSnapshots.has(gid)) dirtyInviteSnapshots.add(gid);
      }
      for (const key of pendingInviteLeaves) {
        const [gid, uid] = key.split(':');
        if (inviteLeaves.get(gid)?.has(uid)) dirtyInviteLeaves.add(key);
      }
      for (const key of pendingDeletedInviteLeaves) {
        const [gid, uid] = key.split(':');
        if (!inviteLeaves.get(gid)?.has(uid)) deletedInviteLeaves.add(key);
      }
      if (pendingMetadata) dirtyMetadata = true;
      logger?.error?.('[xp-level-bot] Flush fehlgeschlagen:', e.message);
    } finally {
      flushInProgress = false;
      const needsFollowUp =
        flushRequested || dirtyGuilds.size || dirtyUsers.size || deletedUsers.size || deletedGuilds.size || dirtyMetadata ||
        dirtyInviteSnapshots.size || dirtyInviteLeaves.size || deletedInviteLeaves.size;
      flushRequested = false;
      // Bei Erfolg sofort die während des Batches entstandenen Änderungen
      // nachziehen. Bei DB-Fehlern übernimmt der reguläre 5-Minuten-Retry, damit
      // keine enge Fehler-/Request-Schleife entsteht.
      if (flushSucceeded && needsFollowUp) queueMicrotask(() => void flush());
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
    let channels;
    try { channels = await guild.channels.fetch(); } catch { return null; }
    for (const channel of channels.filter(c => c.type === ChannelType.GuildText && c.viewable).values()) {
      try {
        // 100 Nachrichten scannen, damit die Leaderboard-Nachricht auch in
        // sehr aktiven Kanälen zuverlässig gefunden wird (sie wandert nach
        // unten, je mehr neue Nachrichten dazukommen)
        const messages = await channel.messages.fetch({ limit: 100 });
        const found = messages.find((m) => {
          if (m.author?.id !== client.user.id) return false;
          const text = extractAllText(m);
          return decodeHidden(text).some((p) => p.includes(LEADERBOARD_MARKER));
        });
        if (found) return { channel, message: found };
      } catch {}
    }
    return null;
  }

  return {
    init,
    getGuild, setGuild, deleteGuild, getAllGuilds, getGuildIds,
    getUser, ensureUser, setUser, deleteUser, getUsersForGuild, getLeaderboard, getRank, getAllUsersCount,
    getCommandIds, getCommandId, setCommandIds,
    getCommandIdScope, setCommandIdScope,
    getGuildCommandIds, getAllGuildCommandIds, setGuildCommandIds, deleteGuildCommandIds, clearGuildCommandIds,
    getInviteSnapshot, setInviteSnapshot, deleteInviteSnapshot,
    getLeaveRecord, setLeaveRecord, deleteLeaveRecord, pruneLeaveRecords,
    flush,
    startBackupInterval, stopBackupInterval,
    findLeaderboardMessage,
    parseNicknamesEnabled,
    _guilds: guilds,
    _users: users,
    _inviteSnapshots: inviteSnapshots,
    _inviteLeaves: inviteLeaves,
    _dirtyGuilds: dirtyGuilds,
    _dirtyUsers: dirtyUsers,
    _db: () => db,
  };
}

module.exports = { createXpStore };
