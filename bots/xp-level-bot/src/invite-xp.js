/**
 * Invite-XP: Wer über einen Invite-Link beitritt, belohnt den Invite-Ersteller.
 *
 * Ablauf bei `guildMemberAdd`:
 *   1. Nur Server mit /setup (leaderboardChannelId) werden behandelt, Bots nie.
 *   2. Rejoin-Schutz: War der Beitretende innerhalb der letzten 7 Tage schon
 *      einmal auf dem Server und ist dann gegangen (Leave-Log im Store), wird
 *      WEDER XP vergeben NOCH eine Nachricht gesendet – egal über welchen
 *      Invite und egal wem er gehört. Der Leave-Eintrag wird dabei verbraucht.
 *   3. Invite-Erkennung über das Delta der `uses`-Zähler: Der Invite-Snapshot
 *      (code -> uses) wird vorher/nachher verglichen. Genau EIN Invite darf
 *      sich erhöht haben, sonst ist die Zuordnung mehrdeutig (kein XP).
 *      Discord spiegelt den Use-Count manchmal erst kurz nach dem Event wider,
 *      deshalb wird einmal mit kurzer Verzögerung nachgeprüft.
 *   4. Nur Invites MIT Invite-Ersteller zählen (Vanity-/Link-lose Invites
 *      haben keinen). Der Ersteller muss noch Mitglied sein und kein Bot.
 *   5. XP: Zufallswert 40–80, wird wie Bonus-XP vergeben (lastActivity,
 *      Levelwechsel lösen die normale Level-Up-Nachbereitung aus).
 *   6. Nachricht im Haupt-Chat aus /setup, gleiche Optik wie Level-Up:
 *      `## `-Überschrift (größerer Text), Components V2 mit Text-Fallback.
 *
 * Der Invite-Fetch braucht die Permission MANAGE_GUILD („Server verwalten“).
 * Fehlt sie, läuft der Rest des Bots normal weiter – Invite-XP ist dann
 * einfach inaktiv (einmalige Warnung pro Server im Log).
 */

const { t } = require('./languages');
const { applyXpGain } = require('./logic');
const { componentsV2Payload } = require('./message-payload');
const { buildInviteXpEmbed } = require('./embed-builder');
const { resolveMainChannel, sendWithTextFallback, isSendableTextChannel } = require('./level-announcements');

const INVITE_XP_MIN = 40;
const INVITE_XP_MAX = 80;
const REJOIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage Rejoin-Schutz
const RETRY_DELAY_MS = 1500; // Discord aktualisiert Invite-Uses ggf. kurz verzögert

/** Zufällige Invite-Belohnung (40–80 XP, Ganzzahl). rng injizierbar für Tests. */
function rollInviteXp(rng = Math.random) {
  return INVITE_XP_MIN + Math.floor(rng() * (INVITE_XP_MAX - INVITE_XP_MIN + 1));
}

