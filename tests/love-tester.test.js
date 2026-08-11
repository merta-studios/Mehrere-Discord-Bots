/**
 * Tests für den Love Tester Bot (ohne Discord-Verbindung):
 * - Kern-Erkennung & Ausschnitt-Bau (4 davor, Kern mit max. 3 Fremden, Rest danach)
 * - Nachricht → KI-Text (Bilder, Videos, Antworten, Sticker, Emojis, Mentions)
 * - Prompt-Bau (System + User) & Token-Budget-Auswahl
 * - Prozent-Extraktion („### 73 %“)
 * - Command-JSONs Discord-API-valide (6 Commands)
 * - Store-Roundtrip (RAM + Datei-Fallback, gleiche Env-Auflösung wie XP-Bot)
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findCoreRuns,
  buildExcerpts,
  messageToAiText,
  buildSystemPrompt,
  buildUserPrompt,
  selectExcerpts,
  extractPercent,
  cleanContent,
  mentionifyNames,
  compactVerdictLines,
  finalizeLoveVerdict,
} = require('../bots/love-tester-bot/src/analyzer');
const { t, LANGS } = require('../bots/love-tester-bot/src/languages');

// ---------------------------------------------------------------------------
// Hilfs-Mock für Nachrichten
// ---------------------------------------------------------------------------

function msg(id, authorId, content = '', extra = {}) {
  return {
    id,
    author: { id: authorId, username: `user-${authorId}`, displayName: `Name${authorId}` },
    authorId,
    content,
    createdTimestamp: 1_700_000_000_000 + Number(id),
    attachments: extra.attachments || new Map(),
    stickers: extra.stickers || { size: 0, values: () => [] },
    embeds: extra.embeds || [],
    flags: extra.flags || { has: () => false },
    reference: extra.reference || null,
    ...extra,
  };
}

const RESOLVER = {
  lang: 'de',
  user1Id: '11',
  user2Id: '22',
  displayName: (id) => `Name${id}`,
  roleName: () => null,
  channelName: () => null,
  resolveReply: () => null,
};

// ---------------------------------------------------------------------------
// Kern-Erkennung
// ---------------------------------------------------------------------------

test('findCoreRuns: erkennt Läufe mit max. 3 fremden Nachrichten dazwischen', () => {
  const msgs = [
    msg('1', '9', 'a'),  // fremd
    msg('2', '9', 'b'),  // fremd
    msg('3', '9', 'c'),  // fremd
    msg('4', '9', 'd'),  // fremd
    msg('5', '11', 'hi'), // USER1
    msg('6', '9', 'ok'),  // 1 fremde dazwischen
    msg('7', '22', 'hallo'), // USER2
    msg('8', '9', 'x'),   // fremd
    msg('9', '9', 'y'),   // fremd
    msg('10', '9', 'z'),  // fremd
    msg('11', '9', 'w'),  // 4. fremde → Lauf endet
    msg('12', '11', 'wieder da'), // neuer Lauf
  ];
  const isTarget = (m) => m.authorId === '11' || m.authorId === '22';
  const runs = findCoreRuns(msgs, isTarget);
  assert.equal(runs.length, 2, `erwartet 2 Läufe, bekam ${JSON.stringify(runs)}`);
  // Kern endet bei der LETZTEN User-Nachricht (Fremde danach zählen nicht zum Kern)
  assert.deepEqual(runs[0], { start: 4, end: 6 }); // hi → hallo (1 fremde dazwischen)
  assert.deepEqual(runs[1], { start: 11, end: 11 });
});

test('findCoreRuns: Lauf ohne fremde Nachrichten', () => {
  const msgs = [
    msg('1', '11', 'a'),
    msg('2', '22', 'b'),
    msg('3', '11', 'c'),
  ];
  const isTarget = (m) => m.authorId === '11' || m.authorId === '22';
  assert.deepEqual(findCoreRuns(msgs, isTarget), [{ start: 0, end: 2 }]);
});

// ---------------------------------------------------------------------------
// Ausschnitt-Bau
// ---------------------------------------------------------------------------

test('buildExcerpts: 4 davor + Kern + 4 danach = mind. 9 Nachrichten', () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) msgs.push(msg(String(i), i === 10 || i === 12 ? '11' : '99', `m${i}`));
  const excerpts = buildExcerpts(msgs, '11', '22');
  assert.equal(excerpts.length, 1);
  const ex = excerpts[0];
  // start = 10 - 4 = 6, end = 12 + 4 = 16 → 11 Nachrichten (≥ 9)
  assert.equal(ex.messages.length, 11);
  assert.ok(ex.messages.length >= 9, 'Ausschnitt hat mind. 9 Nachrichten');
  assert.equal(ex.messages[0].authorId, '99');
  assert.equal(ex.hasBoth, false);
  assert.equal(ex.start, 6);
  assert.equal(ex.end, 16);
});

test('buildExcerpts: beide User im Ausschnitt → hasBoth = true', () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) msgs.push(msg(String(i), i === 5 ? '11' : i === 7 ? '22' : '99', `m${i}`));
  const excerpts = buildExcerpts(msgs, '11', '22');
  assert.equal(excerpts.length, 1);
  assert.equal(excerpts[0].hasBoth, true);
});

test('buildExcerpts: überlappende Ausschnitte werden verschmolzen', () => {
  const msgs = [];
  for (let i = 0; i < 30; i++) msgs.push(msg(String(i), i % 8 === 0 ? '11' : '99', `m${i}`));
  // User-Nachrichten bei 0, 8, 16, 24 → Ausschnitte überlappen → 1 großer
  const excerpts = buildExcerpts(msgs, '11', '22');
  assert.equal(excerpts.length, 1);
});

test('buildExcerpts: große Fremd-Lücken trennen die Ausschnitte', () => {
  const msgs = [
    msg('0', '11', 'a'),
    ...Array.from({ length: 9 }, (_, i) => msg(`f${i}`, '99', `f${i}`)),
    msg('10', '11', 'b'),
  ];
  const excerpts = buildExcerpts(msgs, '11', '22');
  assert.equal(excerpts.length, 2, 'zwei getrennte Ausschnitte');
  // Kein Überlappen bei dieser Lücke
  assert.ok(excerpts[0].end < excerpts[1].start);
});

// ---------------------------------------------------------------------------
// Nachricht → KI-Text
// ---------------------------------------------------------------------------

test('messageToAiText: markiert USER1/USER2 fett mit Tag', () => {
  const line = messageToAiText(msg('1', '11', 'hallo'), RESOLVER);
  assert.ok(line.startsWith('**Name11** [USER1]:'), line);
  const line2 = messageToAiText(msg('2', '22', 'hi'), RESOLVER);
  assert.ok(line2.startsWith('**Name22** [USER2]:'), line2);
  const line3 = messageToAiText(msg('3', '99', 'hi'), RESOLVER);
  assert.ok(line3.startsWith('Name99:'), line3);
});

test('messageToAiText: Bilder, Videos, Sprachnachrichten, Dateien, Sticker, Embeds', () => {
  const attach = (contentType, name = 'file.bin') => new Map([['a1', { contentType, name }]]);

  let line = messageToAiText(msg('1', '99', '', { attachments: attach('image/png') }), RESOLVER);
  assert.ok(line.includes('*hat ein Bild gesendet*'), line);

  line = messageToAiText(msg('2', '99', '', { attachments: attach('video/mp4') }), RESOLVER);
  assert.ok(line.includes('*hat ein Video gesendet*'), line);

  line = messageToAiText(msg('3', '99', '', { attachments: attach('audio/ogg') }), RESOLVER);
  assert.ok(line.includes('*hat eine Sprachnachricht gesendet*'), line);

  line = messageToAiText(msg('4', '99', '', { attachments: attach('application/pdf', 'doku.pdf') }), RESOLVER);
  assert.ok(line.includes('*hat eine Datei „doku.pdf“ gesendet*'), line);

  line = messageToAiText(msg('5', '99', '', { stickers: { size: 1, values: () => [{ name: 'LoveSticker' }] } }), RESOLVER);
  assert.ok(line.includes('*hat einen Sticker „LoveSticker“ gesendet*'), line);

  line = messageToAiText(msg('6', '99', '', { embeds: [{}] }), RESOLVER);
  assert.ok(line.includes('*hat einen Embed geteilt*'), line);
});

test('messageToAiText: Antworten werden erklärt', () => {
  const line = messageToAiText(
    msg('1', '99', 'das glaub ich nicht', {
      reference: { messageId: '42' },
    }),
    { ...RESOLVER, resolveReply: () => ({ user: 'Name11', content: 'ich liebe dich' }) }
  );
  assert.ok(
    line.includes('*hat auf eine Nachricht von **Name11** mit dem Inhalt „ich liebe dich“ geantwortet mit:*'),
    line
  );

  const generic = messageToAiText(
    msg('2', '99', 'hmm', { reference: { messageId: '43' } }),
    { ...RESOLVER, resolveReply: () => ({ user: null, content: '' }) }
  );
  assert.ok(generic.includes('*hat auf eine Nachricht geantwortet mit:*'), generic);
});

test('cleanContent: Server-Emojis, Mentions, Rollen, Kanäle, Timestamps', () => {
  const out = cleanContent('Hey <@123> <:party:999> <a:party2:998> <@&777> <#555> <t:1700000000:R>', {
    displayName: (id) => (id === '123' ? 'Mia' : null),
    roleName: (id) => (id === '777' ? 'Admin' : null),
    channelName: (id) => (id === '555' ? 'chat' : null),
    lang: 'de',
  });
  assert.ok(out.includes('@Mia'), out);
  assert.ok(out.includes(':party:'), out);
  assert.ok(out.includes(':party2:'), out);
  assert.ok(out.includes('@Admin'), out);
  assert.ok(out.includes('#chat'), out);
  assert.ok(!out.includes('<@'), out);
});

// ---------------------------------------------------------------------------
// Prompts & Budget
// ---------------------------------------------------------------------------

test('buildSystemPrompt: Charakter-Fokus, 5 Sätze, fehlende Interaktion nicht bewerten', () => {
  const p = buildSystemPrompt('de', { name: 'Mia' }, { name: 'Lukas' });
  assert.ok(p.includes('Mia'), 'USER1-Name fehlt');
  assert.ok(p.includes('Lukas'), 'USER2-Name fehlt');
  assert.ok(p.includes('### '), 'Prozent-Zeilen-Vorgabe fehlt');
  assert.ok(/Genau 5 Sätze|5 begründete Sätze/i.test(p), '5-Satz-Struktur fehlt');
  assert.ok(/Teenager|teen/i.test(p), 'Teen-Ton fehlt');
  assert.ok(/Charakter/i.test(p), 'Charakter-Fokus fehlt');
  assert.ok(/Erwähne NIEMALS fehlende|wenig \/ nie \/ kaum miteinander/i.test(p), 'Regel gegen Interaktions-Klage fehlt');
  assert.ok(/Bewerte fehlende Interaktion niemals negativ/i.test(p), 'Regel gegen Abwertung fehlt');
  assert.ok(/66–84|62–86|großzügig/i.test(p), 'Prozent-Kalibrierung fehlt');
  assert.ok(!/zwei Leerzeilen/i.test(p), 'alte Riesen-Abstände dürfen nicht mehr gefordert werden');
});

test('buildUserPrompt: USER-Infos + Ausschnitt-Blöcke', () => {
  const user1 = { id: '11', name: 'Mia', username: 'mia_2001', globalName: 'Mia', nickname: 'Mia' };
  const user2 = { id: '22', name: 'Lukas', username: 'luki', globalName: 'Lukas', nickname: 'Lukas' };
  const excerpts = [
    { startTs: 1, hasBoth: true, messages: [{ line: 'Name99: hi' }, { line: '**Mia** [USER1]: gut' }] },
  ];
  const p = buildUserPrompt({ lang: 'de', user1, user2, excerpts });
  assert.ok(p.includes('mia_2001'), 'Username fehlt');
  assert.ok(p.includes('Server-Nickname'), 'Server-Nickname-Info fehlt');
  assert.ok(p.includes('AUSSCHNITT 1'), p);
  assert.ok(p.includes('[USER1]'), p);
});

test('selectExcerpts: beide-User-Ausschnitte zuerst, chronologische Ausgabe', () => {
  const mk = (n, hasBoth, startTs) => ({
    startTs,
    hasBoth,
    messages: Array.from({ length: n }, (_, i) => ({ line: `x${i}` })),
  });
  const excerpts = [mk(10, false, 100), mk(10, true, 200), mk(10, false, 300), mk(10, true, 400)];
  const chosen = selectExcerpts(excerpts, 100000);
  assert.deepEqual(chosen.map((e) => e.startTs), [200, 400, 100, 300], 'both zuerst, dann chronologisch');
});

test('selectExcerpts: Budget wird eingehalten', () => {
  const excerpts = Array.from({ length: 10 }, (_, i) => ({
    startTs: i,
    hasBoth: true,
    messages: Array.from({ length: 100 }, (_, j) => ({ line: `nachricht ${i}-${j} lang genug` })),
  }));
  const chosen = selectExcerpts(excerpts, 5000);
  const total = chosen.reduce((s, e) => s + e.messages.reduce((a, m) => a + m.line.length, 0), 0);
  assert.ok(total <= 5000 + 500, `Budget überschritten: ${total}`);
  assert.ok(chosen.length < 10, 'nicht alle Ausschnitte passen ins Budget');
});

// ---------------------------------------------------------------------------
// Prozent-Extraktion
// ---------------------------------------------------------------------------

test('extractPercent: findet „### XX %“', () => {
  assert.equal(extractPercent('irgendwas\n\n### 73%'), 73);
  assert.equal(extractPercent('### 100 %'), 100);
  assert.equal(extractPercent('### 0%'), 0);
  assert.equal(extractPercent('### 150%'), 100, 'über 100 wird gedeckelt');
  assert.equal(extractPercent('keine Prozent'), null);
});

test('mentionifyNames: Server-Nick, Username und @Name werden zu Mentions', () => {
  const user1 = { id: '11', name: 'Mia', username: 'mia_2001', nickname: 'Miaaa', displayName: 'Mia', globalName: 'Mia' };
  const user2 = { id: '22', name: 'Lukas', username: 'luki', nickname: 'LukiOnDC', displayName: 'Lukas', globalName: 'Lukas' };
  const text = 'Miaaa schreibt ständig „bro“. Lukas sagt nur „ok.“ @luki und mia_2001 wären cute.';
  const out = mentionifyNames(text, user1, user2);
  assert.ok(out.includes('<@11>'), out);
  assert.ok(out.includes('<@22>'), out);
  assert.ok(!out.includes('Miaaa'), out);
  assert.ok(!out.includes('mia_2001'), out);
  assert.ok(!out.includes('@luki'), out);
});

test('mentionifyNames: lässt bestehende Mentions, [USER]-Tags und Fremdwörter in Ruhe', () => {
  const user1 = { id: '11', name: 'Mia', username: 'mia', nickname: 'Mia', displayName: 'Mia' };
  const user2 = { id: '22', name: 'Lukas', username: 'lukas', nickname: 'Lukas', displayName: 'Lukas' };
  const text = 'Mias Aura und <@11> plus [USER2] rockt.';
  const out = mentionifyNames(text, user1, user2);
  assert.match(out, /Mias Aura/);
  assert.ok(out.includes('<@11>'), out);
  assert.ok(out.includes('<@22>'), out);
  assert.ok(!out.includes('[USER2]'), out);
  assert.equal((out.match(/<@11>/g) || []).length, 1, 'bestehende Mention nicht doppeln');
});

test('mentionifyNames: gemeinsame Namen werden nicht geraten', () => {
  const user1 = { id: '11', name: 'Alex', username: 'alex1', nickname: 'Alex' };
  const user2 = { id: '22', name: 'Alex', username: 'alex2', nickname: 'Alex' };
  const out = mentionifyNames('Alex ist chaotic.', user1, user2);
  assert.equal(out, 'Alex ist chaotic.');
});

test('Ladebildschirm: echte Scan-Zahlen, keine Fake-Witze', () => {
  const { buildProgress, buildResult, progressBar } = require('../bots/love-tester-bot/src/embed-builder');
  const { extractAllText } = require('../bots/xp-level-bot/src/embed-builder');
  const user1 = { id: '11', displayName: 'Mia' };
  const user2 = { id: '22', displayName: 'Lukas' };
  const progress = extractAllText(buildProgress({
    lang: 'de',
    token: 'tok',
    pct: 48,
    phase: t('analysingScan', 'de'),
    user1,
    user2,
    scanned: 247,
    channelCount: 3,
    excerpts: 8,
  }));
  assert.ok(progress.includes('247 Nachrichten'), progress);
  assert.ok(progress.includes('3 Kanäle'), progress);
  assert.ok(progress.includes('8 Ausschnitte'), progress);
  assert.ok(progress.includes('Nachrichten werden gelesen'), progress);
  assert.ok(!/Glaskugel|Liebes-Sensor|heimliche Blicke|Sterne/i.test(progress), progress);
  assert.ok(progressBar(50).includes('█'), progressBar(50));
  assert.ok(progressBar(50).includes('░'), progressBar(50));

  const result = extractAllText(buildResult({
    lang: 'de',
    token: 'tok',
    aiText: 'Mia wirkt chaotic.\n\nLukas wirkt ruhig.\n\n# 81%',
    user1,
    user2,
  }));
  assert.ok(result.includes('# Ergebnis'), result);
  assert.ok(result.includes('# 81%'), result);
  assert.ok(!/Nur zum Spaß|Liebe ist keine Prozentzahl/i.test(result), result);
  assert.ok(!result.includes('-#'), result);
});

test('compactVerdictLines: normale Schrift und eine Leerzeile zwischen den Sätzen', () => {
  const out = compactVerdictLines('Satz eins 💀\n\n\nSatz zwei 😐\n\nSatz drei 💘');
  assert.equal(out, 'Satz eins 💀\n\nSatz zwei 😐\n\nSatz drei 💘');
});

test('finalizeLoveVerdict: Mentions + normale Schrift + Prozent als große Überschrift', () => {
  const user1 = { id: '11', name: 'Mia', username: 'mia', nickname: 'Mia', displayName: 'Mia' };
  const user2 = { id: '22', name: 'Lukas', username: 'lukas', nickname: 'Lukas', displayName: 'Lukas' };
  const raw = 'Mia ist chaotic 💀\n\n\nLukas ist dry 😐\n\nDie knallen.\n\n### 81%';
  const out = finalizeLoveVerdict(raw, user1, user2);
  assert.ok(out.includes('\n\n'), out);
  assert.ok(out.includes('<@11>'), out);
  assert.ok(out.includes('<@22>'), out);
  assert.ok(!out.includes('-# '), out);
  assert.ok(out.endsWith('# 81%'), out);
  assert.ok(!out.includes('### 81%'), out);
  assert.ok(!/Mia ist/.test(out), out);
});

// ---------------------------------------------------------------------------
// Sprachdatei
// ---------------------------------------------------------------------------

test('Sprachdatei: alle wichtigen Keys in allen 10 Sprachen vorhanden', () => {
  const keys = [
    'setupStepTitle', 'setupStep1Desc', 'setupStep2Desc', 'setupStep3Desc',
    'loveConfirmBody', 'btnAccept', 'btnDecline', 'analysingPhases',
    'analysingScan', 'analysingPrepare', 'analysingStats',
    'loveResultTitle', 'errGroqRateLimit', 'errGroqAuth', 'errNoMessages',
    'btnRetry', 'btnContinue', 'excerptHeader', 'msgRepliedTo', 'msgImage',
    'helpTitle', 'helpSetup', 'helpTestLove', 'errGeneric',
  ];
  for (const key of keys) {
    for (const code of Object.keys(LANGS)) {
      const val = t(key, code);
      assert.ok(val && val !== `??${key}??`, `${key} (${code}) fehlt oder ist leer`);
    }
  }
  for (const code of Object.keys(LANGS)) {
    assert.ok(Array.isArray(t('analysingPhases', code)) && t('analysingPhases', code).length >= 3, `analysingPhases (${code}) zu kurz`);
  }
});

// ---------------------------------------------------------------------------
// Endless Story
// ---------------------------------------------------------------------------

test('Endless-Story-Startformular hält alle Discord-String-Limits ein', () => {
  const { buildStoryModal } = require('../bots/love-tester-bot/src/endless-story');
  const modal = buildStoryModal('test-token').toJSON();

  assert.ok(modal.title.length <= 45, 'Modal-Titel ist zu lang');
  assert.ok(modal.custom_id.length <= 100, 'Modal-Custom-ID ist zu lang');
  assert.equal(modal.components.length, 4, 'Situation und drei Optionen sind vorhanden');

  for (const row of modal.components) {
    const input = row.components[0];
    assert.ok(input.label.length <= 45, `${input.custom_id}: Label ist zu lang`);
    assert.ok(input.placeholder.length <= 100, `${input.custom_id}: Platzhalter ist zu lang`);
    assert.ok(input.custom_id.length <= 100, `${input.custom_id}: Custom-ID ist zu lang`);
  }
});

test('Endless-Story-Situationsnachricht enthält keine Spoiler-Tags (graue Box) und nutzt ### Format', () => {
  const { buildSituationPayload } = require('../bots/love-tester-bot/src/endless-story');
  const payload = buildSituationPayload({
    situation: 'Du bist im Zauberwald und triffst eine Katze.',
    options: ['Option A', 'Option B', 'Option C'],
    turn: 2,
  });
  const container = payload.components[0].toJSON();
  const textDisplay = container.components[0];
  assert.equal(textDisplay.content, '# 📖 Endless Story — Zug 2\n\n### Du bist im Zauberwald und triffst eine Katze.');
  assert.equal(textDisplay.content.includes('||'), false, 'Darf keine Spoiler-Tags (graue Box) enthalten');
});

test('Endless-Story: History-Limit beträgt 10 Situationen und Optionen', () => {
  const { STORY_HISTORY_LIMIT, buildStoryUserPrompt } = require('../bots/love-tester-bot/src/endless-story');
  assert.equal(STORY_HISTORY_LIMIT, 10, 'STORY_HISTORY_LIMIT muss 10 sein');

  const history = Array.from({ length: 10 }, (_, i) => ({
    situation: `Szene ${i + 1}`,
    options: [`Opt A${i}`, `Opt B${i}`, `Opt C${i}`],
    chosenOption: `Opt A${i}`,
  }));
  const prompt = buildStoryUserPrompt({ history, chosenOptionText: 'Opt A9' });
  assert.ok(prompt.includes('Zug 1: Situation: Szene 1'), 'Erster Zug der 10er-History im Prompt');
  assert.ok(prompt.includes('Zug 10: Situation: Szene 10'), 'Zehnter Zug im Prompt');
  assert.ok(prompt.includes('Optionen: Opt A0 | Opt B0 | Opt C0'), 'Optionen werden im Prompt aufgeführt');
  assert.ok(prompt.includes('→ Gewählt: Opt A0'), 'Gewählte Option im Prompt aufgeführt');
});

test('Endless-Story: Situationen bleiben kurz – die KI kann keine Romane mehr erzeugen', () => {
  const { parseAiResponse, shortenSituation, MAX_STORY_SITUATION_LENGTH } = require('../bots/love-tester-bot/src/endless-story');

  // Sehr langer Roman-Typ-Output, wie ihn die KI bei fortgeschrittener Geschichte liefern kann
  const longRaw = [
    'SITUATION: Du betrittst den alten Wald und spürst sofort, wie sich die Stimmung verändert. Die Bäume',
    'scheinen sich zu bewegen und flüstern leise Geheimnisse, während der Nebel langsam zwischen den Stämmen',
    'aufsteigt. In der Ferne siehst du eine Lichtung, auf der ein einzelner, silberner Baum steht, dessen Blätter',
    'im Mondlicht funkeln. Du erinnerst dich an all die Abenteuer, die dich hierher geführt haben, an die Freunde,',
    'die du unterwegs verloren hast, und an die Gefahren, die noch vor dir liegen. Plötzlich hörst du ein leises',
    'Knacken im Unterholz und spürst, dass etwas Großes dich beobachtet.',
    'OPTION 1: Nachsehen, was es war.',
    'OPTION 2: Schnell weitergehen.',
    'OPTION 3: Umkehren und fliehen.',
  ].join('\n');

  const parsed = parseAiResponse(longRaw);
  assert.ok(parsed.situation.length <= MAX_STORY_SITUATION_LENGTH, `Situation zu lang: ${parsed.situation.length}`);

  // Direkter Test der Stutz-Funktion
  const novel = 'Satz eins über die Reise. Satz zwei über die Gefahr. Satz drei über die Vergangenheit. Satz vier und mehr über endlose Details und Beschreibungen, die ein ganzes Kapitel füllen würden.';
  const short = shortenSituation(novel);
  assert.ok(short.length <= MAX_STORY_SITUATION_LENGTH, 'shortenSituation hält das Zeichenlimit');
  const sentenceCount = (short.match(/[.!?]+(\s|$)/g) || []).length;
  assert.ok(sentenceCount <= 2, `shortenSituation erlaubt höchstens 2 Sätze, bekam: ${sentenceCount}`);

  // Kurze Situation bleibt unverändert
  assert.equal(shortenSituation('Du triffst eine Katze im Zauberwald.'), 'Du triffst eine Katze im Zauberwald.');
});

test('Endless-Story: revertPendingChoice reaktiviert Buttons und verwirft die gewählte Option', async () => {
  const { getRuntimeState, revertPendingChoice } = require('../bots/love-tester-bot/src/endless-story');

  const edited = [];
  const channel = {
    messages: {
      edit: async (id, payload) => { edited.push({ id, payload }); },
    },
  };
  const ctx = { logger: { warn: () => {} } };
  const st = getRuntimeState(ctx, 'guild-1');
  st.channelId = 'chan-1';
  st.lastMessageId = 'msg-9';
  st.turn = 5;
  st.history = [{ situation: 'Du stehst vor einer Tür.', options: ['A', 'B', 'C'], chosenOption: 'A', decidedBy: '42' }];

  const ok = await revertPendingChoice(ctx, 'guild-1', channel);
  assert.equal(ok, true, 'Revert meldet Erfolg');

  // Buttons wurden reaktiviert (disabled: false)
  const container = edited[0].payload.components[0].toJSON();
  const row = container.components.find((c) => c.type === 1);
  const btn = row.components[0];
  assert.equal(btn.disabled, false, 'Button wieder anklickbar');
  assert.equal(edited[0].id, 'msg-9', 'Richtige Nachricht editiert');

  // Gewählte Option wurde verworfen, damit später neu geklickt werden kann
  assert.equal(st.history[0].chosenOption, null, 'chosenOption zurückgesetzt');
  assert.equal(st.history[0].decidedBy, null, 'decidedBy zurückgesetzt');
});

test('Endless-Story: Bearbeitete Nachricht (entschieden) enthält Mention und Hinweis wer entschieden hat', () => {
  const { buildSituationPayload } = require('../bots/love-tester-bot/src/endless-story');
  const payload = buildSituationPayload({
    situation: 'Du bist im Zauberwald und triffst eine Katze.',
    options: ['Option A', 'Option B', 'Option C'],
    turn: 2,
    disabled: true,
    chosenIndex: 1,
    decidedBy: '123456789',
  });
  const container = payload.components[0].toJSON();
  const textDisplay = container.components[0];
  assert.equal(
    textDisplay.content,
    '# 📖 Endless Story — Zug 2\n\n### Du bist im Zauberwald und triffst eine Katze.\n\n<@123456789> hat die nächste Option schon entschieden.'
  );

  const payloadUserObj = buildSituationPayload({
    situation: 'Du bist im Zauberwald und triffst eine Katze.',
    options: ['Option A', 'Option B', 'Option C'],
    turn: 3,
    disabled: true,
    chosenIndex: 0,
    decidedBy: { id: '999888777' },
  });
  const containerObj = payloadUserObj.components[0].toJSON();
  assert.ok(
    containerObj.components[0].content.includes('<@999888777> hat die nächste Option schon entschieden.'),
    'Erkennt auch User-Objekte mit .id sauber als Mention'
  );
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

test('Command-JSONs: 6 Commands, valide Struktur', () => {
  const { defineCommands } = require('../bots/love-tester-bot/src/commands');
  const cmds = defineCommands().map((c) => c.toJSON());
  assert.equal(cmds.length, 6);
  const names = cmds.map((c) => c.name).sort();
  assert.deepEqual(names, ['admin_set_bot_profile', 'adminpanel', 'endless_story_channel', 'help', 'setup', 'test_love']);
  const testLove = cmds.find((c) => c.name === 'test_love');
  assert.deepEqual(testLove.options.map((o) => o.name), ['user1', 'user2']);
  assert.ok(testLove.options.every((o) => o.required), 'beide User-Optionen sind Pflicht');
  const setup = cmds.find((c) => c.name === 'setup');
  assert.equal(setup.default_member_permissions, '8', 'setup nur für Admins');
  const story = cmds.find((c) => c.name === 'endless_story_channel');
  assert.equal(story.default_member_permissions, '8', 'endless_story_channel nur für Admins');
  assert.deepEqual(story.options.map((o) => o.name), ['channel']);
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

test('Store: RAM-Roundtrip + Datei-Fallback (gleiche Turso-Env-Auflösung wie XP-Bot)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'love-store-'));
  const env = (key, fb = '') => {
    if (key === 'LOVE_STORE_DISABLE_FILE_BACKUP') return 'true';
    return fb;
  };
  const { createLoveStore } = require('../bots/love-tester-bot/src/store');
  const store = createLoveStore({ logger: { info() {}, warn() {}, error() {} }, env });
  await store.init();

  assert.equal(store.getGuild('g1'), null);
  store.setGuild({ guildId: 'g1', lang: 'de', channels: ['111', '222'], groqApiKey: 'gsk_test_123', setupComplete: true });
  assert.equal(store.getGuild('g1').setupComplete, true);
  assert.deepEqual(store.getGuild('g1').channels, ['111', '222']);

  store.setCommandIds({ setup: '101', test_love: '102' });
  assert.equal(store.getCommandId('test_love'), '102');
  store.setCommandIdScope('global');
  assert.equal(store.getCommandIdScope(), 'global');

  store.deleteGuild('g1');
  assert.equal(store.getGuild('g1'), null);
  store.stopBackupInterval();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Bugfix-Regressionstests: Command-Registrierung & -Verifizierung
//
// Gemeldete Bugs:
//  1. „Love Tester hat gar keine Commands registriert – unbenutzbar":
//     Die Registrierung lief nur EINMAL beim Start; schlug sie fehl, gab es
//     keinen Retry. → startCommandSelfHealing registriert alle 15 min nach.
//  2. Verwaiste Store-Snowflakes (wie beim XP-Bot) dürfen in /help keine
//     toten Mentions erzeugen → ensureCommandIds verifiziert gegen Discord.
// ---------------------------------------------------------------------------

test('ensureCommandIds korrigiert verwaiste Store-Snowflakes gegen Discord REST', async () => {
  const { createLoveStore } = require('../bots/love-tester-bot/src/store');
  const { ensureCommandIds } = require('../bots/love-tester-bot/src/commands');
  const store = createLoveStore({ env: () => '' });
  store.setCommandIds({
    setup: '101',
    test_love: '102',
    help: '103',
    admin_set_bot_profile: '104',
    adminpanel: 'STALE-OLD', // ← verwaiste ID
  });

  const fakeRest = {
    get: async () => [
      { id: '101', name: 'setup' },
      { id: '102', name: 'test_love' },
      { id: '103', name: 'help' },
      { id: '104', name: 'admin_set_bot_profile' },
      { id: '205', name: 'adminpanel' },
    ],
  };

  const ctx = {
    store,
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' } },
    commandIds: store.getCommandIds(),
    guildCommandIds: new Map(),
  };

  const ids = await ensureCommandIds(ctx, 'g1');
  assert.equal(ids.adminpanel, '205', 'verwaiste ID muss durch frische ersetzt werden');
  assert.equal(ctx.store.getCommandId('adminpanel'), '205', 'Store muss korrigiert werden');
});

test('love-store.setCommandIds ERSTZT die komplette Liste (keine verwaisten IDs per Merge)', () => {
  const { createLoveStore } = require('../bots/love-tester-bot/src/store');
  const store = createLoveStore({ env: () => '' });
  store.setCommandIds({ setup: '111', adminpanel: 'STALE' });
  store.setCommandIds({ setup: '222', test_love: '333' });
  assert.equal(store.getCommandId('adminpanel'), null, 'verwaiste ID darf nicht weiterleben');
  assert.equal(store.getCommandId('setup'), '222');
  assert.equal(store.getCommandId('test_love'), '333');
});

test('Guild-Command-IDs ersetzen ebenfalls die komplette Liste', () => {
  const { createLoveStore } = require('../bots/love-tester-bot/src/store');
  const store = createLoveStore({ env: () => '' });
  store.setGuildCommandIds('dev', { setup: '111', adminpanel: 'STALE' });
  store.setGuildCommandIds('dev', { setup: '222' });
  assert.deepEqual(store.getGuildCommandIds('dev'), { setup: '222' });
});

test('registerCommands wiederholt bei unvollständiger Discord-Antwort und bestätigt erst danach', async () => {
  const { registerCommands } = require('../bots/love-tester-bot/src/commands');
  let putCalls = 0;
  let lastRoute = null;
  const fakeRest = {
    put: async (route, { body }) => {
      putCalls += 1;
      lastRoute = route;
      if (putCalls === 1) return [];
      return (body || []).map((command) => ({ id: `id-${command.name}`, name: command.name }));
    },
  };
  const ctx = {
    commandsRegistered: false,
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' }, guilds: { cache: new Map() } },
    logger: { info() {}, warn() {}, error() {} },
    commandIds: {},
    guildCommandIds: new Map(),
  };

  const ok = await registerCommands(ctx, { retryDelays: [0, 0] });
  assert.equal(ok, true);
  assert.equal(ctx.commandsRegistered, true);
  assert.equal(putCalls, 2, 'die unvollständige Antwort muss einen Retry auslösen');
  assert.equal(ctx.commandIds.test_love, 'id-test_love');
  assert.equal(ctx.commandIdsVerifiedScope, 'global');
  assert.equal(ctx.commandIdsVerifiedAt > 0, true);
  assert.equal(lastRoute, '/applications/app1/commands');
});

test('Command-Selbstheilung holt eine fehlgeschlagene Initial-Registrierung nach', async () => {
  const { startCommandSelfHealing } = require('../bots/love-tester-bot/src/scheduler');
  let putCalls = 0;
  const fakeRest = {
    put: async (route, { body }) => {
      putCalls++;
      return (body || []).map((c) => ({ id: `id-${c.name}`, name: c.name }));
    },
  };
  const ctx = {
    commandsRegistered: false, // Initial-Registrierung ist fehlgeschlagen
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' }, guilds: { cache: new Map() } },
    logger: { info() {}, warn() {}, error() {} },
    commandIds: {},
    guildCommandIds: new Map(),
  };

  const stop = startCommandSelfHealing({ ctx, retryMs: 5, revMs: 10_000 });
  try {
    const deadline = Date.now() + 2000;
    while (ctx.commandsRegistered !== true && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(ctx.commandsRegistered, true, 'Selbstheilung muss die Registrierung nachholen');
    assert.ok(putCalls >= 1, 'es muss ein PUT an Discord gehen');
  } finally {
    stop();
  }
});

test('Command-Selbstheilung lässt eine erfolgreiche Registrierung in Ruhe', async () => {
  const { startCommandSelfHealing } = require('../bots/love-tester-bot/src/scheduler');
  let putCalls = 0;
  const fakeRest = {
    put: async (route, { body }) => {
      putCalls++;
      return (body || []).map((c) => ({ id: `id-${c.name}`, name: c.name }));
    },
  };
  const ctx = {
    commandsRegistered: true,
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' }, guilds: { cache: new Map() } },
    logger: { info() {}, warn() {}, error() {} },
    commandIds: {},
    guildCommandIds: new Map(),
  };

  const stop = startCommandSelfHealing({ ctx, retryMs: 5, revMs: 10_000 });
  await new Promise((r) => setTimeout(r, 50));
  stop();
  assert.equal(putCalls, 0, 'keine unnötige Neu-Registrierung bei intakter Registrierung');
});

test('Command-Selbstheilung stößt periodisch (24h) eine frische Registrierung an', async () => {
  const { startCommandSelfHealing } = require('../bots/love-tester-bot/src/scheduler');
  let putCalls = 0;
  const fakeRest = {
    put: async (route, { body }) => {
      putCalls++;
      return (body || []).map((c) => ({ id: `id-${c.name}`, name: c.name }));
    },
  };
  const ctx = {
    commandsRegistered: true,
    token: 'test-token',
    rest: fakeRest,
    client: { user: { id: 'app1' }, guilds: { cache: new Map() } },
    logger: { info() {}, warn() {}, error() {} },
    commandIds: {},
    guildCommandIds: new Map(),
  };

  const stop = startCommandSelfHealing({ ctx, retryMs: 5, revMs: 20 });
  try {
    const deadline = Date.now() + 2000;
    while (putCalls < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.ok(putCalls >= 1, 'nach dem Reverify-Flip wird frisch registriert');
  } finally {
    stop();
  }
});
