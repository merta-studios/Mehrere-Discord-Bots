'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { parseEndTime, replacePlaceholders, giveawayContainer, createGiveawayManager } = require('../bots/xp-level-bot/src/giveaway');
const { defineCommands } = require('../bots/xp-level-bot/src/commands');

function giveaway(overrides = {}) {
  return {
    id: 'abc123', guildId: 'g1', guildName: 'Testserver', channelId: 'c1', creatorId: 'admin',
    mode: 'xp', lang: 'de', title: 'Gewinnspiel', description: '{PARTICIPANTS} · {TIMER} · {END_DATETIME}',
    winnerMessage: '{WINNER_MENTION} Platz {PLACE} mit {XP} XP', winnerCount: 2,
    startsAt: 1, endsAt: 1_800_000_000_000, status: 'active', entries: {}, winners: [], predetermined: {},
    sources: ['chat', 'voice'], delivery: 'both', showParticipants: true, showRank: true,
    allowAdmins: true, mustRemain: false, imageUrl: null, bannerUrl: null,
    ...overrides,
  };
}

test('/start_giveaway besitzt exakt die verlangten Pflichtoptionen und Gewinnergrenzen', () => {
  const cmd = defineCommands().map(c => c.toJSON()).find(c => c.name === 'start_giveaway');
  assert.ok(cmd);
  assert.deepEqual(cmd.options.map(o => o.name), ['kanal', 'dauer', 'modus', 'anzahl_gewinner']);
  assert.ok(cmd.options.every(o => o.required));
  assert.equal(cmd.options[3].min_value, 1);
  assert.equal(cmd.options[3].max_value, 10);
  assert.deepEqual(cmd.options[2].choices.map(c => c.value), ['xp', 'random']);
});

test('/giveaway_admin ist auf Administratoren begrenzt', () => {
  const cmd = defineCommands().map(c => c.toJSON()).find(c => c.name === 'giveaway_admin');
  assert.ok(cmd.default_member_permissions);
  assert.ok(cmd.options[0].choices.some(c => c.value === 'participants'));
  assert.ok(cmd.options[0].choices.some(c => c.value === 'preset'));
});

test('Dauer akzeptiert kombinierte relative Werte und exakte Berliner Lokalzeit', () => {
  const now = Date.UTC(2026, 7, 17, 10, 0);
  assert.equal(parseEndTime('2d 4h 30m', 'de', now), now + (2 * 24 + 4) * 3_600_000 + 30 * 60_000);
  assert.equal(parseEndTime('24.08.2026 18:30', 'de', now), Date.UTC(2026, 7, 24, 16, 30));
  assert.equal(parseEndTime('2026-08-24 18:30', 'de', now), Date.UTC(2026, 7, 24, 16, 30));
  assert.equal(parseEndTime('irgendwann', 'de', now), null);
});

test('Platzhalter werden für öffentliche und individuelle Gewinnertexte ersetzt', () => {
  const g = giveaway({ entries: { u1: { userId: 'u1', xp: 50 }, u2: { userId: 'u2', xp: 20 } }, winners: [{ userId: 'u1', place: 1, xp: 50 }] });
  const text = replacePlaceholders('{PARTICIPANTS}|{WINNER}|{PLACE}|{XP}|{MODE}|{SERVER}|{GIVEAWAY_ID}', g, { winner: g.winners[0], winnerName: 'Anna' });
  assert.equal(text, '2|<@u1>|1|50|Meiste XP|Testserver|abc123');
});

test('Giveaway-Container hat grünen Teilnahme-Button, Fortschritt und Discord-Timer', () => {
  const json = giveawayContainer(giveaway()).toJSON();
  const rows = json.components.filter(c => c.type === 1);
  const buttons = rows.flatMap(r => r.components || []);
  assert.equal(buttons[0].style, 3); // ButtonStyle.Success
  assert.match(buttons[0].custom_id, /^xp_gw_join:/);
  assert.match(buttons[1].custom_id, /^xp_gw_progress:/);
  assert.match(JSON.stringify(json), /<t:1800000000:R>/);
});

test('Giveaway-XP zählt nur gewählte Quellen, aktive Teilnehmer und positive Beträge', () => {
  const cfg = { guildId: 'g1', giveawayState: giveaway({ endsAt: Date.now() + 60_000, entries: { u1: { userId: 'u1', joinedAt: Date.now(), xp: 0, disqualified: false } } }) };
  const store = { getGuild: () => cfg, setGuild(value) { Object.assign(cfg, value); }, getAllGuilds: () => [cfg] };
  const manager = createGiveawayManager({ store, client: { guilds: { cache: new Map() } } });
  assert.equal(manager.trackXp('g1', 'u1', 30, 'chat'), true);
  assert.equal(manager.trackXp('g1', 'u1', 20, 'bonus'), false);
  assert.equal(manager.trackXp('g1', 'u2', 20, 'chat'), false);
  assert.equal(manager.trackXp('g1', 'u1', -5, 'chat'), false);
  assert.equal(cfg.giveawayState.entries.u1.xp, 30);
});
