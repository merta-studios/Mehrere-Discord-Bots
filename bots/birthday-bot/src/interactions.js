/**
 * Alle Interaktionen, die keine Slash-Commands sind:
 * Buttons (Eintragen, Bestätigen, Bearbeiten, Abbrechen, Gratulieren),
 * Modals (Formulare) und Select-Menüs (Admin-Panel).
 *
 * Verwendet moderne Container & Layout-Komponenten (Components V2).
 *
 * Glückwunsch-/Interessenten-Listen werden aus den wirklich unsichtbaren
 * Zero-Width-Markern (zw-marker.js) UND den sichtbaren Erwähnungen
 * gelesen und vereinigt – dedupliziert, verlustfrei, ohne sichtbares
 * „wish:/int:“-Textformat.
 *
 * NEU: Unterstützt kombinierte Tages-Nachricht mit mehreren Abschnitten.
 */

const { MessageFlags } = require('discord.js');

const { t, formatBirthday, matchMonth, langFromDiscord } = require('./languages');
const { parseDayInput, isValidDate, isWithinSevenDays, isWithinHours, sanitizeEventName } = require('./logic');
const {
  extractAllText,
  buildEntryModal,
  buildConfirmationEmbed,
  buildDeleteConfirmationEmbed,
  buildSevenDayErrorEmbed,
  buildCongratsEmbed,
  buildCombinedCongratsEmbed,
  parseCombinedMessage,
  isCombinedMessage,
  buildEventModal,
  buildEventConfirmationEmbed,
  buildEventCongratsEmbed,
  decodeEventName,
  encodeEventName,
  normalizeWishEntries,
  decodeHidden,
  smallContainer,
} = require('./embed-builder');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');
const { componentsV2Payload } = require('./message-payload');

/**
 * Liest die Glückwunsch-/Interessenten-Einträge (id + Uhrzeit) aus den
 * Markern einer Nachricht. Unterstützt BOTH:
 * - neue, wirklich unsichtbare Zero-Width-Blobs (siehe zw-marker.js)
 * - alte Klartext-Marker („\u200Bwish:<userId>:<ts>\u200B“) zur Migration
 * Dedupliziert nach ID (erster Treffer gewinnt).
 */
function parseMarkedEntries(text, prefix) {
  const out = [];
  const seen = new Set();
  const re = new RegExp(`${prefix}:(\\d+):(\\d+)`, 'g');
  const sources = [text || '', ...decodeHidden(text || '')];
  for (const src of sources) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        out.push({ id: m[1], ts: Number(m[2]) });
      }
    }
  }
  return out;
}

/**
 * Vereinigt Marker-Einträge (mit Uhrzeit) und sichtbare Erwähnungen
 * (ohne Uhrzeit) zu EINER deduplizierten Liste. So geht beim
 * Wieder-Auslesen nichts verloren (auch wenn Marker fehlen/abgeschnitten
 * sind) und kein Nutzer kann doppelt auftauchen. Marker-Einträge
 * gewinnen (sie bringen die Uhrzeit mit), die Reihenfolge der Liste
 * bleibt stabil (Erst-Vorkommen).
 */
function mergeListEntries(marked, mentionedIds) {
  const byId = new Map();
  for (const w of marked) {
    if (!byId.has(w.id)) byId.set(w.id, { id: w.id, ts: w.ts || null });
  }
  for (const id of mentionedIds) {
    if (!byId.has(id)) byId.set(id, { id, ts: null });
  }
  return [...byId.values()];
}

/**
 * Trägt die Nachricht das Ephemeral-Flag? Robust gegenüber dem
 * discord.js-Flags-Bitfield, einfachen Zahlen (Mocks) und fehlenden Flags.
 */
