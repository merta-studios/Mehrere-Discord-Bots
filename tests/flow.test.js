/**
 * Flow-Test mit gemockten Discord-Objekten: validiert die Verdrahtung
 * der Interaktions-Handler (Button → Modal → Bestätigung → Eintrag).
 *
 * Getestet wird ohne echte Discord-Verbindung:
 * - „Geburtstag eintragen“-Button öffnet das Formular
 * - Formular-Absenden erzeugt die Bestätigungsnachricht als Container –
 *   ephemer, also nur für die eintragende Person sichtbar
 * - Bestätigen/Abbrechen/Bearbeiten ersetzt die ephemere Bestätigung in-place
 * - Bestätigen mit gültigem Datum (≥ 7 Tage) trägt ein + aktualisiert die Liste
 * - Bestätigen mit zu nahem Datum wird durch die 7-Tage-Regel blockiert
 * - /setup ist nur für Admins erlaubt
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const { createStore } = require('../bots/birthday-bot/src/store');
const { handleInteraction } = require('../bots/birthday-bot/src/interactions');
const { buildListEmbed, extractAllText } = require('../bots/birthday-bot/src/embed-builder');
const { todayKey, tzParts } = require('../bots/birthday-bot/src/logic');

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeHarness({ lang = 'de' } = {}) {
  const sent = []; // alle Nachrichten, die der „Channel“ je bekam

  function makeListMessage(entry) {
    return {
      id: entry.messageId,
      author: { id: 'bot1' },
      components: [buildListEmbed({ birthdays: entry.birthdays, lang: entry.lang }).toJSON()],
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
      edit: async (payload) => {
        if (payload.components) {
          msg.components = payload.components.map((c) => (c.toJSON ? c.toJSON() : c));
        }
        if (payload.embeds) {
          msg.embeds = payload.embeds.map((e) => (e.toJSON ? e.toJSON() : e));
        }
        if (payload.flags !== undefined) msg.flags = payload.flags;
        return msg;
      },
      delete: async () => {},
    };
  }
  let msg = null;

  const channel = {
    id: 'ch1',
    type: 0,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'object') {
          // { after, limit } → alle nach dieser ID
          const map = new Map();
          if (msg && msg.id > arg.after) map.set(msg.id, msg);
          return map;
        }
        if (arg === 'm1') return msg;
        return sent.find((m) => m.id === arg) || null;
      },
    },
    send: async (payload) => {
      const m = {
        id: `sent${sent.length + 1}`,
        components: payload.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || [],
        embeds: payload.embeds?.map((e) => (e.toJSON ? e.toJSON() : e)) || [],
        flags: payload.flags,
        delete: async () => {},
      };
      sent.push(m);
      return m;
    },
  };

  const guild = {
    id: 'g1',
    name: 'Testgilde',
    members: {
      cache: new Map(),
      fetch: async () => ({ id: 'u1', displayAvatarURL: () => 'https://example.com/a.png' }),
    },
    channels: {
      fetch: async () => [channel],
      cache: [channel],
    },
  };

  const client = {
    user: { id: 'bot1' },
    guilds: { cache: new Map([['g1', guild]]) },
    channels: { fetch: async () => channel },
  };

  const ctx = {
    client,
    token: 'test-token',
    ownerId: 'owner1',
    logger: { info() {}, warn() {}, error() {} },
    env: () => '',
    rest: { patch: async () => {} },
    store: createStore({ client, logger: { warn() {} } }),
    pending: new Map(),
    pendingAdmin: new Map(),
    panelSessions: new Map(),
  };

  const entry = {
    guildId: 'g1',
    channelId: 'ch1',
    messageId: 'm1',
    lang,
    birthdays: [],
    lastRenderDay: todayKey(lang),
    lastBirthdayCheckDay: todayKey(lang),
  };
  msg = makeListMessage(entry);
  ctx.store.set(entry);

  const replies = [];
  const follows = [];
  const modals = [];
  const updates = [];

  function makeInteraction(overrides = {}) {
    const customId = overrides.customId || 'bday_add';
    return {
      user: { id: 'u1', username: 'Tester' },
      guildId: 'g1',
      guild,
      locale: 'de',
      channel,
      customId,
      deferred: false,
      replied: false,
      memberPermissions: { has: () => true },
      inGuild: () => true,
      isChatInputCommand: () => false,
      isButton: () => customId !== 'bday_modal' && customId !== 'admin_bday_modal',
      isModalSubmit: () => customId === 'bday_modal' || customId === 'admin_bday_modal',
      isStringSelectMenu: () => false,
      reply: async (p) => {
        replies.push(p);
      },
      followUp: async (p) => {
        follows.push(p);
      },
      deferUpdate: async () => {},
      deferReply: async () => {},
      showModal: async (m) => {
        modals.push(m);
      },
      update: async (p) => {
        updates.push(p);
      },
      editReply: async () => {},
      message: { embeds: [], components: [], delete: async () => {} },
      fields: { getTextInputValue: () => '' },
      options: {
        getString: (name) => (name === 'language' ? 'de' : null),
        getChannel: () => channel,
      },
      ...overrides,
    };
  }

  return { ctx, channel, entry, msg, sent, replies, follows, modals, updates, makeInteraction };
}

/** Datum, das in `days` Tagen liegt (nur Monat/Tag). */
function dateIn(days) {
  const t = tzParts('Europe/Berlin');
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1 };
}

