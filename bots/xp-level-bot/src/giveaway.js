'use strict';

/**
 * Admin-erstellte Giveaways. Pro Server darf genau ein Giveaway aktiv sein.
 * Kritischer Zustand (Teilnahme, Veröffentlichung, Gewinner) liegt zusammen mit
 * der Guild-Konfiguration in Turso/File und wird nach jeder Änderung geflusht.
 */
const crypto = require('crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} = require('discord.js');
const { componentsV2Payload } = require('./message-payload');
const { LANGS, langFromDiscord } = require('./languages');

const FORM_PREFIX = 'xp_gw_form:';
const BUTTON_PREFIX = 'xp_gw:';
const SETTINGS_PREFIX = 'xp_gw_settings:';
const DELIVERY_PREFIX = 'xp_gw_delivery:';
const OPTIONS_PREFIX = 'xp_gw_options:';
const DRAFT_ACTION_PREFIX = 'xp_gw_draft:';
const JOIN_PREFIX = 'xp_gw_join:';
const PROGRESS_PREFIX = 'xp_gw_progress:';
const ADMIN_PREFIX = 'xp_gw_admin:';
const SOURCE_IDS = ['chat', 'media', 'voice', 'bonus', 'invite'];
const DEFAULT_SOURCES = ['chat', 'media', 'voice'];
const DELIVERY_IDS = ['public', 'dm', 'both'];
const drafts = new Map();

const TEXT = {
  de: {
    noSetup: '⛔ Bitte richte zuerst das XP-System mit **/setup** ein.',
    active: '⛔ Auf diesem Server läuft bereits ein Giveaway. Es ist maximal eines gleichzeitig erlaubt.',
    badTime: '⛔ Ungültige Dauer. Beispiele: `2d 4h`, `90m`, `24.08.2026 18:30` oder `2026-08-24 18:30`.',
    title: 'Giveaway gestalten', formTitle: 'Titel', formDesc: 'Beschreibung', image: 'Bild-URL (kleines Bild, optional)', banner: 'Banner-URL (optional)', winnerMessage: 'Nachricht für Gewinner',
    settingsTitle: '## ⚙️ Giveaway-Einstellungen', publish: 'Giveaway veröffentlichen', cancel: 'Abbrechen', sources: 'XP-Quellen auswählen', delivery: 'Gewinner-Nachricht senden als …', options: 'Weitere Einstellungen',
    joined: '✅ Du nimmst jetzt teil. Viel Glück!', already: 'ℹ️ Du nimmst bereits an diesem Giveaway teil.', ended: '⛔ Dieses Giveaway ist nicht mehr aktiv.', join: 'Teilnehmen', progress: 'Mein Fortschritt', closed: 'Giveaway beendet',
    random: 'Zufällige Auslosung', xp: 'Meiste XP', participants: 'Teilnehmer', ends: 'Endet', winners: 'Gewinner', mode: 'Modus', sourcesLabel: 'Gewertete XP',
    published: '✅ Das Giveaway wurde veröffentlicht.', cancelled: '✅ Erstellung abgebrochen.', noParticipants: 'Es gab keine gültigen Teilnehmer.',
    noGiveaway: 'ℹ️ Es gibt noch kein Giveaway auf diesem Server. Starte eines mit **/start_giveaway**.',
    notActive: '⛔ Es läuft gerade kein aktives Giveaway, das du beenden könntest. Aktueller Status: **{status}**.',
    endAsk: '## 🏁 Giveaway jetzt beenden?\n\n**{title}**\nTeilnehmer: **{count}** · Geplantes Ende: {ends}\n\nDie Gewinner werden **sofort** ausgelost und benachrichtigt, die Giveaway-Nachricht wird geschlossen. Danach kannst du ein neues Giveaway starten.',
    cancelAsk: '## ⛔ Giveaway abbrechen?\n\n**{title}**\nTeilnehmer: **{count}** · Geplantes Ende: {ends}\n\nEs werden **keine** Gewinner gezogen und niemand wird benachrichtigt. Danach kannst du ein neues Giveaway starten.',
    btnEndNow: '🏁 Jetzt beenden & auslosen', btnCancelNow: '⛔ Ohne Gewinner abbrechen', btnKeep: '↩️ Weiterlaufen lassen',
    endDone: '✅ Das Giveaway wurde beendet.\n\n**Gewinner:** {winners}',
    endDoneEmpty: '✅ Das Giveaway wurde beendet. Es gab keine gültigen Teilnehmer, deshalb gibt es keine Gewinner.',
    endFailed: '⛔ Das Giveaway konnte nicht beendet werden – vermutlich ist es gerade von selbst abgelaufen. Prüfe es mit der Aktion **Status ansehen**.',
    cancelDone: '✅ Das Giveaway wurde abgebrochen. Es wurden keine Gewinner gezogen.',
    cancelFailed: '⛔ Das Giveaway konnte nicht abgebrochen werden – vermutlich ist es gerade von selbst abgelaufen.',
    keepRunning: 'ℹ️ Nichts geändert – das Giveaway läuft weiter.',
    cancelledPublic: '## ⛔ Giveaway abgebrochen\nDieses Giveaway wurde von der Serverleitung abgebrochen. Es wurden keine Gewinner gezogen.',
    endedEarly: 'Vorzeitig beendet',
  },
  en: {
    noSetup: '⛔ Please set up the XP system with **/setup** first.', active: '⛔ A giveaway is already active on this server.', badTime: '⛔ Invalid duration. Examples: `2d 4h`, `90m`, `2026-08-24 18:30`.',
    title: 'Design giveaway', formTitle: 'Title', formDesc: 'Description', image: 'Image URL (thumbnail, optional)', banner: 'Banner URL (optional)', winnerMessage: 'Winner message',
    settingsTitle: '## ⚙️ Giveaway settings', publish: 'Publish giveaway', cancel: 'Cancel', sources: 'Select XP sources', delivery: 'Send winner message via …', options: 'Additional settings',
    joined: '✅ You joined the giveaway. Good luck!', already: 'ℹ️ You already joined this giveaway.', ended: '⛔ This giveaway is no longer active.', join: 'Enter', progress: 'My progress', closed: 'Giveaway ended',
    random: 'Random draw', xp: 'Most XP', participants: 'Participants', ends: 'Ends', winners: 'Winners', mode: 'Mode', sourcesLabel: 'Counted XP', published: '✅ Giveaway published.', cancelled: '✅ Creation cancelled.', noParticipants: 'There were no eligible participants.',
    noGiveaway: 'ℹ️ There is no giveaway on this server yet. Start one with **/start_giveaway**.',
    notActive: '⛔ There is no active giveaway to end right now. Current status: **{status}**.',
    endAsk: '## 🏁 End the giveaway now?\n\n**{title}**\nParticipants: **{count}** · Scheduled end: {ends}\n\nWinners are drawn and notified **immediately** and the giveaway message is closed. Afterwards you can start a new giveaway.',
    cancelAsk: '## ⛔ Cancel the giveaway?\n\n**{title}**\nParticipants: **{count}** · Scheduled end: {ends}\n\n**No** winners are drawn and nobody is notified. Afterwards you can start a new giveaway.',
    btnEndNow: '🏁 End & draw now', btnCancelNow: '⛔ Cancel without winners', btnKeep: '↩️ Keep it running',
    endDone: '✅ The giveaway has ended.\n\n**Winners:** {winners}',
    endDoneEmpty: '✅ The giveaway has ended. There were no eligible participants, so there are no winners.',
    endFailed: '⛔ The giveaway could not be ended – it probably just finished on its own. Check it with the **View status** action.',
    cancelDone: '✅ The giveaway was cancelled. No winners were drawn.',
    cancelFailed: '⛔ The giveaway could not be cancelled – it probably just finished on its own.',
    keepRunning: 'ℹ️ Nothing changed – the giveaway keeps running.',
    cancelledPublic: '## ⛔ Giveaway cancelled\nThis giveaway was cancelled by the server staff. No winners were drawn.',
    endedEarly: 'Ended early',
  },
};
function tx(lang, key, vars = null) {
  let text = TEXT[lang]?.[key] || TEXT.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
  return text;
}
function langFor(ctx, interaction) { return ctx.store.getGuild(interaction.guildId)?.lang || langFromDiscord(interaction.locale) || 'en'; }
function ephemeralText(content, ephemeral = true) { return componentsV2Payload([new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))], { ephemeral, allowedMentions: { parse: [] } }); }
function id() { return crypto.randomBytes(6).toString('base64url'); }
function draftKey(guildId, userId) { return `${guildId}:${userId}`; }