function isEphemeralMessage(message) {
  const flags = message?.flags;
  if (!flags) return false;
  if (typeof flags === 'number') return (flags & MessageFlags.Ephemeral) !== 0;
  return Boolean(flags.has?.(MessageFlags.Ephemeral));
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function handleInteraction(ctx, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const { handleChatInput } = require('./commands');
      return await handleChatInput(ctx, interaction);
    }
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (id.startsWith(PANEL_PREFIX)) return await handlePanelButton(ctx, interaction);
      return await handleButton(ctx, interaction);
    }
    if (interaction.isModalSubmit()) {
      return await handleModal(ctx, interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith(PANEL_PREFIX)) {
        return await handlePanelSelect(ctx, interaction);
      }
      // „Welches Event löschen?“ aus /event delete
      if (interaction.customId === 'bday_event_delete') {
        return await eventDeleteSelect(ctx, interaction);
      }
    }
    return null;
  } catch (err) {
    ctx.logger.error('[birthday-bot] Interaction-Fehler:', err);
    const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
    const payload = componentsV2Payload(
      [smallContainer(null, t('errGeneric', lang))],
      { ephemeral: true }
    );
    try {
      if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
      return await interaction.reply(payload);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

async function handleButton(ctx, interaction) {
  const id = interaction.customId;

  // „Geburtstag eintragen“ unter der Liste
  if (id === 'bday_add') {
    let entry = ctx.store.get(interaction.guildId);

    // Selbstheilung: Steht kein Registry-Eintrag bereit (z. B. nach langer
    // Laufzeit / zwischenzeitlichem Registry-Verlust), wird die Liste im
    // Kanal gesucht und der Eintrag neu aufgebaut – so bleibt der Button
    // funktionsfähig, statt mit „Interaktion fehlgeschlagen“ abzubrechen.
    if (!entry && interaction.guild) {
      try {
        const found = await ctx.store.findListMessage(interaction.guild);
        if (found) {
          const { parseListEmbed } = require('./embed-builder');
          const parsed = parseListEmbed(found.message);
          entry = {
            guildId: interaction.guild.id,
            channelId: found.channel.id,
            messageId: found.message.id,
            lang: parsed.lang,
            birthdays: parsed.birthdays,
            lastRenderDay: null,
            lastBirthdayCheckDay: null,
          };
          ctx.store.set(entry);
        }
      } catch {
        /* Recovery ist optional */
      }
    }

    if (!entry) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errNoList', 'en'))], { ephemeral: true })
      );
    }

    try {
      return await interaction.showModal(buildEntryModal(entry.lang));
    } catch (err) {
      // Zeigt das Modal nicht möglich (Netzwerk/Rate-Limit) → sichtbarer
      // Fehler statt einer stummen „interaction failed“.
      ctx.logger.warn('[birthday-bot] Modal konnte nicht geöffnet werden:', err.message);
      return interaction.reply(
        componentsV2Payload(
          [smallContainer(null, t('errGeneric', entry.lang))],
          { ephemeral: true }
        )
      );
    }
  }

  // Bestätigen
  if (id === 'bday_confirm_yes') {
    return confirmYes(ctx, interaction);
  }

  // Bearbeiten → Formular erneut öffnen (Werte als Zahlen vorausgefüllt)
  if (id === 'bday_confirm_edit') {
    const pending = ctx.pending.get(interaction.user.id);
    if (!pending) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', 'en'))], { ephemeral: true })
      );
    }
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || 'en';
    await interaction.showModal(buildEntryModal(lang, { day: pending.day, month: pending.month }));
    // Öffentliche Alt-Bestätigungen (aus der Zeit vor der ephemeren Bestätigung)
    // lassen sich nicht per update() ersetzen → direkt löschen. Ephemere
    // Bestätigungen werden beim erneuten Absenden des Formulars per
    // update() durch die neue Bestätigung ersetzt.
    if (!isEphemeralMessage(interaction.message)) {
      await interaction.message.delete().catch(() => {});
    }
    return null;
  }

  // Abbrechen
  if (id === 'bday_confirm_no') {
    ctx.pending.delete(interaction.user.id);
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || langFromDiscord(interaction.locale);
    const note = t('cancelNote', lang);
    // Ephemere Bestätigung in-place ersetzen (ephemere Nachrichten kann der
    // Bot nicht löschen) – öffentliche Alt-Bestätigung löschen + Hinweis.
    if (isEphemeralMessage(interaction.message)) {
      return interaction.update(componentsV2Payload([smallContainer(null, note)]));
    }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.delete().catch(() => {});
    return interaction.followUp(
      componentsV2Payload([smallContainer(null, note)], { ephemeral: true })
    );
  }

  // Gratulieren auf dem Geburtstags-Gruß (einzeln oder kombiniert)
  if (id.startsWith('bday_congrats_')) {
    return congrats(ctx, interaction, id);
  }

  // Event-Bestätigung (Erstellen)
  if (id === 'bday_event_yes') {
    return eventConfirmYes(ctx, interaction);
  }
  if (id === 'bday_event_edit') {
    const pending = ctx.pendingEvent.get(interaction.user.id);
    if (!pending) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', 'en'))], { ephemeral: true })
      );
    }
    await interaction.showModal(
      buildEventModal(pending.lang, { day: pending.day, month: pending.month, name: pending.name })
    );
    if (!isEphemeralMessage(interaction.message)) {
      await interaction.message.delete().catch(() => {});
    }
    return null;
  }
  if (id === 'bday_event_no') {
    ctx.pendingEvent.delete(interaction.user.id);
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || langFromDiscord(interaction.locale);
    const note = t('cancelNote', lang);
    if (isEphemeralMessage(interaction.message)) {
      return interaction.update(componentsV2Payload([smallContainer(null, note)]));
    }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.delete().catch(() => {});
    return interaction.followUp(
      componentsV2Payload([smallContainer(null, note)], { ephemeral: true })
    );
  }

  // „Interessant! 😂“ auf der Event-Nachricht – Legacy + kombiniert
  if (id === 'bday_event_interest' || id.startsWith('bday_event_interest_')) {
    return eventInterest(ctx, interaction);
  }

  return null;
}