test('„Geburtstag eintragen“-Button öffnet das Formular', async () => {
  const h = makeHarness();
  const interaction = h.makeInteraction({ customId: 'bday_add' });
  await handleInteraction(h.ctx, interaction);
  assert.equal(h.modals.length, 1);
  assert.equal(h.modals[0].data.custom_id, 'bday_modal');
});

test('Formular-Absenden erzeugt genau eine ephemere Bestätigungsnachricht (Container)', async () => {
  const h = makeHarness();
  const good = dateIn(20); // weit genug weg
  const interaction = h.makeInteraction({
    customId: 'bday_modal',
    fields: {
      getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)),
    },
  });
  await handleInteraction(h.ctx, interaction);

  assert.equal(h.sent.length, 0, 'Keine zweite Kanalnachricht wird erzeugt');
  assert.equal(h.replies.length, 1, 'Die Modal-Antwort ist die einzige Bestätigung');
  assert.equal(h.replies[0].ephemeral, undefined, 'Kein veraltetes ephemeral-Feld');
  assert.equal(
    h.replies[0].flags,
    MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    'Bestätigung ist ephemer – nur für die eintragende Person sichtbar'
  );
  assert.equal(h.replies[0].components.length, 1);
  assert.ok(h.ctx.pending.has('u1'), 'Pending-Eintrag gespeichert');
});

test('Formular mit Tippfehler im Monat erkennt September trotzdem', async () => {
  const h = makeHarness();
  const good = dateIn(20);
  const interaction = h.makeInteraction({
    customId: 'bday_modal',
    fields: {
      getTextInputValue: (id) => (id === 'day' ? String(good.day) : 'Sebtemger'),
    },
  });
  await handleInteraction(h.ctx, interaction);

  assert.equal(h.sent.length, 0);
  assert.equal(h.replies.length, 1);
  const text = extractAllText(h.replies[0]);
  assert.match(text, /September/);
  const pending = h.ctx.pending.get('u1');
  assert.equal(pending.month, 9);
  assert.equal(pending.fuzzy, true);
});

test('Bestätigen trägt den Geburtstag ein und aktualisiert das Listen-Embed', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  // 1. Modal absenden
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );

  // 2. Bestätigen
  const confirmInteraction = h.makeInteraction({ customId: 'bday_confirm_yes' });
  await handleInteraction(h.ctx, confirmInteraction);

  const entry = h.ctx.store.get('g1');
  assert.equal(entry.birthdays.length, 1, 'Geburtstag ist eingetragen');
  assert.equal(entry.birthdays[0].userId, 'u1');
  assert.equal(entry.birthdays[0].day, good.day);
  assert.equal(entry.birthdays[0].month, good.month);
  assert.equal(h.follows.length, 1, 'Erfolgsmeldung kam');
  assert.equal(
    h.follows[0].flags,
    MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    'Ephemere V2-Antwort enthält beide benötigten Flags'
  );
  assert.equal(h.msg.flags, MessageFlags.IsComponentsV2, 'Listen-Edit behält Components V2 bei');
  assert.ok(!h.ctx.pending.has('u1'), 'Pending aufgeräumt');
});

