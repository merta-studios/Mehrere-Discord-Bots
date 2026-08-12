/**
 * Baut alle Container, Layout-Komponenten (Components V2) und Modals des
 * Geburtstags-Bots und liest die Geburtstagsliste wieder aus den
 * Komponenten zurück (das ist die „Datenbank“ – die Liste steckt
 * komplett in den Komponenten selbst!).
 *
 * Alle Embeds wurden auf moderne Container / Layout Components umgestellt:
 * - Kein farbiger Rand an der Seite
 * - Trennlinien (Separators / Dividers) direkt im Container
 * - Buttons und ActionRows direkt im Container integriert
 * - Titel „🎂 Geburtstage“ oben direkt beim Datumstext
 * - Kein störender Footer / Timestamp am Ende der Liste
 *
 * Marker (Listen-Sprache, Glückwünsche, Interessenten) sind als
 * Zero-Width-Blobs kodiert (siehe zw-marker.js) – für Nutzer komplett
 * unsichtbar, aber vom Bot jederzeit auslesbar.
 *
 * NEU: Kombinierte Tages-Nachricht – mehrere Geburtstage & Events an
 * einem Tag werden in EINE Nachricht mit mehreren Abschnitten gepackt.
 * Jeder Abschnitt hat eigene Gratulanten/Interessenten + eigenen Button.
 */

const {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} = require('discord.js');

const {
  LANGS,
  t,
  tzOf,
  formatBirthday,
  formatDaysUntil,
  formatToday,
} = require('./languages');
const { pad, tzParts, daysUntilNext } = require('./logic');
const { encodeHidden, decodeHidden } = require('./zw-marker');

const COLORS = {
  list: null, confirm: null, success: null, error: null, congrats: null, help: null, panel: null,
};

/** Marker, über den der Bot seine eigene Liste in jedem Channel wiederfindet. */
const LIST_MARKER = 'bday::v1::';

// ---------------------------------------------------------------------------
// Text-Extraktion (liest Komponenten, Embeds und Strings aus)
// ---------------------------------------------------------------------------

