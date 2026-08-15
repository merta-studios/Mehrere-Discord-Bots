/**
 * Invite-XP: Wer über einen Invite-Link beitritt, belohnt den Invite-Ersteller.
 *
 * Die Invite-Erkennung hält nicht nur einen uses-Snapshot, sondern zusätzlich
 * einen Laufzeit-Cache der Invite-Metadaten. Dadurch funktionieren auch:
 *   - Invites, die nach dem Bot-Start erstellt wurden (`inviteCreate`),
 *   - Einmal-/Limit-Invites, die Discord beim letzten Use sofort löscht,
 *   - mehrere schnelle Beitritte über denselben Link (Deltas werden einzeln
 *     verbraucht, statt mit dem ersten Event komplett übersprungen zu werden),
 *   - verzögert aktualisierte Discord-Zähler (mehrere gestaffelte Retries).
 *
 * Jeder guildMemberAdd – auch ein Bot oder geschützter Rejoin – verbraucht
 * genau ein erkanntes Invite-Delta. XP erhalten weiterhin ausschließlich
 * menschliche Invite-Ersteller für einen zulässigen neuen menschlichen Nutzer.
 *
 * Der Invite-Fetch braucht die Permission MANAGE_GUILD („Server verwalten“).
 * Fehlt sie, läuft der Rest des Bots normal weiter – Invite-XP ist dann
 * inaktiv und es wird nur einmal pro Server gewarnt.
 */

const { t } = require('./languages');
const { applyXpGain } = require('./logic');
const { componentsV2Payload } = require('./message-payload');
const { buildInviteXpEmbed } = require('./embed-builder');
const { resolveMainChannel, sendWithTextFallback, isSendableTextChannel } = require('./level-announcements');

const INVITE_XP_MIN = 40;
const INVITE_XP_MAX = 80;
const REJOIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage Rejoin-Schutz
// Rückwärtskompatibler Einzelwert für Tests/Integrationen. Im Produktivbetrieb
// wird die gestaffelte Liste darunter verwendet (insgesamt maximal 5 Sekunden).
const RETRY_DELAY_MS = 1500;
const RETRY_DELAYS_MS = Object.freeze([500, 1500, 3000]);
const DELETED_INVITE_TTL_MS = 15_000;

/** Zufällige Invite-Belohnung (40–80 XP, Ganzzahl). rng injizierbar für Tests. */
function rollInviteXp(rng = Math.random) {
  return INVITE_XP_MIN + Math.floor(rng() * (INVITE_XP_MAX - INVITE_XP_MIN + 1));
}

