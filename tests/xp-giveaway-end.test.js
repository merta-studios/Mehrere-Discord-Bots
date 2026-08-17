'use strict';

/**
 * Tests für das vorzeitige Beenden und das Abbrechen von Giveaways
 * (/giveaway_admin → Aktion „Giveaway jetzt beenden“ / „Giveaway abbrechen“).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const {
  ADMIN_PREFIX,
  adminCommand,
  handleButton,
  giveawayContainer,
  createGiveawayManager,
} = require('../bots/xp-level-bot/src/giveaway');
const { defineCommands } = require('../bots/xp-level-bot/src/commands');

function extractText(payload) {
  const json = (payload?.components || []).map((c) => (c.toJSON ? c.toJSON() : c));
  return JSON.stringify(json);
}

function giveawayState(overrides = {}) {
  return {
    id: 'gw1', guildId: 'g1', guildName: 'Testserver', channelId: 'c1', messageId: 'm1', creatorId: 'admin',
    mode: 'xp', lang: 'de', title: 'Gewinnspiel', description: 'Mach mit!',
    winnerMessage: 'Glückwunsch {WINNER_MENTION} – Platz {PLACE}!', winnerCount: 1,
    createdAt: 1, endsAt: Date.now() + 3_600_000, status: 'active',
    entries: { u1: { userId: 'u1', joinedAt: 1, xp: 40, disqualified: false }, u2: { userId: 'u2', joinedAt: 2, xp: 10, disqualified: false } },
    winners: [], predetermined: {}, sources: ['chat'], delivery: 'both',
    showParticipants: true, showRank: true, allowAdmins: true, mustRemain: false,
    imageUrl: null, bannerUrl: null,
    ...overrides,
  };
}

function makeHarness(state = giveawayState()) {
  const cfg = { guildId: 'g1', lang: 'de', leaderboardChannelId: 'lb1', giveawayState: state };
  const publicEdits = [];
  const sent = [];
  const dms = [];
  const member = { displayName: 'Anna', user: { bot: false, username: 'anna' }, send: async (p) => dms.push(p) };
  const channel = {
    isTextBased: () => true,
    send: async (p) => { sent.push(p); return { id: 'x' }; },
    messages: { fetch: async () => ({ edit: async (p) => publicEdits.push(p) }) },
  };
  const ctx = {
    logger: { warn() {}, error() {}, info() {} },
    store: {
      getGuild: () => cfg,
      setGuild: (value) => Object.assign(cfg, value),
      getAllGuilds: () => [cfg],
      flush: async () => {},
    },
    client: {
      channels: { fetch: async () => channel },
      guilds: { cache: new Map([['g1', { members: { cache: new Map([['u1', member], ['u2', member]]), fetch: async () => member } }]]) },
    },
  };
  return { ctx, cfg, publicEdits, sent, dms };
}

function makeInteraction({ customId = null, action = null, admin = true, replies = [], updates = [], edits = [] } = {}) {
  return {
    guildId: 'g1',
    locale: 'de',
    customId,
    user: { id: 'admin', bot: false },
    memberPermissions: { has: () => admin },
    options: { getString: () => action, getInteger: () => null, getUser: () => null },
    replies,
    updates,
    edits,
    reply: async (p) => { replies.push(p); return p; },
    update: async (p) => { updates.push(p); return p; },
    editReply: async (p) => { edits.push(p); return p; },
  };
}

test('/giveaway_admin bietet die Aktionen „beenden“ und „abbrechen“ an', () => {
  const cmd = defineCommands().map((c) => c.toJSON()).find((c) => c.name === 'giveaway_admin');
  const values = cmd.options[0].choices.map((c) => c.value);
  assert.deepEqual(values, ['participants', 'status', 'end', 'cancel', 'preset', 'clear']);
  assert.ok(cmd.default_member_permissions, 'nur für Administratoren');
});

test('Aktion „end“ fragt vorher nach und liefert Bestätigungs-Buttons', async () => {
  const { ctx } = makeHarness();
  const replies = [];
  const interaction = makeInteraction({ action: 'end', replies });
  await adminCommand(ctx, interaction);
  const payload = replies[0];
  assert.equal(payload.flags & MessageFlags.Ephemeral, MessageFlags.Ephemeral, 'Antwort ist ephemer');
  const text = extractText(payload);
  assert.match(text, new RegExp(`${ADMIN_PREFIX}end:gw1`));
  assert.match(text, new RegExp(`${ADMIN_PREFIX}keep:gw1`));
  assert.match(text, /wirklich|jetzt beenden/i);
});

test('Bestätigen beendet das Giveaway sofort: Gewinner, geschlossene Nachricht, neuer Start möglich', async () => {
  const h = makeHarness();
  h.ctx.giveawayManager = createGiveawayManager(h.ctx);
  const interaction = makeInteraction({ customId: `${ADMIN_PREFIX}end:gw1` });
  await handleButton(h.ctx, interaction);

  assert.equal(h.cfg.giveawayState.status, 'finished');
  assert.equal(h.cfg.giveawayState.endedEarly, true, 'vorzeitiges Ende wird vermerkt');
  assert.deepEqual(h.cfg.giveawayState.winners.map((w) => w.userId), ['u1'], 'meiste XP gewinnt');
  assert.equal(h.publicEdits.length, 1, 'öffentliche Nachricht wurde geschlossen');
  const publicText = extractText(h.publicEdits[0]);
  assert.match(publicText, /Vorzeitig beendet/);
  assert.ok(h.sent.length + h.dms.length >= 2, 'Gewinner wird öffentlich und per DM benachrichtigt');
  const answer = extractText(interaction.edits[interaction.edits.length - 1]);
  assert.match(answer, /<@u1>/);
});

test('Abbrechen stoppt das Giveaway ohne Gewinner und deaktiviert die Buttons', async () => {
  const h = makeHarness();
  h.ctx.giveawayManager = createGiveawayManager(h.ctx);
  const interaction = makeInteraction({ customId: `${ADMIN_PREFIX}cancel:gw1` });
  await handleButton(h.ctx, interaction);

  assert.equal(h.cfg.giveawayState.status, 'cancelled');
  assert.deepEqual(h.cfg.giveawayState.winners, []);
  assert.equal(h.sent.length, 0, 'keine Gewinner-Nachricht');
  assert.equal(h.dms.length, 0, 'keine DM');
  const publicJson = h.publicEdits[0].components.map((c) => (c.toJSON ? c.toJSON() : c));
  const buttons = JSON.stringify(publicJson).match(/"disabled":true/g) || [];
  assert.equal(buttons.length, 2, 'Teilnehmen und Fortschritt sind deaktiviert');
  assert.match(JSON.stringify(publicJson), /abgebrochen/i);
});

test('„Weiterlaufen lassen“ ändert nichts am Giveaway', async () => {
  const h = makeHarness();
  const interaction = makeInteraction({ customId: `${ADMIN_PREFIX}keep:gw1` });
  await handleButton(h.ctx, interaction);
  assert.equal(h.cfg.giveawayState.status, 'active');
  assert.equal(h.publicEdits.length, 0);
  assert.match(extractText(interaction.updates[0]), /läuft weiter/i);
});

test('Ohne Administrator-Rechte lässt sich kein Giveaway beenden', async () => {
  const h = makeHarness();
  const interaction = makeInteraction({ customId: `${ADMIN_PREFIX}end:gw1`, admin: false });
  await handleButton(h.ctx, interaction);
  assert.equal(h.cfg.giveawayState.status, 'active');
  assert.match(extractText(interaction.replies[0]), /Administrator/);
});

test('Ein bereits beendetes Giveaway kann nicht erneut beendet werden', async () => {
  const h = makeHarness(giveawayState({ status: 'finished' }));
  const replies = [];
  await adminCommand(h.ctx, makeInteraction({ action: 'end', replies }));
  assert.match(extractText(replies[0]), /kein aktives Giveaway/i);
});

test('Der abgebrochene Container zeigt den Hinweis statt einer Gewinnerliste', () => {
  const json = giveawayContainer(giveawayState({ status: 'cancelled' }), { cancelled: true }).toJSON();
  const text = JSON.stringify(json);
  assert.match(text, /Giveaway abgebrochen/);
  assert.doesNotMatch(text, /🏆/);
});
