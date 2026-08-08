/**
 * Baut alle Embeds & Komponenten des Geburtstags-Bots und liest
 * die Geburtstagsliste wieder aus dem Embed zurück (das ist die
 * „Datenbank“ – die Liste steckt komplett im Embed selbst!).
 */

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const { LANGS, t, tzOf, formatBirthday, formatToday } = require('./languages');
const { monthOrder, pad, tzParts } = require('./logic');

const COLORS = {
  list: 0xe91e63,
  confirm: 0xf1c40f,
  success: 0x2ecc71,
  error: 0xe74c3c,
  congrats: 0x9b59b6,
  help: 0x5865f2,
  panel: 0x2c3e50,
};

/** Marker, über den der Bot seine eigene Liste in jedem Channel wiederfindet. */
const LIST_MARKER = 'bday::v1::';

// ---------------------------------------------------------------------------
// Geburtstagsliste
// ---------------------------------------------------------------------------

/**
 * Baut das schöne Listen-Embed:
 * - Aktuelles Datum oben
 * - Monate als Inline-Felder (PC: 3 Spalten, Handy: untereinander)
 * - Aktueller Monat zuerst, dann Rest des Jahres, dann Januar bis davor
 * - Marker im Footer, damit der Bot die Liste später selbst wiederfindet
 */
function buildListEmbed({ birthdays, lang }) {
  const tz = tzOf(lang);
  const now = new Date();
  const cur = tzParts(tz);
  const months = LANGS[lang].months;

  const fields = monthOrder(cur.month).map((mo) => {
    const lines = birthdays
      .filter((b) => b.month === mo)
      .sort((a, b) => a.day - b.day)
      .map((b) => `${pad(b.day)}.${pad(b.month)} ✦ <@${b.userId}>`);
    return { name: months[mo - 1], value: lines.join('\n') || '—', inline: true };
  });

  if (!birthdays.length) {
    fields.push({ name: '🎈', value: t('listEmpty', lang), inline: false });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.list)
    .setTitle(t('listTitle', lang))
    .setDescription(
      [
        `## 📅 ${formatToday(lang)}`,
        t('listTagline', lang),
        '',
        '━━━━━━━━━━━━━━━━━━━━',
      ].join('\n')
    )
    .addFields(fields)
    .setFooter({ text: `${LANGS[lang].flag} ${LANGS[lang].name} · 🕒 ${tz} · ${LIST_MARKER}${lang}` })
    .setTimestamp(now);

  return embed;
}

/** Der „Geburtstag eintragen“-Button unter der Liste. */
function listActionRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('bday_add')
      .setStyle(ButtonStyle.Primary)
      .setLabel(t('btnAddBirthday', lang))
  );
}

/**
 * Liest Sprache + Geburtstage aus einem Listen-Embed zurück.
 * Rückgabe: { lang, birthdays: [{userId, day, month}] } oder null.
 */
function parseListEmbed(msg) {
  const embed = msg.embeds?.[0];
  if (!embed) return null;

  const footer = embed.footer?.text || '';
  const marker = footer.match(/bday::v1::([a-z]{2,5})/i);
  const lang = marker ? marker[1].toLowerCase() : 'en';

  const birthdays = [];
  for (const field of embed.fields || []) {
    for (const line of String(field.value).split('\n')) {
      const m = line.match(/^(\d{1,2})\.(\d{1,2})\s*✦\s*<@!?(\d+)>$/);
      if (m) birthdays.push({ day: Number(m[1]), month: Number(m[2]), userId: m[3] });
    }
  }

  return { lang, birthdays };
}

// ---------------------------------------------------------------------------
// Eintragen-Formular & Bestätigung
// ---------------------------------------------------------------------------

/** Modal mit Tag + Monat (bei „Bearbeiten“ mit vorausgefüllten Zahlen). */
function buildEntryModal(lang, prefill = {}) {
  const dayInput = new TextInputBuilder()
    .setCustomId('day')
    .setLabel(t('modalDayLabel', lang))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(2)
    .setPlaceholder(t('modalDayPlaceholder', lang));
  if (prefill.day) dayInput.setValue(String(prefill.day));

  const monthInput = new TextInputBuilder()
    .setCustomId('month')
    .setLabel(t('modalMonthLabel', lang))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
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

/** Bestätigungs-Embed unter dem Button + die 3 Buttons darunter. */
function buildConfirmationEmbed({ day, month, lang, input, fuzzy }) {
  const date = formatBirthday(day, month, lang);
  let desc = t('confirmBody', { date }, lang);
  if (fuzzy && input) {
    desc += `\n\n${t('fuzzyNote', { input, month: LANGS[lang].months[month - 1] }, lang)}`;
  }
  return new EmbedBuilder().setColor(COLORS.confirm).setTitle(t('confirmTitle', lang)).setDescription(desc);
}

function confirmationRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('bday_confirm_yes').setStyle(ButtonStyle.Success).setLabel(t('btnConfirm', lang)),
    new ButtonBuilder().setCustomId('bday_confirm_edit').setStyle(ButtonStyle.Secondary).setLabel(t('btnEdit', lang)),
    new ButtonBuilder().setCustomId('bday_confirm_no').setStyle(ButtonStyle.Secondary).setLabel(t('btnCancel', lang))
  );
}

/** Fehler-Embed für die 7-Tage-Regel. */
function buildSevenDayErrorEmbed(lang, day, month) {
  const date = formatBirthday(day, month, lang);
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle(t('errSevenDaysTitle', lang))
    .setDescription(t('errSevenDaysBody', { date }, lang));
}

// ---------------------------------------------------------------------------
// Täglicher Geburtstags-Gruß
// ---------------------------------------------------------------------------

/**
 * Kurzes, hübsches Geburtstags-Embed mit Profilbild, Mention und
 * „Gratulieren“-Button. Der Marker im Footer verhindert Doppel-Sendungen.
 */
function buildCongratsEmbed({ member, lang, dateKey }) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.congrats)
    .setTitle(t('bdayCongratsTitle', lang))
    .setDescription(t('bdayCongratsBody', { user: `<@${member.id}>` }, lang))
    .setThumbnail(member.displayAvatarURL({ size: 256, extension: 'png' }))
    .setFooter({ text: `bday-congrats:${dateKey}:${member.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bday_congrats_${member.id}_${dateKey}`)
      .setStyle(ButtonStyle.Success)
      .setLabel(t('btnCongratulate', lang))
  );

  return { embed, row };
}

// ---------------------------------------------------------------------------
// Kleinere Helfer
// ---------------------------------------------------------------------------

function smallEmbed(color, title, desc) {
  const e = new EmbedBuilder().setColor(color);
  if (title) e.setTitle(title);
  if (desc) e.setDescription(desc);
  return e;
}

module.exports = {
  COLORS,
  LIST_MARKER,
  buildListEmbed,
  listActionRow,
  parseListEmbed,
  buildEntryModal,
  buildAdminModal,
  buildConfirmationEmbed,
  confirmationRow,
  buildSevenDayErrorEmbed,
  buildCongratsEmbed,
  smallEmbed,
};