test('Bestätigen mit doppeltem Eintrag ersetzt den alten', async () => {
  const h = makeHarness();
  const good = dateIn(20);
  const other = dateIn(60);
  h.entry.birthdays = [{ userId: 'u1', day: other.day, month: other.month }];

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_confirm_yes' }));

  const entry = h.ctx.store.get('g1');
  assert.equal(entry.birthdays.length, 1, 'Kein Doppel-Eintrag');
  assert.equal(entry.birthdays[0].day, good.day, 'Neuer Tag');
  assert.equal(entry.birthdays[0].month, good.month, 'Neuer Monat');
});

test('7-Tage-Regel blockiert Geburtstage in weniger als 7 Tagen', async () => {
  const h = makeHarness();
  const tooSoon = dateIn(2);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(tooSoon.day) : String(tooSoon.month)) },
    })
  );
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_confirm_yes' }));

  const entry = h.ctx.store.get('g1');
  assert.equal(entry.birthdays.length, 0, 'Nichts eingetragen');
  assert.equal(h.follows.length, 1);
  const text = extractAllText(h.follows[0]);
  assert.match(text, /Zu früh zum Eintragen!/);
});

test('Abbrechen löscht die Bestätigung ohne Eintrag', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_confirm_no' }));

  assert.equal(h.ctx.store.get('g1').birthdays.length, 0);
  assert.ok(!h.ctx.pending.has('u1'));
});

/** Mock einer ephemeren Bestätigungsnachricht; trackt Löschversuche. */
function ephemeralConfirmationMessage(state) {
  return {
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    embeds: [],
    components: [],
    delete: async () => {
      state.deleted = true;
    },
  };
}

test('Bestätigen ersetzt die ephemere Bestätigung in-place (kein Löschen, keine Folgenachricht)', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );

  const state = { deleted: false };
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_confirm_yes',
      message: ephemeralConfirmationMessage(state),
    })
  );

  assert.equal(state.deleted, false, 'Ephemere Nachricht wird nicht gelöscht (wäre unmöglich)');
  assert.equal(h.updates.length, 1, 'Erfolgsmeldung ersetzt die Bestätigung in-place');
  assert.equal(h.follows.length, 0, 'Keine zusätzliche Folgenachricht nötig');
  assert.equal(h.updates[0].flags, MessageFlags.IsComponentsV2);
  assert.match(extractAllText(h.updates[0]), /wurde eingetragen/);

  const entry = h.ctx.store.get('g1');
  assert.equal(entry.birthdays.length, 1, 'Geburtstag ist eingetragen');
  assert.ok(!h.ctx.pending.has('u1'), 'Pending aufgeräumt');
});

test('7-Tage-Regel ersetzt die ephemere Bestätigung in-place durch den Fehler', async () => {
  const h = makeHarness();
  const tooSoon = dateIn(2);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: {
        getTextInputValue: (id) => (id === 'day' ? String(tooSoon.day) : String(tooSoon.month)),
      },
    })
  );

  const state = { deleted: false };
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_confirm_yes',
      message: ephemeralConfirmationMessage(state),
    })
  );

  assert.equal(state.deleted, false);
  assert.equal(h.updates.length, 1, 'Fehlermeldung ersetzt die Bestätigung in-place');
  assert.match(extractAllText(h.updates[0]), /Zu früh zum Eintragen!/);
  assert.equal(h.ctx.store.get('g1').birthdays.length, 0, 'Nichts eingetragen');
});

test('Abbrechen ersetzt die ephemere Bestätigung in-place durch den Abbruch-Hinweis', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );

  const state = { deleted: false };
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_confirm_no',
      message: ephemeralConfirmationMessage(state),
    })
  );

  assert.equal(state.deleted, false);
  assert.equal(h.updates.length, 1, 'Abbruch-Hinweis ersetzt die Bestätigung in-place');
  assert.equal(h.follows.length, 0, 'Keine zusätzliche Folgenachricht nötig');
  assert.match(extractAllText(h.updates[0]), /Abgebrochen!/);
  assert.equal(h.ctx.store.get('g1').birthdays.length, 0);
  assert.ok(!h.ctx.pending.has('u1'));
});

