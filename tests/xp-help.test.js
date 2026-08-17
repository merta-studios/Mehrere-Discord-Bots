'use strict';

/**
 * Tests für den überarbeiteten /help-Command des XP-Bots:
 * drei Seiten (Befehle, Überblick, Platzhalter), Umschalt-Menü,
 * erklärte Optionen und die Platzhalter-Legende in allen Sprachen.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHelpPayload, handleHelpSelect, isHelpSelect, HELP_PAGES } = require('../bots/xp-level-bot/src/help');
const { defineCommands, ALL_COMMAND_NAMES } = require('../bots/xp-level-bot/src/commands');
const { LANGS, t } = require('../bots/xp-level-bot/src/languages');

const HELP_KEYS = [
  'helpNavPlaceholder', 'helpPageOverview', 'helpPageCommands', 'helpPagePlaceholders', 'helpTopicDesc',
  'helpHint', 'helpOverviewBody', 'helpGroupEveryone', 'helpGroupSetup', 'helpGroupGiveaway', 'helpGroupOwner',
  'helpOptSetup', 'helpOptLevelRoles', 'helpOptToggleNicknames', 'helpOptInactiveRole', 'helpOptPingInactive',
  'helpOptStartGiveaway', 'helpOptGiveawayAdmin', 'helpOptProfile',
  'helpPhIntro', 'helpPhLevelRoles', 'helpPhPingInactive', 'helpPhGiveawayText', 'helpPhGiveawayWinner', 'helpPhExample',
  'giveawayAdminHelp', 'giveawayAdminActionDesc',
];

function ctxFor(lang = 'de') {
  return { commandIds: {}, guildCommandIds: new Map(), store: { getGuild: () => ({ lang }) } };
}

function textOf(payload) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== 'object') return;
    if (typeof node.content === 'string') out.push(node.content);
    walk(node.components);
  };
  walk(payload.components.map((c) => (c.toJSON ? c.toJSON() : c)));
  return out.join('\n');
}

function payloadJson(payload) {
  return payload.components.map((c) => (c.toJSON ? c.toJSON() : c));
}

test('/help besitzt eine optionale Themen-Auswahl mit allen Seiten', () => {
  const cmd = defineCommands().map((c) => c.toJSON()).find((c) => c.name === 'help');
  assert.equal(cmd.default_member_permissions, undefined, '/help bleibt für alle nutzbar');
  const option = cmd.options[0];
  assert.equal(option.name, 'thema');
  assert.ok(!option.required, 'thema ist optional');
  assert.deepEqual(option.choices.map((c) => c.value), HELP_PAGES);
});

test('Standardseite erklärt jeden Befehl inklusive seiner Optionen', () => {
  const text = textOf(buildHelpPayload(ctxFor(), { lang: 'de', guildId: 'g1' }));
  for (const name of ALL_COMMAND_NAMES) {
    assert.ok(text.includes(`/${name}`), `${name} fehlt in der Befehlsübersicht`);
  }
  // Optionen werden im Klartext erklärt, nicht nur aufgezählt
  assert.match(text, /`leaderboard` =/);
  assert.match(text, /`only_level_chat`/);
  assert.match(text, /`anzahl_gewinner`/);
  assert.match(text, /Giveaway jetzt beenden/);
  assert.match(text, /Giveaway abbrechen/);
});

test('Überblick-Seite erklärt alle XP-Quellen und Automatiken', () => {
  const text = textOf(buildHelpPayload(ctxFor(), { lang: 'de', guildId: 'g1', page: 'overview' }));
  for (const needle of ['Chat', 'Medien', 'Voice', 'Bonus', 'Invite', 'Leaderboard', 'Schwund', 'Nickname', 'Level-Rollen', 'Giveaway']) {
    assert.ok(text.includes(needle), `${needle} fehlt im Überblick`);
  }
});

test('Platzhalter-Seite erklärt jeden Platzhalter des Bots', () => {
  const text = textOf(buildHelpPayload(ctxFor(), { lang: 'de', guildId: 'g1', page: 'placeholders' }));
  const placeholders = [
    '{LEVEL}', '{ROLEPING}', '{TITLE}', '{DESCRIPTION}', '{PARTICIPANTS}', '{PARTICIPANT_COUNT}',
    '{TIMER}', '{END_TIME}', '{END_DATE}', '{END_DATETIME}', '{MODE}', '{WINNER_COUNT}', '{GIVEAWAY_ID}',
    '{SERVER}', '{CHANNEL}', '{CREATOR}', '{WINNER}', '{WINNER_MENTION}', '{WINNER_NAME}', '{PLACE}',
    '{XP}', '{TOP_XP}', '{WINNERS}',
  ];
  for (const ph of placeholders) assert.ok(text.includes(ph), `${ph} wird nicht erklärt`);
});

test('Die Platzhalter der Legende decken sich mit den echten Giveaway-Werten', () => {
  const { replacePlaceholders } = require('../bots/xp-level-bot/src/giveaway');
  const g = {
    id: 'abc', guildId: 'g1', guildName: 'Server', channelId: 'c1', creatorId: 'admin', mode: 'xp', lang: 'de',
    title: 'T', description: 'D', winnerCount: 2, endsAt: 1_800_000_000_000,
    entries: { u1: { userId: 'u1', xp: 5 } }, winners: [{ userId: 'u1', place: 1, xp: 5 }],
  };
  const legend = [t('helpPhGiveawayText', 'de'), t('helpPhGiveawayWinner', 'de')].join('\n');
  for (const match of legend.matchAll(/\{([A-Z_]+)\}/g)) {
    const replaced = replacePlaceholders(`{${match[1]}}`, g, { winner: g.winners[0], winnerName: 'Anna' });
    assert.notEqual(replaced, `{${match[1]}}`, `${match[1]} existiert nicht im Giveaway-System`);
  }
});

test('Jede Seite bleibt unter dem Components-V2-Limit von 4000 Zeichen', () => {
  for (const lang of Object.keys(LANGS)) {
    for (const page of HELP_PAGES) {
      const text = textOf(buildHelpPayload(ctxFor(lang), { lang, guildId: 'g1', page }));
      assert.ok(text.length < 4000, `${lang}/${page} ist zu lang (${text.length})`);
    }
  }
});

test('Das Auswahlmenü schaltet die Seite um, ohne eine neue Nachricht zu senden', async () => {
  const payload = buildHelpPayload(ctxFor(), { lang: 'de', guildId: 'g1' });
  const rows = payloadJson(payload)[0].components.filter((c) => c.type === 1);
  const select = rows.flatMap((r) => r.components).find((c) => c.type === 3);
  assert.ok(select, 'Select-Menü vorhanden');
  assert.ok(isHelpSelect(select.custom_id));
  assert.deepEqual(select.options.map((o) => o.value), HELP_PAGES);
  assert.equal(select.options.find((o) => o.default).value, 'commands');

  let updated = null;
  const ctx = ctxFor();
  ctx.store = { getGuild: () => ({ lang: 'de' }) };
  await handleHelpSelect(ctx, {
    guildId: 'g1', locale: 'de', customId: select.custom_id, values: ['placeholders'],
    update: async (p) => { updated = p; return p; },
    reply: async () => { throw new Error('darf keine neue Nachricht senden'); },
  });
  assert.ok(updated, 'Nachricht wurde aktualisiert');
  assert.match(textOf(updated), /\{TIMER\}/);
});

test('Alle neuen Hilfe-Texte existieren in allen 10 Sprachen', () => {
  for (const lang of Object.keys(LANGS)) {
    for (const key of HELP_KEYS) {
      const value = t(key, lang);
      assert.ok(value && !value.startsWith('??'), `${key} fehlt für ${lang}`);
      if (lang !== 'de') assert.notEqual(value, t(key, 'de'), `${key} ist für ${lang} nicht übersetzt`);
    }
  }
});