function validHttpUrl(value) {
  if (!value) return null;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}

/** Konvertiert eine lokale Wandzeit ohne externe Bibliothek robust in UTC. */
function zonedLocalToUtc(year, month, day, hour, minute, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    guess += Date.UTC(year, month - 1, day, hour, minute) - shown;
  }
  const check = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  if (check.year !== year || check.month !== month || check.day !== day || check.hour !== hour || check.minute !== minute) return null; // z.B. übersprungene DST-Zeit
  return guess;
}

function parseEndTime(input, lang = 'de', now = Date.now()) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return null;
  const exact = raw.match(/^(?:(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})|(\d{4})-(\d{1,2})-(\d{1,2}))[ ,t]+(\d{1,2}):(\d{2})$/i);
  let end = null;
  if (exact) {
    const year = Number(exact[3] || exact[4]);
    const month = Number(exact[2] || exact[5]);
    const day = Number(exact[1] || exact[6]);
    const hour = Number(exact[7]);
    const minute = Number(exact[8]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    end = zonedLocalToUtc(year, month, day, hour, minute, LANGS[lang]?.tz || 'UTC');
  } else {
    const re = /(\d+)\s*(w|wochen?|weeks?|d|tage?|days?|h|stunden?|hours?|m|min(?:uten?)?|minutes?)/gi;
    let total = 0; let match; let consumed = '';
    while ((match = re.exec(raw))) {
      consumed += match[0];
      const n = Number(match[1]); const unit = match[2][0].toLowerCase();
      total += n * (unit === 'w' ? 604800000 : unit === 'd' || unit === 't' ? 86400000 : unit === 'h' || unit === 's' ? 3600000 : 60000);
    }
    if (!total || raw.replace(re, '').replace(/[,+\s]/g, '')) return null;
    end = now + total;
  }
  if (!Number.isFinite(end) || end < now + 60_000 || end > now + 366 * 86400000) return null;
  return end;
}

function sourceLabel(source) { return ({ chat: 'Chat', media: 'Medien', voice: 'Voice', bonus: 'Bonus-Drops', invite: 'Invite-XP' })[source] || source; }
function modeLabel(g, lang) { return tx(lang, g.mode === 'xp' ? 'xp' : 'random'); }
function winnerMentions(g) { return (g.winners || []).map(w => `<@${w.userId}>`).join(', '); }