/**
 * Bestätigen: 7-Tage-Regel prüfen → ggf. alten Eintrag ersetzen → Liste
 * sofort aktualisieren. Die Bestätigungsnachricht ist ephemer (nur für die
 * eintragende Person sichtbar) und kann vom Bot nicht gelöscht werden –
 * sie wird deshalb per update() in-place durch die Abschlussmeldung
 * ersetzt. Öffentliche Alt-Bestätigungen (vor dem Ephemeral-Fix) werden
 * wie bisher gelöscht und durch einen ephemeren Hinweis beantwortet.
 */
async function confirmYes(ctx, interaction) {
  const pending = ctx.pending.get(interaction.user.id);

  // Antwortweg je nach Ursprung der Bestätigungsnachricht wählen.
  const finish = (containers) => {
    if (isEphemeralMessage(interaction.message)) {
      return interaction.update(componentsV2Payload(containers));
    }
    return (async () => {
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      return interaction.followUp(componentsV2Payload(containers, { ephemeral: true }));
    })();
  };

  if (!pending) {
    return finish([smallContainer(null, t('errGeneric', 'en'))]);
  }

  ctx.pending.delete(interaction.user.id);

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return finish([smallContainer(null, t('errNoList', 'en'))]);
  }

  const lang = entry.lang;

  // Lösch-Modus: beide Felder waren leer → eigenen Geburtstag entfernen.
  if (pending.delete) {
    let existed = false;
    await ctx.store.refresh(entry, (list) => {
      existed = list.some((b) => b.userId === interaction.user.id);
      return list.filter((b) => b.userId !== interaction.user.id);
    });
    const desc = existed ? t('birthdayDeleted', lang) : t('noBirthdayToDelete', lang);
    return finish([smallContainer(null, desc)]);
  }

  // 7-Tage-Regel (Spam-Schutz)
  if (isWithinSevenDays(pending.day, pending.month, lang)) {
    return finish([buildSevenDayErrorEmbed(lang, pending.day, pending.month)]);
  }

  // Alten Eintrag des Nutzers entfernen (keine Doppel-Einträge!) und
  // den neuen direkt auf den frisch ausgelesenen Stand anwenden.
  let replaced = false;
  await ctx.store.refresh(entry, (list) => {
    replaced = list.some((b) => b.userId === interaction.user.id);
    return [
      ...list.filter((b) => b.userId !== interaction.user.id),
      { userId: interaction.user.id, day: pending.day, month: pending.month },
    ];
  });

  const date = formatBirthday(pending.day, pending.month, lang);
  let desc = t('birthdayAdded', lang, { date });
  if (replaced) desc += `\n\n${t('entryReplaced', lang)}`;

  return finish([smallContainer(null, desc)]);
}

