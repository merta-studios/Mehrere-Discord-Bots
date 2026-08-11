/**
 * Love-Tester Store – nutzt DIESELBE Turso-Datenbank wie der XP-Level-Bot
 * (gleiche Umgebungsvariablen TURSO_DATABASE_URL / TURSO_AUTH_TOKEN), legt
 * aber eigene Tabellen an, damit sich die Bots nicht in die Quere kommen.
 *
 * Es wird bewusst kaum etwas gespeichert: nur die Server-Konfiguration
 * (Sprache, Kanäle, Groq-API-Key) + Command-IDs. Keine Chat-Verläufe,
 * keine Analyse-Ergebnisse – Datenschutz first! 💘
 *
 * RAM-first wie der XP-Store: einmal laden, Dirty-Tracking, Flush bei
 * Änderung + Backup-Intervall. Ohne Turso: JSON-Datei-Fallback.
 */

const fs = require('fs');
const path = require('path');

function createLoveStore({ logger, env } = {}) {
  const guilds = new Map(); // guildId -> {guildId, lang, channels: [], groqApiKey, setupComplete, updatedAt}
  let commandIds = {}; // cmdName -> id (globale Command-IDs)
  const guildCommandIds = new Map(); // guildId -> {cmdName: id} (nur Dev-Gilde)
  let commandIdScope = null;

  const dirtyGuilds = new Set();
  const deletedGuilds = new Set();
  let dirtyMetadata = false;
  let db = null;
  let flushInProgress = false;
  let flushRequested = false;

  const fallbackPath = path.join(__dirname, '..', '..', '..', 'data', 'love-store.json');
  const localFallback = path.join(__dirname, '..', 'love-data.json');

  const envFn = typeof env === 'function' ? env : ((key, fb = '') => process.env[key] ?? fb);
  // Identische Auflösung wie beim XP-Bot: gleiche Datenbank, gleiche Zugangsdaten.
  const tursoUrl =
    envFn('TURSO_DATABASE_URL', '') ||
    envFn('XP_BOT_TURSO_URL', '') ||
    envFn('XP_TURSO_DATABASE_URL', '') ||
    envFn('LOVE_BOT_TURSO_URL', '') ||
    '';
  const tursoToken =
    envFn('TURSO_AUTH_TOKEN', '') ||
    envFn('XP_BOT_TURSO_AUTH_TOKEN', '') ||
    envFn('XP_TURSO_AUTH_TOKEN', '') ||
    envFn('LOVE_BOT_TURSO_AUTH_TOKEN', '') ||
    '';
  const disableFileBackup = envFn('LOVE_STORE_DISABLE_FILE_BACKUP', '') === 'true';

  async function init() {
    if (tursoUrl) {
      try {
        const { createClient } = require('@libsql/client');
        db = createClient({ url: tursoUrl, authToken: tursoToken || undefined });
        logger?.info?.('[love-tester-bot] Verbinde zu Turso (gleiche DB wie XP-Bot)...');
        await ensureTables();
        await loadFromDb();
        logger?.info?.(`[love-tester-bot] Turso geladen: ${guilds.size} Love-Setups`);
        return;
      } catch (e) {
        logger?.error?.('[love-tester-bot] Turso Verbindung fehlgeschlagen, fallback auf RAM+File:', e.message);
        db = null;
      }
    } else {
      logger?.warn?.('[love-tester-bot] Keine TURSO_DATABASE_URL gesetzt – nutze RAM + Datei-Fallback (lokal).');
    }
    tryLoadFile();
  }

  async function ensureTables() {
    if (!db) return;
    await db.execute(`CREATE TABLE IF NOT EXISTS love_configs (
      guild_id TEXT PRIMARY KEY,
      lang TEXT NOT NULL,
      channels TEXT NOT NULL,
      groq_api_key TEXT NOT NULL,
      setup_complete INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );`);
    await db.execute(`CREATE TABLE IF NOT EXISTS love_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`);
  }

  function parseJsonCol(value, fallback = null) {
    if (value == null || value === '') return fallback;
    try { return JSON.parse(value); } catch { return fallback; }
  }

  async function loadFromDb() {
    if (!db) return;
    const gRes = await db.execute('SELECT * FROM love_configs');
    for (const row of gRes.rows) {
      guilds.set(row.guild_id, {
        guildId: row.guild_id,
        lang: row.lang || 'de',
        channels: parseJsonCol(row.channels, []),
        groqApiKey: row.groq_api_key || '',
        setupComplete: Number(row.setup_complete) === 1,
        updatedAt: row.updated_at ? Number(row.updated_at) : null,
      });
    }
    try {
      const metaRes = await db.execute("SELECT key, value FROM love_metadata WHERE key IN ('command_ids','guild_command_ids','command_id_scope')");
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
      logger?.warn?.('[love-tester-bot] Laden der love_metadata fehlgeschlagen:', e.message);
    }
  }

  function tryLoadFile() {
    if (disableFileBackup) return;
    let data = null;
    for (const p of [localFallback, fallbackPath]) {
      try {
        if (fs.existsSync(p)) {
          data = JSON.parse(fs.readFileSync(p, 'utf8'));
          logger?.info?.(`[love-tester-bot] Fallback-Datei geladen: ${p}`);
          break;
        }
      } catch {}
    }
    if (!data) return;
    try {
      if (data.guilds) {
        for (const [gid, cfg] of Object.entries(data.guilds)) guilds.set(gid, cfg);
      }
      if (data.commandIds && typeof data.commandIds === 'object') commandIds = { ...data.commandIds };
      if (data.commandIdScope && typeof data.commandIdScope === 'string') commandIdScope = data.commandIdScope;
      if (data.guildCommandIds && typeof data.guildCommandIds === 'object') {
        for (const [gid, ids] of Object.entries(data.guildCommandIds)) guildCommandIds.set(gid, ids);
      }
    } catch (e) {
      logger?.warn?.('[love-tester-bot] Fallback-Datei korrupt:', e.message);
    }
  }

  function saveToFile() {
    if (disableFileBackup) return;
    const obj = {
      guilds: Object.fromEntries([...guilds.entries()]),
      commandIds,
      commandIdScope,
      guildCommandIds: Object.fromEntries([...guildCommandIds.entries()]),
    };
    const json = JSON.stringify(obj);
    for (const p of [localFallback, fallbackPath]) {
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, json);
      } catch {}
    }
  }

  // ----------------- Command-ID-API (wie XP-Bot) -----------------
  function getCommandIds() { return { ...commandIds }; }
  function getCommandId(name) { return commandIds[name] || null; }
  function setCommandIds(ids) {
    if (ids && typeof ids === 'object') {
      // ERSTZEN statt mergen: `ids` ist immer die vollständige, autoritative
      // Liste von Discord (PUT-Antwort oder REST-GET). Verwaiste Snowflakes
      // dürfen beim Merge sonst als alte ID überleben und in /help
      // „Kein Befehl gefunden" auslösen.
      commandIds = { ...ids };
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getCommandIdScope() { return commandIdScope; }
  function setCommandIdScope(scope) {
    if (typeof scope === 'string') {
      commandIdScope = scope;
      dirtyMetadata = true;
      try { saveToFile(); } catch {}
    }
  }
  function getGuildCommandIds(guildId) { return guildCommandIds.get(guildId) || null; }
  function getAllGuildCommandIds() { return Object.fromEntries([...guildCommandIds.entries()]); }
  function setGuildCommandIds(guildId, ids) {
    if (guildId && ids && typeof ids === 'object') {
      // Discords GET/PUT-Antwort ist die vollständige Liste für diese Gilde.
      // Nicht mergen: sonst bleiben gelöschte Commands als tote Snowflakes
      // erhalten und werden später in /help als verwaiste Mentions verwendet.
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

  // ----------------- Guild-API -----------------
  function getGuild(guildId) { return guilds.get(guildId) || null; }
  function setGuild(cfg) {
    cfg.updatedAt = Date.now();
    guilds.set(cfg.guildId, cfg);
    dirtyGuilds.add(cfg.guildId);
    deletedGuilds.delete(cfg.guildId);
  }
  function deleteGuild(guildId) {
    guilds.delete(guildId);
    guildCommandIds.delete(guildId);
    dirtyGuilds.delete(guildId);
    deletedGuilds.add(guildId);
  }
  function getAllGuilds() { return [...guilds.values()]; }
  function getGuildIds() { return [...guilds.keys()]; }

  // ----------------- Persistenz -----------------
  async function flush({ force = false } = {}) {
    if (flushInProgress) {
      flushRequested = true;
      return;
    }
    if (!dirtyGuilds.size && !deletedGuilds.size && !dirtyMetadata && !force) return;
    flushInProgress = true;
    flushRequested = false;
    const start = Date.now();

    const pendingGuilds = new Set(dirtyGuilds);
    const pendingDeletedGuilds = new Set(deletedGuilds);
    const pendingMetadata = dirtyMetadata;
    for (const gid of pendingGuilds) dirtyGuilds.delete(gid);
    for (const gid of pendingDeletedGuilds) deletedGuilds.delete(gid);
    if (pendingMetadata) dirtyMetadata = false;

    try {
      if (db) {
        const statements = [];
        for (const gid of pendingDeletedGuilds) {
          statements.push({ sql: 'DELETE FROM love_configs WHERE guild_id = ?', args: [gid] });
        }
        for (const gid of pendingGuilds) {
          const g = guilds.get(gid);
          if (!g) continue;
          statements.push({
            sql: `INSERT INTO love_configs (guild_id, lang, channels, groq_api_key, setup_complete, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(guild_id) DO UPDATE SET
                    lang=excluded.lang, channels=excluded.channels, groq_api_key=excluded.groq_api_key,
                    setup_complete=excluded.setup_complete, updated_at=excluded.updated_at`,
            args: [
              g.guildId,
              g.lang || 'de',
              JSON.stringify(g.channels || []),
              g.groqApiKey || '',
              g.setupComplete ? 1 : 0,
              g.updatedAt || Date.now(),
            ],
          });
        }
        if (pendingMetadata) {
          statements.push({
            sql: `INSERT INTO love_metadata (key, value) VALUES ('command_ids', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(commandIds)],
          });
          statements.push({
            sql: `INSERT INTO love_metadata (key, value) VALUES ('guild_command_ids', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(Object.fromEntries([...guildCommandIds.entries()]))],
          });
          statements.push({
            sql: `INSERT INTO love_metadata (key, value) VALUES ('command_id_scope', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
            args: [JSON.stringify(commandIdScope)],
          });
        }
        if (statements.length) {
          const chunk = 50;
          for (let i = 0; i < statements.length; i += chunk) {
            await db.batch(statements.slice(i, i + chunk));
          }
          logger?.info?.(`[love-tester-bot] Flush: ${statements.length} ops in ${Date.now() - start}ms`);
        }
        try { saveToFile(); } catch {}
      } else {
        saveToFile();
        logger?.info?.(`[love-tester-bot] File-Backup gesichert in ${Date.now() - start}ms`);
      }
    } catch (e) {
      for (const gid of pendingGuilds) {
        if (guilds.has(gid) && !deletedGuilds.has(gid)) dirtyGuilds.add(gid);
      }
      for (const gid of pendingDeletedGuilds) {
        if (!guilds.has(gid)) deletedGuilds.add(gid);
      }
      if (pendingMetadata) dirtyMetadata = true;
      logger?.error?.('[love-tester-bot] Flush fehlgeschlagen:', e.message);
    } finally {
      flushInProgress = false;
      const needsFollowUp = flushRequested || dirtyGuilds.size || deletedGuilds.size || dirtyMetadata;
      flushRequested = false;
      if (needsFollowUp) queueMicrotask(() => void flush());
    }
  }

  let backupTimer = null;
  function startBackupInterval(ms = 10 * 60 * 1000) {
    if (backupTimer) clearInterval(backupTimer);
    backupTimer = setInterval(() => { void flush(); }, ms);
    if (backupTimer.unref) backupTimer.unref();
  }
  function stopBackupInterval() { if (backupTimer) clearInterval(backupTimer); }

  return {
    init,
    getGuild, setGuild, deleteGuild, getAllGuilds, getGuildIds,
    getCommandIds, getCommandId, setCommandIds,
    getCommandIdScope, setCommandIdScope,
    getGuildCommandIds, getAllGuildCommandIds, setGuildCommandIds, deleteGuildCommandIds, clearGuildCommandIds,
    flush,
    startBackupInterval, stopBackupInterval,
    _guilds: guilds,
  };
}

module.exports = { createLoveStore };