function placeholderValues(g, extra = {}) {
  const unix = Math.floor(g.endsAt / 1000);
  const participantCount = Object.keys(g.entries || {}).length;
  const winner = extra.winner || null;
  return {
    TITLE: g.title, DESCRIPTION: g.description, PARTICIPANTS: String(participantCount), PARTICIPANT_COUNT: String(participantCount),
    TIMER: `<t:${unix}:R>`, END_TIME: `<t:${unix}:t>`, END_DATE: `<t:${unix}:D>`, END_DATETIME: `<t:${unix}:F>`,
    MODE: modeLabel(g, g.lang), WINNER_COUNT: String(g.winnerCount), WINNERS: winnerMentions(g) || '–', GIVEAWAY_ID: g.id,
    SERVER: g.guildName || '', CHANNEL: `<#${g.channelId}>`, CREATOR: `<@${g.creatorId}>`,
    WINNER: winner ? `<@${winner.userId}>` : '–', WINNER_MENTION: winner ? `<@${winner.userId}>` : '–', WINNER_NAME: extra.winnerName || (winner ? winner.userId : '–'),
    PLACE: winner ? String(winner.place) : '–', XP: winner ? String(winner.xp || 0) : '0', TOP_XP: String(g.winners?.[0]?.xp || 0),
    ...extra.values,
  };
}
function replacePlaceholders(text, g, extra = {}) {
  const values = placeholderValues(g, extra);
  return String(text || '').replace(/\{([A-Z_]+)\}/gi, (all, key) => Object.prototype.hasOwnProperty.call(values, key.toUpperCase()) ? values[key.toUpperCase()] : all);
}

function giveawayContainer(g, { ended = false, cancelled = false } = {}) {
  const lang = g.lang || 'de';
  const closed = ended || cancelled;
  const body = replacePlaceholders(g.description, g);
  const header = `# ${replacePlaceholders(g.title, g)}`;
  const info = [
    `**${tx(lang, 'mode')}:** ${modeLabel(g, lang)}`,
    `**${tx(lang, 'ends')}:** <t:${Math.floor(g.endsAt / 1000)}:F> · <t:${Math.floor(g.endsAt / 1000)}:R>`,
    `**${tx(lang, 'winners')}:** ${g.winnerCount}`,
    g.showParticipants !== false ? `**${tx(lang, 'participants')}:** ${Object.keys(g.entries || {}).length}` : null,
    g.mode === 'xp' ? `**${tx(lang, 'sourcesLabel')}:** ${(g.sources || []).map(sourceLabel).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  const c = new ContainerBuilder();
  if (g.imageUrl) {
    c.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n\n${body}`)).setThumbnailAccessory(new ThumbnailBuilder().setURL(g.imageUrl)));
  } else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${header}\n\n${body}`));
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(info));
  if (cancelled) {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(tx(lang, 'cancelledPublic')));
  } else if (ended) {
    const result = (g.winners || []).length
      ? (g.winners || []).map(w => `**#${w.place}** <@${w.userId}>${g.mode === 'xp' ? ` — **${w.xp} XP**` : ''}`).join('\n')
      : tx(lang, 'noParticipants');
    const early = g.endedEarly ? ` (${tx(lang, 'endedEarly')})` : '';
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🏆 ${tx(lang, 'closed')}${early}\n${result}`));
  }
  if (g.bannerUrl) c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(g.bannerUrl)));
  // Zufallsmodus: kein XP-Wettrennen -> nur Teilnahme-Button, kein „Mein Fortschritt“
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${JOIN_PREFIX}${g.id}`).setStyle(ButtonStyle.Success).setLabel(closed ? tx(lang, 'closed') : tx(lang, 'join')).setDisabled(closed),
  );
  if (g.mode === 'xp') {
    row.addComponents(new ButtonBuilder().setCustomId(`${PROGRESS_PREFIX}${g.id}`).setStyle(ButtonStyle.Secondary).setLabel(tx(lang, 'progress')).setDisabled(closed));
  }
  c.addActionRowComponents(row);
  return c;
}