/**
 * Gratulieren: Wer schon gratuliert hat, kann nicht doppelt.
 * Unterstützt sowohl einzelne Geburtstags-Nachrichten als auch kombinierte
 * Nachrichten mit mehreren Abschnitten.
 */
async function congrats(ctx, interaction, id) {
  const parts = id.split('_'); // bday_congrats_<userId>_<dateKey>
  const birthdayUserId = parts[2];
  const dateKey = parts.slice(3).join('_');

  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  const clickerId = interaction.user.id;

  // Das Geburtstagskind darf den eigenen Glückwunsch-Zähler nicht erhöhen.
  if (clickerId === birthdayUserId) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('cannotWishSelf', lang))],
        { ephemeral: true }
      )
    );
  }

  // Gratulieren ist nur innerhalb der nächsten 24 Stunden erlaubt
  if (!isWithinHours(interaction.message?.createdTimestamp, 24)) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('congratsExpired', lang, { user: `<@${birthdayUserId}>` }))],
        { ephemeral: true }
      )
    );
  }

  // Prüfen ob kombinierte Nachricht
  if (isCombinedMessage(interaction.message)) {
    const parsed = parseCombinedMessage(interaction.message);
    const idx = parsed.birthdays.findIndex((b) => b.id === birthdayUserId);
    if (idx === -1) {
      // Fallback: vielleicht ist die ID im alten Format? Versuche alte Logik
      return congratsSingle(ctx, interaction, birthdayUserId, dateKey, lang, clickerId);
    }
    // Check bereits gratuliert?
    if (parsed.birthdays[idx].wishes.some((w) => w.id === clickerId)) {
      return interaction.reply(
        componentsV2Payload(
          [smallContainer(null, t('alreadyWished', lang, { user: `<@${birthdayUserId}>` }))],
          { ephemeral: true }
        )
      );
    }
    parsed.birthdays[idx].wishes.push({ id: clickerId, ts: Date.now() });

    const birthdayEntries = parsed.birthdays.map((b) => ({ id: b.id, wishes: b.wishes }));
    const eventEntries = parsed.events.map((ev) => ({ name: ev.name, hex: ev.hex, interested: ev.interested }));

    const { container } = buildCombinedCongratsEmbed({
      lang,
      dateKey: parsed.dateKey || dateKey,
      birthdays: birthdayEntries,
      events: eventEntries,
    });

    await interaction.update(componentsV2Payload([container]));
    return interaction.followUp(
      componentsV2Payload(
        [smallContainer(null, t('wished', lang, { user: `<@${birthdayUserId}>` }))],
        { ephemeral: true }
      )
    );
  }

  // Einzelne Nachricht – alte Logik
  return congratsSingle(ctx, interaction, birthdayUserId, dateKey, lang, clickerId);
}