test('Erneutes Absenden nach „Bearbeiten“ ersetzt die ephemere Bestätigung (keine Zweit-Nachricht)', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  // 1. Erste Bestätigung (ephemerer Reply)
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );
  assert.equal(h.replies.length, 1);

  // 2. „Bearbeiten“ auf der ephemeren Bestätigung → Formular erneut
  const state = { deleted: false };
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_confirm_edit',
      message: ephemeralConfirmationMessage(state),
    })
  );
  assert.equal(h.modals.length, 1, 'Formular erneut geöffnet');
  assert.equal(state.deleted, false, 'Ephemere Bestätigung bleibt bis zum Ersetzen bestehen');

  // 3. Bearbeitetes Formular absenden (Modal stammt von der ephemeren Bestätigung)
  const newer = dateIn(40);
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(newer.day) : String(newer.month)) },
      message: ephemeralConfirmationMessage({ deleted: false }),
    })
  );

  assert.equal(h.replies.length, 1, 'Keine zweite Bestätigungsnachricht');
  assert.equal(h.updates.length, 1, 'Bestehende Bestätigung wurde in-place ersetzt');
  const pending = h.ctx.pending.get('u1');
  assert.equal(pending.day, newer.day, 'Neuer Tag übernommen');
  assert.equal(pending.month, newer.month, 'Neuer Monat übernommen');
});

test('Gratulieren: Geburtstagskind kann sich nicht selbst gratulieren', async () => {
  const h = makeHarness();
  const uid = 'bday1';
  const dateKey = '2026-12-31';
  const { container } = require('../bots/birthday-bot/src/embed-builder').buildCongratsEmbed({
    member: { id: uid },
    lang: 'de',
    dateKey,
    wishes: [],
  });
  const msg = {
    components: [container.toJSON()],
    id: 'congrats1',
    delete: async () => {},
  };

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: `bday_congrats_${uid}_${dateKey}`,
      user: { id: uid, username: 'Geburtstagskind' },
      message: msg,
    })
  );

  assert.equal(h.updates.length, 0, 'Der Glückwunsch-Container bleibt unverändert');
  assert.equal(h.follows.length, 0, 'Es wird keine Erfolgsbestätigung gesendet');
  assert.equal(h.replies.length, 1, 'Das Geburtstagskind bekommt einen Hinweis');
  assert.match(extractAllText(h.replies[0]), /nicht selbst/i);
  assert.doesNotMatch(extractAllText(msg), /Glückwünsche \(1\)/);
});

test('Gratulieren: erste Gratulation fügt Feld hinzu, Wiederholung wird blockiert', async () => {
  const h = makeHarness();
  const uid = 'bday1';
  const dateKey = '2026-12-31';

  const { container } = require('../bots/birthday-bot/src/embed-builder').buildCongratsEmbed({
    member: { id: uid },
    lang: 'de',
    dateKey,
    wishes: [],
  });

  const msg = {
    components: [container.toJSON()],
    id: 'congrats1',
    delete: async () => {},
  };

  // 1. Gratulation durch u1
  const first = h.makeInteraction({
    customId: `bday_congrats_${uid}_${dateKey}`,
    message: msg,
    update: async (p) => {
      msg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
    },
  });
  await handleInteraction(h.ctx, first);
  assert.equal(h.follows.length, 1, 'u1 bekam Bestätigung');
  let msgText = extractAllText(msg);
  assert.match(msgText, /Glückwünsche \(1\)/, 'Anzahl = 1');
  assert.ok(msgText.includes('<@u1>'), 'u1 wird erwähnt');

  // 2. Gratulation durch u2 → Anzahl 2
  const second = h.makeInteraction({
    customId: `bday_congrats_${uid}_${dateKey}`,
    user: { id: 'u2', username: 'Zweiter' },
    message: msg,
    update: async (p) => {
      msg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
    },
  });
  await handleInteraction(h.ctx, second);
  msgText = extractAllText(msg);
  assert.match(msgText, /Glückwünsche \(2\)/, 'Anzahl = 2');
  assert.ok(msgText.includes('<@u2>'), 'u2 wird erwähnt');

  // 3. u1 will nochmal → blockiert (kein Doppel-Glückwunsch)
  const third = h.makeInteraction({
    customId: `bday_congrats_${uid}_${dateKey}`,
    message: msg,
    update: async (p) => {
      msg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
    },
  });
  await handleInteraction(h.ctx, third);
  msgText = extractAllText(msg);
  assert.match(msgText, /Glückwünsche \(2\)/, 'Anzahl unverändert');
  assert.ok(h.replies.length >= 1, 'Blockade-Meldung kam');
  const replyText = extractAllText(h.replies[h.replies.length - 1]);
  assert.match(replyText, /bereits/i);
});