function extractAllText(obj) {
  let out = '';
  if (!obj) return out;
  if (typeof obj === 'string') return obj + '\n';
  if (Array.isArray(obj)) {
    for (const item of obj) out += extractAllText(item);
    return out;
  }
  if (typeof obj === 'object') {
    if (obj.content) out += obj.content + '\n';
    if (obj.data?.content) out += obj.data.content + '\n';
    if (obj.title) out += obj.title + '\n';
    if (obj.description) out += obj.description + '\n';
    if (obj.footer?.text) out += obj.footer.text + '\n';
    if (obj.fields && Array.isArray(obj.fields)) {
      for (const f of obj.fields) {
        out += (f.name || '') + '\n' + (f.value || '') + '\n';
      }
    }
    if (obj.components) out += extractAllText(obj.components);
    if (obj.embeds) out += extractAllText(obj.embeds);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geburtstagsliste (Container / Components V2)
// ---------------------------------------------------------------------------

/**
 * Baut den modernen Listen-Container:
 * - Titel „🎂 Geburtstage“ oben beim Datumstext
 * - Trennlinie (Divider) zwischen Header und Monaten
 * - Monate als formatierte Abschnitte mit lokalisiertem Countdown hinter jeder Erwähnung
 *   (Events stehen mit ihrem Namen statt einer Nutzer-Erwähnung in derselben Liste –
 *   OHNE Raketen-Emoji, das wurde entfernt)
 * - Sortierung nach Tagen bis zum nächsten Geburtstag (daysUntilNext), nicht nur nach Monat:
 *   Heute = „Heute“, danach chronologisch, vergangene Geburtstage rutschen ganz nach unten
 *   und sind bereit fürs nächste Jahr. Events werden nach Ablauf gelöscht (siehe store).
 * - Trennlinie vor dem Button
 * - „Geburtstag eintragen“-Button direkt im Container
 * - Kein farbiger Rand, kein sichtbarer Footer, kein störender Timestamp
 * - Unsichtbarer Marker für die Wiedererkennung (inkl. optionaler Geburtstagsrolle)
 */
function buildListEmbed({ birthdays = [], events = [], lang = 'de', now = new Date(), birthdayRoleId = null }) {
  const tz = tzOf(lang);
  const months = LANGS[lang].months;

  const container = new ContainerBuilder();

  // Header: Titel + Datumstext zusammen oben, plus unsichtbarer Sprach-Marker
  // (komplett aus Zero-Width-Zeichen kodiert → für Nutzer unsichtbar)
  const marker = birthdayRoleId ? `${LIST_MARKER}${lang}:${birthdayRoleId}` : `${LIST_MARKER}${lang}`;
  const headerLines = [
    `# ${t('listTitle', lang)}`,
    `## 📅 ${formatToday(lang, now)}`,
    t('listTagline', lang),
    encodeHidden(marker),
  ];
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerLines.join('\n'))
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  // Geburtstage + Events gemeinsam nach Tagen bis zum nächsten Vorkommen sortiert
  // → „Heute“ (0 Tage) ganz oben, vergangene Geburtstage (z.B. 364 Tage) ganz unten
  const rawEntries = [
    ...birthdays.map((b) => ({ kind: 'user', userId: b.userId, day: b.day, month: b.month })),
    ...events.map((e) => ({ kind: 'event', name: e.name, day: e.day, month: e.month })),
  ];

  if (!rawEntries.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`🎈 ${t('listEmpty', lang)}`)
    );
  } else {
    const enriched = rawEntries
      .map((e) => ({
        ...e,
        days: daysUntilNext(e.day, e.month, tz, now),
      }))
      .sort((a, b) => {
        if (a.days !== b.days) return a.days - b.days;
        // Tie-Breaker: Monat, dann Tag, dann Name/User
        if (a.month !== b.month) return a.month - b.month;
        if (a.day !== b.day) return a.day - b.day;
        if (a.kind !== b.kind) return a.kind === 'user' ? -1 : 1;
        return 0;
      });

    // Gruppiere nach Monat in der sortierten Reihenfolge.
    // Erlaubt, dass derselbe Monat zweimal vorkommt (z.B. August oben für kommende,
    // August unten für bereits vergangene Geburtstage) – so rutschen vergangene
    // wirklich ganz nach unten.
    const sections = [];
    let currentMonth = null;
    let currentLines = [];

    for (const e of enriched) {
      if (e.month !== currentMonth) {
        if (currentLines.length) {
          sections.push({ month: currentMonth, lines: currentLines });
        }
        currentMonth = e.month;
        currentLines = [];
      }
      const daysText = formatDaysUntil(e.days, lang);
      if (e.kind === 'event') {
        // Raketen-Emoji entfernt – Events wie normale Einträge, nur fett
        currentLines.push(`${pad(e.day)}.${pad(e.month)} | **${e.name}** – ${daysText}`);
      } else {
        currentLines.push(`${pad(e.day)}.${pad(e.month)} | <@${e.userId}> – ${daysText}`);
      }
    }
    if (currentLines.length) {
      sections.push({ month: currentMonth, lines: currentLines });
    }

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const monthName = months[sec.month - 1] || `Month ${sec.month}`;
      const monthText = `### ${monthName}\n${sec.lines.join('\n')}`;
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(monthText));
      if (i < sections.length - 1) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      }
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(listActionRow(lang));

  return container;
}

/** Der „Geburtstag eintragen“-Button unter/in der Liste. */
function listActionRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bday_add')
      .setStyle(ButtonStyle.Primary)
      .setLabel(t('btnAddBirthday', lang))
  );
}

/**
 * Liest Sprache + Geburtstage + Events + Geburtstagsrolle aus einer
 * Listen-Nachricht (Container oder Embed) zurück.
 * Rückgabe: { lang, birthdays: [{userId, day, month}], events: [{name, day, month}],
 *             birthdayRoleId } oder null.
 */