async function congratsSingle(ctx, interaction, birthdayUserId, dateKey, lang, clickerId) {
  const rawText = extractAllText(interaction.message) || '';

  const marked = parseMarkedEntries(rawText, 'wish');
  const mentionedIds = [
    ...new Set(
      [...rawText.matchAll(/<@!?([^>]+)>/g)]
        .map((m) => m[1])
        .filter((uid) => uid !== birthdayUserId)
    ),
  ];
  const wishes = mergeListEntries(marked, mentionedIds);

  if (wishes.some((w) => w.id === clickerId)) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('alreadyWished', lang, { user: `<@${birthdayUserId}>` }))],
        { ephemeral: true }
      )
    );
  }

  wishes.push({ id: clickerId, ts: Date.now() });

  const { container } = buildCongratsEmbed({
    member: { id: birthdayUserId },
    lang,
    dateKey,
    wishes,
  });

  await interaction.update(componentsV2Payload([container]));

  return interaction.followUp(
    componentsV2Payload(
      [smallContainer(null, t('wished', lang, { user: `<@${birthdayUserId}>` }))],
      { ephemeral: true }
    )
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

async function handleModal(ctx, interaction) {
  if (interaction.customId === 'bday_modal') {
    return entryModalSubmit(ctx, interaction);
  }
  if (interaction.customId === 'admin_bday_modal') {
    return adminModalSubmit(ctx, interaction);
  }
  if (interaction.customId === 'bday_event_modal') {
    return eventModalSubmit(ctx, interaction);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Events (/event create → Formular → Bestätigung)
// ---------------------------------------------------------------------------

const MAX_EVENTS = 5; // maximal so viele Events gleichzeitig pro Server

/** /event create: Formular prüfen → Bestätigungs-Container (ephemer, 3 Buttons). */
async function eventModalSubmit(ctx, interaction) {
  const entry0 = ctx.store.get(interaction.guildId);
  const errLang = entry0?.lang || langFromDiscord(interaction.locale);

  const nameRaw = interaction.fields.getTextInputValue('name');
  const dayRaw = interaction.fields.getTextInputValue('day');
  const monthRaw = interaction.fields.getTextInputValue('month');

  const name = sanitizeEventName(nameRaw);
  if (!name) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventInvalidName', errLang))], { ephemeral: true })
    );
  }
  const day = parseDayInput(dayRaw);
  if (!day) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDay', errLang))], { ephemeral: true })
    );
  }
  const mm = matchMonth(monthRaw);
  if (!mm) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidMonth', errLang))], { ephemeral: true })
    );
  }
  // Bei Events ist JEDES Datum erlaubt – die 7-Tage-Regel gilt nur für Geburtstage.
  if (!isValidDate(day, mm.month)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDate', errLang))], { ephemeral: true })
    );
  }

  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);

  if ((entry?.events || []).length >= MAX_EVENTS) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventLimit', lang, { max: MAX_EVENTS }))], { ephemeral: true })
    );
  }

  ctx.pendingEvent.set(interaction.user.id, { day, month: mm.month, name, lang, guildId: interaction.guildId });

  const confirmation = buildEventConfirmationEmbed({ name, day, month: mm.month, lang });
  if (isEphemeralMessage(interaction.message)) {
    return interaction.update(componentsV2Payload([confirmation]));
  }
  return interaction.reply(componentsV2Payload([confirmation], { ephemeral: true }));
}

/**
 * Event-Bestätigung „Bestätigen“: Event in die Liste einsortieren (wie die
 * Geburtstage, nur mit Namen statt Erwähnung) – max. 5 Events gleichzeitig.
 */
async function eventConfirmYes(ctx, interaction) {
  const pending = ctx.pendingEvent.get(interaction.user.id);

  const finish = (containers) => {
    if (isEphemeralMessage(interaction.message)) {
      return interaction.update(componentsV2Payload(containers));
    }
    return (async () => {
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      return interaction.followUp(componentsV2Payload(containers, { ephemeral: true }));
    })();
  };

  if (!pending) {
    return finish([smallContainer(null, t('errGeneric', 'en'))]);
  }
  ctx.pendingEvent.delete(interaction.user.id);

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return finish([smallContainer(null, t('errNoList', 'en'))]);
  }
  const lang = entry.lang;

  // Limit nochmal gegen den FRISCHEN Listenstand prüfen (damit nichts kippt,
  // falls inzwischen ein Event gefeuert oder gelöscht wurde)
  let tooMany = false;
  await ctx.store.refresh(
    entry,
    null,
    (events) => {
      const fresh = events.filter((e) => !(String(e.name).toLowerCase() === pending.name.toLowerCase()));
      if (fresh.length >= MAX_EVENTS) { tooMany = true; return events; }
      return [...fresh, { event: true, name: pending.name, day: pending.day, month: pending.month }];
    }
  );
  if (tooMany) {
    return finish([smallContainer(null, t('eventLimit', lang, { max: MAX_EVENTS }))]);
  }

  const date = formatBirthday(pending.day, pending.month, lang);
  return finish([smallContainer(null, t('eventCreated', lang, { name: `**${pending.name}**`, date }))]);
}