function buildForm(draft, lang) {
  const description = '🎁 **Gewinn:** Beschreibe hier deinen Preis!\n\nKlicke unten auf **Teilnehmen**. Aktuell machen **{PARTICIPANTS}** Personen mit.\n⏳ Ende: {TIMER} ({END_DATETIME})';
  return new ModalBuilder().setCustomId(`${FORM_PREFIX}${draft.id}`).setTitle(tx(lang, 'title')).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel(tx(lang, 'formTitle')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(150).setValue('🎉 Großes Giveaway')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel(tx(lang, 'formDesc')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(description)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel(tx(lang, 'image')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('banner').setLabel(tx(lang, 'banner')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('winner').setLabel(tx(lang, 'winnerMessage')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500).setValue('Glückwunsch {WINNER_MENTION}! Du hast Platz **{PLACE}** von {PARTICIPANTS} Teilnehmern gewonnen! 🎉')),
  );
}

function settingsPayload(draft, lang) {
  const isRandom = draft.mode === 'random';
  const deliverySelect = new StringSelectMenuBuilder().setCustomId(`${DELIVERY_PREFIX}${draft.id}`).setPlaceholder(tx(lang, 'delivery')).setMinValues(1).setMaxValues(1).addOptions([
    { label: 'Öffentlich im Giveaway-Kanal', value: 'public', default: draft.delivery === 'public' }, { label: 'Nur per DM', value: 'dm', default: draft.delivery === 'dm' }, { label: 'Öffentlich und per DM', value: 'both', default: draft.delivery === 'both' },
  ]);
  // Zufall -> kein XP-Wettrennen -> XP-Quellen & Platz-Anzeige ausblenden
  const optionChoices = [
    { label: 'Teilnehmerzahl anzeigen', value: 'showParticipants', default: draft.showParticipants, description: 'Zeigt die aktuelle Anzahl öffentlich' },
    ...(!isRandom ? [{ label: 'Zwischenplatz im Fortschritt zeigen', value: 'showRank', default: draft.showRank, description: 'XP-Teilnehmer sehen ihren aktuellen Platz' }] : []),
    { label: 'Admins dürfen teilnehmen', value: 'allowAdmins', default: draft.allowAdmins, description: 'Sonst sind Administratoren ausgeschlossen' },
    { label: 'Gewinner müssen noch auf dem Server sein', value: 'mustRemain', default: draft.mustRemain, description: 'Ausgetretene Nutzer werden übersprungen' },
  ];
  const maxOptions = isRandom ? 3 : 4;
  const optionSelect = new StringSelectMenuBuilder().setCustomId(`${OPTIONS_PREFIX}${draft.id}`).setPlaceholder(tx(lang, 'options')).setMinValues(0).setMaxValues(maxOptions).addOptions(optionChoices);
  const summary = `${tx(lang, 'settingsTitle')}\n\n**Kanal:** <#${draft.channelId}>\n**Ende:** <t:${Math.floor(draft.endsAt / 1000)}:F>\n**Modus:** ${modeLabel(draft, lang)}\n**Gewinner:** ${draft.winnerCount}\n\nPlatzhalter: \`{PARTICIPANTS}\`, \`{TIMER}\`, \`{END_TIME}\`, \`{END_DATE}\`, \`{END_DATETIME}\`, \`{MODE}\`, \`{WINNER_COUNT}\`, \`{GIVEAWAY_ID}\`, \`{SERVER}\`, \`{CHANNEL}\`, \`{CREATOR}\`. Gewinnertext zusätzlich: \`{WINNER}\`, \`{WINNER_MENTION}\`, \`{WINNER_NAME}\`, \`{PLACE}\`${!isRandom ? ', `{XP}`, `{TOP_XP}`' : ''}, \`{WINNERS}\`.\nWas jeder Platzhalter bedeutet, erklärt **/help** unter *Platzhalter erklärt*.`;
  const c = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));
  if (!isRandom) {
    const sourceSelect = new StringSelectMenuBuilder().setCustomId(`${SETTINGS_PREFIX}${draft.id}`).setPlaceholder(tx(lang, 'sources')).setMinValues(1).setMaxValues(SOURCE_IDS.length)
      .addOptions(SOURCE_IDS.map(s => ({ label: sourceLabel(s), value: s, default: draft.sources.includes(s), description: s === 'bonus' || s === 'invite' ? 'Optionaler Sonder-XP-Typ' : 'Normale XP-Quelle' })));
    c.addActionRowComponents(new ActionRowBuilder().addComponents(sourceSelect));
  }
  c.addActionRowComponents(new ActionRowBuilder().addComponents(deliverySelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(optionSelect))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${DRAFT_ACTION_PREFIX}publish:${draft.id}`).setStyle(ButtonStyle.Success).setLabel(tx(lang, 'publish')),
      new ButtonBuilder().setCustomId(`${DRAFT_ACTION_PREFIX}cancel:${draft.id}`).setStyle(ButtonStyle.Danger).setLabel(tx(lang, 'cancel')),
    ));
  return componentsV2Payload([c], { ephemeral: true });
}

function adminGate(ctx, interaction) {
  const perms = interaction.memberPermissions ?? interaction.member?.permissions;
  const lang = langFor(ctx, interaction);
  if (!interaction.guildId || !perms?.has(PermissionFlagsBits.Administrator)) return { error: ephemeralText('⛔ Administrator-Berechtigung erforderlich.'), lang };
  const cfg = ctx.store.getGuild(interaction.guildId);
  if (!cfg?.leaderboardChannelId) return { error: ephemeralText(tx(lang, 'noSetup')), lang };
  return { cfg, lang };
}

async function startCommand(ctx, interaction) {
  const gate = adminGate(ctx, interaction); if (gate.error) return interaction.reply(gate.error);
  if (gate.cfg.giveawayState?.status === 'active' && gate.cfg.giveawayState.endsAt <= Date.now()) {
    await ctx.giveawayManager?.finish(interaction.guildId);
  }
  if (gate.cfg.giveawayState?.status === 'active' || gate.cfg.giveawayState?.status === 'ending') return interaction.reply(ephemeralText(tx(gate.lang, 'active')));
  const channel = interaction.options.getChannel('kanal');
  const end = parseEndTime(interaction.options.getString('dauer'), gate.lang);
  if (!end) return interaction.reply(ephemeralText(tx(gate.lang, 'badTime')));
  const mode = interaction.options.getString('modus');
  const draft = { id: id(), guildId: interaction.guildId, guildName: interaction.guild?.name || '', creatorId: interaction.user.id, channelId: channel.id, endsAt: end,
    mode, winnerCount: interaction.options.getInteger('anzahl_gewinner'), lang: gate.lang, sources: [...DEFAULT_SOURCES], delivery: 'both', showParticipants: true, showRank: mode === 'xp', allowAdmins: true, mustRemain: true };
  drafts.set(draftKey(interaction.guildId, interaction.user.id), draft);
  return interaction.showModal(buildForm(draft, gate.lang));
}

async function formSubmit(ctx, interaction) {
  const key = draftKey(interaction.guildId, interaction.user.id); const draft = drafts.get(key);
  if (!draft || `${FORM_PREFIX}${draft.id}` !== interaction.customId) return interaction.reply(ephemeralText('⛔ Diese Erstellung ist abgelaufen. Bitte starte den Command erneut.'));
  const imageRaw = interaction.fields.getTextInputValue('image').trim(); const bannerRaw = interaction.fields.getTextInputValue('banner').trim();
  if ((imageRaw && !validHttpUrl(imageRaw)) || (bannerRaw && !validHttpUrl(bannerRaw))) return interaction.reply(ephemeralText('⛔ Bild- und Banner-Adresse müssen gültige `https://`- oder `http://`-URLs sein.'));
  Object.assign(draft, { title: interaction.fields.getTextInputValue('title'), description: interaction.fields.getTextInputValue('description'), imageUrl: validHttpUrl(imageRaw), bannerUrl: validHttpUrl(bannerRaw), winnerMessage: interaction.fields.getTextInputValue('winner') });
  return interaction.reply(settingsPayload(draft, draft.lang));
}

function draftForInteraction(interaction, expectedId) {
  const d = drafts.get(draftKey(interaction.guildId, interaction.user.id));
  return d?.id === expectedId ? d : null;
}
async function settingSelect(ctx, interaction) {
  const [prefix, field] = interaction.customId.startsWith(SETTINGS_PREFIX) ? [SETTINGS_PREFIX, 'sources'] : interaction.customId.startsWith(DELIVERY_PREFIX) ? [DELIVERY_PREFIX, 'delivery'] : [OPTIONS_PREFIX, 'options'];
  const d = draftForInteraction(interaction, interaction.customId.slice(prefix.length));
  if (!d) return interaction.reply(ephemeralText('⛔ Diese Erstellung ist abgelaufen.'));
  if (field === 'sources') {
    if (d.mode === 'random') return interaction.reply(ephemeralText('⛔ Im Zufallsmodus gibt es keine XP-Quellen.'));
    d.sources = interaction.values.filter(v => SOURCE_IDS.includes(v));
  }
  else if (field === 'delivery') d.delivery = DELIVERY_IDS.includes(interaction.values[0]) ? interaction.values[0] : 'both';
  else {
    const keys = d.mode === 'random' ? ['showParticipants', 'allowAdmins', 'mustRemain'] : ['showParticipants', 'showRank', 'allowAdmins', 'mustRemain'];
    for (const k of keys) d[k] = interaction.values.includes(k);
    if (d.mode === 'random') d.showRank = false;
  }
  const payload = settingsPayload(d, d.lang);
  payload.flags &= ~require('discord.js').MessageFlags.Ephemeral;
  return interaction.update(payload);
}

async function publish(ctx, interaction, draft) {
  const cfg = ctx.store.getGuild(draft.guildId);
  if (cfg?.giveawayState?.status === 'active' || cfg?.giveawayState?.status === 'ending') return interaction.update(ephemeralText(tx(draft.lang, 'active'), false));
  const channel = interaction.guild?.channels?.cache?.get(draft.channelId) || await ctx.client.channels.fetch(draft.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return interaction.update(ephemeralText('⛔ Der Giveaway-Kanal ist nicht erreichbar.', false));
  const g = { ...draft, status: 'active', createdAt: Date.now(), messageId: null, entries: {}, winners: [], predetermined: {}, finishNonce: null };
  const message = await channel.send(componentsV2Payload([giveawayContainer(g)], { allowedMentions: { parse: [] } })).catch(e => { ctx.logger.warn('[xp-giveaway] Nachricht fehlgeschlagen:', e.message); return null; });
  if (!message) return interaction.update(ephemeralText('⛔ Die Giveaway-Nachricht konnte nicht gesendet werden. Prüfe die Kanalrechte.', false));
  g.messageId = message.id; cfg.giveawayState = g; ctx.store.setGuild(cfg); await ctx.store.flush(); ctx.giveawayManager?.arm(g.guildId, g.endsAt); drafts.delete(draftKey(draft.guildId, draft.creatorId));
  return interaction.update(ephemeralText(tx(draft.lang, 'published'), false));
}
async function draftAction(ctx, interaction) {
  const rest = interaction.customId.slice(DRAFT_ACTION_PREFIX.length); const split = rest.indexOf(':'); const action = rest.slice(0, split); const draft = draftForInteraction(interaction, rest.slice(split + 1));
  if (!draft) return interaction.reply(ephemeralText('⛔ Diese Erstellung ist abgelaufen.'));
  if (action === 'cancel') { drafts.delete(draftKey(interaction.guildId, interaction.user.id)); return interaction.update(ephemeralText(tx(draft.lang, 'cancelled'), false)); }
  return publish(ctx, interaction, draft);
}

async function editPublic(ctx, g, state = {}) {
  const opts = typeof state === 'boolean' ? { ended: state } : state;
  const channel = await ctx.client.channels.fetch(g.channelId).catch(() => null); const msg = await channel?.messages?.fetch(g.messageId).catch(() => null);
  if (!msg) return false; await msg.edit(componentsV2Payload([giveawayContainer(g, opts)], { allowedMentions: { parse: [] } })).catch(() => null); return true;
}
async function join(ctx, interaction, giveawayId) {
  const cfg = ctx.store.getGuild(interaction.guildId); const g = cfg?.giveawayState; const lang = g?.lang || langFor(ctx, interaction);
  if (!g || g.id !== giveawayId || g.status !== 'active' || Date.now() >= g.endsAt) { if (g?.status === 'active') void ctx.giveawayManager.finish(g.guildId); return interaction.reply(ephemeralText(tx(lang, 'ended'))); }
  if (interaction.user.bot) return interaction.reply(ephemeralText('⛔ Bots können nicht teilnehmen.'));
  if (!g.allowAdmins && (interaction.memberPermissions ?? interaction.member?.permissions)?.has(PermissionFlagsBits.Administrator)) return interaction.reply(ephemeralText('⛔ Administratoren sind bei diesem Giveaway ausgeschlossen.'));
  if (g.entries[interaction.user.id]) return interaction.reply(ephemeralText(tx(lang, 'already')));
  g.entries[interaction.user.id] = { userId: interaction.user.id, joinedAt: Date.now(), xp: 0, disqualified: false };
  cfg.giveawayState = g; ctx.store.setGuild(cfg); await ctx.store.flush(); void editPublic(ctx, g);
  return interaction.reply(ephemeralText(tx(lang, 'joined')));
}
async function progress(ctx, interaction, giveawayId) {
  const g = ctx.store.getGuild(interaction.guildId)?.giveawayState;
  if (!g || g.id !== giveawayId || g.status !== 'active') return interaction.reply(ephemeralText(tx(langFor(ctx, interaction), 'ended')));
  const e = g.entries?.[interaction.user.id]; if (!e) return interaction.reply(ephemeralText('ℹ️ Klicke zuerst auf **Teilnehmen**.'));
  // Zufallsmodus hat kein XP-Wettrennen – nur Teilnahme bestätigen
  if (g.mode === 'random') {
    return interaction.reply(ephemeralText(`## 🎲 Zufalls-Giveaway\n\n✅ Du nimmst teil! Die Gewinner werden **zufällig** ausgelost.\n**Teilnehmer:** ${Object.keys(g.entries).length}\n**Ende:** <t:${Math.floor(g.endsAt / 1000)}:R>`));
  }
  let rank = '–'; if (g.mode === 'xp' && g.showRank) rank = 1 + Object.values(g.entries).filter(x => !x.disqualified && x.xp > e.xp).length;
  return interaction.reply(ephemeralText(`## 📊 Dein Fortschritt\n\n**Giveaway-XP:** ${e.xp || 0}\n**Aktueller Platz:** ${rank}\n**Teilnehmer:** ${Object.keys(g.entries).length}\n**Ende:** <t:${Math.floor(g.endsAt / 1000)}:R>`));
}

async function resolveEligible(ctx, guild, g) {
  const entries = Object.values(g.entries || {}).filter(e => !e.disqualified);
  if (!g.mustRemain) return entries;
  const result = [];
  for (const e of entries) { const member = guild.members?.cache?.get(e.userId) || await guild.members.fetch(e.userId).catch(() => null); if (member && !member.user?.bot) result.push(e); }
  return result;
}
function randomItem(list) { return list.length ? list[crypto.randomInt(list.length)] : null; }
async function finishGiveaway(ctx, guildId, { force = false } = {}) {
  const cfg = ctx.store.getGuild(guildId); const g = cfg?.giveawayState;
  if (!g || g.status !== 'active' || (!force && Date.now() < g.endsAt)) return false;
  // Vorzeitiges Beenden merken, damit die öffentliche Nachricht es kennzeichnet.
  if (force && Date.now() < g.endsAt) g.endedEarly = true;
  g.status = 'ending'; g.finishNonce = g.finishNonce || id(); ctx.store.setGuild(cfg); await ctx.store.flush();
  const guild = ctx.client.guilds.cache.get(guildId) || await ctx.client.guilds.fetch(guildId).catch(() => null);
  const eligible = guild ? await resolveEligible(ctx, guild, g) : Object.values(g.entries || {}).filter(e => !e.disqualified);
  const winners = []; const used = new Set();
  for (let place = 1; place <= g.winnerCount; place++) {
    const presetId = g.mode === 'random' ? g.predetermined?.[String(place)] : null;
    let chosen = presetId ? eligible.find(e => e.userId === presetId && !used.has(e.userId)) : null;
    if (!chosen) {
      const pool = eligible.filter(e => !used.has(e.userId) && (g.mode !== 'xp' || e.xp > 0));
      if (g.mode === 'xp') {
        pool.sort((a, b) => b.xp - a.xp);
        if (pool.length) { const topXp = pool[0].xp; chosen = randomItem(pool.filter(e => e.xp === topXp)); }
      } else chosen = randomItem(pool);
    }
    if (!chosen) break; used.add(chosen.userId); winners.push({ userId: chosen.userId, place, xp: chosen.xp || 0, predetermined: chosen.userId === presetId });
  }
  g.winners = winners; g.finishedAt = Date.now(); g.status = 'finished'; cfg.giveawayState = g; ctx.store.setGuild(cfg); await ctx.store.flush(); await editPublic(ctx, g, { ended: true });
  const channel = await ctx.client.channels.fetch(g.channelId).catch(() => null);
  for (const winner of winners) {
    const member = guild?.members?.cache?.get(winner.userId) || await guild?.members?.fetch?.(winner.userId).catch(() => null);
    const text = replacePlaceholders(g.winnerMessage, g, { winner, winnerName: member?.displayName || member?.user?.username || winner.userId });
    const payload = { content: text, allowedMentions: { users: [winner.userId], roles: [], parse: [] } };
    if (g.delivery === 'public' || g.delivery === 'both') await channel?.send(payload).catch(() => null);
    if (g.delivery === 'dm' || g.delivery === 'both') await member?.send(payload).catch(() => null);
  }
  return true;
}

/**
 * Bricht ein laufendes Giveaway ohne Auslosung ab: keine Gewinner, keine DMs.
 * Die öffentliche Nachricht wird als „abgebrochen“ markiert und die Buttons
 * werden deaktiviert. Danach darf sofort ein neues Giveaway starten.
 */
async function cancelGiveaway(ctx, guildId) {
  const cfg = ctx.store.getGuild(guildId); const g = cfg?.giveawayState;
  if (!g || (g.status !== 'active' && g.status !== 'ending')) return false;
  g.status = 'cancelled'; g.winners = []; g.cancelledAt = Date.now();
  cfg.giveawayState = g; ctx.store.setGuild(cfg); await ctx.store.flush();
  await editPublic(ctx, g, { cancelled: true });
  return true;
}

function trackXp(ctx, guildId, userId, amount, source) {
  const cfg = ctx.store.getGuild(guildId); const g = cfg?.giveawayState; const e = g?.entries?.[userId]; const n = Math.floor(Number(amount));
  if (!g || g.status !== 'active' || g.mode !== 'xp' || Date.now() >= g.endsAt || !e || e.disqualified || !g.sources.includes(source) || n <= 0) return false;
  e.xp = (e.xp || 0) + n; cfg.giveawayState = g; ctx.store.setGuild(cfg); return true;
}

/** Ephemere Sicherheitsabfrage vor dem Beenden/Abbrechen eines Giveaways. */
function confirmPayload(g, lang, mode) {
  const vars = { title: replacePlaceholders(g.title, g), count: String(Object.keys(g.entries || {}).length), ends: `<t:${Math.floor(g.endsAt / 1000)}:R>` };
  const confirm = mode === 'end'
    ? new ButtonBuilder().setCustomId(`${ADMIN_PREFIX}end:${g.id}`).setStyle(ButtonStyle.Success).setLabel(tx(lang, 'btnEndNow'))
    : new ButtonBuilder().setCustomId(`${ADMIN_PREFIX}cancel:${g.id}`).setStyle(ButtonStyle.Danger).setLabel(tx(lang, 'btnCancelNow'));
  const c = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(tx(lang, mode === 'end' ? 'endAsk' : 'cancelAsk', vars)))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      confirm,
      new ButtonBuilder().setCustomId(`${ADMIN_PREFIX}keep:${g.id}`).setStyle(ButtonStyle.Secondary).setLabel(tx(lang, 'btnKeep')),
    ));
  return componentsV2Payload([c], { ephemeral: true, allowedMentions: { parse: [] } });
}