test('Leere Formular-Felder → Lösch-Bestätigung → Geburtstag wird gelöscht', async () => {
  const h = makeHarness();
  const good = dateIn(20);
  const uid = '111111111111111111'; // numerische Snowflake-ID (wie in Produktion)

  // 1. Erst einen Geburtstag eintragen
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
      user: { id: uid, username: 'Eintragender' },
    })
  );
  await handleInteraction(
    h.ctx,
    h.makeInteraction({ customId: 'bday_confirm_yes', user: { id: uid, username: 'Eintragender' } })
  );
  assert.equal(h.ctx.store.get('g1').birthdays.length, 1, 'Vorher eingetragen');

  // 2. Formular leer absenden → Lösch-Bestätigung
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: () => '' },
      user: { id: uid, username: 'Eintragender' },
    })
  );
  const confText = extractAllText(h.replies[h.replies.length - 1]);
  assert.match(confText, /Geburtstag löschen/);
  const pending = h.ctx.pending.get(uid);
  assert.equal(pending.delete, true, 'Pending markiert als Löschen');

  // 3. Bestätigen → Geburtstag entfernt
  await handleInteraction(
    h.ctx,
    h.makeInteraction({ customId: 'bday_confirm_yes', user: { id: uid, username: 'Eintragender' } })
  );
  assert.equal(h.ctx.store.get('g1').birthdays.length, 0, 'Geburtstag gelöscht');
  const lastFollow = extractAllText(h.follows[h.follows.length - 1]);
  assert.match(lastFollow, /gelöscht/);
});

test('Löschen ohne bestehenden Eintrag gibt einen Hinweis (kein Fehler)', async () => {
  const h = makeHarness();
  await handleInteraction(
    h.ctx,
    h.makeInteraction({ customId: 'bday_modal', fields: { getTextInputValue: () => '' } })
  );
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_confirm_yes' }));
  const lastFollow = extractAllText(h.follows[h.follows.length - 1]);
  assert.match(lastFollow, /nichts zu löschen/);
  assert.equal(h.ctx.store.get('g1').birthdays.length, 0);
});

test('Admin setzt und löscht den Geburtstag eines anderen mit leeren Feldern', async () => {
  const h = makeHarness();
  const good = dateIn(20);
  const targetId = '222222222222222222'; // numerische Snowflake-ID

  // 1. Admin setzt Geburtstag für den Ziel-Nutzer
  h.ctx.pendingAdmin.set('u1', { targetId, guildId: 'g1' });
  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'admin_bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );
  assert.equal(h.ctx.store.get('g1').birthdays.length, 1, 'Admin hat eingetragen');
  assert.equal(h.ctx.store.get('g1').birthdays[0].userId, targetId);

  // 2. Admin löscht mit leeren Feldern
  h.ctx.pendingAdmin.set('u1', { targetId, guildId: 'g1' });
  await handleInteraction(
    h.ctx,
    h.makeInteraction({ customId: 'admin_bday_modal', fields: { getTextInputValue: () => '' } })
  );
  assert.equal(h.ctx.store.get('g1').birthdays.length, 0, 'Admin hat gelöscht');
  const lastReply = extractAllText(h.replies[h.replies.length - 1]);
  assert.match(lastReply, /gelöscht/);
});