/** /event delete: gewähltes Event aus dem Auswahlmenü löschen. */
async function eventDeleteSelect(ctx, interaction) {
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);

  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  if (!perms?.has(require('discord.js').PermissionFlagsBits.Administrator)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoPermission', lang))], { ephemeral: true })
    );
  }
  if (!entry) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoList', lang))], { ephemeral: true })
    );
  }

  const value = interaction.values?.[0] || '';
  const m = value.match(/^(\d{1,2})\.(\d{1,2})\.([0-9a-f]+)$/i);
  const name = m ? decodeEventName(m[3]) : null;
  if (!m || !name) {
    return interaction.update(componentsV2Payload([smallContainer(null, t('errGeneric', lang))]));
  }
  const day = Number(m[1]);
  const month = Number(m[2]);

  let removed = false;
  await ctx.store.refresh(entry, null, (events) =>
    events.filter((e) => {
      const match =
        e.day === day && e.month === month && String(e.name).toLowerCase() === name.toLowerCase();
      if (match) removed = true;
      return !match;
    })
  );

  const desc = removed ? t('eventDeleted', lang, { name: `**${name}**` }) : t('eventNoEvents', lang);
  return interaction.update(componentsV2Payload([smallContainer(null, desc)]));
}

/**
 * „Interessant! 😂“-Button auf der 0-Uhr-Event-Nachricht.
 * Unterstützt Einzel- und kombinierte Nachrichten.
 */
async function eventInterest(ctx, interaction) {
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  const clickerId = interaction.user.id;
  const customId = interaction.customId;

  // Zeitfenster: 24h
  if (!isWithinHours(interaction.message?.createdTimestamp, 24)) {
    // Für kombinierte Nachricht: versuche Event-Namen zu ermitteln für Fehlermeldung
    let nameForMsg = 'Event';
    try {
      if (isCombinedMessage(interaction.message)) {
        const parsed = parseCombinedMessage(interaction.message);
        const target = resolveEventFromCustomId(customId, parsed.events);
        if (target) nameForMsg = `**${target.name}**`;
      } else {
        const rawText = extractAllText(interaction.message) || '';
        const hidden = decodeHidden(rawText);
        const eventRe = /bday-event:(\d{4}-\d{2}-\d{2}):([0-9a-f]+)/i;
        const marker = rawText.match(eventRe) || hidden.map((s) => s.match(eventRe)).find((mm) => mm) || null;
        const n = marker ? decodeEventName(marker[2]) : null;
        if (n) nameForMsg = `**${n}**`;
      }
    } catch {}
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventInterestClosed', lang, { name: nameForMsg }))], { ephemeral: true })
    );
  }

  // Kombinierte Nachricht?
  if (isCombinedMessage(interaction.message)) {
    const parsed = parseCombinedMessage(interaction.message);
    const target = resolveEventFromCustomId(customId, parsed.events);
    if (!target) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
      );
    }
    if (target.interested.some((w) => w.id === clickerId)) {
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('eventAlreadyInterested', lang, { name: `**${target.name}**` }))], { ephemeral: true })
      );
    }
    target.interested.push({ id: clickerId, ts: Date.now() });

    const birthdayEntries = parsed.birthdays.map((b) => ({ id: b.id, wishes: b.wishes }));
    const eventEntries = parsed.events.map((ev) => ({ name: ev.name, hex: ev.hex, interested: ev.interested }));

    const { container } = buildCombinedCongratsEmbed({
      lang,
      dateKey: parsed.dateKey,
      birthdays: birthdayEntries,
      events: eventEntries,
    });

    await interaction.update(componentsV2Payload([container]));
    return interaction.followUp(
      componentsV2Payload([smallContainer(null, t('eventInterestedDone', lang, { name: `**${target.name}**` }))], { ephemeral: true })
    );
  }

  // Einzelne Event-Nachricht – alte Logik
  const rawText = extractAllText(interaction.message) || '';
  const hidden = decodeHidden(rawText);
  const eventRe = /bday-event:(\d{4}-\d{2}-\d{2}):([0-9a-f]+)/i;
  const marker = rawText.match(eventRe) || hidden.map((s) => s.match(eventRe)).find((mm) => mm) || null;
  const name = marker ? decodeEventName(marker[2]) : null;
  if (!marker || !name) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
    );
  }
  const dateKey = marker[1];
  const boldName = `**${name}**`;

  const marked = parseMarkedEntries(rawText, 'int');
  const mentionedIds = [
    ...new Set([...rawText.matchAll(/<@!?([^>]+)>/g)].map((mm) => mm[1])),
  ];
  const interested = mergeListEntries(marked, mentionedIds);

  if (interested.some((w) => w.id === clickerId)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventAlreadyInterested', lang, { name: boldName }))], { ephemeral: true })
    );
  }
  interested.push({ id: clickerId, ts: Date.now() });

  const { container } = buildEventCongratsEmbed({ name, lang, dateKey, interested });
  await interaction.update(componentsV2Payload([container]));

  return interaction.followUp(
    componentsV2Payload([smallContainer(null, t('eventInterestedDone', lang, { name: boldName }))], { ephemeral: true })
  );
}