function parseListEmbed(msg) {
  if (!msg) return null;
  const text = extractAllText(msg);

  // Neue Listen: Sprach-Marker ist als unsichtbarer Zero-Width-Blob kodiert.
  // Alte Listen (und Fremd-Nachrichten) tragen ihn als Klartext.
  const hidden = decodeHidden(text).join('\n');
  const haystack = `${text}\n${hidden}`;

  const marker = haystack.match(/bday::v1::([a-z]{2,5})(?::(\d+))?/i);
  const lang = marker ? marker[1].toLowerCase() : 'en';
  const birthdayRoleId = marker && marker[2] ? marker[2] : null;

  const birthdays = [];
  const events = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    // Geburtstage: „14.08 | <@123> – Heute / in X Tagen“
    const m = line.match(/^(\d{1,2})\.(\d{1,2})\s*\|\s*<@!?(\d+)>(?:\s+[–—-]\s+.*)?$/);
    if (m) {
      const key = `${m[3]}:${m[2]}:${m[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        birthdays.push({ day: Number(m[1]), month: Number(m[2]), userId: m[3] });
      }
      continue;
    }
    // Event-Zeilen: „05.12 | **Name** – …“ (optional altes 🚀 noch tolerieren für Migration)
    const ev = line.match(/^(\d{1,2})\.(\d{1,2})\s*\|\s*(?:🚀\s*)?\*\*(.+?)\*\*(?:\s+[–—-]\s+.*)?$/);
    if (ev) {
      let name = ev[3].trim();
      // Altes Raketen-Emoji aus dem Namen entfernen, falls noch in alten Listen vorhanden
      name = name.replace(/🚀/g, '').trim();
      if (!name) continue;
      const key = `event:${name.toLowerCase()}:${ev[2]}:${ev[1]}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push({ event: true, name, day: Number(ev[1]), month: Number(ev[2]) });
      }
    }
  }

  return { lang, birthdays, events, birthdayRoleId };
}

// ---------------------------------------------------------------------------
// Eintragen-Formular & Bestätigung
// ---------------------------------------------------------------------------

/**
 * Modal mit Tag + Monat (bei „Bearbeiten“ mit vorausgefüllten Zahlen).
 *
 * Beide Felder sind NICHT verpflichtend: Lässt man sie beide leer, will man
 * den eigenen Geburtstag löschen (siehe entryModalSubmit). Wird nur eines
 * befüllt, fängt das die Validierung als Fehler ab.
 */
function buildEntryModal(lang, prefill = {}) {
  const dayInput = new TextInputBuilder()
    .setCustomId('day')
    .setLabel(t('modalDayLabel', lang))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2)
    .setPlaceholder(t('modalDayPlaceholder', lang));
  if (prefill.day) dayInput.setValue(String(prefill.day));

  const monthInput = new TextInputBuilder()
    .setCustomId('month')
    .setLabel(t('modalMonthLabel', lang))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(24)
    .setPlaceholder(t('modalMonthPlaceholder', lang));
  if (prefill.month) monthInput.setValue(String(prefill.month));

  return new ModalBuilder()
    .setCustomId('bday_modal')
    .setTitle(t('modalTitle', lang))
    .addComponents(
      new ActionRowBuilder().addComponents(dayInput),
      new ActionRowBuilder().addComponents(monthInput)
    );
}

/** Modal für /admin_set_birthday (gleiches Formular, anderer Titel). */
function buildAdminModal(lang, targetUser) {
  const modal = buildEntryModal(lang);
  modal.setCustomId('admin_bday_modal');
  modal.setTitle(t('adminModalTitle', lang, { user: targetUser }));
  return modal;
}

/** Bestätigungs-Container mit Text, Trennlinie und den 3 Buttons im Container. */
function buildConfirmationEmbed({ day, month, lang, input, fuzzy }) {
  const date = formatBirthday(day, month, lang);
  let desc = t('confirmBody', lang, { date });
  if (fuzzy && input) {
    desc += `\n\n${t('fuzzyNote', lang, { input, month: LANGS[lang].months[month - 1] })}`;
  }

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t('confirmTitle', lang)}\n\n${desc}`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(confirmationRow(lang));

  return container;
}

function confirmationRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bday_confirm_yes').setStyle(ButtonStyle.Success).setLabel(t('btnConfirm', lang)),
    new ButtonBuilder().setCustomId('bday_confirm_edit').setStyle(ButtonStyle.Secondary).setLabel(t('btnEdit', lang)),
    new ButtonBuilder().setCustomId('bday_confirm_no').setStyle(ButtonStyle.Secondary).setLabel(t('btnCancel', lang))
  );
}

/**
 * Bestätigungs-Container fürs LÖSCHEN: Man hat die beiden Felder leer
 * gelassen → der eigene (bzw. beim Admin der Ziel-) Geburtstag soll entfernt
 * werden. Gleiche 3 Buttons wie beim Eintragen.
 */
function buildDeleteConfirmationEmbed({ lang, target }) {
  const desc = target
    ? t('adminDeleteConfirmBody', lang, { user: target })
    : t('deleteConfirmBody', lang);

  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t('deleteConfirmTitle', lang)}\n\n${desc}`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(confirmationRow(lang));
}

