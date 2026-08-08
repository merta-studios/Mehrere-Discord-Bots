/**
 * Alle Interaktionen, die keine Slash-Commands sind:
 * Buttons (Eintragen, Bestätigen, Bearbeiten, Abbrechen, Gratulieren),
 * Modals (Formulare) und Select-Menüs (Admin-Panel).
 *
 * Verwendet moderne Container & Layout-Komponenten (Components V2).
 */

const { t, formatBirthday, matchMonth, langFromDiscord } = require('./languages');
const { parseDayInput, isValidDate, isWithinSevenDays } = require('./logic');
const {
  extractAllText,
  buildEntryModal,
  buildConfirmationEmbed,
  buildSevenDayErrorEmbed,
  buildCongratsEmbed,
  smallContainer,
} = require('./embed-builder');
const { handlePanelButton, handlePanelSelect, PANEL_PREFIX } = require('./admin-panel');

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
      if (id.startsWith(PANEL_PREFIX)) return handlePanelButton(ctx, interaction);
      return await handleButton(ctx, interaction);
    }
    if (interaction.isModalSubmit()) {
      return await handleModal(ctx, interaction);
    }
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith(PANEL_PREFIX)) return handlePanelSelect(ctx, interaction);
    }
    return null;
  } catch (err) {
    ctx.logger.error('[birthday-bot] Interaction-Fehler:', err);
    const lang = ctx.store.get(interaction.guildId)?.lang || langFromDiscord(interaction.locale);
    const payload = {
      components: [smallContainer(null, t('errGeneric', lang))],
      ephemeral: true,
    };
    try {
      if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
      return interaction.reply(payload);
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
    const entry = ctx.store.get(interaction.guildId);
    if (!entry) {
      return interaction.reply({
        components: [smallContainer(null, t('errNoList', 'en'))],
        ephemeral: true,
      });
    }
    return interaction.showModal(buildEntryModal(entry.lang));
  }

  // Bestätigen
  if (id === 'bday_confirm_yes') {
    return confirmYes(ctx, interaction);
  }

  // Bearbeiten → Formular erneut öffnen (Werte als Zahlen vorausgefüllt)
  if (id === 'bday_confirm_edit') {
    const pending = ctx.pending.get(interaction.user.id);
    if (!pending) {
      return interaction.reply({
        components: [smallContainer(null, t('errGeneric', 'en'))],
        ephemeral: true,
      });
    }
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || 'en';
    await interaction.showModal(buildEntryModal(lang, { day: pending.day, month: pending.month }));
    return interaction.message.delete().catch(() => {});
  }

  // Abbrechen
  if (id === 'bday_confirm_no') {
    await interaction.deferUpdate();
    ctx.pending.delete(interaction.user.id);
    await interaction.message.delete().catch(() => {});
    const entry = ctx.store.get(interaction.guildId);
    const lang = entry?.lang || langFromDiscord(interaction.locale);
    return interaction.followUp({
      components: [smallContainer(null, t('cancelNote', lang))],
      ephemeral: true,
    });
  }

  // Gratulieren auf dem Geburtstags-Gruß
  if (id.startsWith('bday_congrats_')) {
    return congrats(ctx, interaction, id);
  }

  return null;
}

/**
 * Bestätigen: Bestätigungsnachricht löschen → 7-Tage-Regel prüfen →
 * ggf. alten Eintrag ersetzen → Liste sofort aktualisieren.
 */