function resolveEventFromCustomId(customId, events) {
  if (!Array.isArray(events) || !events.length) return null;
  // Indexed format: bday_event_interest_<index>_<dateKey>
  if (customId.startsWith('bday_event_interest_')) {
    const rest = customId.slice('bday_event_interest_'.length);
    const parts = rest.split('_');
    // first part numeric -> index
    if (/^\d+$/.test(parts[0])) {
      const idx = Number(parts[0]);
      if (events[idx]) return events[idx];
    } else {
      // hex format
      const hex = rest.toLowerCase();
      // exact match
      let found = events.find((ev) => ev.hex.toLowerCase() === hex);
      if (found) return found;
      // prefix match (truncated hex)
      found = events.find((ev) => ev.hex.toLowerCase().startsWith(hex) || hex.startsWith(ev.hex.toLowerCase()));
      if (found) return found;
      // try decode and match name
      const name = decodeEventName(hex);
      if (name) {
        found = events.find((ev) => ev.name === name);
        if (found) return found;
      }
    }
  }
  // Legacy single
  if (customId === 'bday_event_interest') {
    return events[0] || null;
  }
  // Fallback: first event
  return events[0] || null;
}

/** Eigenes Eintragen: validieren → Bestätigungs-Container mit den 3 Buttons. */
async function entryModalSubmit(ctx, interaction) {
  const entry0 = ctx.store.get(interaction.guildId);
  const errLang = entry0?.lang || langFromDiscord(interaction.locale);

  const dayRaw = interaction.fields.getTextInputValue('day');
  const monthRaw = interaction.fields.getTextInputValue('month');

  // Beide Felder leer → der eigene Geburtstag soll GELÖSCHT werden.
  if (!dayRaw.trim() && !monthRaw.trim()) {
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || langFromDiscord(interaction.locale);

    ctx.pending.set(interaction.user.id, { delete: true, lang });

    const confirmation = buildDeleteConfirmationEmbed({ lang });

    if (isEphemeralMessage(interaction.message)) {
      return interaction.update(componentsV2Payload([confirmation]));
    }
    return interaction.reply(componentsV2Payload([confirmation], { ephemeral: true }));
  }

  const day = parseDayInput(dayRaw);
  if (!day) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDay', errLang))], { ephemeral: true })
    );
  }

  const mm = matchMonth(monthRaw);
  if (!mm) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidMonth', errLang))], { ephemeral: true })
    );
  }
  if (!isValidDate(day, mm.month)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDate', errLang))], { ephemeral: true })
    );
  }

  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);

  ctx.pending.set(interaction.user.id, {
    day,
    month: mm.month,
    input: monthRaw.trim(),
    fuzzy: mm.fuzzy,
    lang,
  });

  // Bestätigungs-Container (Buttons direkt im Container) – EPHEMER, damit
  // nur die Person ihn sieht, die gerade ihren Geburtstag einträgt.
  const confirmation = buildConfirmationEmbed({
    day,
    month: mm.month,
    lang,
    input: monthRaw.trim(),
    fuzzy: mm.fuzzy,
  });

  // Wurde das Formular über „Bearbeiten“ einer ephemeren Bestätigung
  // geöffnet, wird diese in-place ersetzt – sonst gäbe es nach jeder
  // Bearbeitung eine weitere Bestätigung im Verlauf.
  if (isEphemeralMessage(interaction.message)) {
    return interaction.update(componentsV2Payload([confirmation]));
  }
  return interaction.reply(componentsV2Payload([confirmation], { ephemeral: true }));
}

