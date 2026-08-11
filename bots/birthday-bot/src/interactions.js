/**
 * Alle Interaktionen, die keine Slash-Commands sind:
 * Buttons (Eintragen, Bestätigen, Bearbeiten, Abbrechen, Gratulieren),
 * Modals (Formulare) und Select-Menüs (Admin-Panel).
 *
 * Verwendet moderne Container & Layout-Komponenten (Components V2).
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
  buildEventModal,
  buildEventConfirmationEmbed,
  buildEventCongratsEmbed,
  decodeEventName,
  normalizeWishEntries,
  smallContainer,
} = require('./embed-builder');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');
const { componentsV2Payload } = require('./message-payload');

/**
 * Liest die Glückwunsch-/Interessenten-Einträge (id + Uhrzeit) aus den
 * unsichtbaren Markern einer Nachricht:
 *   \u200Bwish:<userId>:<ts>\u200B  bzw.  \u200Bint:<userId>:<ts>\u200B
 * Gibt [] zurück, wenn keine Marker vorhanden sind (alte Nachrichten).
 */
function parseMarkedEntries(text, prefix) {
  const out = [];
  const re = new RegExp(`${prefix}:(\\d+):(\\d+)`, 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push({ id: m[1], ts: Number(m[2]) });
  }
  return out;
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

  // Gratulieren auf dem Geburtstags-Gruß
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

  // „Interessant! 😂“ auf der Event-Nachricht
  if (id === 'bday_event_interest') {
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
 * Die Glückwünsche + Anzahl + Uhrzeiten stecken im Container selbst (keine DB).
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

  // Gratulieren ist nur innerhalb der nächsten 24 Stunden erlaubt (nach dem
  // Senden des Gruß-Containers). Danach nimmt der Bot keine Glückwünsche mehr an.
  if (!isWithinHours(interaction.message?.createdTimestamp, 24)) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('congratsExpired', lang, { user: `<@${birthdayUserId}>` }))],
        { ephemeral: true }
      )
    );
  }

  const rawText = extractAllText(interaction.message);

  // Glückwünsche aus den unsichtbaren Markern lesen (id + Uhrzeit).
  // Fallback für alte Nachrichten ohne Marker: Mentions ohne Uhrzeit.
  let wishes = parseMarkedEntries(rawText, 'wish');
  if (!wishes.length) {
    const allMentions = [...rawText.matchAll(/<@!?([^>]+)>/g)].map((m) => m[1]);
    wishes = [...new Set(allMentions.filter((uid) => uid !== birthdayUserId))].map((id) => ({ id, ts: null }));
  }

  if (wishes.some((w) => w.id === clickerId)) {
    return interaction.reply(
      componentsV2Payload(
        [smallContainer(null, t('alreadyWished', lang, { user: `<@${birthdayUserId}>` }))],
        { ephemeral: true }
      )
    );
  }

  // Neuer Glückwunsch MIT Uhrzeit
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
 * Analog zu den Geburtstags-Glückwünschen: Die Interessenten (inkl. Uhrzeit)
 * stecken im Container selbst (keine DB), jeder nur einmal, Fenster: 24 Stunden.
 */
async function eventInterest(ctx, interaction) {
  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  const clickerId = interaction.user.id;

  const rawText = extractAllText(interaction.message);
  const marker = rawText.match(/bday-event:(\d{4}-\d{2}-\d{2}):([0-9a-f]+)/i);
  const name = marker ? decodeEventName(marker[2]) : null;
  if (!marker || !name) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('errGeneric', lang))], { ephemeral: true })
    );
  }
  const dateKey = marker[1];
  const boldName = `**${name}**`;

  // Interesse-Melden nur 24 Stunden nach dem Post (dann ist das Event durch)
  if (!isWithinHours(interaction.message?.createdTimestamp, 24)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventInterestClosed', lang, { name: boldName }))], { ephemeral: true })
    );
  }

  // Interessenten aus den unsichtbaren Markern lesen (id + Uhrzeit).
  // Fallback für alte Nachrichten ohne Marker: Mentions ohne Uhrzeit.
  let interested = parseMarkedEntries(rawText, 'int');
  if (!interested.length) {
    interested = [...new Set([...rawText.matchAll(/<@!?([^>]+)>/g)].map((mm) => mm[1]))].map((id) => ({ id, ts: null }));
  }

  if (interested.some((w) => w.id === clickerId)) {
    return interaction.reply(
      componentsV2Payload([smallContainer(null, t('eventAlreadyInterested', lang, { name: boldName }))], { ephemeral: true })
    );
  }
  // Neuer Interessent MIT Uhrzeit
  interested.push({ id: clickerId, ts: Date.now() });

  const { container } = buildEventCongratsEmbed({ name, lang, dateKey, interested });
  await interaction.update(componentsV2Payload([container]));

  return interaction.followUp(
    componentsV2Payload([smallContainer(null, t('eventInterestedDone', lang, { name: boldName }))], { ephemeral: true })
  );
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
    return interaction.reply(componentsV2Payload([smallContainer(null, desc)], { ephemeral: true }));
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
      { ephemeral: true }
    )
  );
}

module.exports = { handleInteraction };