function inviteUses(invite) {
  const n = Number(invite?.uses);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function snapshotUses(value) {
  // Akzeptiert vorsorglich sowohl das bisherige Zahlenformat als auch ein
  // mögliches Metadatenformat, ohne bestehende persistierte Daten zu brechen.
  const raw = value && typeof value === 'object' ? value.uses : value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function inviteMaxUses(invite) {
  const n = Number(invite?.maxUses);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function inviteMetadata(invite, previous = null) {
  if (!invite?.code && !previous?.code) return null;
  const eventUses = inviteUses(invite);
  const previousUses = inviteUses(previous);
  return {
    code: String(invite?.code || previous.code),
    // Ein InviteDelete-Event kann ein älteres Cache-Objekt enthalten. Der
    // bereits bekannte höhere Zähler darf dadurch nicht zurückgesetzt werden.
    uses: Math.max(eventUses, previousUses),
    inviterId: invite?.inviter?.id || invite?.inviterId || previous?.inviterId || previous?.inviter?.id || null,
    maxUses: inviteMaxUses(invite) || inviteMaxUses(previous),
  };
}

/** Baut aus einer Invite-Collection den persistierbaren Snapshot {code: uses}. */
function toInviteSnapshot(invites) {
  const data = {};
  if (invites && typeof invites.values === 'function') {
    for (const invite of invites.values()) {
      if (!invite?.code) continue;
      data[invite.code] = inviteUses(invite);
    }
  }
  return data;
}

/**
 * Welcher Invite wurde für den Beitritt benutzt?
 * Öffentliche, konservative Hilfsfunktion: Nur wenn GENAU EIN bekannter Invite
 * einen höheren Zähler hat, wird er zurückgegeben.
 */
function detectUsedInvite(snapshot, invites) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!invites || typeof invites.values !== 'function') return null;
  let found = null;
  for (const invite of invites.values()) {
    if (!invite?.code || !Object.prototype.hasOwnProperty.call(snapshot, invite.code)) continue;
    const prev = snapshotUses(snapshot[invite.code]);
    const uses = inviteUses(invite);
    if (uses > prev) {
      if (found) return null;
      found = { code: invite.code, inviterId: invite.inviter?.id || invite.inviterId || null, uses, prev };
    }
  }
  return found;
}

/** Rejoin-Schutz: lag der letzte Serververlust weniger als 7 Tage zurück? */
function isRejoinWithinWindow(leftAt, now = Date.now()) {
  if (leftAt == null) return false;
  const ts = Number(leftAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return now - ts < REJOIN_WINDOW_MS;
}

function normalizeRetryDelays(retryDelayMs, retryDelaysMs) {
  if (Array.isArray(retryDelaysMs)) {
    return retryDelaysMs
      .map(Number)
      .filter((ms) => Number.isFinite(ms) && ms > 0)
      .map(Math.floor);
  }
  if (retryDelayMs != null) {
    const ms = Number(retryDelayMs);
    return Number.isFinite(ms) && ms > 0 ? [Math.floor(ms)] : [];
  }
  return [...RETRY_DELAYS_MS];
}

function createInviteXpTracker({
  ctx,
  store,
  logger,
  onLevelChange,
  onXpOnly,
  rng = Math.random,
  retryDelayMs,
  retryDelaysMs,
} = {}) {
  // Pro Server serialisierte Verarbeitung: Fetch, Delta-Verbrauch und Snapshot
  // bleiben atomar zueinander, auch wenn mehrere Nutzer schnell hintereinander
  // beitreten.
  const queues = new Map();
  const permWarned = new Set();
  const knownInvites = new Map(); // guildId -> Map(code -> Metadaten)
  const recentlyDeleted = new Map(); // guildId -> Map(code -> Metadaten + deletedAt)
  const initializedGuilds = new Set(); // vollständiger erfolgreicher Fetch erfolgt
  const retryDelays = normalizeRetryDelays(retryDelayMs, retryDelaysMs);

  function enqueue(guildId, fn) {
    const id = String(guildId || '?');
    const prev = queues.get(id) || Promise.resolve();
    const next = prev.then(fn, fn);
    const guarded = next.catch(() => {});
    queues.set(id, guarded);
    // Abgeschlossene Guild-Queues nicht für immer im RAM behalten.
    void guarded.finally(() => {
      if (queues.get(id) === guarded) queues.delete(id);
    });
    return next;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function guildIdOfInvite(invite) {
    return invite?.guild?.id || invite?.guildId || null;
  }

  function pruneDeleted(guildId, now = Date.now()) {
    const deleted = recentlyDeleted.get(String(guildId));
    if (!deleted) return;
    for (const [code, meta] of deleted.entries()) {
      if (now - Number(meta.deletedAt || 0) > DELETED_INVITE_TTL_MS) deleted.delete(code);
    }
    if (!deleted.size) recentlyDeleted.delete(String(guildId));
  }

  function rememberInviteCollection(guildId, invites) {
    const id = String(guildId);
    const previous = knownInvites.get(id) || new Map();
    const next = new Map();
    if (invites && typeof invites.values === 'function') {
      for (const invite of invites.values()) {
        const meta = inviteMetadata(invite, previous.get(invite?.code));
        if (meta) next.set(meta.code, meta);
      }
    }
    knownInvites.set(id, next);
    initializedGuilds.add(id);
    pruneDeleted(id);
  }

  async function fetchInvites(guild) {
    if (!guild?.invites?.fetch) return null;
    try {
      const invites = await guild.invites.fetch();
      permWarned.delete(guild.id);
      return invites;
    } catch (err) {
      if (!permWarned.has(guild.id)) {
        permWarned.add(guild.id);
        logger?.warn?.(
          `[xp-level-bot] Invite-XP auf ${guild.name || guild.id} vorübergehend inaktiv: Invite-Liste ` +
            `nicht lesbar (Bot braucht die Permission „Server verwalten“ / MANAGE_GUILD): ${err?.message || err}`
        );
      }
      return null;
    }
  }

  /** Holt die Invites und legt Snapshot plus vollständigen Laufzeit-Cache ab. */
  async function refreshSnapshot(guild) {
    const invites = await fetchInvites(guild);
    if (!invites) return null;
    rememberInviteCollection(guild.id, invites);
    store.setInviteSnapshot(guild.id, toInviteSnapshot(invites));
    return invites;
  }

  /** Snapshot für einen einzelnen Server nachholen (z. B. nach /setup). */
  async function syncGuild(guild) {
    if (!guild) return null;
    return enqueue(guild.id, () => refreshSnapshot(guild)).catch(() => null);
  }

  /**
   * Snapshot für alle eingerichteten Server nach Ready nachholen. Alle Jobs
   * werden sofort eingereiht (nicht serverweise nacheinander), damit ein Join
   * auf dem letzten Server nicht vor dessen Start-Snapshot vorbeirutschen kann.
   */
  async function syncAllSnapshots() {
    const jobs = [];
    for (const cfg of store.getAllGuilds()) {
      if (!cfg.leaderboardChannelId) continue;
      const guild = ctx?.client?.guilds?.cache?.get(cfg.guildId);
      if (!guild) continue;
      jobs.push(enqueue(cfg.guildId, () => refreshSnapshot(guild)));
    }
    await Promise.allSettled(jobs);
  }

  /** Invite wurde zur Laufzeit erstellt: sofort eine 0/uses-Baseline merken. */
  function handleInviteCreate(invite) {
    const guildId = guildIdOfInvite(invite);
    const code = invite?.code;
    if (!guildId || !code) return;
    const id = String(guildId);
    let known = knownInvites.get(id);
    if (!known) {
      known = new Map();
      knownInvites.set(id, known);
    }
    const meta = inviteMetadata(invite, known.get(code));
    if (meta) known.set(code, meta);
    recentlyDeleted.get(id)?.delete(code);

    const snapshot = store.getInviteSnapshot(id)?.data || {};
    snapshot[code] = inviteUses(invite);
    store.setInviteSnapshot(id, snapshot);
  }

  /**
   * Gelöschte Limit-Invites kurz behalten. Discord entfernt einen Invite mit
   * maxUses=1 häufig schon vor unserem REST-Fetch; ohne diesen Cache wäre sein
   * Ersteller anschließend nicht mehr bestimmbar.
   */
  function handleInviteDelete(invite) {
    const guildId = guildIdOfInvite(invite);
    const code = invite?.code;
    if (!guildId || !code) return;
    const id = String(guildId);
    const known = knownInvites.get(id)?.get(code) || null;
    const meta = inviteMetadata(invite, known);
    if (!meta) return;
    let deleted = recentlyDeleted.get(id);
    if (!deleted) {
      deleted = new Map();
      recentlyDeleted.set(id, deleted);
    }
    deleted.set(code, { ...meta, deletedAt: Date.now() });
  }

  function forgetGuild(guildId) {
    const id = String(guildId);
    queues.delete(id);
    permWarned.delete(id);
    knownInvites.delete(id);
    recentlyDeleted.delete(id);
    initializedGuilds.delete(id);
  }

  /**
   * Ermittelt alle plausiblen Deltas. Neben normalen Counter-Erhöhungen werden
   * neue Invites (nach vollständigem Runtime-Sync) und gerade verschwundene
   * Limit-Invites berücksichtigt.
   */
  function resolveUsedInvite(guildId, baseline, invites, now = Date.now()) {
    if (!baseline || typeof baseline !== 'object') {
      return { used: null, reason: 'no-baseline', candidates: [] };
    }
    const id = String(guildId);
    const candidates = [];
    const currentCodes = new Set();

    if (invites && typeof invites.values === 'function') {
      for (const invite of invites.values()) {
        if (!invite?.code) continue;
        const code = String(invite.code);
        currentCodes.add(code);
        const uses = inviteUses(invite);
        const knownInBaseline = Object.prototype.hasOwnProperty.call(baseline, code);
        const prev = knownInBaseline ? snapshotUses(baseline[code]) : 0;
        if (uses > prev && (knownInBaseline || initializedGuilds.has(id))) {
          candidates.push({
            code,
            inviterId: invite.inviter?.id || invite.inviterId || null,
            uses,
            prev,
            maxUses: inviteMaxUses(invite),
            source: knownInBaseline ? 'counter' : 'new-invite',
          });
        }
      }
    }

    // Beim letzten Use eines limitierten Invites fehlt der Code in der
    // aktuellen Liste. Die alte Baseline + Metadaten liefern den Ersteller.
    const deleted = recentlyDeleted.get(id);
    const known = knownInvites.get(id);
    for (const [code, rawPrev] of Object.entries(baseline)) {
      if (currentCodes.has(code)) continue;
      const prev = snapshotUses(rawPrev);
      const deletedMeta = deleted?.get(code) || null;
      const meta = deletedMeta || known?.get(code) || null;
      const maxUses = inviteMaxUses(meta);
      if (!meta || maxUses <= prev) continue;
      const deletionIsFresh = deletedMeta && now - Number(deletedMeta.deletedAt || 0) <= DELETED_INVITE_TTL_MS;
      // Ohne InviteDelete-Event nur den eindeutigen letzten Use ableiten. Bei
      // mehreren verbleibenden Uses wäre auch eine manuelle Löschung möglich.
      if (!deletionIsFresh && maxUses - prev !== 1) continue;
      candidates.push({
        code,
        inviterId: meta.inviterId || null,
        uses: prev + 1,
        prev,
        maxUses,
        source: 'deleted-limit',
      });
    }

    if (candidates.length === 1) return { used: candidates[0], reason: null, candidates };
    if (candidates.length > 1) {
      // Mehrere Links desselben Erstellers sind für die XP-Zuordnung trotzdem
      // eindeutig. Welcher seiner Links es exakt war, ist für die Belohnung egal.
      const inviters = new Set(candidates.map((c) => c.inviterId).filter(Boolean));
      if (inviters.size === 1 && candidates.every((c) => c.inviterId)) {
        return { used: candidates[0], reason: null, candidates };
      }
      return { used: null, reason: 'ambiguous', candidates };
    }
    return { used: null, reason: 'no-delta', candidates };
  }

  /** Schreibt nur EIN verbrauchtes Delta fort, nicht blind den ganzen Sprung. */
  function snapshotAfterResolution(baseline, invites, used, allCandidates = []) {
    const next = toInviteSnapshot(invites);
    if (!used) return next;

    // Falls mehrere geänderte Links demselben Ersteller gehören, ist der
    // XP-Empfänger eindeutig. Nicht ausgewählte Deltas bleiben trotzdem für
    // die bereits eingereihten nächsten Join-Events offen.
    const candidates = allCandidates.length ? allCandidates : [used];
    for (const candidate of candidates) {
      const selected = candidate === used;
      const consumedUses = candidate.prev + (selected ? 1 : 0);
      if (candidate.source === 'deleted-limit') {
        if (consumedUses < candidate.maxUses) next[candidate.code] = consumedUses;
      } else if (consumedUses < candidate.uses) {
        // z. B. uses 4 bei Baseline 2: Dieser Join verbraucht 2→3, der bereits
        // eingereihte nächste Join darf anschließend noch 3→4 verbrauchen.
        next[candidate.code] = consumedUses;
      }
    }
    return next;
  }

  /**
   * Einstiegspunkt bei guildMemberAdd. Läuft über die Per-Guild-Queue, damit
   * mehrere Joins nacheinander korrekt aufgelöst werden.
   */
  function handleGuildMemberAdd(member) {
    return enqueue(member?.guild?.id || '?', () => processMemberAdd(member));
  }

  async function processMemberAdd(member) {
    const guild = member?.guild;
    if (!guild) return { awarded: false, reason: 'no-guild' };
    const cfg = store.getGuild(guild.id);
    if (!cfg || !cfg.leaderboardChannelId) return { awarded: false, reason: 'no-setup' };

    const now = Date.now();
    const isBot = member.user?.bot === true;

    // Rejoin-Eintrag sofort verbrauchen. Die Invite-Auflösung läuft trotzdem,
    // damit dieser Join nicht das Delta des nächsten neuen Nutzers verschiebt.
    const leftAt = isBot ? null : store.getLeaveRecord(guild.id, member.id);
    if (leftAt != null) store.deleteLeaveRecord(guild.id, member.id);
    const protectedRejoin = !isBot && isRejoinWithinWindow(leftAt, now);

    const baseline = store.getInviteSnapshot(guild.id)?.data || null;
    let invites = null;
    let resolution = { used: null, reason: 'no-delta', candidates: [] };

    // Sofortiger Fetch + mehrere gestaffelte Nachprüfungen. Dieselbe Baseline
    // bleibt während aller Versuche erhalten.
    const attempts = [0, ...retryDelays];
    for (let i = 0; i < attempts.length; i++) {
      if (attempts[i] > 0) await sleep(attempts[i]);
      const fetched = await fetchInvites(guild);
      if (!fetched) continue;
      invites = fetched;
      resolution = resolveUsedInvite(guild.id, baseline, invites, Date.now());
      if (resolution.used || resolution.reason === 'ambiguous') break;
    }

    if (!invites) {
      if (protectedRejoin) return { awarded: false, reason: 'rejoin-within-window' };
      if (isBot) return { awarded: false, reason: 'bot' };
      return { awarded: false, reason: 'invites-unavailable' };
    }

    const used = resolution.used;
    const nextSnapshot = snapshotAfterResolution(baseline, invites, used, resolution.candidates);
    store.setInviteSnapshot(guild.id, nextSnapshot);
    rememberInviteCollection(guild.id, invites);

    if (used?.source === 'deleted-limit') {
      const consumedUses = used.prev + 1;
      if (consumedUses < used.maxUses) {
        let deleted = recentlyDeleted.get(String(guild.id));
        if (!deleted) {
          deleted = new Map();
          recentlyDeleted.set(String(guild.id), deleted);
        }
        deleted.set(used.code, { ...used, uses: consumedUses, deletedAt: Date.now() });
      } else {
        recentlyDeleted.get(String(guild.id))?.delete(used.code);
      }
    }

    if (isBot) return { awarded: false, reason: 'bot', inviteConsumed: Boolean(used) };
    if (protectedRejoin) {
      logger?.info?.(
        `[xp-level-bot] Rejoin-Schutz ${guild.name || guild.id}: ${member.id} kam nach ` +
          `${Math.round((now - Number(leftAt)) / 3600000)} h zurück – keine Invite-XP, keine Nachricht`
      );
      return { awarded: false, reason: 'rejoin-within-window', inviteConsumed: Boolean(used) };
    }
    if (!used) {
      if (resolution.reason === 'ambiguous') {
        logger?.warn?.(
          `[xp-level-bot] Invite-XP auf ${guild.name || guild.id} nicht eindeutig: ` +
            `${resolution.candidates.length} Invite-Zähler haben sich gleichzeitig geändert.`
        );
        return { awarded: false, reason: 'invite-ambiguous' };
      }
      return { awarded: false, reason: 'no-invite-delta' };
    }
    if (!used.inviterId || used.inviterId === member.id) {
      return { awarded: false, reason: 'no-inviter' };
    }

    // Invite-Ersteller prüfen. Cache-Miss allein darf keine Belohnung kosten.
    let inviterMember = guild.members?.cache?.get?.(used.inviterId);
    if (!inviterMember) {
      try {
        inviterMember = await guild.members.fetch(used.inviterId).catch(() => null);
      } catch {
        inviterMember = null;
      }
    }
    if (!inviterMember) return { awarded: false, reason: 'inviter-left' };
    if (inviterMember.user?.bot) return { awarded: false, reason: 'inviter-bot' };

    // XP vergeben (wie Bonus-XP: zählt als Aktivität, kein 30s-Cooldown).
    const xp = rollInviteXp(rng);
    const user = store.ensureUser(guild.id, used.inviterId);
    const res = applyXpGain(user, xp);
    user.level = res.level;
    user.xp = res.xp;
    user.lastActivity = now;
    user.inactiveDays = 0;
    store.setUser(user);
    void require('./inactive-role')
      .clearInactiveRoleForUser(ctx, guild, used.inviterId)
      .catch(() => {});

    // Invite-Belohnungen inklusive verbrauchtem Snapshot sofort sichern. So
    // verschwinden sie bei einem Restart innerhalb des 5-Minuten-Backups nicht.
    const awardFlush = store.flush().catch((err) =>
      logger?.warn?.('[xp-level-bot] Invite-XP Flush fehlgeschlagen:', err?.message || err)
    );

    // Sichtbare Invite-Belohnung zuerst senden.
    const announced = await sendInviteAnnouncement({
      ctx,
      guild,
      cfg,
      inviterId: used.inviterId,
      joinedId: member.id,
      xp,
    });

    try {
      if (res.leveledUp || res.leveledDown) {
        if (onLevelChange) await onLevelChange(guild, cfg, user, res);
      } else if (onXpOnly) {
        await onXpOnly(guild, cfg, user, used.inviterId);
      }
    } catch (err) {
      logger?.warn?.('[xp-level-bot] Invite-XP Level-Up-Nachbereitung fehlgeschlagen:', err?.message || err);
    }
    await awardFlush;

    logger?.info?.(
      `[xp-level-bot] Invite-XP: ${member.id} über Invite ${used.code} beigetreten → ` +
        `${used.inviterId} bekommt ${xp} XP (${guild.name || guild.id}, ` +
        `${announced ? 'Nachricht gesendet' : 'Nachricht fehlgeschlagen'})`
    );
    return { awarded: true, xp, inviterId: used.inviterId, announced };
  }

  /**
   * Invite-Ankündigung im Haupt-Chat: Components V2 (Container mit `## `-Zeile)
   * mit Text-Fallback. Fallback: Haupt-Chat → Leaderboard → Systemkanal.
   */
  async function sendInviteAnnouncement({ ctx: sendCtx, guild, cfg, inviterId, joinedId, xp }) {
    const lang = cfg.lang || 'de';
    const vars = { inviter: `<@${inviterId}>`, joined: `<@${joinedId}>`, xp };
    const text = t('inviteXp', lang, vars);
    const errors = [];
    const payloads = {
      componentsPayload: componentsV2Payload([buildInviteXpEmbed({ lang, inviterId, joinedId, xp })]),
      textPayload: { content: `## ${text}` },
    };

    const candidates = [];
    const main = await resolveMainChannel(guild, cfg.mainChannelId).catch(() => null);
    if (main) candidates.push(main);
    if (String(cfg.mainChannelId) !== String(cfg.leaderboardChannelId || '')) {
      const lb = await resolveMainChannel(guild, cfg.leaderboardChannelId).catch(() => null);
      if (lb) candidates.push(lb);
    }
    if (isSendableTextChannel(guild?.systemChannel)) candidates.push(guild.systemChannel);

    for (const channel of candidates) {
      if (await sendWithTextFallback((p) => channel.send(p), payloads, errors, 'invite-channel')) return true;
    }
    sendCtx?.logger?.warn?.(
      `[xp-level-bot] Invite-XP-Nachricht konnte nicht gesendet werden ` +
        `(${guild?.name || cfg.guildId}, User ${joinedId}): ${errors.join(' | ') || 'kein Kanal erreichbar'}`
    );
    return false;
  }

  /** Einstiegspunkt bei guildMemberRemove: Leave-Zeitpunkt für den Rejoin-Schutz merken. */
  function handleGuildMemberRemove(member) {
    const guild = member?.guild;
    if (!guild || member.user?.bot) return;
    const cfg = store.getGuild(guild.id);
    if (!cfg || !cfg.leaderboardChannelId) return;
    store.pruneLeaveRecords(guild.id, Date.now() - REJOIN_WINDOW_MS);
    store.setLeaveRecord(guild.id, member.id, Date.now());
  }

  return {
    handleGuildMemberAdd,
    handleGuildMemberRemove,
    handleInviteCreate,
    handleInviteDelete,
    forgetGuild,
    syncGuild,
    syncAllSnapshots,
    refreshSnapshot,
    _queues: queues,
    _knownInvites: knownInvites,
    _recentlyDeleted: recentlyDeleted,
  };
}

module.exports = {
  createInviteXpTracker,
  rollInviteXp,
  toInviteSnapshot,
  detectUsedInvite,
  isRejoinWithinWindow,
  INVITE_XP_MIN,
  INVITE_XP_MAX,
  REJOIN_WINDOW_MS,
  RETRY_DELAY_MS,
  RETRY_DELAYS_MS,
  DELETED_INVITE_TTL_MS,
};