async function confirmYes(ctx, interaction) {
  const pending = ctx.pending.get(interaction.user.id);
  if (!pending) {
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.delete().catch(() => {});
    return interaction.followUp({
      components: [smallContainer(null, t('errGeneric', 'en'))],
      ephemeral: true,
    });
  }

  await interaction.deferUpdate();
  ctx.pending.delete(interaction.user.id);
  await interaction.message.delete().catch(() => {});

  const entry = ctx.store.get(interaction.guildId);
  if (!entry) {
    return interaction.followUp({
      components: [smallContainer(null, t('errNoList', 'en'))],
      ephemeral: true,
    });
  }

  const lang = entry.lang;

  // 7-Tage-Regel (Spam-Schutz)
  if (isWithinSevenDays(pending.day, pending.month, lang)) {
    return interaction.followUp({
      components: [buildSevenDayErrorEmbed(lang, pending.day, pending.month)],
      ephemeral: true,
    });
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

  return interaction.followUp({
    components: [smallContainer(null, desc)],
    ephemeral: true,
  });
}

/**
 * Gratulieren: Wer schon gratuliert hat, kann nicht doppelt.
 * Die Glückwünsche + Anzahl stecken im Container selbst (keine DB).
 */
async function congrats(ctx, interaction, id) {
  const parts = id.split('_'); // bday_congrats_<userId>_<dateKey>
  const birthdayUserId = parts[2];
  const dateKey = parts.slice(3).join('_');

  const entry = ctx.store.get(interaction.guildId);
  const lang = entry?.lang || langFromDiscord(interaction.locale);
  const clickerId = interaction.user.id;

  const rawText = extractAllText(interaction.message);

  // Glückwünsche aus dem Text / den Feldern lesen (alle Mentions außer Geburtstagskind)
  const allMentions = [...rawText.matchAll(/<@!?([^>]+)>/g)].map((m) => m[1]);
  const wishes = [...new Set(allMentions.filter((uid) => uid !== birthdayUserId))];

  if (wishes.includes(clickerId)) {
    return interaction.reply({
      components: [
        smallContainer(null, t('alreadyWished', lang, { user: `<@${birthdayUserId}>` })),
      ],
      ephemeral: true,
    });
  }

  wishes.push(clickerId);

  const { container } = buildCongratsEmbed({
    member: { id: birthdayUserId },
    lang,
    dateKey,
    wishes,
  });

  await interaction.update({ components: [container] });

  return interaction.followUp({
    components: [smallContainer(null, t('wished', lang, { user: `<@${birthdayUserId}>` }))],
    ephemeral: true,
  });
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
  return null;
}

/** Eigenes Eintragen: validieren → Bestätigungs-Container mit den 3 Buttons. */
async function entryModalSubmit(ctx, interaction) {
  const entry0 = ctx.store.get(interaction.guildId);
  const errLang = entry0?.lang || langFromDiscord(interaction.locale);

  const dayRaw = interaction.fields.getTextInputValue('day');
  const monthRaw = interaction.fields.getTextInputValue('month');

  const day = parseDayInput(dayRaw);
  if (!day) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidDay', errLang))],
      ephemeral: true,
    });
  }

  const mm = matchMonth(monthRaw);
  if (!mm) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidMonth', errLang))],
      ephemeral: true,
    });
  }
  if (!isValidDate(day, mm.month)) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidDate', errLang))],
      ephemeral: true,
    });
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

  // Reply mit dem Bestätigungs-Container (Buttons direkt im Container)
  return interaction.reply({
    components: [
      buildConfirmationEmbed({ day, month: mm.month, lang, input: monthRaw.trim(), fuzzy: mm.fuzzy }),
    ],
  });
}

/** Admin: Geburtstag für einen anderen Nutzer setzen (ohne 7-Tage-Regel). */
async function adminModalSubmit(ctx, interaction) {
  const pending = ctx.pendingAdmin.get(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      components: [smallContainer(null, t('errGeneric', 'en'))],
      ephemeral: true,
    });
  }

  const dayRaw = interaction.fields.getTextInputValue('day');
  const monthRaw = interaction.fields.getTextInputValue('month');

  const day = parseDayInput(dayRaw);
  if (!day) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidDay', 'en'))],
      ephemeral: true,
    });
  }
  const mm = matchMonth(monthRaw);
  if (!mm) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidMonth', 'en'))],
      ephemeral: true,
    });
  }
  if (!isValidDate(day, mm.month)) {
    return interaction.reply({
      components: [smallContainer(null, t('errInvalidDate', 'en'))],
      ephemeral: true,
    });
  }

  const entry = ctx.store.get(pending.guildId);
  if (!entry) {
    ctx.pendingAdmin.delete(interaction.user.id);
    return interaction.reply({
      components: [smallContainer(null, t('errNoList', 'en'))],
      ephemeral: true,
    });
  }

  // Ziel-Nutzer muss noch auf dem Server sein
  const guild = ctx.client.guilds.cache.get(pending.guildId);
  const member = await guild?.members.fetch(pending.targetId).catch(() => null);
  if (!member) {
    ctx.pendingAdmin.delete(interaction.user.id);
    return interaction.reply({
      components: [smallContainer(null, t('errUserGone', entry.lang))],
      ephemeral: true,
    });
  }

  // Alten Eintrag des Ziel-Nutzers ersetzen (auf dem frisch
  // ausgelesenen Stand anwenden).
  await ctx.store.refresh(entry, (list) => [
    ...list.filter((b) => b.userId !== pending.targetId),
    { userId: pending.targetId, day, month: mm.month },
  ]);
  ctx.pendingAdmin.delete(interaction.user.id);

  const date = formatBirthday(day, mm.month, entry.lang);
  return interaction.reply({
    components: [
      smallContainer(
        null,
        t('adminSetSuccess', entry.lang, { user: `<@${pending.targetId}>`, date })
      ),
    ],
    ephemeral: true,
  });
}

module.exports = { handleInteraction };
