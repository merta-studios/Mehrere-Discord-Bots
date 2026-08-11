/**
 * Tests für die neuen Geburtstags-Bot-Features:
 * - /event create/delete: Formular, Bestätigung, Liste, Limit, Lösch-Menü
 * - Event-Zeilen in der Liste (mit Name statt Erwähnung) + täglicher 0-Uhr-Post
 * - „Interessant! 😂“-Button mit Interessenten-Liste
 * - Geburtstagsrolle im Marker (bday::v1::<lang>:<roleId>) + 24h-Cleanup
 *
 * Ausführen mit: npm test
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const { createStore } = require('../bots/birthday-bot/src/store');
const { handleInteraction } = require('../bots/birthday-bot/src/interactions');
const {
  buildListEmbed,
  parseListEmbed,
  extractAllText,
  buildEventModal,
  buildEventCongratsEmbed,
  encodeEventName,
  decodeEventName,
  decodeHidden,
} = require('../bots/birthday-bot/src/embed-builder');
const { tzParts, sanitizeEventName, todayKey } = require('../bots/birthday-bot/src/logic');
const { t } = require('../bots/birthday-bot/src/languages');

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function makeHarness({ lang = 'de' } = {}) {
  const logger = { info() {}, warn() {}, error() {} };
  const client = {
    user: { id: 'bot1' },
    guilds: { cache: new Map() },
    channels: { fetch: async (id) => (id === 'ch1' ? channel : null) },
  };
  const store = createStore({ client, logger });

  const channel = {
    id: 'ch1',
    type: 0,
    isTextBased: () => true,
    send: async (payload) => {
      const m = {
        id: `m${channel.sent.length + 2}`,
        components: payload.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || [],
        flags: payload.flags,
        edit: async (p) => {
          if (p.components) m.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
          return m;
        },
      };
      channel.sent.push(m);
      return m;
    },
    sent: [],
    messages: {
      fetch: async (arg) => {
        if (typeof arg === 'object') {
          return new Map(channel.sent.map((m) => [m.id, m]));
        }
        if (arg === 'm1') return channel.listMsg;
        return null;
      },
    },
  };
  channel.sent = [];

  const guild = {
    id: 'g1',
    name: 'Testgilde',
    members: { cache: new Map(), fetch: async () => ({ id: 'u1' }) },
    channels: { fetch: async () => [channel] },
  };
  client.guilds.cache.set('g1', guild);

  const entry = {
    guildId: 'g1',
    channelId: 'ch1',
    messageId: 'm1',
    lang,
    birthdays: [],
    events: [],
    birthdayRoleId: null,
    lastRenderDay: todayKey(lang),
    lastBirthdayCheckDay: todayKey(lang),
  };
  channel.listMsg = {
    id: 'm1',
    components: [buildListEmbed({ birthdays: [], lang }).toJSON()],
    edit: async (p) => {
      if (p.components) channel.listMsg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
      return channel.listMsg;
    },
    delete: async () => {},
  };
  store.set(entry);

  const ctx = {
    client,
    store,
    logger,
    pending: new Map(),
    pendingAdmin: new Map(),
    pendingEvent: new Map(),
    panelSessions: new Map(),
  };

  const replies = [];
  const updates = [];
  const follows = [];
  const modals = [];

  function makeInteraction(overrides = {}) {
    const customId = overrides.customId || 'bday_event_modal';
    return {
      user: { id: 'u1', username: 'Admin' },
      guildId: 'g1',
      guild,
      locale: 'de',
      customId,
      memberPermissions: { has: () => true },
      inGuild: () => true,
      isChatInputCommand: () => false,
      isButton: () =>
        !['bday_event_modal', 'bday_modal', 'admin_bday_modal'].includes(customId) && !overrides.isSelect,
      isModalSubmit: () => customId === 'bday_event_modal',
      isStringSelectMenu: () => Boolean(overrides.isSelect),
      reply: async (p) => replies.push(p),
      followUp: async (p) => follows.push(p),
      update: async (p) => updates.push(p),
      deferUpdate: async () => {},
      deferReply: async () => {},
      showModal: async (m) => modals.push(m),
      message: { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [], embeds: [], delete: async () => {} },
      fields: { getTextInputValue: () => '' },
      options: {},
      ...overrides,
    };
  }

  return { ctx, store, entry, channel, guild, replies, updates, follows, modals, makeInteraction };
}

function textOf(payload) {
  return extractAllText(payload);
}

// ---------------------------------------------------------------------------
// sanitizeEventName & Hex-Codierung
// ---------------------------------------------------------------------------

test('sanitizeEventName: entfernt Format-Brecher, kürzt auf 45 Zeichen', () => {
  assert.equal(sanitizeEventName('Sommerfest'), 'Sommerfest');
  assert.equal(sanitizeEventName('  Max’ **große** | Party  '), 'Max’ große Party');
  assert.equal(sanitizeEventName('Zeile1\nZeile2'), 'Zeile1 Zeile2');
  assert.equal(sanitizeEventName('@everyone Treffen'), 'everyone Treffen');
  assert.equal(sanitizeEventName('   '), null);
  assert.equal(sanitizeEventName('***'), null);
  assert.equal(sanitizeEventName('x'.repeat(80)).length, 45);
  assert.equal(sanitizeEventName(42), null);
});

test('encode/decodeEventName: Roundtrip auch mit Emojis & Umlauten', () => {
  for (const name of ['Sommerfest', 'Lan-Party 🎮', 'Müller & Söhne – Fest', '夏祭り']) {
    assert.equal(decodeEventName(encodeEventName(name)), name);
  }
  assert.equal(decodeEventName('???'), null);
});

// ---------------------------------------------------------------------------
// Liste: Events stehen mit Name statt Erwähnung drin & kommen wieder raus
// ---------------------------------------------------------------------------

test('Container-Roundtrip: Events & Geburtstage mischen sich in derselben Liste', () => {
  for (const lang of ['de', 'en', 'ja']) {
    const container = buildListEmbed({
      birthdays: [{ userId: '111', day: 4, month: 9 }],
      events: [
        { event: true, name: 'Sommerfest', day: 5, month: 9 },
        { event: true, name: 'Kinoabend', day: 3, month: 9 },
      ],
      lang,
    });
    const text = textOf(container.toJSON());
    // Raketen-Emoji wurde entfernt – Events stehen jetzt nur fett, ohne 🚀
    assert.ok(text.includes('**Sommerfest**'), `${lang}: Event mit Name statt Erwähnung`);
    assert.ok(!text.includes('🚀 **Sommerfest**'), `${lang}: kein Raketen-Emoji mehr in der Liste`);
    const parsed = parseListEmbed({ components: [container.toJSON()] });
    assert.equal(parsed.birthdays.length, 1, `${lang}: Geburtstag bleibt`);
    assert.equal(parsed.events.length, 2, `${lang}: beide Events lesbar`);
    const sommer = parsed.events.find((e) => e.name === 'Sommerfest');
    assert.deepEqual({ day: sommer.day, month: sommer.month }, { day: 5, month: 9 });
  }
});

test('Marker mit Geburtstagsrolle: bday::v1::<lang>:<roleId> rundreisen', () => {
  const withRole = buildListEmbed({ birthdays: [], lang: 'de', birthdayRoleId: '9876543210' });
  const parsed = parseListEmbed({ components: [withRole.toJSON()] });
  assert.equal(parsed.lang, 'de');
  assert.equal(parsed.birthdayRoleId, '9876543210');

  // alte Marker ohne Rolle bleiben lesbar
  const plain = buildListEmbed({ birthdays: [], lang: 'en' });
  const parsedPlain = parseListEmbed({ components: [plain.toJSON()] });
  assert.equal(parsedPlain.birthdayRoleId, null);
});

// ---------------------------------------------------------------------------
// /event create: Formular → Bestätigung → Eintrag (kein 7-Tage-Limit!)
// ---------------------------------------------------------------------------

test('/event create öffnet Formular, Bestätigen sortiert das Event in die Liste', async () => {
  const h = makeHarness();
  const in2 = (() => { const d = tzParts('Europe/Berlin'); const dt = new Date(Date.UTC(d.year, d.month - 1, d.day + 2)); return { day: dt.getUTCDate(), month: dt.getUTCMonth() + 1 }; })();

  // Modal-Absenden (Datum in 2 Tagen – für GEBURTSTAGE verboten, für Events erlaubt!)
  // message: null → wie ein echtes Modal-Submit aus einem Slash-Command (keine Ursprungs-Nachricht)
  await handleInteraction(h.ctx, h.makeInteraction({
    customId: 'bday_event_modal',
    message: null,
    fields: { getTextInputValue: (id) => (id === 'name' ? 'Spieleabend' : id === 'day' ? String(in2.day) : String(in2.month)) },
  }));
  assert.equal(h.replies.length, 1, 'Bestätigung erschien');
  assert.equal(h.replies[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
  assert.ok(textOf(h.replies[0]).includes('Spieleabend'));
  assert.ok(h.ctx.pendingEvent.has('u1'));

  // Bestätigen → Event steht in der Liste
  await handleInteraction(h.ctx, h.makeInteraction({ customId: 'bday_event_yes' }));
  assert.equal(h.entry.events.length, 1, 'Event eingetragen');
  assert.equal(h.entry.events[0].name, 'Spieleabend');
  assert.equal(h.entry.events[0].day, in2.day);
  // und in der gerenderten Listen-Nachricht sichtbar (ohne Rakete)
  const listText = textOf(h.channel.listMsg);
  assert.ok(listText.includes('**Spieleabend**'), 'Event steht in der Listen-Nachricht');
  assert.ok(!listText.includes('🚀 **Spieleabend**'), 'kein Raketen-Emoji mehr');
});

test('/event limit: maximal 5 Events gleichzeitig', async () => {
  const h = makeHarness();
  h.entry.events = [1, 2, 3, 4, 5].map((i) => ({ event: true, name: `Fest ${i}`, day: 10 + i, month: 12 }));
  await handleInteraction(h.ctx, h.makeInteraction({
    customId: 'bday_event_modal',
    fields: { getTextInputValue: (id) => (id === 'name' ? 'Nummer 6' : id === 'day' ? '15' : 'Dezember') },
  }));
  assert.equal(h.replies.length, 1);
  assert.ok(textOf(h.replies[0]).includes('5'), 'Fehlermeldung nennt das Limit');
  assert.ok(!h.ctx.pendingEvent.has('u1'), 'kein Pending bei Limit-Blockade');
});

// ---------------------------------------------------------------------------
// /event delete: Auswahlmenü → Löschen
// ---------------------------------------------------------------------------

test('/event delete-Menü entfernt das gewählte Event aus der Liste', async () => {
  const h = makeHarness();
  h.entry.events = [
    { event: true, name: 'Sommerfest', day: 5, month: 8 },
    { event: true, name: 'Kinoabend', day: 9, month: 8 },
  ];
  // Liste dazu passend rendern
  h.channel.listMsg.components = [buildListEmbed({ birthdays: [], events: h.entry.events, lang: 'de' }).toJSON()];

  const selectInteraction = h.makeInteraction({
    customId: 'bday_event_delete',
    isSelect: true,
    values: [`5.8.${encodeEventName('Sommerfest')}`],
  });
  await handleInteraction(h.ctx, selectInteraction);
  assert.equal(h.updates.length, 1);
  assert.ok(textOf(h.updates[0]).includes('Sommerfest'), 'gelöscht-Meldung nennt das Event');
  assert.equal(h.entry.events.length, 1);
  assert.equal(h.entry.events[0].name, 'Kinoabend');
  assert.ok(!textOf(h.channel.listMsg).includes('Sommerfest'), 'Liste aktualisiert');
});

// ---------------------------------------------------------------------------
// 0-Uhr-Event-Post: eigener Titel/Text, „Interessant! 😂“, danach gelöscht
// ---------------------------------------------------------------------------

test('Event-Nachricht: Titel/Text/„Interessenten“/„Interessant! 😂“ exakt wie gefordert', () => {
  assert.equal(t('eventCongratsTitle', 'de'), '🚀 Heute findet ein Event statt!');
  const { container } = buildEventCongratsEmbed({ name: 'Sommerfest', lang: 'de', dateKey: '2026-08-20', interested: ['u7'] });
  const json = container.toJSON();
  const text = extractAllText(json);
  assert.ok(text.includes('# 🚀 Heute findet ein Event statt!'), 'Event-Titel');
  assert.ok(text.includes('Heute findet das Event **Sommerfest** statt! Habt ihr Interesse?'), 'Event-Beschreibung');
  assert.ok(text.includes('Interessenten (1)'), 'Abschnitt heißt „Interessenten“');
  assert.ok(text.includes('<@u7>'));
  const row = json.components.find((c) => c.type === 1);
  assert.equal(row.components[0].label, 'Interessant! 😂');
  assert.equal(row.components[0].custom_id, 'bday_event_interest');
});

test('birthdayCheck: Event um 0 Uhr posten und danach aus der Liste löschen', async () => {
  const h = makeHarness();
  const now = tzParts('Europe/Berlin');
  h.entry.events = [
    { event: true, name: 'Release-Party', day: now.day, month: now.month }, // heute!
    { event: true, name: 'Später', day: now.day === 28 ? 1 : 28, month: now.month === 12 ? 1 : (now.day === 28 ? now.month : now.month) }, // nicht heute
  ];
  h.entry.birthdays = [];
  h.channel.listMsg.components = [
    buildListEmbed({ birthdays: [], events: h.entry.events, lang: 'de' }).toJSON(),
  ];

  await h.ctx.store.birthdayCheck(h.entry);

  // Der Event-Marker ist heute ein unsichtbarer Zero-Width-Blob → dekodieren
  const isEventPost = (m) =>
    decodeHidden(extractAllText(m)).some((s) => s.includes('bday-event:'));
  const eventPosts = h.channel.sent.filter(isEventPost);
  assert.equal(eventPosts.length, 1, 'genau ein Event-Post');
  const postText = extractAllText(eventPosts[0]);
  assert.ok(postText.includes('🚀 Heute findet ein Event statt!'));
  assert.ok(postText.includes('**Release-Party**'));
  // Im sichtbaren Text steht kein „bday-event:“-Klartext mehr
  assert.ok(!postText.includes('bday-event:'), 'Marker ist unsichtbar');
  assert.equal(h.entry.events.length, 1, 'gefälliges Event wird GELÖSCHT…');
  assert.equal(h.entry.events[0].name, 'Später', '… das andere bleibt stehen');
});

test('birthdayCheck: sendet nichts doppelt, entfernt fälliges Event trotzdem', async () => {
  const h = makeHarness();
  const now = tzParts('Europe/Berlin');
  h.entry.events = [{ event: true, name: 'Nachtmarkt', day: now.day, month: now.month }];
  const dateKey = `${now.year}-${String(now.month).padStart(2, '0')}-${String(now.day).padStart(2, '0')}`;
  // Marker schon im Verlauf → wurde heute schon gepostet (hier: moderner
  // unsichtbarer Zero-Width-Blob, wie ihn buildEventCongratsEmbed erzeugt)
  const { buildEventCongratsEmbed, encodeHidden } = require('../bots/birthday-bot/src/embed-builder');
  h.channel.sent.push({
    id: 'alt',
    components: [
      buildEventCongratsEmbed({ name: 'Nachtmarkt', lang: 'de', dateKey, interested: [] }).container.toJSON(),
    ],
    content: encodeHidden(`bday-event:${dateKey}:${encodeEventName('Nachtmarkt')}`),
  });
  h.channel.listMsg.components = [
    buildListEmbed({ birthdays: [], events: h.entry.events, lang: 'de' }).toJSON(),
  ];
  await h.ctx.store.birthdayCheck(h.entry);
  const isEventPost = (m) =>
    decodeHidden(extractAllText(m)).some((s) => s.includes('bday-event:'));
  const posts = h.channel.sent.filter((m) => m.id !== 'alt' && isEventPost(m));
  assert.equal(posts.length, 0, 'kein Doppel-Post');
  assert.equal(h.entry.events.length, 0, 'aber trotzdem aus der Liste entfernt');
});

// ---------------------------------------------------------------------------
// „Interessant! 😂“-Button: Interessenten-Liste im Container
// ---------------------------------------------------------------------------

test('Interesse melden: erster Klick trägt ein, Doppel-Klick wird blockiert', async () => {
  const h = makeHarness();
  const { container } = buildEventCongratsEmbed({ name: 'Zocknacht', lang: 'de', dateKey: '2026-08-20', interested: [] });
  const msg = { components: [container.toJSON()], createdTimestamp: Date.now(), delete: async () => {} };

  const updates = [];
  const makeInterest = (uid) => h.makeInteraction({
    customId: 'bday_event_interest',
    user: { id: uid, username: uid },
    message: msg,
    update: async (p) => {
      updates.push(p);
      msg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
    },
  });

  await handleInteraction(h.ctx, makeInterest('u2'));
  let text = extractAllText(msg);
  assert.ok(text.includes('Interessenten (1)'));
  assert.ok(text.includes('<@u2>'));

  await handleInteraction(h.ctx, makeInterest('u3'));
  text = extractAllText(msg);
  assert.ok(text.includes('Interessenten (2)'));

  // u2 nochmal → blockiert, Liste unverändert
  await handleInteraction(h.ctx, makeInterest('u2'));
  text = extractAllText(msg);
  assert.ok(text.includes('Interessenten (2)'), 'kein Doppel-Eintrag');
});

test('Interesse melden: alte Nachricht ohne unsichtbare Marker blockt Doppel-Klick', async () => {
  const h = makeHarness();
  // Alte Event-Nachricht: Marker als Klartext, Interessenten NUR als
  // sichtbare Mentions – der Bot muss trotzdem verlustfrei einlesen und
  // doppelte Einträge verhindern (Regression: Doppel-Einträge im Feld).
  const msg = {
    components: [
      {
        type: 17,
        components: [
          {
            type: 10,
            content:
              '# 🚀 Heute findet ein Event statt!\n\nHeute findet das Event **Alt-Fest** statt! Habt ihr Interesse?\nbday-event:2026-08-20:416c742d46657374\n### 🙋 Interessenten (2)\n<@u2>\n<@u3>',
          },
        ],
      },
    ],
    createdTimestamp: Date.now(),
    delete: async () => {},
  };

  const updates = [];
  const makeInterest = (uid) =>
    h.makeInteraction({
      customId: 'bday_event_interest',
      user: { id: uid, username: uid },
      message: msg,
      update: async (p) => {
        updates.push(p);
        msg.components = p.components.map((c) => (c.toJSON ? c.toJSON() : c));
      },
    });

  // u4 klickt → wird ergänzt, u2/u3 bleiben erhalten (nichts geht verloren)
  await handleInteraction(h.ctx, makeInterest('u4'));
  let text = extractAllText(msg);
  assert.ok(text.includes('Interessenten (3)'), 'zählt alle drei');
  assert.ok(text.includes('<@u2>') && text.includes('<@u3>') && text.includes('<@u4>'), 'alle da');

  // u2 klickt (er stand NUR als sichtbare Erwähnung in der alten Nachricht)
  await handleInteraction(h.ctx, makeInterest('u2'));
  text = extractAllText(msg);
  assert.equal(updates.length, 1, 'Nachricht wurde beim Doppel-Klick nicht editiert');
  assert.equal(h.replies.length, 1, 'Doppel-Klick wird mit Hinweis beantwortet');
  assert.ok(text.includes('Interessenten (3)'), 'Liste unverändert: u2 NICHT doppelt');
  assert.equal((text.match(/<@u2>/g) || []).length, 1, 'u2 steht genau einmal drin');

  // Nach dem Rebuild ist der Marker unsichtbar (kein sichtbares „int:“)
  assert.ok(!text.includes('int:'), 'kein sichtbarer int:-Marker nach Rebuild');
  const hidden = decodeHidden(text).join('\n');
  assert.ok(hidden.includes('int:u4:'), 'neue Einträge liegen als unsichtbarer Marker vor');
});

// ---------------------------------------------------------------------------
// Geburtstagsrolle: Vergabe + stündliches Cleanup nach 24h
// ---------------------------------------------------------------------------

function makeRoleGuild({ todayBirthdayIds = [] } = {}) {
  const removed = [];
  const added = [];
  const role = { id: 'role1', members: new Map() };
  const members = new Map();
  const mk = (id, hasRole) => {
    const m = {
      id,
      roles: {
        cache: new Map(hasRole ? [['role1', role]] : []),
        add: async (rid) => { added.push([id, rid]); m.roles.cache.set(rid, role); },
        remove: async (rid) => { removed.push([id, rid]); m.roles.cache.delete(rid); },
      },
    };
    members.set(id, m);
    if (hasRole) role.members.set(id, m);
    return m;
  };
  return { removed, added, role, members, mk };
}

test('cleanupBirthdayRoles: Rolle bleibt am Geburtstag, sonst wird sie entfernt', async () => {
  const Berlin = tzParts('Europe/Berlin');
  const h = makeRoleGuild();
  h.mk('bdayGirl', true); // hat heute Geburtstag → Rolle bleibt
  h.mk('yesterday', true); // Geburtstag war gestern → Rolle weg
  h.mk('noRole', false); // ohnehin ohne Rolle

  const client = { user: { id: 'bot1' }, guilds: { cache: new Map() }, channels: { fetch: async () => null } };
  const store = createStore({ client, logger: { info() {}, warn() {} } });
  const guild = {
    id: 'g1',
    members: { cache: h.members, fetch: async () => h.members },
    roles: { cache: new Map([['role1', h.role]]), fetch: async () => h.role },
  };
  client.guilds.cache.set('g1', guild);

  const entry = {
    guildId: 'g1',
    lang: 'de',
    birthdayRoleId: 'role1',
    birthdays: [{ userId: 'bdayGirl', day: Berlin.day, month: Berlin.month }],
    events: [],
  };
  await store.cleanupBirthdayRoles(entry);

  assert.deepEqual(h.removed, [['yesterday', 'role1']], 'nur der Nicht-Geburtstag verliert die Rolle');
  assert.equal(h.members.get('bdayGirl').roles.cache.has('role1'), true);
});

test('/setup JSON prüft: birthday_role ist eine optionale Rollen-Option', () => {
  const { defineCommands } = require('../bots/birthday-bot/src/commands');
  const cmds = defineCommands().map((c) => c.toJSON());
  const setup = cmds.find((c) => c.name === 'setup');
  const roleOpt = setup.options.find((o) => o.name === 'birthday_role');
  assert.equal(roleOpt.type, 8, 'Typ 8 = Role in der Discord-API');
  assert.ok(!roleOpt.required);
  // erforderliche Optionen stehen vor optionalen (Discord-Regel)
  const reqOrder = setup.options.map((o) => Boolean(o.required));
  assert.deepEqual(reqOrder, [...reqOrder].sort((a, b) => b - a));
});