/** Fehler-Container für die 7-Tage-Regel. */
function buildSevenDayErrorEmbed(lang, day, month) {
  const date = formatBirthday(day, month, lang);
  return new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${t('errSevenDaysTitle', lang)}\n\n${t('errSevenDaysBody', lang, { date })}`
    )
  );
}

// ---------------------------------------------------------------------------
// Glückwunsch-/Interessenten-Listen: untereinander + Uhrzeit
// ---------------------------------------------------------------------------

/**
 * Normalisiert Glückwunsch-/Interessenten-Einträge. Erlaubt sowohl alte
 * Listen (nur User-ID-Strings) als auch neue Einträge mit Zeitstempel:
 *   "123"                -> { id: "123", ts: null }
 *   { id: "123", ts: n } -> { id: "123", ts: n }
 *
 * Dedupliziert nach ID (der erste Eintrag gewinnt) – so kann ein Nutzer
 * niemals doppelt in der Liste auftauchen, selbst wenn die Quelle
 * (Marker + sichtbare Erwähnungen) einen Doppel-Eintrag enthält.
 */
function normalizeWishEntries(entries) {
  const seen = new Set();
  return (entries || [])
    .map((w) => {
      if (typeof w === 'string') return { id: w, ts: null };
      return { id: String(w.id ?? w.userId ?? ''), ts: w.ts || null };
    })
    .filter((w) => {
      if (!w.id || seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });
}

/** Uhrzeit („14:32“) im Format + Zeitzone der Listensprache. */
function formatWishTime(ts, lang) {
  if (!ts) return '';
  const locale = LANGS[lang]?.locale || 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tzOf(lang),
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/**
 * Baut die Listen-Zeilen: jede Person UNTEREINANDER auf einer eigenen
 * Zeile, jeweils mit Uhrzeit des Klicks:
 *   @Mia · 14:32
 *   @Tom · 14:41
 *   @Lisa · 15:03
 */
function wishListText(entries, lang) {
  return entries
    .map((w) => (w.ts ? `<@${w.id}> · ${formatWishTime(w.ts, lang)}` : `<@${w.id}>`))
    .join('\n');
}

/**
 * Baut die WIRKLICH unsichtbaren Marker für ALLE Einträge (auch über die
 * sichtbaren hinaus): Die komplette Liste samt Uhrzeiten wird als
 * Zero-Width-Blob kodiert (kein sichtbarer Text wie früher „wish:…/int:…“).
 *
 * Rückgabe: Array von Zeichenketten, die NUR aus Zero-Width-Zeichen
 * bestehen. Jeder Eintrag beginnt an einer Eintrags-Grenze, damit jeder
 * Teil für sich dekodierbar ist. Mehrere Teile entstehen nur, wenn die
 * Liste sehr lang wird (TextDisplay-Limit 4000 Zeichen).
 */
function wishMarkerText(entries, prefix, chunkPayloadChars = 1700) {
  const chunks = [];
  let current = '';
  for (const w of entries) {
    if (!w.ts) continue;
    const marker = `${prefix}:${w.id}:${w.ts}`;
    if (current && current.length + marker.length > chunkPayloadChars) {
      chunks.push(encodeHidden(current));
      current = '';
    }
    current += marker;
  }
  if (current) chunks.push(encodeHidden(current));
  return chunks;
}

// Neue Marker für kombinierte Nachricht (scoped)
function combinedWishMarkerText(birthdayId, entries, chunkPayloadChars = 1700) {
  const chunks = [];
  let current = '';
  for (const w of entries) {
    if (!w.ts) continue;
    const marker = `bday-wish:${birthdayId}:${w.id}:${w.ts}`;
    if (current && current.length + marker.length > chunkPayloadChars) {
      chunks.push(encodeHidden(current));
      current = '';
    }
    current += marker;
  }
  if (current) chunks.push(encodeHidden(current));
  return chunks;
}

function combinedIntMarkerText(eventHex, entries, chunkPayloadChars = 1700) {
  const chunks = [];
  let current = '';
  const hex = String(eventHex || '').toLowerCase();
  for (const w of entries) {
    if (!w.ts) continue;
    const marker = `bday-int:${hex}:${w.id}:${w.ts}`;
    if (current && current.length + marker.length > chunkPayloadChars) {
      chunks.push(encodeHidden(current));
      current = '';
    }
    current += marker;
  }
  if (current) chunks.push(encodeHidden(current));
  return chunks;
}

// ---------------------------------------------------------------------------
// Täglicher Geburtstags-Gruß (einzeln – bleibt für Kompatibilität)
// ---------------------------------------------------------------------------

/**
 * Geburtstags-Container mit Titel, Erwähnung, Glückwünschen, Trennlinie
 * und „Gratulieren“-Button direkt im Container.
 *
 * Glückwünsche: Mentions UNTEREINANDER, mit Uhrzeit des Gratulierens.
 * Die komplette Liste inkl. Uhrzeiten steckt als unsichtbarer
 * Zero-Width-Blob im Container (das ist die „Datenbank“).
 */
function buildCongratsEmbed({ member, lang, dateKey, wishes = [] }) {
  const container = new ContainerBuilder();

  const header = `# ${t('bdayCongratsTitle', lang)}\n\n${t('bdayCongratsBody', lang, { user: `<@${member.id}>` })}\n${encodeHidden(`bday-congrats:${dateKey}:${member.id}`)}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

  const all = normalizeWishEntries(wishes);
  if (all.length > 0) {
    const maxShown = 12;
    let wishesText = `### ${t('congratsField', lang, { count: all.length })}\n`;
    wishesText += wishListText(all.slice(0, maxShown), lang);
    if (all.length > maxShown) {
      wishesText += `\n${t('congratsMore', lang, { count: all.length - maxShown })}`;
    }
    // Unsichtbare Zero-Width-Marker für die komplette Liste (Zähler,
    // Uhrzeiten & Doppel-Klick-Schutz bleiben korrekt)
    const chunks = wishMarkerText(all, 'wish');
    if (chunks.length) wishesText += chunks[0];
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(wishesText));
    for (const chunk of chunks.slice(1)) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bday_congrats_${member.id}_${dateKey}`)
      .setStyle(ButtonStyle.Success)
      .setLabel(t('btnCongratulate', lang))
  );
  container.addActionRowComponents(row);

  return { container, embed: container, row };
}

// ---------------------------------------------------------------------------
// Kombinierte Tages-Nachricht – mehrere Geburtstage & Events in EINER Message
// ---------------------------------------------------------------------------

/**
 * Baut EINE kombinierte Nachricht für alle Geburtstage + Events eines Tages.
 * Jeder Abschnitt hat eigenen Marker, eigene Gratulanten/Interessenten und eigenen Button.
 *
 * Struktur:
 * - Header: combinedTitle + combinedDesc + hidden bday-combined:dateKey
 * - Für jede Geburtstagsperson:
 *   - TextDisplay: Titel + Body + hidden bday-congrats:dateKey:userId
 *   - (optional) TextDisplay: Glückwünsche (x) + wish lines + hidden bday-wish:birthdayId:wisherId:ts chunks
 *   - ActionRow: Gratulieren Button (bday_congrats_userId_dateKey)
 *   - Separator
 * - Für jedes Event:
 *   - TextDisplay: Event Titel + Body + hidden bday-event:dateKey:hex
 *   - (optional) TextDisplay: Interessenten + lines + hidden bday-int:hex:wisherId:ts
 *   - ActionRow: Interessant Button (bday_event_interest_<index>_<dateKey>)
 */
function buildCombinedCongratsEmbed({ lang = 'de', dateKey, birthdays = [], events = [], now = new Date() }) {
  const container = new ContainerBuilder();
  const maxShown = 12;

  const headerLines = [
    `# ${t('combinedTitle', lang)}`,
    t('combinedDesc', lang),
    encodeHidden(`bday-combined:${dateKey}`),
  ];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

  // Birthdays
  for (let i = 0; i < birthdays.length; i++) {
    const b = birthdays[i];
    const bId = String(b.id || b.userId || b.member?.id || '');
    if (!bId) continue;
    const wishes = normalizeWishEntries(b.wishes || []);

    const header = `## ${t('bdayCongratsTitle', lang)}\n\n${t('bdayCongratsBody', lang, { user: `<@${bId}>` })}\n${encodeHidden(`bday-congrats:${dateKey}:${bId}`)}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    if (wishes.length > 0) {
      let wishesText = `### ${t('congratsField', lang, { count: wishes.length })}\n`;
      wishesText += wishListText(wishes.slice(0, maxShown), lang);
      if (wishes.length > maxShown) {
        wishesText += `\n${t('congratsMore', lang, { count: wishes.length - maxShown })}`;
      }
      const chunks = combinedWishMarkerText(bId, wishes);
      if (chunks.length) wishesText += chunks[0];
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(wishesText));
      for (const chunk of chunks.slice(1)) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
      }
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bday_congrats_${bId}_${dateKey}`)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnCongratulate', lang))
    );
    container.addActionRowComponents(row);

    if (i < birthdays.length - 1 || events.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
  }

  // Events
  for (let j = 0; j < events.length; j++) {
    const ev = events[j];
    const name = ev.name;
    if (!name) continue;
    const hex = (ev.hex || encodeEventName(name)).toLowerCase();
    const interested = normalizeWishEntries(ev.interested || []);

    const header = `## ${t('eventCongratsTitle', lang)}\n\n${t('eventCongratsBody', lang, { name: `**${name}**` })}\n${encodeHidden(`bday-event:${dateKey}:${hex}`)}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    if (interested.length > 0) {
      let text = `### ${t('eventInterestedField', lang, { count: interested.length })}\n`;
      text += wishListText(interested.slice(0, maxShown), lang);
      if (interested.length > maxShown) {
        text += `\n${t('congratsMore', lang, { count: interested.length - maxShown })}`;
      }
      const chunks = combinedIntMarkerText(hex, interested);
      if (chunks.length) text += chunks[0];
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
      for (const chunk of chunks.slice(1)) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
      }
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    // Indexed customId: robust gegen lange Hex, leicht parsbar
    const customId = `bday_event_interest_${j}_${dateKey}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(customId)
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnEventInterested', lang))
    );
    container.addActionRowComponents(row);

    if (j < events.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    }
  }

  return { container, embed: container };
}

// ---------------------------------------------------------------------------
// Parsing für kombinierte Nachricht (für Interaktionen)
// ---------------------------------------------------------------------------

function parseCombinedMessage(msg) {
  const text = extractAllText(msg) || '';
  const hiddenAll = decodeHidden(text).join('\n');
  const haystack = `${text}\n${hiddenAll}`;

  let dateKey = null;
  const combinedMatch = haystack.match(/bday-combined:(\d{4}-\d{2}-\d{2})/);
  if (combinedMatch) dateKey = combinedMatch[1];

  // Birthdays in order
  const birthdayOrder = [];
  const seenB = new Set();
  const bdayRegex = /bday-congrats:(\d{4}-\d{2}-\d{2}):(\d+)/g;
  let m;
  while ((m = bdayRegex.exec(haystack))) {
    const d = m[1], uid = m[2];
    if (!dateKey) dateKey = d;
    if (!seenB.has(uid)) {
      seenB.add(uid);
      birthdayOrder.push(uid);
    }
  }

  // Events in order
  const eventOrder = [];
  const seenE = new Set();
  const eventRegex = /bday-event:(\d{4}-\d{2}-\d{2}):([0-9a-f]+)/gi;
  while ((m = eventRegex.exec(haystack))) {
    const d = m[1], hex = m[2].toLowerCase();
    if (!dateKey) dateKey = d;
    if (!seenE.has(hex)) {
      seenE.add(hex);
      eventOrder.push(hex);
    }
  }

  // Wishes: bday-wish:birthdayId:wisherId:ts
  const wishesByBirthday = new Map();
  const wishCombinedRegex = /bday-wish:(\d+):(\d+):(\d+)/g;
  while ((m = wishCombinedRegex.exec(haystack))) {
    const bId = m[1], wId = m[2], ts = Number(m[3]);
    if (!wishesByBirthday.has(bId)) wishesByBirthday.set(bId, []);
    const arr = wishesByBirthday.get(bId);
    if (!arr.some(v => v.id === wId)) arr.push({ id: wId, ts });
  }
  // Legacy wish: wish:wisherId:ts (but not part of bday-wish)
  const legacyWishes = [];
  const legacyWishRegex = /\bwish:(\d+):(\d+)/g;
  while ((m = legacyWishRegex.exec(haystack))) {
    const idx = m.index;
    const preceding = haystack.slice(Math.max(0, idx - 5), idx);
    if (preceding.endsWith('bday-')) continue;
    const wId = m[1], ts = Number(m[2]);
    if (!legacyWishes.some(v => v.id === wId)) legacyWishes.push({ id: wId, ts });
  }

  // Interested: bday-int:hex:wisherId:ts
  const interestedByHex = new Map();
  const intCombinedRegex = /bday-int:([0-9a-f]+):(\d+):(\d+)/gi;
  while ((m = intCombinedRegex.exec(haystack))) {
    const hex = m[1].toLowerCase(), wId = m[2], ts = Number(m[3]);
    if (!interestedByHex.has(hex)) interestedByHex.set(hex, []);
    const arr = interestedByHex.get(hex);
    if (!arr.some(v => v.id === wId)) arr.push({ id: wId, ts });
  }
  const legacyInt = [];
  const legacyIntRegex = /\bint:(\d+):(\d+)/g;
  while ((m = legacyIntRegex.exec(haystack))) {
    const idx = m.index;
    const preceding = haystack.slice(Math.max(0, idx - 5), idx);
    if (preceding.endsWith('bday-')) continue;
    const wId = m[1], ts = Number(m[2]);
    if (!legacyInt.some(v => v.id === wId)) legacyInt.push({ id: wId, ts });
  }

  const birthdays = birthdayOrder.map(bId => ({
    id: bId,
    wishes: wishesByBirthday.get(bId) || (birthdayOrder.length === 1 ? legacyWishes : []),
  }));

  const events = eventOrder.map(hex => {
    const name = decodeEventName(hex) || hex;
    return {
      name,
      hex,
      interested: interestedByHex.get(hex) || (eventOrder.length === 1 ? legacyInt : []),
    };
  });

  return {
    dateKey,
    birthdays,
    events,
    wishesByBirthday,
    interestedByHex,
    legacyWishes,
    legacyInt,
  };
}

function isCombinedMessage(msg) {
  const text = extractAllText(msg) || '';
  const hiddenAll = decodeHidden(text).join('\n');
  const hay = `${text}\n${hiddenAll}`;
  return /bday-combined:\d{4}-\d{2}-\d{2}/.test(hay);
}

// ---------------------------------------------------------------------------
// Events (/event) – Formular, Bestätigung, 0-Uhr-Nachricht, Lösch-Auswahl
// ---------------------------------------------------------------------------

/**
 * Kodiert einen Event-Namen kompakt & separator-sicher (nur [0-9a-f]),
 * damit er in Custom-IDs, Markern und Select-Values mitreisen kann.
 */
function encodeEventName(name) {
  return Buffer.from(String(name ?? ''), 'utf8').toString('hex');
}
function decodeEventName(hex) {
  try {
    if (!/^[0-9a-f]*$/i.test(String(hex))) return null;
    const s = Buffer.from(String(hex), 'hex').toString('utf8');
    return s || null;
  } catch {
    return null;
  }
}

/** Modal für /event create: Name + Tag + Monat (kein Jahr, jedes Datum erlaubt). */
function buildEventModal(lang, prefill = {}) {
  const nameInput = new TextInputBuilder()
    .setCustomId('name')
    .setLabel(t('eventNameLabel', lang).slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(45)
    .setPlaceholder(t('eventNamePlaceholder', lang).slice(0, 100));
  if (prefill.name) nameInput.setValue(String(prefill.name).slice(0, 45));

  const dayInput = new TextInputBuilder()
    .setCustomId('day')
    .setLabel(t('modalDayLabel', lang).slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder(t('modalDayPlaceholder', lang).slice(0, 100));
  if (prefill.day) dayInput.setValue(String(prefill.day));

  const monthInput = new TextInputBuilder()
    .setCustomId('month')
    .setLabel(t('modalMonthLabel', lang).slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(24)
    .setPlaceholder(t('modalMonthPlaceholder', lang).slice(0, 100));
  if (prefill.month) monthInput.setValue(String(prefill.month));

  return new ModalBuilder()
    .setCustomId('bday_event_modal')
    .setTitle(t('eventModalTitle', lang).slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(dayInput),
      new ActionRowBuilder().addComponents(monthInput)
    );
}

/** Bestätigungs-Container für ein neues Event (gleiche 3 Buttons wie beim Geburtstag). */
function buildEventConfirmationEmbed({ name, day, month, lang }) {
  const date = formatBirthday(day, month, lang);
  const desc = t('eventConfirmBody', lang, { name: `**${name}**`, date });

  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t('confirmTitle', lang)}\n\n${desc}`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(eventConfirmationRow(lang));
}

function eventConfirmationRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bday_event_yes').setStyle(ButtonStyle.Success).setLabel(t('btnConfirm', lang)),
    new ButtonBuilder().setCustomId('bday_event_edit').setStyle(ButtonStyle.Secondary).setLabel(t('btnEdit', lang)),
    new ButtonBuilder().setCustomId('bday_event_no').setStyle(ButtonStyle.Secondary).setLabel(t('btnCancel', lang))
  );
}

/**
 * Die tägliche Event-Nachricht um 0 Uhr – wie der Geburtstags-Gruß, aber mit
 * Event-Titel, „Interessenten“-Abschnitt und „Interessant! 😂“-Button.
 * Interessenten: Mentions UNTEREINANDER, mit Uhrzeit des Klicks.
 * (Einzel-Version – bleibt für Kompatibilität, wird aber jetzt durch combined ersetzt)
 */
function buildEventCongratsEmbed({ name, lang, dateKey, interested = [] }) {
  const container = new ContainerBuilder();

  const hex = encodeEventName(name);
  const header = `# ${t('eventCongratsTitle', lang)}\n\n${t('eventCongratsBody', lang, { name: `**${name}**` })}\n${encodeHidden(`bday-event:${dateKey}:${hex}`)}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

  const all = normalizeWishEntries(interested);
  if (all.length > 0) {
    const maxShown = 12;
    let text = `### ${t('eventInterestedField', lang, { count: all.length })}\n`;
    text += wishListText(all.slice(0, maxShown), lang);
    if (all.length > maxShown) {
      text += `\n${t('congratsMore', lang, { count: all.length - maxShown })}`;
    }
    // Unsichtbare Zero-Width-Marker für die komplette Liste (Zähler,
    // Uhrzeiten & Doppel-Klick-Schutz bleiben korrekt)
    const chunks = wishMarkerText(all, 'int');
    if (chunks.length) text += chunks[0];
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    for (const chunk of chunks.slice(1)) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bday_event_interest')
        .setStyle(ButtonStyle.Success)
        .setLabel(t('btnEventInterested', lang))
    )
  );

  return { container, embed: container };
}