async function adminCommand(ctx, interaction) {
  const gate = adminGate(ctx, interaction); if (gate.error) return interaction.reply(gate.error);
  const lang = gate.lang;
  const g = gate.cfg.giveawayState; if (!g) return interaction.reply(ephemeralText(tx(lang, 'noGiveaway')));
  const action = interaction.options.getString('aktion'); const page = interaction.options.getInteger('seite') || 1;
  if (action === 'participants' || action === 'status') {
    const list = Object.values(g.entries || {}).sort((a, b) => g.mode === 'xp' ? b.xp - a.xp : a.joinedAt - b.joinedAt); const start = (page - 1) * 20;
    const rows = list.slice(start, start + 20).map((e, i) => {
      // Zufall: kein XP-Wettrennen -> keine XP-Anzeige
      if (g.mode === 'random') {
        return `${start + i + 1}. <@${e.userId}>${e.disqualified ? ' — disqualifiziert' : ''}${Object.entries(g.predetermined || {}).find(([, uid]) => uid === e.userId)?.[0] ? ` — fest Platz ${Object.entries(g.predetermined).find(([, uid]) => uid === e.userId)[0]}` : ''}`;
      }
      return `${start + i + 1}. <@${e.userId}> — ${e.xp || 0} XP${e.disqualified ? ' — disqualifiziert' : ''}${Object.entries(g.predetermined || {}).find(([, uid]) => uid === e.userId)?.[0] ? ` — fest Platz ${Object.entries(g.predetermined).find(([, uid]) => uid === e.userId)[0]}` : ''}`;
    });
    const ends = g.status === 'active' ? `\n**Ende:** <t:${Math.floor(g.endsAt / 1000)}:F> · <t:${Math.floor(g.endsAt / 1000)}:R>` : '';
    const hint = g.status === 'active' ? '\n\n🏁 Vorzeitig beenden: Aktion **Giveaway jetzt beenden** · ⛔ Ohne Gewinner stoppen: Aktion **Giveaway abbrechen**.' : '';
    return interaction.reply(ephemeralText(`## 🔒 Giveaway-Adminansicht\n**Status:** ${g.status}\n**ID:** \`${g.id}\`\n**Teilnehmer:** ${list.length}${ends}\n**Seite:** ${page}/${Math.max(1, Math.ceil(list.length / 20))}\n\n${rows.join('\n') || 'Noch keine Teilnehmer.'}${hint}`));
  }
  if (action === 'end' || action === 'cancel') {
    if (g.status !== 'active') return interaction.reply(ephemeralText(tx(lang, 'notActive', { status: g.status })));
    return interaction.reply(confirmPayload(g, lang, action));
  }
  if (g.mode !== 'random' || g.status !== 'active') return interaction.reply(ephemeralText('⛔ Gewinner können nur bei einem laufenden Zufalls-Giveaway vorbestimmt werden.'));
  const place = interaction.options.getInteger('platz'); const user = interaction.options.getUser('nutzer');
  if (action === 'clear') { if (place) delete g.predetermined[String(place)]; else g.predetermined = {}; gate.cfg.giveawayState = g; ctx.store.setGuild(gate.cfg); await ctx.store.flush(); return interaction.reply(ephemeralText('✅ Vorbestimmung entfernt.')); }
  if (!place || place > g.winnerCount || !user || !g.entries?.[user.id] || g.entries[user.id].disqualified) return interaction.reply(ephemeralText('⛔ Wähle einen gültigen Teilnehmer und einen Platz innerhalb der Gewinneranzahl.'));
  for (const [p, uid] of Object.entries(g.predetermined)) if (uid === user.id) delete g.predetermined[p];
  g.predetermined[String(place)] = user.id; gate.cfg.giveawayState = g; ctx.store.setGuild(gate.cfg); await ctx.store.flush();
  return interaction.reply(ephemeralText(`✅ <@${user.id}> ist intern für Gewinnerplatz **${place}** vorgemerkt. Nicht belegte Plätze werden normal ausgelost.`));
}

