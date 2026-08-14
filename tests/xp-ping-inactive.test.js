/**
 * Tests für:
 * 1. Voice-XP v2: Anwesenheit reicht (egal ob Mute/Deaf/allein) – fairer Wert 10 XP/min
 * 2. /ping_inactive_people [Main Channel|Direct]: Admin-Command, Formular mit
 *    Beispiel, {ROLEPING}-Ersetzung im Main Channel, DM-Versand an alle mit der
 *    Inaktiv-Rolle im Direct-Modus, Fortschritt nur für den Command-Nutzer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');

const { shouldGrantVoiceXp } = require('../bots/xp-level-bot/src/logic');
const { createVoiceTracker, VOICE_XP_PER_MINUTE } = require('../bots/xp-level-bot/src/voice');
const { defineCommands, handleChatInput } = require('../bots/xp-level-bot/src/commands');
const { createXpStore } = require('../bots/xp-level-bot/src/store');
const {
  PING_MODAL_PREFIX,
  ROLEPING,
  buildPingModal,
  handlePingInactiveCommand,
  handlePingModalSubmit,
  membersWithInactiveRole,
} = require('../bots/xp-level-bot/src/ping-inactive');

// ---------------------------------------------------------------------------
// Voice XP v2
// ---------------------------------------------------------------------------

test('Voice-XP v2: fairer Wert = 10 XP pro Minute', () => {
  assert.equal(VOICE_XP_PER_MINUTE, 10);
});

test('shouldGrantVoiceXp: Anwesenheit reicht – kein Mute-/Sprech-/Personen-Check mehr', () => {
  assert.equal(shouldGrantVoiceXp({ present: true }), true);
  assert.equal(shouldGrantVoiceXp({ present: false }), false);
});

test('createVoiceTracker exportiert die neuen Konstanten', () => {
  const tracker = createVoiceTracker({
    client: { guilds: { cache: new Map() }, on() {}, removeListener() {} },
    store: {},
    logger: { info() {}, warn() {}, error() {} },
    getGuildConfig: () => null,
  });
  assert.equal(typeof tracker.tickMinute, 'function');
  assert.equal(typeof tracker.populateAllSessions, 'function');
  assert.equal(tracker.VOICE_XP_PER_MINUTE, 10);
});

// ---------------------------------------------------------------------------
// /ping_inactive_people – Command-Definition
// ---------------------------------------------------------------------------

const VALID_LOCALES = new Set([
  'id', 'da', 'de', 'en-GB', 'en-US', 'es-ES', 'es-419', 'fr', 'hr', 'it', 'lt',
  'hu', 'nl', 'no', 'pl', 'pt-BR', 'ro', 'fi', 'sv-SE', 'vi', 'tr', 'cs', 'el',
  'bg', 'ru', 'uk', 'hi', 'th', 'zh-CN', 'ja', 'zh-TW', 'ko',
]);

test('/ping_inactive_people ist ein valider Admin-Command mit den Modes Main Channel & Direct', () => {
  const cmds = defineCommands().map((c) => c.toJSON());
  const cmd = cmds.find((c) => c.name === 'ping_inactive_people');
  assert.ok(cmd, '/ping_inactive_people muss definiert sein');
  assert.equal(cmd.default_member_permissions, '8', 'Nur Admins');
  assert.ok(cmd.description.length >= 1 && cmd.description.length <= 100);

  const mode = (cmd.options || []).find((o) => o.name === 'mode');
  assert.ok(mode && mode.required, 'mode ist Pflicht');
  assert.equal(mode.type, 3, 'String-Option');
  assert.deepEqual((mode.choices || []).map((c) => c.value).sort(), ['direct', 'main_channel']);
  for (const ch of mode.choices || []) {
    assert.ok(ch.name.length >= 1 && ch.name.length <= 100);
    for (const k of Object.keys(ch.name_localizations || {})) {
      assert.ok(VALID_LOCALES.has(k), `ungültige Locale "${k}" in Choice`);
    }
  }
});

function makeCtx(overrides = {}) {
  const store = createXpStore({ env: () => '' });
  return {
    store,
    logger: { info() {}, warn() {}, error() {} },
    client: { user: { id: 'bot' }, guilds: { cache: new Map() } },
    ...overrides,
  };
}

function makeAdminInteraction({ commandName = 'ping_inactive_people', options = {}, cfgLang = 'de' }) {
  const replies = [];
  const edits = [];
  const interaction = {
    commandName,
    guildId: 'g1',
    locale: cfgLang,
    user: { id: 'admin' },
    inGuild: () => true,
    memberPermissions: { has: () => true },
    options: { getString: (name) => options[name] },
    deferred: false,
    replied: false,
    reply: async (payload) => {
      replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    deferReply: async (opts) => {
      interaction.deferred = true;
      interaction.deferFlags = opts?.flags;
    },
    editReply: async (payload) => {
      edits.push(payload);
      return payload;
    },
    showModal: async (modal) => {
      interaction.modal = modal;
      return modal;
    },
    replies,
    edits,
  };
  return interaction;
}

function payloadText(payload) {
  return JSON.stringify(payload?.components?.map((c) => (c.toJSON ? c.toJSON() : c)) || payload);
}

test('/ping_inactive_people ohne eingerichtete Inaktiv-Rolle → Fehler', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de' });
  const interaction = makeAdminInteraction({ options: { mode: 'main_channel' } });
  await handlePingInactiveCommand({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);
  assert.ok(interaction.replies.length === 1);
  assert.match(payloadText(interaction.replies[0]), /Inaktiv-Rolle|inactive role/i);
});

test('/ping_inactive_people als Admin mit Rolle → Formular öffnet sich mit Beispiel-Nachricht', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const interaction = makeAdminInteraction({ options: { mode: 'main_channel' } });
  await handlePingInactiveCommand({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);

  assert.ok(interaction.modal, 'showModal muss aufgerufen werden');
  const modal = interaction.modal;
  const json = modal.toJSON();
  assert.equal(json.custom_id, PING_MODAL_PREFIX + 'main_channel');
  // Formular enthält eine Beispiel-Nachricht mit {ROLEPING}
  const value = json.components[0].components[0].value || '';
  assert.ok(value.includes(ROLEPING), `Beispiel muss {ROLEPING} enthalten: ${value}`);
  assert.ok(value.length > 10);
});

test('/ping_inactive_people als Nicht-Admin → verweigert', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const interaction = makeAdminInteraction({ options: { mode: 'direct' } });
  interaction.memberPermissions = { has: () => false };
  await handlePingInactiveCommand({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);
  assert.equal(interaction.modal, undefined);
  assert.match(payloadText(interaction.replies[0]), /Administrator|Permission/i);
});

test('Direct-Modal: Beispiel-Nachricht ohne {ROLEPING}, damit sie als DM funktioniert', () => {
  const modal = buildPingModal('direct', 'de').toJSON();
  const value = modal.components[0].components[0].value || '';
  assert.ok(value.length > 10);
  assert.ok(!value.includes(ROLEPING), 'Direct-Beispiel darf keinen Rollen-Platzhalter brauchen');
});

// ---------------------------------------------------------------------------
// /ping_inactive_people – Main Channel Modus
// ---------------------------------------------------------------------------

function makeModalInteraction({ mode, message, channel, guild }) {
  const replies = [];
  const edits = [];
  const sent = [];
  const interaction = {
    customId: PING_MODAL_PREFIX + mode,
    guildId: 'g1',
    guild,
    user: { id: 'admin' },
    fields: { getTextInputValue: () => message },
    channel,
    deferred: false,
    replied: false,
    reply: async (payload) => {
      replies.push(payload);
      interaction.replied = true;
      return payload;
    },
    deferReply: async (opts) => {
      interaction.deferred = true;
      interaction.deferFlags = opts?.flags;
    },
    editReply: async (payload) => {
      edits.push(payload);
      return payload;
    },
    replies,
    edits,
    sent,
  };
  if (channel) {
    channel.send = async (payload) => {
      sent.push(payload);
      return { id: 'msg' };
    };
  }
  return interaction;
}

test('Main Channel ohne {ROLEPING} im Formular → Fehler, nichts wird gesendet', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const channel = { id: 'c1', send() {} };
  const interaction = makeModalInteraction({ mode: 'main_channel', message: 'Hallo ohne Platzhalter', channel });
  await handlePingModalSubmit({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);
  assert.equal(interaction.sent.length, 0, 'nichts in den Kanal senden');
  assert.match(payloadText(interaction.replies[0]), /ROLEPING/);
});

test('Main Channel mit {ROLEPING} → Nachricht in den Command-Kanal, Platzhalter wird Rollen-Mention', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const channel = { id: 'c1' };
  const interaction = makeModalInteraction({
    mode: 'main_channel',
    message: 'Hey {ROLEPING} kommt zurück!',
    channel,
  });
  await handlePingModalSubmit({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);

  assert.equal(interaction.sent.length, 1);
  assert.equal(interaction.sent[0].content, 'Hey <@&role-x> kommt zurück!');
  assert.ok(!interaction.sent[0].content.includes(ROLEPING));
  // Bestätigung ist ephemeral (nur der Command-Nutzer sieht sie)
  assert.match(payloadText(interaction.replies[0]), /gesendet|sent/i);
  assert.ok((interaction.replies[0].flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral,
    'Bestätigung muss ephemeral sein (nur für den Command-Nutzer)');
});

// ---------------------------------------------------------------------------
// /ping_inactive_people – Direct Modus
// ---------------------------------------------------------------------------

function makeMember(id, { bot = false, hasRole = true } = {}) {
  const roles = new Map(hasRole ? [['role-x', { id: 'role-x' }]] : []);
  const m = {
    id,
    user: { username: id, bot },
    roles: { cache: roles },
    sends: [],
    send: async (payload) => {
      if (id === 'nodm') {
        const err = new Error('Cannot send messages to this user');
        err.code = 50007;
        throw err;
      }
      m.sends.push(payload);
      return m;
    },
  };
  return m;
}

test('Direct-Modus: DM an alle mit Inaktiv-Rolle (plain, kein Container), Fortschritt nur ephemer', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });

  const alice = makeMember('alice');
  const bob = makeMember('bob');
  const nodm = makeMember('nodm'); // fremde DMs ausgeschaltet → Fehlschlag
  const botMember = makeMember('bot', { bot: true });
  const active = makeMember('active', { hasRole: false });
  const adminMember = makeMember('admin'); // Command-Nutzer wird übersprungen

  const members = new Map([
    ['alice', alice],
    ['bob', bob],
    ['nodm', nodm],
    ['bot', botMember],
    ['active', active],
    ['admin', adminMember],
  ]);
  const guild = { id: 'g1', members: { fetch: async () => members } };

  const interaction = makeModalInteraction({
    mode: 'direct',
    message: 'Hey! Sei wieder aktiver! 🎉',
    guild,
  });
  interaction.user = { id: 'admin' };

  await handlePingModalSubmit({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);

  // DM als Plain-Text, nicht im Container
  assert.equal(alice.sends.length, 1);
  assert.equal(alice.sends[0].content, 'Hey! Sei wieder aktiver! 🎉');
  assert.equal(alice.sends[0].components, undefined, 'DM darf keinen Container enthalten („nicht im Container sondern einfach so“)');
  assert.equal(bob.sends.length, 1);
  assert.equal(nodm.sends.length, 0, 'fehlgeschlagene DM wird gezählt, nicht gesendet');
  assert.equal(botMember.sends.length, 0, 'Bots bekommen keine DM');
  assert.equal(active.sends.length, 0, 'aktive Mitglieder (ohne Inaktiv-Rolle) bekommen keine DM');
  assert.equal(adminMember.sends.length, 0, 'der Command-Nutzer selbst wird übersprungen');

  // Deferred + Ephemeral → nur der Command-Nutzer sieht Fortschritt/Ergebnis
  assert.equal(interaction.deferred, true);
  assert.ok(interaction.deferFlags & MessageFlags.Ephemeral, 'Direct-Versand muss ephemer sein');

  // Ergebnis: 2 erfolgreich (alice, bob), 1 fehlgeschlagen (nodm)
  const finalText = payloadText(interaction.edits[interaction.edits.length - 1]);
  assert.match(finalText, /2/); // ok
  assert.match(finalText, /1/); // failed
  assert.ok(interaction.edits.length >= 2, 'Fortschritts-Updates wurden gepostet');
});

test('membersWithInactiveRole filtert Bots und Mitglieder ohne Rolle', () => {
  const alice = makeMember('alice');
  const bot = makeMember('bot', { bot: true });
  const active = makeMember('active', { hasRole: false });
  const result = membersWithInactiveRole([alice, bot, active], 'role-x', new Set());
  assert.deepEqual(result.map((m) => m.id), ['alice']);
});

test('Direct-Modus ohne Mitglieder mit Inaktiv-Rolle → Hinweis statt DMs', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const active = makeMember('active', { hasRole: false });
  const members = new Map([['active', active]]);
  const guild = { id: 'g1', members: { fetch: async () => members } };
  const interaction = makeModalInteraction({ mode: 'direct', message: 'Hi', guild });

  await handlePingModalSubmit({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);
  const finalText = payloadText(interaction.edits[interaction.edits.length - 1]);
  assert.match(finalText, /Keine|No members|nichts/i);
  assert.equal(active.sends.length, 0);
});

test('handleChatInput routet /ping_inactive_people zum Command-Handler', async () => {
  const store = createXpStore({ env: () => '' });
  store.setGuild({ guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de', inactiveRoleId: 'role-x' });
  const interaction = makeAdminInteraction({ options: { mode: 'direct' } });
  await handleChatInput({ store, logger: { info() {}, warn() {}, error() {} } }, interaction);
  assert.ok(interaction.modal, 'Chat-Input muss das Formular öffnen');
});

// ---------------------------------------------------------------------------
// Voice-XP v2 – funktionaler Tick-Test
// ---------------------------------------------------------------------------

test('tickMinute vergibt 10 XP nach 60s Anwesenheit im Voice – auch wenn gemutet', async () => {
  const store = createXpStore({ env: () => '' });
  const cfg = { guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de' };

  const channel = { id: 'vc', isVoiceBased: () => true };
  const member = {
    id: 'u1',
    user: { username: 'u1', bot: false },
    voice: { channelId: 'vc', selfMute: true, serverMute: true, selfDeaf: true, serverDeaf: true, suppress: true },
  };
  const guild = {
    id: 'g1',
    name: 'Test',
    channels: { cache: new Map([['vc', channel]]) },
    voiceStates: {
      cache: new Map([['u1', { id: 'u1', channelId: 'vc', selfMute: true, selfDeaf: true, suppress: true }]]),
    },
    members: { fetch: async () => member },
  };
  const client = {
    guilds: { cache: new Map([['g1', guild]]) },
    on() {},
    removeListener() {},
    user: { id: 'bot' },
  };
  const logs = [];
  const tracker = createVoiceTracker({
    client,
    store,
    logger: { info: (...a) => logs.push(a), warn() {}, error() {} },
    getGuildConfig: () => cfg,
  });

  tracker.ensureSession('g1', 'u1', 'vc');
  const sess = tracker.sessions.get('g1:u1');
  sess.lastMinuteStart = Date.now() - 61_000; // eine Minute abgelaufen

  await tracker.tickMinute();

  const user = store.getUser('g1', 'u1');
  assert.ok(user, 'Nutzer muss angelegt worden sein');
  assert.equal(user.xp, 10, '10 XP für eine Minute Anwesenheit (egal ob Full Mute)');
  assert.ok(logs.some((l) => l.join(' ').includes('+10 XP')), 'Log bestätigt die XP-Vergabe');
});

test('tickMinute vergibt KEINE Voice-XP an Bots', async () => {
  const store = createXpStore({ env: () => '' });
  const cfg = { guildId: 'g1', leaderboardChannelId: 'lb', mainChannelId: 'main', lang: 'de' };
  const channel = { id: 'vc', isVoiceBased: () => true };
  const botMember = { id: 'bot1', user: { username: 'bot', bot: true }, voice: { channelId: 'vc' } };
  const guild = {
    id: 'g1',
    name: 'Test',
    channels: { cache: new Map([['vc', channel]]) },
    voiceStates: { cache: new Map([['bot1', { id: 'bot1', channelId: 'vc' }]]) },
    members: { fetch: async () => botMember },
  };
  const client = {
    guilds: { cache: new Map([['g1', guild]]) },
    on() {},
    removeListener() {},
    user: { id: 'bot' },
  };
  const tracker = createVoiceTracker({
    client,
    store,
    logger: { info() {}, warn() {}, error() {} },
    getGuildConfig: () => cfg,
  });
  tracker.ensureSession('g1', 'bot1', 'vc');
  tracker.sessions.get('g1:bot1').lastMinuteStart = Date.now() - 61_000;
  await tracker.tickMinute();
  assert.equal(store.getUser('g1', 'bot1'), null, 'Bots bekommen keine XP und keine Session');
});
