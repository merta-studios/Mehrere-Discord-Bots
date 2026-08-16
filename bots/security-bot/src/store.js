/**
 * Security Store – RAM-first mit Turso Persistenz und Datei-Fallback.
 * Speichert Serverkonfigurationen, Mistral API-Keys, Verwarnungen und Verstöße.
 */

const fs = require('fs');
const path = require('path');
const {
  getDefaultGuildConfig,
  normalizeGuildConfig,
  normalizeModerationCategory,
} = require('./rules');

function parseJsonCol(val, fallback = null) {
  if (val == null || val === '') return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function createSecurityStore({ logger, env } = {}) {
  const guilds = new Map(); // guildId -> config
  const violations = new Map(); // violationId -> violation
  let commandIds = {};
  const guildCommandIds = new Map();
  let dirtyMetadata = false;

  const dirtyGuilds = new Set();
  const dirtyViolations = new Set();
  const deletedViolations = new Set();
  const deletedGuilds = new Set();

  let db = null;
  let flushInProgress = false;
  let flushRequested = false;

  const localFallback = path.join(__dirname, '..', 'security-data.json');
  const sharedFallback = path.join(__dirname, '..', '..', '..', 'data', 'security-store.json');

  const envFn = typeof env === 'function' ? env : ((key, fb = '') => process.env[key] ?? fb);
  const tursoUrl = envFn('TURSO_DATABASE_URL', '') ||
    envFn('SECURITY_BOT_TURSO_URL', '') ||
    envFn('SECURITY_TURSO_DATABASE_URL', '') ||
    envFn('XP_BOT_TURSO_URL', '') ||
    '';
  const tursoToken = envFn('TURSO_AUTH_TOKEN', '') ||
    envFn('SECURITY_BOT_TURSO_AUTH_TOKEN', '') ||
    envFn('SECURITY_TURSO_AUTH_TOKEN', '') ||
    envFn('XP_BOT_TURSO_AUTH_TOKEN', '') ||
    '';
  const disableFileBackup = envFn('SECURITY_STORE_DISABLE_FILE_BACKUP', '') === 'true';

  async function init() {
    if (tursoUrl) {
      try {
        const { createClient } = require('@libsql/client');
        db = createClient({ url: tursoUrl, authToken: tursoToken || undefined });
        logger?.info?.('[security-bot] Verbinde zu Turso...');
        await ensureTables();
        await loadFromDb();
        logger?.info?.(`[security-bot] Turso geladen: ${guilds.size} Gilden, ${violations.size} Verstöße`);
        return;
      } catch (e) {
        logger?.error?.('[security-bot] Turso Verbindung fehlgeschlagen, fallback auf RAM+File:', e.message);
        db = null;
      }
    } else {
      logger?.warn?.('[security-bot] Keine TURSO_DATABASE_URL gesetzt – nutze RAM + Datei-Fallback.');
    }
    tryLoadFile();
  }

  async function ensureTables() {
    if (!db) return;
    await db.execute(`CREATE TABLE IF NOT EXISTS security_guild_configs (
      guild_id TEXT PRIMARY KEY,
      mistral_api_key TEXT,
      lang TEXT NOT NULL,
      sensitivity TEXT,
      category_thresholds TEXT,
      category_enabled TEXT,
      category_autodelete TEXT,
      warning_actions TEXT,
      max_warnings INTEGER,
      violation_expiry_days INTEGER,
      default_autodelete INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );`);

    // Bestehende Installationen besitzen noch die frühere openai_api_key-
    // Spalte. Der neue Mistral-Schlüssel bekommt eine eigene Spalte; der alte
    // Schlüssel wird absichtlich nicht migriert, da er bei Mistral ungültig ist.
    try {
      await db.execute('ALTER TABLE security_guild_configs ADD COLUMN mistral_api_key TEXT');
    } catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message || e))) throw e;
    }

    await db.execute(`CREATE TABLE IF NOT EXISTS security_violations (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      categories TEXT NOT NULL,
      highest_category TEXT NOT NULL,
      highest_score REAL NOT NULL,
      content_snippet TEXT,
      has_image INTEGER DEFAULT 0,
      action_taken TEXT NOT NULL,
      timeout_seconds INTEGER DEFAULT 0,
      warning_number INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      deleted INTEGER DEFAULT 0,
      deleted_by TEXT,
      deleted_at INTEGER
    );`);

    await db.execute(`CREATE TABLE IF NOT EXISTS security_bot_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`);

    await db.execute(`CREATE INDEX IF NOT EXISTS idx_sec_viol_guild_user ON security_violations(guild_id, user_id);`);
  }

  async function loadFromDb() {
    if (!db) return;
    const gRes = await db.execute('SELECT * FROM security_guild_configs');
    for (const row of gRes.rows) {
      const cfg = normalizeGuildConfig({
        guildId: row.guild_id,
        mistralApiKey: row.mistral_api_key || null,
        lang: row.lang || 'de',
        sensitivity: row.sensitivity || 'balanced',
        categoryThresholds: parseJsonCol(row.category_thresholds, null),
        categoryEnabled: parseJsonCol(row.category_enabled, null),
        categoryAutoDelete: parseJsonCol(row.category_autodelete, null),
        warningActions: parseJsonCol(row.warning_actions, null),
        maxWarnings: row.max_warnings ? Number(row.max_warnings) : 3,
        violationExpiryDays: row.violation_expiry_days ? Number(row.violation_expiry_days) : 14,
        defaultAutoDelete: row.default_autodelete === 1 || row.default_autodelete === '1' || row.default_autodelete === true,
        createdAt: row.created_at ? Number(row.created_at) : Date.now(),
        updatedAt: row.updated_at ? Number(row.updated_at) : Date.now(),
      });
      if (cfg) guilds.set(cfg.guildId, cfg);
    }

    const vRes = await db.execute('SELECT * FROM security_violations');
    for (const row of vRes.rows) {
      violations.set(row.id, {
        id: row.id,
        guildId: row.guild_id,
        userId: row.user_id,
        categories: [...new Set(
          parseJsonCol(row.categories, [row.highest_category]).map(normalizeModerationCategory)
        )],
        highestCategory: normalizeModerationCategory(row.highest_category),
        highestScore: Number(row.highest_score) || 0,
        contentSnippet: row.content_snippet || '',
        hasImage: Boolean(row.has_image),
        actionTaken: row.action_taken,
        timeoutSeconds: Number(row.timeout_seconds) || 0,
        warningNumber: Number(row.warning_number) || 1,
        createdAt: Number(row.created_at) || Date.now(),
        expiresAt: Number(row.expires_at) || Date.now() + 14 * 86400 * 1000,
        deleted: Boolean(row.deleted),
        deletedBy: row.deleted_by || null,
        deletedAt: row.deleted_at ? Number(row.deleted_at) : null,
      });
    }

    try {
      const metaRes = await db.execute("SELECT key, value FROM security_bot_metadata WHERE key IN ('command_ids', 'guild_command_ids')");
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
      logger?.warn?.('[security-bot] Metadata load fail:', e.message);
    }
  }

  function tryLoadFile() {
    if (disableFileBackup) return;
    let data = null;
    for (const p of [localFallback, sharedFallback]) {
      try {
        if (fs.existsSync(p)) {
          data = JSON.parse(fs.readFileSync(p, 'utf8'));
          logger?.info?.(`[security-bot] Fallback-Datei geladen: ${p}`);
          break;
        }
      } catch {}
    }
    if (!data) return;
    try {
      if (data.guilds && typeof data.guilds === 'object') {
        for (const [gid, cfg] of Object.entries(data.guilds)) {
          const norm = normalizeGuildConfig({ ...cfg, guildId: gid });
          if (norm) guilds.set(String(gid), norm);
        }
      }
      if (data.violations && typeof data.violations === 'object') {
        for (const [id, v] of Object.entries(data.violations)) {
          if (v && typeof v === 'object') {
            const highestCategory = normalizeModerationCategory(v.highestCategory);
            const categories = Array.isArray(v.categories)
              ? [...new Set(v.categories.map(normalizeModerationCategory))]
              : [highestCategory];
            violations.set(String(id), { ...v, categories, highestCategory });
          }
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
      logger?.warn?.('[security-bot] Fallback-Datei korrupt:', e.message);
    }
  }

  function saveToFile() {
    if (disableFileBackup) return;
    const obj = {
      guilds: Object.fromEntries([...guilds.entries()]),
      violations: Object.fromEntries([...violations.entries()]),
      commandIds,
      guildCommandIds: Object.fromEntries([...guildCommandIds.entries()]),
    };
    const json = JSON.stringify(obj);
    for (const p of [localFallback, sharedFallback]) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, json);
      } catch {}
    }
  }

  // ----------------- Guild Configuration API -----------------
  function getGuild(guildId) {
    return guilds.get(String(guildId)) || null;
  }

  function ensureGuild(guildId) {
    const id = String(guildId);
    let cfg = guilds.get(id);
    if (!cfg) {
      cfg = getDefaultGuildConfig(id);
      guilds.set(id, cfg);
      dirtyGuilds.add(id);
    }
    return cfg;
  }

  function setGuild(cfg) {
    if (!cfg?.guildId) return;
    const normalized = normalizeGuildConfig(cfg);
    if (!normalized) return;
    normalized.updatedAt = Date.now();
    guilds.set(normalized.guildId, normalized);
    dirtyGuilds.add(normalized.guildId);
    deletedGuilds.delete(normalized.guildId);
  }

  function deleteGuild(guildId) {
    const id = String(guildId);
    guilds.delete(id);
    guildCommandIds.delete(id);
    dirtyGuilds.delete(id);
    deletedGuilds.add(id);
    // Delete violations for guild
    for (const [vId, v] of violations.entries()) {
      if (v.guildId === id) {
        violations.delete(vId);
        dirtyViolations.delete(vId);
        deletedViolations.add(vId);
      }
    }
  }

  function getAllGuilds() {
    return [...guilds.values()];
  }

  function getApiKey(guildId) {
    return guilds.get(String(guildId))?.mistralApiKey || null;
  }

  function setApiKey(guildId, apiKey) {
    const cfg = ensureGuild(guildId);
    cfg.mistralApiKey = apiKey ? String(apiKey).trim() : null;
    cfg.updatedAt = Date.now();
    dirtyGuilds.add(cfg.guildId);
  }

  function getLanguage(guildId) {
    return guilds.get(String(guildId))?.lang || 'de';
  }

  function setLanguage(guildId, lang) {
    const cfg = ensureGuild(guildId);
    cfg.lang = lang || 'de';
    cfg.updatedAt = Date.now();
    dirtyGuilds.add(cfg.guildId);
  }

  // ----------------- Violations API -----------------
  function addViolation(v) {
    if (!v?.id || !v.guildId || !v.userId) return null;
    const item = {
      id: String(v.id),
      guildId: String(v.guildId),
      userId: String(v.userId),
      categories: [...new Set(
        (Array.isArray(v.categories) ? v.categories : [v.highestCategory])
          .map(normalizeModerationCategory)
      )],
      highestCategory: normalizeModerationCategory(v.highestCategory),
      highestScore: Number(v.highestScore) || 0,
      contentSnippet: String(v.contentSnippet || '').slice(0, 500),
      hasImage: Boolean(v.hasImage),
      actionTaken: String(v.actionTaken || 'warn'),
      timeoutSeconds: Number(v.timeoutSeconds) || 0,
      warningNumber: Number(v.warningNumber) || 1,
      createdAt: Number(v.createdAt) || Date.now(),
      expiresAt: Number(v.expiresAt) || (Date.now() + 14 * 86400 * 1000),
      deleted: false,
      deletedBy: null,
      deletedAt: null,
    };
    violations.set(item.id, item);
    dirtyViolations.add(item.id);
    deletedViolations.delete(item.id);
    return item;
  }

  function getViolation(id) {
    return violations.get(String(id)) || null;
  }

  function getViolations(guildId, userId, { activeOnly = true, now = Date.now() } = {}) {
    const gid = String(guildId);
    const uid = String(userId);
    const result = [];
    for (const v of violations.values()) {
      if (v.guildId === gid && v.userId === uid) {
        if (activeOnly) {
          if (!v.deleted && v.expiresAt > now) {
            result.push(v);
          }
        } else {
          result.push(v);
        }
      }
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }

  function getAllViolationsForGuild(guildId) {
    const gid = String(guildId);
    const result = [];
    for (const v of violations.values()) {
      if (v.guildId === gid) result.push(v);
    }
    result.sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }

  function deleteViolation(id, { deletedBy = null } = {}) {
    const v = violations.get(String(id));
    if (!v) return false;
    v.deleted = true;
    v.deletedBy = deletedBy ? String(deletedBy) : null;
    v.deletedAt = Date.now();
    dirtyViolations.add(v.id);
    return true;
  }

  function clearUserViolations(guildId, userId, { deletedBy = null } = {}) {
    const gid = String(guildId);
    const uid = String(userId);
    let count = 0;
    const now = Date.now();
    for (const v of violations.values()) {
      if (v.guildId === gid && v.userId === uid && !v.deleted) {
        v.deleted = true;
        v.deletedBy = deletedBy ? String(deletedBy) : null;
        v.deletedAt = now;
        dirtyViolations.add(v.id);
        count++;
      }
    }
    return count;
  }

  function pruneExpiredViolations(now = Date.now()) {
    let count = 0;
    // Hard delete violations that expired more than 90 days ago to keep DB light
    const cutoff = now - (90 * 86400 * 1000);
    for (const [id, v] of violations.entries()) {
      if ((v.deleted && v.deletedAt && v.deletedAt < cutoff) || (v.expiresAt < cutoff)) {
        violations.delete(id);
        dirtyViolations.delete(id);
        deletedViolations.add(id);
        count++;
      }
    }
    return count;
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
      commandIds = { ...ids };
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getGuildCommandIds(guildId) {
    return guildCommandIds.get(String(guildId)) || null;
  }
  function setGuildCommandIds(guildId, ids) {
    if (guildId && ids && typeof ids === 'object') {
      guildCommandIds.set(String(guildId), { ...ids });
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function clearGuildCommandIds() {
    guildCommandIds.clear();
    dirtyMetadata = true;
  }

  // ----------------- Persistence -----------------
  async function flush({ force = false } = {}) {
    if (flushInProgress) {
      flushRequested = true;
      return;
    }
    if (!dirtyGuilds.size && !dirtyViolations.size && !deletedViolations.size && !deletedGuilds.size && !dirtyMetadata && !force) return;
    flushInProgress = true;
    flushRequested = false;
    const start = Date.now();

    const pendingGuilds = new Set(dirtyGuilds);
    const pendingViolations = new Set(dirtyViolations);
    const pendingDeletedViolations = new Set(deletedViolations);
    const pendingDeletedGuilds = new Set(deletedGuilds);
    const pendingMetadata = dirtyMetadata;

    for (const k of pendingGuilds) dirtyGuilds.delete(k);
    for (const k of pendingViolations) dirtyViolations.delete(k);
    for (const k of pendingDeletedViolations) deletedViolations.delete(k);
    for (const k of pendingDeletedGuilds) deletedGuilds.delete(k);
    if (pendingMetadata) dirtyMetadata = false;

    let success = false;
    try {
      if (db) {
        const statements = [];

        for (const gid of pendingDeletedGuilds) {
          statements.push({ sql: 'DELETE FROM security_guild_configs WHERE guild_id = ?', args: [gid] });
          statements.push({ sql: 'DELETE FROM security_violations WHERE guild_id = ?', args: [gid] });
        }
        for (const vid of pendingDeletedViolations) {
          statements.push({ sql: 'DELETE FROM security_violations WHERE id = ?', args: [vid] });
        }

        for (const gid of pendingGuilds) {
          const g = guilds.get(gid);
          if (!g) continue;
          statements.push({
            sql: `INSERT INTO security_guild_configs (
                    guild_id, mistral_api_key, lang, sensitivity, category_thresholds,
                    category_enabled, category_autodelete, warning_actions, max_warnings,
                    violation_expiry_days, default_autodelete, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET
                    mistral_api_key=excluded.mistral_api_key,
                    lang=excluded.lang,
                    sensitivity=excluded.sensitivity,
                    category_thresholds=excluded.category_thresholds,
                    category_enabled=excluded.category_enabled,
                    category_autodelete=excluded.category_autodelete,
                    warning_actions=excluded.warning_actions,
                    max_warnings=excluded.max_warnings,
                    violation_expiry_days=excluded.violation_expiry_days,
                    default_autodelete=excluded.default_autodelete,
                    updated_at=excluded.updated_at`,
            args: [
              g.guildId,
              g.mistralApiKey || null,
              g.lang || 'de',
              g.sensitivity || 'balanced',
              JSON.stringify(g.categoryThresholds || {}),
              JSON.stringify(g.categoryEnabled || {}),
              JSON.stringify(g.categoryAutoDelete || {}),
              JSON.stringify(g.warningActions || []),
              g.maxWarnings || 3,
              g.violationExpiryDays || 14,
              g.defaultAutoDelete ? 1 : 0,
              g.createdAt || Date.now(),
              g.updatedAt || Date.now(),
            ],
          });
        }

        for (const vid of pendingViolations) {
          const v = violations.get(vid);
          if (!v) continue;
          statements.push({
            sql: `INSERT INTO security_violations (
                    id, guild_id, user_id, categories, highest_category, highest_score,
                    content_snippet, has_image, action_taken, timeout_seconds, warning_number,
                    created_at, expires_at, deleted, deleted_by, deleted_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    categories=excluded.categories,
                    highest_category=excluded.highest_category,
                    highest_score=excluded.highest_score,
                    content_snippet=excluded.content_snippet,
                    has_image=excluded.has_image,
                    action_taken=excluded.action_taken,
                    timeout_seconds=excluded.timeout_seconds,
                    warning_number=excluded.warning_number,
                    expires_at=excluded.expires_at,
                    deleted=excluded.deleted,
                    deleted_by=excluded.deleted_by,
                    deleted_at=excluded.deleted_at`,
            args: [
              v.id,
              v.guildId,
              v.userId,
              JSON.stringify(v.categories || []),
              v.highestCategory,
              v.highestScore,
              v.contentSnippet || '',
              v.hasImage ? 1 : 0,
              v.actionTaken,
              v.timeoutSeconds || 0,
              v.warningNumber || 1,
              v.createdAt,
              v.expiresAt,
              v.deleted ? 1 : 0,
              v.deletedBy || null,
              v.deletedAt || null,
            ],
          });
        }

        if (pendingMetadata) {
          statements.push({
            sql: `INSERT INTO security_bot_metadata (key, value) VALUES ('command_ids', ?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(commandIds)],
          });
          statements.push({
            sql: `INSERT INTO security_bot_metadata (key, value) VALUES ('guild_command_ids', ?)
                  ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(Object.fromEntries([...guildCommandIds.entries()]))],
          });
        }

        if (statements.length > 0) {
          const chunk = 50;
          for (let i = 0; i < statements.length; i += chunk) {
            await db.batch(statements.slice(i, i + chunk));
          }
          logger?.info?.(
            `[security-bot] Flush: ${statements.length} ops in ${Date.now() - start}ms (guilds:${pendingGuilds.size} viol:${pendingViolations.size})`
          );
        }
        try { saveToFile(); } catch {}
      } else {
        saveToFile();
      }
      success = true;
    } catch (e) {
      for (const gid of pendingGuilds) {
        if (guilds.has(gid) && !deletedGuilds.has(gid)) dirtyGuilds.add(gid);
      }
      for (const vid of pendingViolations) {
        if (violations.has(vid) && !deletedViolations.has(vid)) dirtyViolations.add(vid);
      }
      if (pendingMetadata) dirtyMetadata = true;
      logger?.error?.('[security-bot] Flush fehlgeschlagen:', e.message);
    } finally {
      flushInProgress = false;
      const needsMore = flushRequested || dirtyGuilds.size || dirtyViolations.size || deletedViolations.size || deletedGuilds.size || dirtyMetadata;
      flushRequested = false;
      if (success && needsMore) queueMicrotask(() => void flush());
    }
  }

  let backupTimer = null;
  function startBackupInterval(ms = 5 * 60 * 1000) {
    if (backupTimer) clearInterval(backupTimer);
    backupTimer = setInterval(() => { void flush(); }, ms);
    if (backupTimer.unref) backupTimer.unref();
  }
  function stopBackupInterval() {
    if (backupTimer) clearInterval(backupTimer);
  }

  return {
    init,
    getGuild,
    ensureGuild,
    setGuild,
    deleteGuild,
    getAllGuilds,
    getApiKey,
    setApiKey,
    getLanguage,
    setLanguage,
    addViolation,
    getViolation,
    getViolations,
    getAllViolationsForGuild,
    deleteViolation,
    clearUserViolations,
    pruneExpiredViolations,
    getCommandIds,
    getCommandId,
    setCommandIds,
    getGuildCommandIds,
    setGuildCommandIds,
    clearGuildCommandIds,
    flush,
    startBackupInterval,
    stopBackupInterval,
    _guilds: guilds,
    _violations: violations,
    _db: () => db,
  };
}

module.exports = { createSecurityStore };