function createGiveawayManager(ctx) {
  const timers = new Map();
  let manager = null;
  function arm(guildId, endsAt) {
    const gid = String(guildId);
    if (timers.has(gid)) clearTimeout(timers.get(gid));
    const delay = Math.max(0, Math.min(Number(endsAt) - Date.now(), 2_147_000_000));
    const timer = setTimeout(async () => {
      timers.delete(gid);
      const g = ctx.store.getGuild(gid)?.giveawayState;
      if (!g || g.status !== 'active') return;
      if (Date.now() < g.endsAt) return arm(gid, g.endsAt); // lange Laufzeit: nächsten sicheren Timer setzen
      await finishGiveaway(ctx, gid).catch(err => ctx.logger?.warn?.('[xp-giveaway] Exaktes Ende fehlgeschlagen:', err?.message || err));
    }, delay);
    timer.unref?.();
    timers.set(gid, timer);
  }
  manager = {
    arm,
    trackXp: (guildId, userId, amount, source) => trackXp(ctx, String(guildId), String(userId), amount, source),
    async finish(guildId, opts) {
      const gid = String(guildId); const result = await finishGiveaway(ctx, gid, opts);
      if (result && timers.has(gid)) { clearTimeout(timers.get(gid)); timers.delete(gid); }
      return result;
    },
    /** Bricht ein laufendes Giveaway ohne Auslosung ab und entschärft den Timer. */
    async cancel(guildId) {
      const gid = String(guildId); const result = await cancelGiveaway(ctx, gid);
      if (result && timers.has(gid)) { clearTimeout(timers.get(gid)); timers.delete(gid); }
      return result;
    },
    async tick(now = new Date()) {
      for (const cfg of ctx.store.getAllGuilds()) {
        const g = cfg.giveawayState;
        if (g?.status !== 'active') continue;
        if (!timers.has(String(cfg.guildId))) arm(cfg.guildId, g.endsAt);
        if (g.endsAt <= now.getTime()) await manager.finish(cfg.guildId);
      }
    },
  };
  // Persistierte Giveaways direkt nach dem Store-Load sekundengenau wieder scharfstellen.
  // Ein beim Prozessabbruch übrig gebliebenes `ending` wird sicher fortgesetzt;
  // Gewinner waren zu diesem Zeitpunkt noch nicht gespeichert.
  for (const cfg of ctx.store.getAllGuilds()) {
    if (cfg.giveawayState?.status === 'ending') {
      cfg.giveawayState.status = 'active';
      ctx.store.setGuild(cfg);
    }
    if (cfg.giveawayState?.status === 'active') arm(cfg.guildId, cfg.giveawayState.endsAt);
  }
  return manager;
}