/** Ephemeres Lösch-Menü für /event delete: Auswahl aller eingetragenen Events. */
function buildEventDeleteEmbed({ lang, events }) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('bday_event_delete')
    .setPlaceholder(t('eventSelectPlaceholder', lang).slice(0, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      events.slice(0, 25).map((e) => ({
        label: e.name.slice(0, 100) || `${e.day}.${e.month}`,
        value: `${e.day}.${e.month}.${encodeEventName(e.name)}`.slice(0, 100),
        description: `📅 ${pad(e.day)}.${pad(e.month)}`,
      }))
    );

  return new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# ${t('eventDeleteTitle', lang)}`)
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addActionRowComponents(new ActionRowBuilder().addComponents(select));
}

// ---------------------------------------------------------------------------
// Kleinere Helfer (Container ohne Farbrand)
// ---------------------------------------------------------------------------

function smallContainer(title, desc) {
  const container = new ContainerBuilder();
  let text = '';
  if (title) text += `# ${title}\n\n`;
  if (desc) text += desc;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.trim() || '…'));
  return container;
}

function smallEmbed(_color, title, desc) {
  return smallContainer(title, desc);
}

module.exports = {
  COLORS,
  LIST_MARKER,
  extractAllText,
  buildListEmbed,
  listActionRow,
  parseListEmbed,
  buildEntryModal,
  buildAdminModal,
  buildConfirmationEmbed,
  buildDeleteConfirmationEmbed,
  confirmationRow,
  buildSevenDayErrorEmbed,
  buildCongratsEmbed,
  buildCombinedCongratsEmbed,
  parseCombinedMessage,
  isCombinedMessage,
  encodeEventName,
  decodeEventName,
  buildEventModal,
  buildEventConfirmationEmbed,
  buildEventCongratsEmbed,
  buildEventDeleteEmbed,
  eventConfirmationRow,
  normalizeWishEntries,
  formatWishTime,
  wishListText,
  wishMarkerText,
  combinedWishMarkerText,
  combinedIntMarkerText,
  encodeHidden,
  decodeHidden,
  smallContainer,
  smallEmbed,
};