test('Gratulieren ist nach 24 Stunden nicht mehr möglich', async () => {
  const h = makeHarness();
  const uid = 'bday1';
  const dateKey = '2026-12-31';

  const { container } = require('../bots/birthday-bot/src/embed-builder').buildCongratsEmbed({
    member: { id: uid },
    lang: 'de',
    dateKey,
    wishes: [],
  });

  // Gruß-Nachricht ist älter als 24 Stunden
  const oldMsg = {
    components: [container.toJSON()],
    id: 'old_congrats',
    delete: async () => {},
    createdTimestamp: Date.now() - 25 * 60 * 60 * 1000,
  };

  await handleInteraction(
    h.ctx,
    h.makeInteraction({ customId: `bday_congrats_${uid}_${dateKey}`, message: oldMsg })
  );

  const lastReply = extractAllText(h.replies[h.replies.length - 1]);
  assert.match(lastReply, /vorbei/);
  assert.ok(!extractAllText(oldMsg).includes('<@u1>'), 'Keine Glückwünsche hinzugefügt');
});

test('/help zeigt nur die Befehle – ohne den „klicke unten“-Tipp', async () => {
  const h = makeHarness();
  const helpInteraction = h.makeInteraction({
    commandName: 'help',
    isChatInputCommand: () => true,
    isButton: () => false,
  });
  await handleInteraction(h.ctx, helpInteraction);
  const text = extractAllText(h.replies[h.replies.length - 1]);
  assert.match(text, /setup/);
  assert.match(text, /admin_set_birthday/);
  assert.match(text, /help/);
  assert.ok(!text.includes('klicke unten auf'), 'Footer-Tipp wurde entfernt');
  assert.ok(!text.includes('💡 Tipp'), 'Kein Tipp-Block mehr');
});

test('Admin-Panel: Owner sieht Serverliste und wählt einen Server aus', async () => {
  const h = makeHarness();
  h.ctx.ownerId = 'owner1';
  h.ctx.client.user.displayAvatarURL = () => 'https://example.com/bot.png';
  h.ctx.client.guilds.cache.get('g1').iconURL = () => 'https://example.com/g.png';
  h.ctx.client.guilds.cache.get('g1').ownerId = 'owner1';
  h.ctx.client.guilds.cache.get('g1').memberCount = 5;
  h.ctx.client.guilds.cache.get('g1').leave = async () => {};

  // 1. /adminpanel im DM → Serverliste mit Select + Nav-Buttons
  const listInteraction = h.makeInteraction({
    customId: 'adminpanel',
    commandName: 'adminpanel',
    user: { id: 'owner1', username: 'Owner' },
    channel: { type: 1 }, // DM
    isChatInputCommand: () => true,
    isButton: () => false,
  });
  await handleInteraction(h.ctx, listInteraction);
  assert.equal(h.replies.length, 1);
  const listPayload = h.replies[0];
  assert.equal(listPayload.flags, MessageFlags.IsComponentsV2);
  const listText = extractAllText(listPayload);
  assert.match(listText, /Testgilde/);

  // Container components check
  const containerJson = listPayload.components[0].toJSON
    ? listPayload.components[0].toJSON()
    : listPayload.components[0];
  const actionRows = containerJson.components.filter((c) => c.type === 1);
  const select = actionRows[0].components[0];
  assert.equal(select.options.length, 1);
  assert.equal(select.options[0].value, 'g1');
  assert.equal(actionRows[1].components.length, 3, '◀ / Aktualisieren / ▶');

  // 2. Server auswählen → Detail-Ansicht mit Zurück/Einladung/Verlassen
  const selectInteraction = h.makeInteraction({
    customId: 'ap_select',
    user: { id: 'owner1', username: 'Owner' },
    channel: { type: 1 },
    isButton: () => false,
    isStringSelectMenu: () => true,
    values: ['g1'],
    deferUpdate: async () => {},
    editReply: async (p) => {
      h.detailPayload = p;
    },
  });
  await handleInteraction(h.ctx, selectInteraction);
  const detail = h.detailPayload;
  assert.ok(detail, 'Detail-Ansicht gerendert');
  const detailText = extractAllText(detail);
  assert.match(detailText, /Mitglieder/);
  assert.match(detailText, /Geburtstagsliste/);

  const detailContainer = detail.components[0].toJSON
    ? detail.components[0].toJSON()
    : detail.components[0];
  const detailActionRow = detailContainer.components.find((c) => c.type === 1);
  const btnLabels = detailActionRow.components.map((b) => b.label);
  assert.deepEqual(btnLabels, ['◀ Zurück', '🔗 Einladung', '🚪 Verlassen']);
});