/**
 * Buttons der ephemeren Admin-Bestätigung: Giveaway sofort beenden (mit
 * Auslosung), abbrechen (ohne Gewinner) oder weiterlaufen lassen.
 */
async function adminButton(ctx, interaction) {
  const gate = adminGate(ctx, interaction);
  if (gate.error) return interaction.reply(gate.error);
  const lang = gate.lang;
  const rest = interaction.customId.slice(ADMIN_PREFIX.length);
  const split = rest.indexOf(':');
  const action = rest.slice(0, split);
  const giveawayId = rest.slice(split + 1);
  const g = gate.cfg.giveawayState;
  if (!g || g.id !== giveawayId) return interaction.update(ephemeralText(tx(lang, 'noGiveaway'), false));
  if (action === 'keep') return interaction.update(ephemeralText(tx(lang, 'keepRunning'), false));
  if (g.status !== 'active') return interaction.update(ephemeralText(tx(lang, 'notActive', { status: g.status }), false));

  // Auslosung + Gewinner-Nachrichten können dauern → erst die Buttons entschärfen.
  await interaction.update(componentsV2Payload([new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(tx(lang, action === 'end' ? 'btnEndNow' : 'btnCancelNow') + ' …'))], { allowedMentions: { parse: [] } }));

  if (action === 'cancel') {
    const done = ctx.giveawayManager ? await ctx.giveawayManager.cancel(g.guildId) : await cancelGiveaway(ctx, g.guildId);
    return interaction.editReply(ephemeralText(tx(lang, done ? 'cancelDone' : 'cancelFailed'), false));
  }
  const done = ctx.giveawayManager ? await ctx.giveawayManager.finish(g.guildId, { force: true }) : await finishGiveaway(ctx, g.guildId, { force: true });
  if (!done) return interaction.editReply(ephemeralText(tx(lang, 'endFailed'), false));
  const after = ctx.store.getGuild(g.guildId)?.giveawayState;
  const winners = winnerMentions(after || g);
  return interaction.editReply(ephemeralText(winners ? tx(lang, 'endDone', { winners }) : tx(lang, 'endDoneEmpty'), false));
}

async function handleButton(ctx, interaction) {
  if (interaction.customId.startsWith(ADMIN_PREFIX)) return adminButton(ctx, interaction);
  if (interaction.customId.startsWith(DRAFT_ACTION_PREFIX)) return draftAction(ctx, interaction);
  if (interaction.customId.startsWith(JOIN_PREFIX)) return join(ctx, interaction, interaction.customId.slice(JOIN_PREFIX.length));
  if (interaction.customId.startsWith(PROGRESS_PREFIX)) return progress(ctx, interaction, interaction.customId.slice(PROGRESS_PREFIX.length));
  return null;
}
function isSettingsSelect(idValue) { return idValue.startsWith(SETTINGS_PREFIX) || idValue.startsWith(DELIVERY_PREFIX) || idValue.startsWith(OPTIONS_PREFIX); }

module.exports = {
  FORM_PREFIX, BUTTON_PREFIX, DRAFT_ACTION_PREFIX, JOIN_PREFIX, PROGRESS_PREFIX, ADMIN_PREFIX,
  createGiveawayManager, startCommand, adminCommand, formSubmit, settingSelect, handleButton, isSettingsSelect,
  parseEndTime, replacePlaceholders, giveawayContainer, finishGiveaway, cancelGiveaway,
};