function inviteUses(invite) {
  const n = Number(invite?.uses);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
 * Vergleicht die aktuellen `uses` mit dem Snapshot. Nur wenn GENAU EIN Invite
 * mehr Uses hat, ist die Zuordnung eindeutig.
 *
 * @param {Object|null} snapshot  {code: uses} aus dem Store (vor dem Beitritt)
 * @param {Iterable}    invites   aktuelle Invites (Collection/Map)
 * @returns {{code:string, inviterId:string|null, uses:number, prev:number}|null}
 */
function detectUsedInvite(snapshot, invites) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (!invites || typeof invites.values !== 'function') return null;
  let found = null;
  for (const invite of invites.values()) {
    const prev = snapshot[invite.code];
    if (prev == null) continue; // Invite unbekannt -> kein Delta möglich
    const uses = inviteUses(invite);
    if (uses > prev) {
      if (found) return null; // mehr als einer erhöht -> mehrdeutig, kein XP
      found = { code: invite.code, inviterId: invite.inviter?.id || null, uses, prev };
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

function createInviteXpTracker({ ctx, store, logger, onLevelChange, onXpOnly, rng = Math.random, retryDelayMs = RETRY_DELAY_MS }) {
  // Pro Server serialisierte Verarbeitung: Zwei Joins in schneller Folge dürfen
  // sich die Invite-Deltas nicht gegenseitig kaputt machen (Fetch + Snapshot
  // müssen immer in derselben Reihenfolge wie die Events laufen).
  const queues = new Map();
  const permWarned = new Set(); // Server, für die die fehlende Permission schon geloggt wurde

  function enqueue(guildId, fn) {
    const prev = queues.get(guildId) || Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(guildId, next.catch(() => {}));
    return next;
  }

  // Bewusst OHNE unref: Ein Timer, der kurz vor dem Shutdown läuft, hält den
  // Prozess maximal retryDelayMs (Standard 1,5 s) am Leben – das ist ok und
  // verhindert, dass Tests/Prozesse den ausstehenden Retry verschlucken.
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchInvites(guild) {
    if (!guild?.invites?.fetch) return null;
    try {
      return await guild.invites.fetch();
    } catch (err) {
      if (!permWarned.has(guild.id)) {
        permWarned.add(guild.id);
        logger?.warn?.(
          `[xp-level-bot] Invite-XP auf ${guild.name || guild.id} inaktiv: Invite-Liste ` +
            `nicht lesbar (Bot braucht die Permission „Server verwalten“ / MANAGE_GUILD): ${err?.message || err}`
        );
      }
      return null;
    }
  }

  /** Holt die Invites und legt den frischen Snapshot ab. @returns Invites oder null */
  async function refreshSnapshot(guild) {
    const invites = await fetchInvites(guild);
    if (!invites) return null;
    store.setInviteSnapshot(guild.id, toInviteSnapshot(invites));
    return invites;
  }

  /** Snapshot für einen einzelnen Server nachholen (z. B. bei guildCreate). */
  async function syncGuild(guild) {
    if (!guild) return;
    await enqueue(guild.id, () => refreshSnapshot(guild)).catch(() => {});
  }

  /** Snapshot für alle eingerichteten Server nachholen (nach Ready). */
  async function syncAllSnapshots() {
    const guilds = store.getAllGuilds();
    for (const cfg of guilds) {
      const guild = ctx?.client?.guilds?.cache?.get(cfg.guildId);
      if (!guild) continue;
      if (!cfg.leaderboardChannelId) continue;
      await enqueue(cfg.guildId, () => refreshSnapshot(guild)).catch(() => {});
    }
  }

  /**
   * Einstiegspunkt bei guildMemberAdd. Läuft über die Per-Guild-Queue, damit
   * mehrere Joins nacheinander korrekt aufgelöst werden.
   * @returns {Promise<{awarded:boolean, reason?:string, xp?:number, inviterId?:string, announced?:boolean}>}
   */
  function handleGuildMemberAdd(member) {
    return enqueue(member?.guild?.id || '?', () => processMemberAdd(member));
  }

  async function processMemberAdd(member) {
    const guild = member?.guild;
    if (!guild) return { awarded: false, reason: 'no-guild' };
    if (member.user?.bot) return { awarded: false, reason: 'bot' };
    const cfg = store.getGuild(guild.id);
    // Nur eingerichtete Server (wie Bonus/XP): ohne /setup kein Invite-XP
    if (!cfg || !cfg.leaderboardChannelId) return { awarded: false, reason: 'no-setup' };

    const now = Date.now();

    // ---- Rejoin-Schutz (7 Tage) -------------------------------------------
    // Wird der Leave-Eintrag gefunden, ist er IMMER verbraucht: Innerhalb des
    // Fensters blockt er XP + Nachricht, außerhalb ist er nur Müll.
    const leftAt = store.getLeaveRecord(guild.id, member.id);
    if (leftAt != null) store.deleteLeaveRecord(guild.id, member.id);
    if (isRejoinWithinWindow(leftAt, now)) {
      logger?.info?.(
        `[xp-level-bot] Rejoin-Schutz ${guild.name || guild.id}: ${member.id} kam nach ` +
          `${Math.round((now - Number(leftAt)) / 3600000)} h zurück – keine Invite-XP, keine Nachricht`
      );
      // Snapshot trotzdem aktualisieren, damit die Deltas für künftige Joins stimmen.
      await refreshSnapshot(guild).catch(() => {});
      return { awarded: false, reason: 'rejoin-within-window' };
    }

    // ---- Invite-Delta bestimmen -------------------------------------------
    const baseline = store.getInviteSnapshot(guild.id)?.data || null;
    let invites = await fetchInvites(guild);
    if (!invites) return { awarded: false, reason: 'invites-unavailable' };
    let used = detectUsedInvite(baseline, invites);
    if (!used && retryDelayMs > 0) {
      // Discord spiegelt den Use-Count manchmal erst einen Moment nach dem
      // Join-Event wider – einmal kurz warten und gegen dieselbe Baseline
      // erneut prüfen.
      await sleep(retryDelayMs);
      const retry = await fetchInvites(guild);
      if (retry) {
        invites = retry;
        used = detectUsedInvite(baseline, invites);
      }
    }
    store.setInviteSnapshot(guild.id, toInviteSnapshot(invites));
    if (!used) return { awarded: false, reason: 'no-invite-delta' };
    if (!used.inviterId || used.inviterId === member.id) {
      return { awarded: false, reason: 'no-inviter' };
    }

    // ---- Invite-Ersteller prüfen ------------------------------------------
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

    // ---- XP vergeben (wie Bonus-XP: zählt als Aktivität, kein 30s-Cooldown)
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
    const levelFlush = res.leveled ? store.flush().catch(() => {}) : null;

    // ---- Nachricht im Haupt-Chat (## -Überschrift wie Level-Up) ------------
    const announced = await sendInviteAnnouncement({
      ctx,
      guild,
      cfg,
      inviterId: used.inviterId,
      joinedId: member.id,
      xp,
    });

    // ---- Levelwechsel / Top-3-Nickname wie bei Bonus-XP ---------------------
    try {
      if (res.leveledUp || res.leveledDown) {
        if (onLevelChange) await onLevelChange(guild, cfg, user, res);
      } else if (onXpOnly) {
        await onXpOnly(guild, cfg, user, used.inviterId);
      }
    } catch (err) {
      logger?.warn?.('[xp-level-bot] Invite-XP Level-Up-Nachbereitung fehlgeschlagen:', err?.message || err);
    }
    if (levelFlush) await levelFlush;

    logger?.info?.(
      `[xp-level-bot] Invite-XP: ${member.id} über Invite ${used.code} beigetreten → ` +
        `${used.inviterId} bekommt ${xp} XP (${guild.name || guild.id}, ` +
        `${announced ? 'Nachricht gesendet' : 'Nachricht fehlgeschlagen'})`
    );
    return { awarded: true, xp, inviterId: used.inviterId, announced };
  }

  /**
   * Invite-Ankündigung im Haupt-Chat: Components V2 (Container mit `## `-Zeile,
   * gleiche Schriftgröße wie Level-Up) mit Text-Fallback. Fallback-Kette:
   * Haupt-Chat aus /setup → Leaderboard-Kanal → Systemkanal.
   */
  async function sendInviteAnnouncement({ ctx, guild, cfg, inviterId, joinedId, xp }) {
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
    ctx?.logger?.warn?.(
      `[xp-level-bot] Invite-XP-Nachricht konnte nicht gesendet werden ` +
        `(${guild?.name || cfg.guildId}, User ${joinedId}): ${errors.join(' | ') || 'kein Kanal erreichbar'}`
    );
    return false;
  }

  /** Einstiegspunkt bei guildMemberRemove: Leave-Zeitpunkt für den Rejoin-Schutz merken. */
  function handleGuildMemberRemove(member) {
    const guild = member?.guild;
    if (!guild) return;
    if (member.user?.bot) return;
    const cfg = store.getGuild(guild.id);
    if (!cfg || !cfg.leaderboardChannelId) return;
    // Alte Leave-Einträge (älter als 7 Tage) aufräumen, dann den neuen setzen.
    store.pruneLeaveRecords(guild.id, Date.now() - REJOIN_WINDOW_MS);
    store.setLeaveRecord(guild.id, member.id, Date.now());
  }

  return {
    handleGuildMemberAdd,
    handleGuildMemberRemove,
    syncGuild,
    syncAllSnapshots,
    refreshSnapshot,
    _queues: queues,
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
};