test('Admin-Panel: DM des Owners funktioniert auch ohne gecachten Channel', async () => {
  const h = makeHarness();
  h.ctx.ownerId = '123456789012345678';
  h.ctx.client.guilds.cache.get('g1').memberCount = 5;

  // Discord kann bei einer Interaction den DM-Channel noch nicht im Cache
  // haben. guildId ist bei DMs trotzdem zuverlässig nicht gesetzt.
  const interaction = h.makeInteraction({
    commandName: 'adminpanel',
    user: { id: '123456789012345678', username: 'Owner' },
    guildId: null,
    guild: null,
    channel: null,
    isChatInputCommand: () => true,
    isButton: () => false,
  });

  await handleInteraction(h.ctx, interaction);
  assert.equal(h.replies.length, 1, 'Der Owner erhält das Panel statt einer Berechtigungsablehnung');
  assert.match(extractAllText(h.replies[0]), /Testgilde/);
});

test('Bearbeiten öffnet das Formular erneut mit vorbefüllten Zahlen', async () => {
  const h = makeHarness();
  const good = dateIn(20);

  await handleInteraction(
    h.ctx,
    h.makeInteraction({
      customId: 'bday_modal',
      fields: { getTextInputValue: (id) => (id === 'day' ? String(good.day) : String(good.month)) },
    })
  );

  const before = h.modals.length;
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_confirm_edit' }));
  assert.equal(h.modals.length, before + 1, 'Formular erneut geöffnet');
  const modalJson = h.modals[h.modals.length - 1].toJSON();
  const dayInput = modalJson.components[0].components[0];
  const monthInput = modalJson.components[1].components[0];
  assert.equal(dayInput.value, String(good.day), 'Tag vorbefüllt');
  assert.equal(monthInput.value, String(good.month), 'Monat als Zahl vorbefüllt');
});

test('Setup Command blockiert Nicht-Admins', async () => {
  const h = makeHarness();
  const setupInteraction = h.makeInteraction({
    commandName: 'setup',
    isChatInputCommand: () => true,
    isButton: () => false,
    memberPermissions: { has: () => false }, // Kein Admin!
  });
  await handleInteraction(h.ctx, setupInteraction);
  assert.equal(h.replies.length, 1);
  assert.equal(
    h.replies[0].flags,
    MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
  );
  assert.equal('ephemeral' in h.replies[0], false);
  const text = extractAllText(h.replies[0]);
  assert.match(text, /Administrator/);
});

test('Setup sendet und editiert Container ausschließlich mit Components-V2-Flag', async () => {
  const h = makeHarness();
  const deferred = [];
  const edited = [];
  const setupInteraction = h.makeInteraction({
    commandName: 'setup',
    isChatInputCommand: () => true,
    isButton: () => false,
    deferReply: async (payload) => deferred.push(payload),
    editReply: async (payload) => edited.push(payload),
  });

  await handleInteraction(h.ctx, setupInteraction);

  assert.equal(deferred[0].flags, MessageFlags.Ephemeral);
  assert.equal('ephemeral' in deferred[0], false);
  assert.equal(h.sent[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(edited[0].flags, MessageFlags.IsComponentsV2);
});

test('Auch eine fehlgeschlagene Fehlerantwort beendet den Bot-Handler nicht', async () => {
  const h = makeHarness();
  let attempts = 0;
  const interaction = h.makeInteraction({
    commandName: 'unbekannt',
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async () => {
      attempts += 1;
      throw new Error('Discord nicht erreichbar');
    },
  });

  await assert.doesNotReject(() => handleInteraction(h.ctx, interaction));
  assert.equal(attempts, 2, 'Ursprüngliche Antwort und Fehlerantwort wurden versucht');
});