/** Admin: Geburtstag für einen anderen Nutzer setzen (ohne 7-Tage-Regel). */
async function adminModalSubmit(ctx, interaction) {
  const pending = ctx.pendingAdmin.get(interaction.user.id);
  if (!pending) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', 'en'))], { ephemeral: true })
    );
  }

  const dayRaw = interaction.fields.getTextInputValue('day');
  const monthRaw = interaction.fields.getTextInputValue('month');

  // Beide Felder leer → der Geburtstag des Ziel-Nutzers soll GELÖSCHT werden.
  if (!dayRaw.trim() && !monthRaw.trim()) {
    const entry = ctx.store.get(pending.guildId);
    if (!entry) {
      ctx.pendingAdmin.delete(interaction.user.id);
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errNoList', 'en'))], { ephemeral: true })
      );
    }

    const guild = ctx.client.guilds.cache.get(pending.guildId);
    const member = await guild?.members.fetch(pending.targetId).catch(() => null);
    if (!member) {
      ctx.pendingAdmin.delete(interaction.user.id);
      return interaction.reply(
        componentsV2Payload([smallContainer(null, t('errUserGone', entry.lang))], { ephemeral: true })
      );
    }

    let existed = false;
    await ctx.store.refresh(entry, (list) => {
      existed = list.some((b) => b.userId === pending.targetId);
      return list.filter((b) => b.userId !== pending.targetId);
    });
    ctx.pendingAdmin.delete(interaction.user.id);

    const desc = existed
      ? t('adminDeletedSuccess', entry.lang, { user: `<@${pending.targetId}>` })
      : t('noBirthdayToDelete', entry.lang);
    return interaction.reply(componentsV2Payload([smallContainer(null, desc)], { ephemeral: false }));
  }

  const day = parseDayInput(dayRaw);
  if (!day) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDay', 'en'))], { ephemeral: true })
    );
  }
  const mm = matchMonth(monthRaw);
  if (!mm) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidMonth', 'en'))], { ephemeral: true })
    );
  }
  if (!isValidDate(day, mm.month)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errInvalidDate', 'en'))], { ephemeral: true })
    );
  }

  const entry = ctx.store.get(pending.guildId);
  if (!entry) {
    ctx.pendingAdmin.delete(interaction.user.id);
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errNoList', 'en'))], { ephemeral: true })
    );
  }

  // Ziel-Nutzer muss noch auf dem Server sein
  const guild = ctx.client.guilds.cache.get(pending.guildId);
  const member = await guild?.members.fetch(pending.targetId).catch(() => null);
  if (!member) {
    ctx.pendingAdmin.delete(interaction.user.id);
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errUserGone', entry.lang))], { ephemeral: true })
    );
  }

  // Alten Eintrag des Ziel-Nutzers ersetzen (auf dem frisch
  // ausgelesenen Stand anwenden).
  await ctx.store.refresh(entry, (list) => [
    ...list.filter((b) => b.userId !== pending.targetId),
    { userId: pending.targetId, day, month: mm.month },
  ]);
  ctx.pendingAdmin.delete(interaction.user.id);

  const date = formatBirthday(day, mm.month, entry.lang);
  return interaction.reply(
    componentsV2Payload(
      [
        smallContainer(
          null,
          t('adminSetSuccess', entry.lang, { user: `<@${pending.targetId}>`, date })
        ),
      ],
      { ephemeral: false }
    )
  );
}

module.exports = { handleInteraction };
