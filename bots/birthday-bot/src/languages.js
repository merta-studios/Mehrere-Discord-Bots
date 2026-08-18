/**
 * ============================================================================
 *  DIE Sprachdatei – ALLE Sprachen in EINER Datei.
 *
 *  So funktioniert's:
 *  - Jeder Text-Key enthält direkt untereinander alle 10 Sprachen.
 *    Wenn du einen Text änderst, siehst du sofort alle Übersetzungen
 *    daneben und musst nicht in 10 Dateien suchen.
 *  - Die 10 meistgenutzten Discord-Sprachen: Deutsch, Englisch,
 *    Französisch, Spanisch, Portugiesisch (BR), Russisch, Japanisch,
 *    Koreanisch, Chinesisch (CN), Italienisch.
 *  - T-Keys, die nur `de` enthalten, sind bewusst nur auf Deutsch
 *    (z. B. das Owner-Admin-Panel).
 *
 *  Platzhalter in Texten: {name}, {date}, {count} … werden zur
 *  Laufzeit ersetzt (siehe t() am Ende der Datei).
 * ============================================================================
 */

const LANGS = {
  de: {
    name: 'Deutsch',
    names: { de: 'Deutsch', en: 'German', fr: 'Allemand', es: 'Alemán', pt: 'Alemão', ru: 'Немецкий', ja: 'ドイツ語', ko: '독일어', zh: '德语', it: 'Tedesco' },
    flag: '🇩🇪',
    locale: 'de-DE',
    tz: 'Europe/Berlin',
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    short: ['jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'],
    extra: [['jänner'], [], ['maerz'], [], [], [], [], [], [], [], [], []],
  },
  en: {
    name: 'English',
    names: { de: 'Englisch', en: 'English', fr: 'Anglais', es: 'Inglés', pt: 'Inglês', ru: 'Английский', ja: '英語', ko: '영어', zh: '英语', it: 'Inglese' },
    flag: '🇬🇧',
    locale: 'en-US',
    tz: 'America/New_York',
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    short: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
    extra: [],
  },
  fr: {
    name: 'Français',
    names: { de: 'Französisch', en: 'French', fr: 'Français', es: 'Francés', pt: 'Francês', ru: 'Французский', ja: 'フランス語', ko: '프랑스어', zh: '法语', it: 'Francese' },
    flag: '🇫🇷',
    locale: 'fr-FR',
    tz: 'Europe/Paris',
    months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    short: ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
    extra: [['janvier'], ['fevrier', 'février'], [], ['avril'], [], [], ['juillet'], ['aout', 'août'], ['septembre'], [], [], ['decembre', 'décembre']],
  },
  es: {
    name: 'Español',
    names: { de: 'Spanisch', en: 'Spanish', fr: 'Espagnol', es: 'Español', pt: 'Espanhol', ru: 'Испанский', ja: 'スペイン語', ko: '스페인어', zh: '西班牙语', it: 'Spagnolo' },
    flag: '🇪🇸',
    locale: 'es-ES',
    tz: 'Europe/Madrid',
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    short: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
    extra: [['enero'], [], ['marzo'], [], [], [], [], [], ['setiembre', 'septiembre'], [], [], []],
  },
  pt: {
    name: 'Português',
    names: { de: 'Portugiesisch', en: 'Portuguese', fr: 'Portugais', es: 'Portugués', pt: 'Português', ru: 'Португальский', ja: 'ポルトガル語', ko: '포르투갈어', zh: '葡萄牙语', it: 'Portoghese' },
    flag: '🇧🇷',
    locale: 'pt-BR',
    tz: 'America/Sao_Paulo',
    months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    short: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
    extra: [['janeiro'], [], ['marco', 'março'], [], [], [], [], [], ['setembro'], [], [], []],
  },
  ru: {
    name: 'Русский',
    names: { de: 'Russisch', en: 'Russian', fr: 'Russe', es: 'Ruso', pt: 'Russo', ru: 'Русский', ja: 'ロシア語', ko: '러시아어', zh: '俄语', it: 'Russo' },
    flag: '🇷🇺',
    locale: 'ru-RU',
    tz: 'Europe/Moscow',
    months: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'],
    short: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    extra: [['января'], ['февраля'], ['марта'], ['апреля'], ['мая'], ['июня'], ['июля'], ['августа'], ['сентября'], ['октября'], ['ноября'], ['декабря']],
  },
  ja: {
    name: '日本語',
    names: { de: 'Japanisch', en: 'Japanese', fr: 'Japonais', es: 'Japonés', pt: 'Japonês', ru: 'Японский', ja: '日本語', ko: '일본어', zh: '日语', it: 'Giapponese' },
    flag: '🇯🇵',
    locale: 'ja-JP',
    tz: 'Asia/Tokyo',
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    short: [],
    kanji: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
    numeralSuffix: '月',
    extra: [],
  },
  ko: {
    name: '한국어',
    names: { de: 'Koreanisch', en: 'Korean', fr: 'Coréen', es: 'Coreano', pt: 'Coreano', ru: 'Корейский', ja: '韓国語', ko: '한국어', zh: '韩语', it: 'Coreano' },
    flag: '🇰🇷',
    locale: 'ko-KR',
    tz: 'Asia/Seoul',
    months: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
    short: [],
    hangul: ['일월', '이월', '삼월', '사월', '오월', '유월', '칠월', '팔월', '구월', '시월', '십일월', '십이월'],
    numeralSuffix: '월',
    extra: [],
  },
  zh: {
    name: '中文',
    names: { de: 'Chinesisch', en: 'Chinese', fr: 'Chinois', es: 'Chino', pt: 'Chinês', ru: 'Китайский', ja: '中国語', ko: '중국어', zh: '中文', it: 'Cinese' },
    flag: '🇨🇳',
    locale: 'zh-CN',
    tz: 'Asia/Shanghai',
    months: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    short: [],
    kanji: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
    numeralSuffix: '月',
    extra: [],
  },
  it: {
    name: 'Italiano',
    names: { de: 'Italienisch', en: 'Italian', fr: 'Italien', es: 'Italiano', pt: 'Italiano', ru: 'Итальянский', ja: 'イタリア語', ko: '이탈리아어', zh: '意大利语', it: 'Italiano' },
    flag: '🇮🇹',
    locale: 'it-IT',
    tz: 'Europe/Rome',
    months: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
    short: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
    extra: [['gennaio'], [], ['marzo'], [], [], [], [], [], ['settembre'], [], [], []],
  },
};

const T = {
  // ----------------------------------------------------------
  // Geburtstagsliste (Embed)
  // ----------------------------------------------------------
  listTitle: {
    de: '🎂 Geburtstage',
    en: '🎂 Birthdays',
    fr: '🎂 Anniversaires',
    es: '🎂 Cumpleaños',
    pt: '🎂 Aniversários',
    ru: '🎂 Дни рождения',
    ja: '🎂 誕生日',
    ko: '🎂 생일',
    zh: '🎂 生日',
    it: '🎂 Compleanni',
  },
  listTagline: {
    de: 'Alle Geburtstage auf einen Blick – trag dich ein! 🥳',
    en: 'All birthdays at a glance – add yours! 🥳',
    fr: 'Tous les anniversaires en un coup d’œil – ajoute le tien ! 🥳',
    es: 'Todos los cumpleaños de un vistazo – ¡añade el tuyo! 🥳',
    pt: 'Todos os aniversários num relance – adicione o seu! 🥳',
    ru: 'Все дни рождения на одном экране – добавь свой! 🥳',
    ja: '誕生日を一目でチェック！ぜひ登録してね 🥳',
    ko: '생일을 한눈에 확인하세요 – 여러분의 생일을 등록하세요! 🥳',
    zh: '所有生日一目了然——快来添加你的生日吧！🥳',
    it: 'Tutti i compleanni a colpo d’occhio – aggiungi il tuo! 🥳',
  },
  // Countdown hinter jeder Erwähnung in der Geburtstagsliste. Die
  // unterschiedlichen Keys bilden die wichtigsten Pluralformen ab (z. B.
  // Russisch: 1 день, 2 дня, 5 дней).
  birthdayInDaysOne: {
    de: 'in {count} Tag',
    en: 'in {count} day',
    fr: 'dans {count} jour',
    es: 'en {count} día',
    pt: 'em {count} dia',
    ru: 'через {count} день',
    ja: 'あと{count}日',
    ko: '{count}일 후',
    zh: '{count}天后',
    it: 'tra {count} giorno',
  },
  birthdayInDaysFew: {
    de: 'in {count} Tagen',
    en: 'in {count} days',
    fr: 'dans {count} jours',
    es: 'en {count} días',
    pt: 'em {count} dias',
    ru: 'через {count} дня',
    ja: 'あと{count}日',
    ko: '{count}일 후',
    zh: '{count}天后',
    it: 'tra {count} giorni',
  },
  birthdayInDaysMany: {
    de: 'in {count} Tagen',
    en: 'in {count} days',
    fr: 'dans {count} jours',
    es: 'en {count} días',
    pt: 'em {count} dias',
    ru: 'через {count} дней',
    ja: 'あと{count}日',
    ko: '{count}일 후',
    zh: '{count}天后',
    it: 'tra {count} giorni',
  },
  birthdayInDaysOther: {
    de: 'in {count} Tagen',
    en: 'in {count} days',
    fr: 'dans {count} jours',
    es: 'en {count} días',
    pt: 'em {count} dias',
    ru: 'через {count} дня',
    ja: 'あと{count}日',
    ko: '{count}일 후',
    zh: '{count}天后',
    it: 'tra {count} giorni',
  },
  birthdayToday: {
    de: 'Heute',
    en: 'Today',
    fr: "Aujourd'hui",
    es: 'Hoy',
    pt: 'Hoje',
    ru: 'Сегодня',
    ja: '今日',
    ko: '오늘',
    zh: '今天',
    it: 'Oggi',
  },
  listEmpty: {
    de: 'Noch niemand eingetragen. Klicke unten auf den Button und sei die/der Erste! 🎈',
    en: 'Nobody has entered a birthday yet. Click the button below and be the first! 🎈',
    fr: 'Personne n’a encore ajouté son anniversaire. Clique sur le bouton ci-dessous pour être le premier ! 🎈',
    es: 'Aún nadie ha añadido su cumpleaños. ¡Haz clic en el botón de abajo y sé el primero! 🎈',
    pt: 'Ninguém adicionou um aniversário ainda. Clique no botão abaixo e seja o primeiro! 🎈',
    ru: 'Пока никто не добавил свой день рождения. Нажми на кнопку ниже и стань первым! 🎈',
    ja: 'まだ誰も登録していません。下のボタンを押して最初に登録しましょう！🎈',
    ko: '아직 아무도 생일을 등록하지 않았어요. 아래 버튼을 눌러 첫 번째로 등록하세요! 🎈',
    zh: '还没有人添加生日。点击下方按钮，成为第一个吧！🎈',
    it: 'Nessuno ha ancora inserito il proprio compleanno. Clicca il pulsante qui sotto e sii il primo! 🎈',
  },

  // ----------------------------------------------------------
  // Buttons
  // ----------------------------------------------------------
  btnAddBirthday: {
    de: '🎂 Geburtstag eintragen',
    en: '🎂 Add birthday',
    fr: '🎂 Ajouter mon anniversaire',
    es: '🎂 Añadir cumpleaños',
    pt: '🎂 Adicionar aniversário',
    ru: '🎂 Добавить день рождения',
    ja: '🎂 誕生日を登録',
    ko: '🎂 생일 등록',
    zh: '🎂 添加生日',
    it: '🎂 Aggiungi compleanno',
  },
  btnConfirm: {
    de: '✅ Bestätigen',
    en: '✅ Confirm',
    fr: '✅ Confirmer',
    es: '✅ Confirmar',
    pt: '✅ Confirmar',
    ru: '✅ Подтвердить',
    ja: '✅ 確認',
    ko: '✅ 확인',
    zh: '✅ 确认',
    it: '✅ Conferma',
  },
  btnEdit: {
    de: '✏️ Bearbeiten',
    en: '✏️ Edit',
    fr: '✏️ Modifier',
    es: '✏️ Editar',
    pt: '✏️ Editar',
    ru: '✏️ Изменить',
    ja: '✏️ 編集',
    ko: '✏️ 수정',
    zh: '✏️ 编辑',
    it: '✏️ Modifica',
  },
  btnCancel: {
    de: '❌ Abbrechen',
    en: '❌ Cancel',
    fr: '❌ Annuler',
    es: '❌ Cancelar',
    pt: '❌ Cancelar',
    ru: '❌ Отмена',
    ja: '❌ キャンセル',
    ko: '❌ 취소',
    zh: '❌ 取消',
    it: '❌ Annulla',
  },
  btnCongratulate: {
    de: '🎉 Gratulieren',
    en: '🎉 Congratulate',
    fr: '🎉 Féliciter',
    es: '🎉 Felicitar',
    pt: '🎉 Parabenizar',
    ru: '🎉 Поздравить',
    ja: '🎉 お祝いする',
    ko: '🎉 축하하기',
    zh: '🎉 祝贺',
    it: '🎉 Congratulati',
  },

  // ----------------------------------------------------------
  // Formular (Modal)
  // ----------------------------------------------------------
  modalTitle: {
    de: '🎂 Geburtstag eintragen',
    en: '🎂 Add birthday',
    fr: '🎂 Ajouter un anniversaire',
    es: '🎂 Añadir cumpleaños',
    pt: '🎂 Adicionar aniversário',
    ru: '🎂 Добавить день рождения',
    ja: '🎂 誕生日を登録',
    ko: '🎂 생일 등록',
    zh: '🎂 添加生日',
    it: '🎂 Aggiungi compleanno',
  },
  modalDayLabel: {
    de: 'Tag',
    en: 'Day',
    fr: 'Jour',
    es: 'Día',
    pt: 'Dia',
    ru: 'День',
    ja: '日',
    ko: '일',
    zh: '日',
    it: 'Giorno',
  },
  modalDayPlaceholder: {
    de: 'z. B. 4 oder 04',
    en: 'e.g. 4 or 04',
    fr: 'p. ex. 4 ou 04',
    es: 'p. ej. 4 o 04',
    pt: 'ex.: 4 ou 04',
    ru: 'напр. 4 или 04',
    ja: '例: 4 または 04',
    ko: '예: 4 또는 04',
    zh: '例如：4 或 04',
    it: 'es. 4 o 04',
  },
  modalMonthLabel: {
    de: 'Monat',
    en: 'Month',
    fr: 'Mois',
    es: 'Mes',
    pt: 'Mês',
    ru: 'Месяц',
    ja: '月',
    ko: '월',
    zh: '月',
    it: 'Mese',
  },
  modalMonthPlaceholder: {
    de: 'z. B. 9, September, Sebtemger …',
    en: 'e.g. 9, September, Sebtemger …',
    fr: 'p. ex. 9, septembre, setmebre …',
    es: 'p. ej. 9, septiembre, septiemre …',
    pt: 'ex.: 9, setembro, setembor …',
    ru: 'напр. 9, сентябрь, сенятбрь …',
    ja: '例: 9、9月、くがつ、9がつ …',
    ko: '예: 9, 9월, 구월, 구월 …',
    zh: '例如：9、9月、九月、九月 …',
    it: 'es. 9, settembre, settermbre …',
  },

  // ----------------------------------------------------------
  // Bestätigung
  // ----------------------------------------------------------
  confirmTitle: {
    de: 'Bist du sicher? 🤔',
    en: 'Are you sure? 🤔',
    fr: 'Tu es sûr ? 🤔',
    es: '¿Estás seguro? 🤔',
    pt: 'Tem certeza? 🤔',
    ru: 'Ты уверен? 🤔',
    ja: '本当にいい？🤔',
    ko: '확실한가요? 🤔',
    zh: '确定吗？🤔',
    it: 'Sei sicuro? 🤔',
  },
  confirmBody: {
    de: 'Du hast eingetragen:\n\n**{date}**\n\nStimmt das so? Dann klick auf **Bestätigen**!',
    en: 'You entered:\n\n**{date}**\n\nIs that right? Then hit **Confirm**!',
    fr: 'Tu as indiqué :\n\n**{date}**\n\nC’est bon ? Alors clique sur **Confirmer** !',
    es: 'Has indicado:\n\n**{date}**\n\n¿Es correcto? ¡Entonces haz clic en **Confirmar**!',
    pt: 'Você indicou:\n\n**{date}**\n\nEstá certo? Então clique em **Confirmar**!',
    ru: 'Ты указал:\n\n**{date}**\n\nВсё верно? Тогда жми **Подтвердить**!',
    ja: '入力された日付:\n\n**{date}**\n\nこれでいい？**確認**を押してね！',
    ko: '입력한 날짜:\n\n**{date}**\n\n맞나요? **확인**을 눌러 주세요!',
    zh: '你输入的日期：\n\n**{date}**\n\n正确吗？点击**确认**吧！',
    it: 'Hai inserito:\n\n**{date}**\n\nÈ giusto? Allora clicca su **Conferma**!',
  },
  fuzzyNote: {
    de: '🤓 Ich habe „{input}“ als **{month}** interpretiert.',
    en: '🤓 I interpreted “{input}” as **{month}**.',
    fr: '🤓 J’ai interprété « {input} » comme **{month}**.',
    es: '🤓 Interpreté «{input}» como **{month}**.',
    pt: '🤓 Interpretei «{input}» como **{month}**.',
    ru: '🤓 Я распознал «{input}» как **{month}**.',
    ja: '🤓 「{input}」を **{month}** と解釈しました。',
    ko: '🤓 「{input}」을(를) **{month}**(으)로 해석했어요.',
    zh: '🤓 我将「{input}」理解为**{month}**。',
    it: '🤓 Ho interpretato «{input}» come **{month}**.',
  },
  confirmAck: {
    de: '📝 Bitte bestätige unten im Kanal!',
    en: '📝 Please confirm below in the channel!',
    fr: '📝 Confirme en bas dans le salon !',
    es: '📝 ¡Confirma abajo en el canal!',
    pt: '📝 Confirme abaixo no canal!',
    ru: '📝 Подтверди внизу в канале!',
    ja: '📝 下のチャンネルで確認してください！',
    ko: '📝 아래 채널에서 확인해 주세요!',
    zh: '📝 请在下方频道中确认！',
    it: '📝 Conferma qui sotto nel canale!',
  },

  // ----------------------------------------------------------
  // Löschen (beide Felder leer lassen)
  // ----------------------------------------------------------
  deleteConfirmTitle: {
    de: 'Geburtstag löschen? 🗑️',
    en: 'Delete your birthday? 🗑️',
    fr: 'Supprimer ton anniversaire ? 🗑️',
    es: '¿Eliminar tu cumpleaños? 🗑️',
    pt: 'Excluir seu aniversário? 🗑️',
    ru: 'Удалить день рождения? 🗑️',
    ja: '誕生日を削除しますか？🗑️',
    ko: '생일을 삭제할까요? 🗑️',
    zh: '要删除你的生日吗？🗑️',
    it: 'Eliminare il tuo compleanno? 🗑️',
  },
  deleteConfirmBody: {
    de: 'Du hast **beide Felder leer** gelassen. Wenn du auf **Bestätigen** klickst, wird dein Geburtstag aus der Liste **gelöscht**.\n\nBist du sicher?',
    en: 'You left **both fields empty**. If you hit **Confirm**, your birthday will be **removed** from the list.\n\nAre you sure?',
    fr: 'Tu as laissé **les deux champs vides**. Si tu cliques sur **Confirmer**, ton anniversaire sera **supprimé** de la liste.\n\nTu es sûr ?',
    es: 'Dejaste **los dos campos vacíos**. Si haces clic en **Confirmar**, tu cumpleaños se **eliminará** de la lista.\n\n¿Estás seguro?',
    pt: 'Você deixou **os dois campos vazios**. Se clicar em **Confirmar**, seu aniversário será **removido** da lista.\n\nTem certeza?',
    ru: 'Ты оставил **оба поля пустыми**. Если нажать **Подтвердить**, твой день рождения будет **удалён** из списка.\n\nТы уверен?',
    ja: '**両方のフィールドを空**のままにしました。**確認**を押すと、リストから誕生日が**削除**されます。\n\nよろしいですか？',
    ko: '**두 필드를 모두 비워** 두셨어요. **확인**을 누르면 목록에서 생일이 **삭제**됩니다.\n\n확실한가요?',
    zh: '你**两个字段都留空了**。点击**确认**后，你的生日将从列表中**删除**。\n\n确定吗？',
    it: 'Hai lasciato **entrambi i campi vuoti**. Se clicchi su **Conferma**, il tuo compleanno verrà **rimosso** dalla lista.\n\nSei sicuro?',
  },
  adminDeleteConfirmBody: {
    de: 'Du hast **beide Felder leer** gelassen. Wenn du auf **Bestätigen** klickst, wird der Geburtstag von {user} aus der Liste **gelöscht**.\n\nBist du sicher?',
    en: 'You left **both fields empty**. If you hit **Confirm**, {user}’s birthday will be **removed** from the list.\n\nAre you sure?',
    fr: 'Tu as laissé **les deux champs vides**. Si tu cliques sur **Confirmer**, l’anniversaire de {user} sera **supprimé** de la liste.\n\nTu es sûr ?',
    es: 'Dejaste **los dos campos vacíos**. Si haces clic en **Confirmar**, el cumpleaños de {user} se **eliminará** de la lista.\n\n¿Estás seguro?',
    pt: 'Você deixou **os dois campos vazios**. Se clicar em **Confirmar**, o aniversário de {user} será **removido** da lista.\n\nTem certeza?',
    ru: 'Ты оставил **оба поля пустыми**. Если нажать **Подтвердить**, день рождения {user} будет **удалён** из списка.\n\nТы уверен?',
    ja: '**両方のフィールドを空**のままにしました。**確認**を押すと、{user} の誕生日がリストから**削除**されます。\n\nよろしいですか？',
    ko: '**두 필드를 모두 비워** 두셨어요. **확인**을 누르면 {user}님의 생일이 목록에서 **삭제**됩니다.\n\n확실한가요?',
    zh: '你**两个字段都留空了**。点击**确认**后，{user}的生日将从列表中**删除**。\n\n确定吗？',
    it: 'Hai lasciato **entrambi i campi vuoti**. Se clicchi su **Conferma**, il compleanno di {user} verrà **rimosso** dalla lista.\n\nSei sicuro?',
  },
  cancelNote: {
    de: '👋 Abgebrochen!',
    en: '👋 Cancelled!',
    fr: '👋 Annulé !',
    es: '👋 ¡Cancelado!',
    pt: '👋 Cancelado!',
    ru: '👋 Отменено!',
    ja: '👋 キャンセルしました！',
    ko: '👋 취소했어요!',
    zh: '👋 已取消！',
    it: '👋 Annullato!',
  },

  // ----------------------------------------------------------
  // Erfolg & Fehler beim Eintragen
  // ----------------------------------------------------------
  birthdayAdded: {
    de: '🎉 Geschafft! Dein Geburtstag (**{date}**) wurde eingetragen.',
    en: '🎉 Done! Your birthday (**{date}**) has been added.',
    fr: '🎉 C’est fait ! Ton anniversaire (**{date}**) a été ajouté.',
    es: '🎉 ¡Hecho! Tu cumpleaños (**{date}**) se ha añadido.',
    pt: '🎉 Pronto! Seu aniversário (**{date}**) foi adicionado.',
    ru: '🎉 Готово! Твой день рождения (**{date}**) добавлен.',
    ja: '🎉 完了！誕生日（**{date}**）を登録しました。',
    ko: '🎉 완료! 생일(**{date}**)을 등록했어요.',
    zh: '🎉 完成！你的生日（**{date}**）已添加。',
    it: '🎉 Fatto! Il tuo compleanno (**{date}**) è stato aggiunto.',
  },
  entryReplaced: {
    de: '🔄 Dein alter Eintrag wurde entfernt und durch den neuen ersetzt.',
    en: '🔄 Your old entry was removed and replaced with the new one.',
    fr: '🔄 Ton ancienne entrée a été supprimée et remplacée par la nouvelle.',
    es: '🔄 Tu antigua entrada se eliminó y se sustituyó por la nueva.',
    pt: '🔄 Sua entrada antiga foi removida e substituída pela nova.',
    ru: '🔄 Твоя старая запись удалена и заменена новой.',
    ja: '🔄 以前の登録を削除して、新しいものに置き換えました。',
    ko: '🔄 이전 등록을 삭제하고 새 것으로 바꿨어요.',
    zh: '🔄 你的旧条目已被删除并替换为新条目。',
    it: '🔄 La tua vecchia voce è stata rimossa e sostituita con quella nuova.',
  },
  birthdayDeleted: {
    de: '🗑️ Dein Geburtstag wurde gelöscht.',
    en: '🗑️ Your birthday was deleted.',
    fr: '🗑️ Ton anniversaire a été supprimé.',
    es: '🗑️ Tu cumpleaños fue eliminado.',
    pt: '🗑️ Seu aniversário foi excluído.',
    ru: '🗑️ Твой день рождения удалён.',
    ja: '🗑️ 誕生日を削除しました。',
    ko: '🗑️ 생일을 삭제했어요.',
    zh: '🗑️ 你的生日已被删除。',
    it: '🗑️ Il tuo compleanno è stato eliminato.',
  },
  adminDeletedSuccess: {
    de: '🗑️ Der Geburtstag von {user} wurde gelöscht.',
    en: '🗑️ {user}’s birthday was deleted.',
    fr: '🗑️ L’anniversaire de {user} a été supprimé.',
    es: '🗑️ El cumpleaños de {user} fue eliminado.',
    pt: '🗑️ O aniversário de {user} foi excluído.',
    ru: '🗑️ День рождения {user} удалён.',
    ja: '🗑️ {user} の誕生日を削除しました。',
    ko: '🗑️ {user}님의 생일을 삭제했어요.',
    zh: '🗑️ 已删除{user}的生日。',
    it: '🗑️ Il compleanno di {user} è stato eliminato.',
  },
  noBirthdayToDelete: {
    de: 'ℹ️ Du hast gar keinen Geburtstag eingetragen – es gibt nichts zu löschen.',
    en: 'ℹ️ You haven’t entered a birthday, so there is nothing to delete.',
    fr: 'ℹ️ Tu n’as pas entré d’anniversaire, il n’y a donc rien à supprimer.',
    es: 'ℹ️ No has añadido un cumpleaños, así que no hay nada que eliminar.',
    pt: 'ℹ️ Você não adicionou um aniversário, então não há nada para excluir.',
    ru: 'ℹ️ Ты не добавлял день рождения, поэтому удалять нечего.',
    ja: 'ℹ️ 誕生日を登録していないので、削除するものはありません。',
    ko: 'ℹ️ 등록한 생일이 없어서 삭제할 것이 없어요.',
    zh: 'ℹ️ 你还没有添加生日，因此没有可删除的内容。',
    it: 'ℹ️ Non hai inserito un compleanno, quindi non c’è nulla da eliminare.',
  },
  errSevenDaysTitle: {
    de: '⛔ Zu früh zum Eintragen!',
    en: '⛔ Too early to add!',
    fr: '⛔ Trop tôt pour t’inscrire !',
    es: '⛔ ¡Demasiado pronto para añadirlo!',
    pt: '⛔ Cedo demais para adicionar!',
    ru: '⛔ Слишком рано!',
    ja: '⛔ 登録するには早すぎます！',
    ko: '⛔ 등록하기엔 너무 빨라요!',
    zh: '⛔ 添加太早了！',
    it: '⛔ Troppo presto per aggiungerlo!',
  },
  errSevenDaysBody: {
    de: 'Dein Geburtstag am **{date}** ist in weniger als 7 Tagen. Das könnte als Spam erkannt werden – deshalb darfst du ihn jetzt nicht eintragen.\n\nVersuch es einfach **einen Tag nach deinem Geburtstag** nochmal – dann klappt es garantiert! 🎂',
    en: 'Your birthday on **{date}** is less than 7 days away. That could look like spam, so you can’t add it right now.\n\nJust try again **one day after your birthday** – it will definitely work! 🎂',
    fr: 'Ton anniversaire le **{date}** tombe dans moins de 7 jours. Cela pourrait ressembler à du spam, tu ne peux donc pas l’ajouter maintenant.\n\nRéessaie **le lendemain de ton anniversaire** – ça fonctionnera à coup sûr ! 🎂',
    es: 'Tu cumpleaños el **{date}** es en menos de 7 días. Podría parecer spam, así que ahora no puedes añadirlo.\n\n¡Vuelve a intentarlo **un día después de tu cumpleaños** y funcionará seguro! 🎂',
    pt: 'Seu aniversário em **{date}** é daqui a menos de 7 dias. Isso pode parecer spam, então você não pode adicioná-lo agora.\n\nTente de novo **um dia depois do seu aniversário** – com certeza vai funcionar! 🎂',
    ru: 'Твой день рождения **{date}** наступит меньше чем через 7 дней. Это может выглядеть как спам, поэтому сейчас добавить его нельзя.\n\nПопробуй снова **на следующий день после дня рождения** – всё обязательно получится! 🎂',
    ja: '**{date}** の誕生日は7日以内にあります。スパムと判断される可能性があるため、今は登録できません。\n\n誕生日の**翌日**にもう一度試してみてください。必ず成功しますよ！🎂',
    ko: '**{date}** 생일이 7일 이내에 있어요. 스팸으로 오해받을 수 있으니 지금은 등록할 수 없어요.\n\n생일 **다음 날** 다시 시도해 보세요. 분명 성공할 거예요! 🎂',
    zh: '你的生日**{date}**在7天以内，可能会被当作垃圾信息，所以现在无法添加。\n\n请在你的生日**后一天**再试一次，一定能成功！🎂',
    it: 'Il tuo compleanno il **{date}** è tra meno di 7 giorni. Potrebbe essere considerato spam, quindi non puoi aggiungerlo ora.\n\nRiprova **il giorno dopo il tuo compleanno** – funzionerà di sicuro! 🎂',
  },
  errInvalidDay: {
    de: '⛔ Der Tag muss eine Zahl zwischen 1 und 31 sein.',
    en: '⛔ The day must be a number between 1 and 31.',
    fr: '⛔ Le jour doit être un nombre entre 1 et 31.',
    es: '⛔ El día debe ser un número entre 1 y 31.',
    pt: '⛔ O dia deve ser um número entre 1 e 31.',
    ru: '⛔ День должен быть числом от 1 до 31.',
    ja: '⛔ 日は1〜31の数字で入力してください。',
    ko: '⛔ 일은 1~31 사이의 숫자여야 해요.',
    zh: '⛔ 日必须是1到31之间的数字。',
    it: '⛔ Il giorno deve essere un numero da 1 a 31.',
  },
  errInvalidMonth: {
    de: '⛔ Den Monat konnte ich nicht erkennen. Versuch es nochmal (z. B. „September“ oder „9“).',
    en: '⛔ I couldn’t recognize the month. Try again (e.g. “September” or “9”).',
    fr: '⛔ Je n’ai pas reconnu le mois. Réessaie (p. ex. « septembre » ou « 9 »).',
    es: '⛔ No pude reconocer el mes. Inténtalo de nuevo (p. ej. «septiembre» o «9»).',
    pt: '⛔ Não consegui reconhecer o mês. Tente novamente (ex.: «setembro» ou «9»).',
    ru: '⛔ Не удалось распознать месяц. Попробуй ещё раз (например, «сентябрь» или «9»).',
    ja: '⛔ 月を認識できませんでした。もう一度試してください（例：「9月」や「9」）。',
    ko: '⛔ 월을 인식하지 못했어요. 다시 시도해 주세요(예: 「9월」 또는 「9」).',
    zh: '⛔ 无法识别月份，请重试（例如「9月」或「9」）。',
    it: '⛔ Non sono riuscito a riconoscere il mese. Riprova (es. «settembre» o «9»).',
  },
  errInvalidDate: {
    de: '⛔ Dieses Datum gibt es nicht (z. B. 31. Februar).',
    en: '⛔ This date doesn’t exist (e.g. February 31).',
    fr: '⛔ Cette date n’existe pas (p. ex. le 31 février).',
    es: '⛔ Esta fecha no existe (p. ej. 31 de febrero).',
    pt: '⛔ Essa data não existe (ex.: 31 de fevereiro).',
    ru: '⛔ Такой даты не существует (например, 31 февраля).',
    ja: '⛔ この日付は存在しません（例：2月31日）。',
    ko: '⛔ 없는 날짜예요(예: 2월 31일).',
    zh: '⛔ 这个日期不存在（例如2月31日）。',
    it: '⛔ Questa data non esiste (es. 31 febbraio).',
  },
  errNoList: {
    de: '⛔ Es gibt noch keine Geburtstagsliste auf diesem Server. Bitte nutze zuerst **/setup**!',
    en: '⛔ There’s no birthday list on this server yet. Please use **/setup** first!',
    fr: '⛔ Il n’y a pas encore de liste d’anniversaires sur ce serveur. Utilise d’abord **/setup** !',
    es: '⛔ Aún no hay lista de cumpleaños en este servidor. ¡Usa primero **/setup**!',
    pt: '⛔ Ainda não há lista de aniversários neste servidor. Use **/setup** primeiro!',
    ru: '⛔ На этом сервере ещё нет списка дней рождения. Сначала используй **/setup**!',
    ja: '⛔ このサーバーにはまだ誕生日リストがありません。先に **/setup** を使ってください！',
    ko: '⛔ 이 서버에는 아직 생일 목록이 없어요. 먼저 **/setup**을 사용하세요!',
    zh: '⛔ 这个服务器上还没有生日列表，请先使用 **/setup**！',
    it: '⛔ Non c’è ancora una lista di compleanni su questo server. Usa prima **/setup**!',
  },
  errGuildOnly: {
    de: '⛔ Dieser Befehl funktioniert nur auf einem Server.',
    en: '⛔ This command only works on a server.',
    fr: '⛔ Cette commande ne fonctionne que sur un serveur.',
    es: '⛔ Este comando solo funciona en un servidor.',
    pt: '⛔ Este comando só funciona em um servidor.',
    ru: '⛔ Эта команда работает только на сервере.',
    ja: '⛔ このコマンドはサーバーでのみ使用できます。',
    ko: '⛔ 이 명령어는 서버에서만 사용할 수 있어요.',
    zh: '⛔ 此命令只能在服务器上使用。',
    it: '⛔ Questo comando funziona solo su un server.',
  },
  errNoPermission: {
    de: '⛔ Dazu brauchst du die **Administrator**-Berechtigung!',
    en: '⛔ You need the **Administrator** permission for this!',
    fr: '⛔ Tu as besoin de la permission **Administrateur** pour ça !',
    es: '⛔ ¡Necesitas el permiso de **Administrador** para esto!',
    pt: '⛔ Você precisa da permissão de **Administrador** para isso!',
    ru: '⛔ Для этого нужны права **Администратора**!',
    ja: '⛔ これには**管理者**権限が必要です！',
    ko: '⛔ 이 작업에는 **관리자** 권한이 필요해요!',
    zh: '⛔ 执行此操作需要**管理员**权限！',
    it: '⛔ Per questo serve il permesso **Amministratore**!',
  },
  errOwnerOnly: {
    de: '⛔ Nur der Bot-Owner kann das nutzen!',
    en: '⛔ Only the bot owner can use this!',
    fr: '⛔ Seul le propriétaire du bot peut utiliser ça !',
    es: '⛔ ¡Solo el propietario del bot puede usar esto!',
    pt: '⛔ Somente o dono do bot pode usar isso!',
    ru: '⛔ Это может использовать только владелец бота!',
    ja: '⛔ これはボットの所有者だけが使えます！',
    ko: '⛔ 봇 소유자만 사용할 수 있어요!',
    zh: '⛔ 只有机器人所有者才能使用此功能！',
    it: '⛔ Solo il proprietario del bot può usarlo!',
  },
  errDmOnly: {
    de: '⛔ Bitte nutze diesen Befehl im Privatchat mit dem Bot-Owner!',
    en: '⛔ Please use this command in the DM with the bot owner!',
    fr: '⛔ Utilise cette commande en MP avec le propriétaire du bot !',
    es: '⛔ ¡Usa este comando en el DM con el propietario del bot!',
    pt: '⛔ Use este comando no DM com o dono do bot!',
    ru: '⛔ Используй эту команду в ЛС с владельцем бота!',
    ja: '⛔ ボット所有者とのDMでこのコマンドを使用してください！',
    ko: '⛔ 봇 소유자와의 DM에서 이 명령어를 사용하세요!',
    zh: '⛔ 请在机器人所有者的私聊中使用此命令！',
    it: '⛔ Usa questo comando nel DM con il proprietario del bot!',
  },
  errChannelBad: {
    de: '⛔ Bitte wähle einen Textchannel aus!',
    en: '⛔ Please choose a text channel!',
    fr: '⛔ Choisis un salon textuel !',
    es: '⛔ ¡Elige un canal de texto!',
    pt: '⛔ Escolha um canal de texto!',
    ru: '⛔ Выбери текстовый канал!',
    ja: '⛔ テキストチャンネルを選択してください！',
    ko: '⛔ 텍스트 채널을 선택하세요!',
    zh: '⛔ 请选择一个文字频道！',
    it: '⛔ Scegli un canale testuale!',
  },
  errBotPerms: {
    de: '⛔ Ich brauche die Berechtigungen **Nachrichten senden** und **Kanal ansehen** in {channel}!',
    en: '⛔ I need **Send Messages** and **View Channel** permissions in {channel}!',
    fr: '⛔ J’ai besoin des permissions **Envoyer des messages** et **Voir le salon** dans {channel} !',
    es: '⛔ ¡Necesito los permisos **Enviar mensajes** y **Ver canal** en {channel}!',
    pt: '⛔ Preciso das permissões **Enviar mensagens** e **Ver canal** em {channel}!',
    ru: '⛔ Мне нужны права **Отправлять сообщения** и **Просматривать канал** в {channel}!',
    ja: '⛔ {channel} で**メッセージを送信**と**チャンネルを見る**権限が必要です！',
    ko: '⛔ {channel}에서 **메시지 보내기** 및 **채널 보기** 권한이 필요해요!',
    zh: '⛔ 我需要在{channel}中拥有**发送消息**和**查看频道**的权限！',
    it: '⛔ Mi servono i permessi **Invia messaggi** e **Vedi canale** in {channel}!',
  },
  errGeneric: {
    de: '😵 Ups, da ist etwas schiefgelaufen. Bitte versuch es nochmal!',
    en: '😵 Oops, something went wrong. Please try again!',
    fr: '😵 Oups, quelque chose s’est mal passé. Réessaie !',
    es: '😵 Vaya, algo salió mal. ¡Inténtalo de nuevo!',
    pt: '😵 Opa, algo deu errado. Tente novamente!',
    ru: '😵 Ой, что-то пошло не так. Попробуй ещё раз!',
    ja: '😵 あれ、何かがうまくいきませんでした。もう一度お試しください！',
    ko: '😵 앗, 뭔가 잘못됐어요. 다시 시도해 주세요!',
    zh: '😵 哎呀，出了点问题，请重试！',
    it: '😵 Ops, qualcosa è andato storto. Riprova!',
  },

  // ----------------------------------------------------------
  // /setup
  // ----------------------------------------------------------
  setupChannelDesc: {
    de: 'Kanal für die Liste (optional, Standard: aktueller Kanal)',
    en: 'Channel for the list (optional, defaults to this channel)',
    fr: 'Salon pour la liste (optionnel, par défaut ce salon)',
    es: 'Canal para la lista (opcional, por defecto este canal)',
    pt: 'Canal para a lista (opcional, padrão: este canal)',
    ru: 'Канал для списка (необязательно, по умолчанию текущий)',
    ja: 'リスト用チャンネル（省略可、デフォルトはこのチャンネル）',
    ko: '목록용 채널(선택 사항, 기본값: 현재 채널)',
    zh: '列表频道（可选，默认为当前频道）',
    it: 'Canale per la lista (facoltativo, predefinito: questo canale)',
  },
  setupLangDesc: {
    de: 'Sprache der Geburtstagsliste',
    en: 'Language of the birthday list',
    fr: 'Langue de la liste d’anniversaires',
    es: 'Idioma de la lista de cumpleaños',
    pt: 'Idioma da lista de aniversários',
    ru: 'Язык списка дней рождения',
    ja: '誕生日リストの言語',
    ko: '생일 목록의 언어',
    zh: '生日列表的语言',
    it: 'Lingua della lista dei compleanni',
  },
  setupSuccess: {
    de: '🎉 Alles eingerichtet! Die Geburtstagsliste wurde in {channel} erstellt.',
    en: '🎉 All set up! The birthday list was created in {channel}.',
    fr: '🎉 Tout est prêt ! La liste d’anniversaires a été créée dans {channel}.',
    es: '🎉 ¡Todo listo! La lista de cumpleaños se creó en {channel}.',
    pt: '🎉 Tudo pronto! A lista de aniversários foi criada em {channel}.',
    ru: '🎉 Всё готово! Список дней рождения создан в {channel}.',
    ja: '🎉 設定完了！誕生日リストを {channel} に作成しました。',
    ko: '🎉 설정 완료! {channel}에 생일 목록을 만들었어요.',
    zh: '🎉 设置完成！生日列表已在{channel}中创建。',
    it: '🎉 Tutto pronto! La lista dei compleanni è stata creata in {channel}.',
  },
  setupFoundOld: {
    de: '🔎 Ich habe eine bestehende Liste gefunden – ihre Einträge werden übernommen.',
    en: '🔎 I found an existing list – its entries will be carried over.',
    fr: '🔎 J’ai trouvé une liste existante – ses entrées seront reprises.',
    es: '🔎 Encontré una lista existente: sus entradas se transferirán.',
    pt: '🔎 Encontrei uma lista existente – as entradas serão transferidas.',
    ru: '🔎 Я нашёл существующий список – его записи будут перенесены.',
    ja: '🔎 既存のリストを見つけました。エントリーを引き継ぎます。',
    ko: '🔎 기존 목록을 찾았어요. 항목을 옮겨 올게요.',
    zh: '🔎 找到了现有列表——条目将被迁移。',
    it: '🔎 Ho trovato una lista esistente – le voci verranno trasferite.',
  },
  setupMigrated: {
    de: '📦 {count} bestehende Geburtstage wurden übernommen.',
    en: '📦 {count} existing birthdays were carried over.',
    fr: '📦 {count} anniversaires existants ont été repris.',
    es: '📦 Se transfirieron {count} cumpleaños existentes.',
    pt: '📦 {count} aniversários existentes foram transferidos.',
    ru: '📦 Перенесено {count} существующих дней рождения.',
    ja: '📦 既存の誕生日 {count} 件を引き継ぎました。',
    ko: '📦 기존 생일 {count}개를 옮겼어요.',
    zh: '📦 已迁移{count}个现有生日。',
    it: '📦 {count} compleanni esistenti sono stati trasferiti.',
  },
  setupLangBad: {
    de: '⛔ Bitte wähle eine gültige Sprache aus den Vorschlägen.',
    en: '⛔ Please pick a valid language from the suggestions.',
    fr: '⛔ Choisis une langue valide dans les suggestions.',
    es: '⛔ Elige un idioma válido de las sugerencias.',
    pt: '⛔ Escolha um idioma válido nas sugestões.',
    ru: '⛔ Выбери допустимый язык из предложенных.',
    ja: '⛔ 提案の中から有効な言語を選んでください。',
    ko: '⛔ 제안 중에서 유효한 언어를 선택하세요.',
    zh: '⛔ 请从建议中选择有效的语言。',
    it: '⛔ Scegli una lingua valida dai suggerimenti.',
  },

  // ----------------------------------------------------------
  // /admin_set_birthday
  // ----------------------------------------------------------
  adminSetUserDesc: {
    de: 'Der Nutzer, dessen Geburtstag gesetzt wird',
    en: 'The user whose birthday will be set',
    fr: 'L’utilisateur dont on définit l’anniversaire',
    es: 'El usuario cuyo cumpleaños se fijará',
    pt: 'O usuário cujo aniversário será definido',
    ru: 'Пользователь, которому устанавливается день рождения',
    ja: '誕生日を設定するユーザー',
    ko: '생일을 설정할 사용자',
    zh: '要设置生日的用户',
    it: 'L’utente di cui impostare il compleanno',
  },
  adminModalTitle: {
    de: 'Geburtstag für {user} setzen',
    en: 'Set birthday for {user}',
    fr: 'Définir l’anniversaire de {user}',
    es: 'Fijar cumpleaños de {user}',
    pt: 'Definir aniversário de {user}',
    ru: 'Установить день рождения для {user}',
    ja: '{user} の誕生日を設定',
    ko: '{user}님의 생일 설정',
    zh: '为{user}设置生日',
    it: 'Imposta il compleanno di {user}',
  },
  adminSetSuccess: {
    de: '✅ Geburtstag von {user} wurde auf **{date}** gesetzt.',
    en: '✅ {user}’s birthday was set to **{date}**.',
    fr: '✅ L’anniversaire de {user} a été fixé au **{date}**.',
    es: '✅ El cumpleaños de {user} se fijó en **{date}**.',
    pt: '✅ O aniversário de {user} foi definido para **{date}**.',
    ru: '✅ День рождения {user} установлен на **{date}**.',
    ja: '✅ {user} の誕生日を **{date}** に設定しました。',
    ko: '✅ {user}님의 생일을 **{date}**(으)로 설정했어요.',
    zh: '✅ 已将{user}的生日设置为**{date}**。',
    it: '✅ Il compleanno di {user} è stato impostato su **{date}**.',
  },
  errUserGone: {
    de: '⛔ Diesen Nutzer konnte ich auf dem Server nicht finden.',
    en: '⛔ I couldn’t find this user on the server.',
    fr: '⛔ Je n’ai pas trouvé cet utilisateur sur le serveur.',
    es: '⛔ No pude encontrar a este usuario en el servidor.',
    pt: '⛔ Não consegui encontrar este usuário no servidor.',
    ru: '⛔ Я не нашёл этого пользователя на сервере.',
    ja: '⛔ このサーバーでそのユーザーを見つけられませんでした。',
    ko: '⛔ 서버에서 이 사용자를 찾지 못했어요.',
    zh: '⛔ 我在服务器上找不到该用户。',
    it: '⛔ Non ho trovato questo utente sul server.',
  },

  // ----------------------------------------------------------
  // /admin_set_bot_profile
  // ----------------------------------------------------------
  profileImageDesc: {
    de: 'Welches Bild soll verwendet werden?',
    en: 'Which image should be used?',
    fr: 'Quelle image doit être utilisée ?',
    es: '¿Qué imagen se debe usar?',
    pt: 'Qual imagem deve ser usada?',
    ru: 'Какое изображение использовать?',
    ja: 'どの画像を使いますか？',
    ko: '어떤 이미지를 사용할까요?',
    zh: '使用哪张图片？',
    it: 'Quale immagine deve essere usata?',
  },
  profileSet: {
    de: '🖼️ Profilbild geändert: {choice}',
    en: '🖼️ Profile picture changed: {choice}',
    fr: '🖼️ Image de profil modifiée : {choice}',
    es: '🖼️ Foto de perfil cambiada: {choice}',
    pt: '🖼️ Foto de perfil alterada: {choice}',
    ru: '🖼️ Аватар изменён: {choice}',
    ja: '🖼️ プロフィール画像を変更しました: {choice}',
    ko: '🖼️ 프로필 사진을 변경했어요: {choice}',
    zh: '🖼️ 头像已更改：{choice}',
    it: '🖼️ Immagine del profilo cambiata: {choice}',
  },
  profileChoiceStandard: {
    de: 'Standard-Profilbild',
    en: 'Standard profile picture',
    fr: 'Image de profil standard',
    es: 'Foto de perfil estándar',
    pt: 'Foto de perfil padrão',
    ru: 'Стандартный аватар',
    ja: '標準プロフィール画像',
    ko: '기본 프로필 사진',
    zh: '标准头像',
    it: 'Immagine del profilo standard',
  },
  profileChoiceServer: {
    de: 'Server-Profilbild',
    en: 'Server profile picture',
    fr: 'Image du serveur',
    es: 'Foto del servidor',
    pt: 'Foto do servidor',
    ru: 'Аватар сервера',
    ja: 'サーバーの画像',
    ko: '서버 사진',
    zh: '服务器头像',
    it: 'Immagine del server',
  },
  profileChoiceOwner: {
    de: 'Profilbild des Server-Owners',
    en: 'Server owner’s profile picture',
    fr: 'Image du propriétaire du serveur',
    es: 'Foto del propietario del servidor',
    pt: 'Foto do dono do servidor',
    ru: 'Аватар владельца сервера',
    ja: 'サーバー所有者の画像',
    ko: '서버 소유자 사진',
    zh: '服务器所有者头像',
    it: 'Immagine del proprietario del server',
  },
  errAvatar: {
    de: '⛔ Das Profilbild konnte nicht geändert werden: {error}',
    en: '⛔ Couldn’t change the profile picture: {error}',
    fr: '⛔ Impossible de modifier l’image de profil : {error}',
    es: '⛔ No se pudo cambiar la foto de perfil: {error}',
    pt: '⛔ Não foi possível alterar a foto de perfil: {error}',
    ru: '⛔ Не удалось изменить аватар: {error}',
    ja: '⛔ プロフィール画像を変更できませんでした: {error}',
    ko: '⛔ 프로필 사진을 변경하지 못했어요: {error}',
    zh: '⛔ 无法更改头像：{error}',
    it: '⛔ Impossibile cambiare l’immagine del profilo: {error}',
  },
  errAvatarPerms: {
    de: '⛔ Dem Bot fehlt die Berechtigung „Nickname ändern“. Gib dem Bot diese Berechtigung (oder Administrator-Rechte) und versuche es dann erneut.',
    en: '⛔ The bot is missing the “Change Nickname” permission. Grant that permission (or Administrator) to the bot, then try again.',
    fr: '⛔ Il manque au bot la permission « Changer le pseudo ». Accordez-lui cette permission (ou Administrateur), puis réessayez.',
    es: '⛔ Al bot le falta el permiso «Cambiar apodo». Concédele ese permiso (o Administrador) e inténtalo de nuevo.',
    pt: '⛔ O bot não tem a permissão «Alterar apelido». Conceda-lhe essa permissão (ou Administrador) e tente novamente.',
    ru: '⛔ У бота нет права «Изменить никнейм». Дайте боту это право (или «Администратор») и повторите попытку.',
    ja: '⛔ ボットに「ニックネームの変更」権限がありません。この権限（または管理者）を付与してから、もう一度お試しください。',
    ko: '⛔ 봇에게 "닉네임 변경하기" 권한이 없어요. 해당 권한(또는 관리자)을 부여한 뒤 다시 시도해 주세요.',
    zh: '⛔ 机器人缺少“更改昵称”权限。请为机器人授予该权限（或管理员权限）后重试。',
    it: '⛔ Al bot manca l’autorizzazione «Cambia nickname». Concedigliela (o Amministratore) e riprova.',
  },
  errServerNoIcon: {
    de: '⛔ Dieser Server hat kein eigenes Profilbild.',
    en: '⛔ This server has no profile picture of its own.',
    fr: '⛔ Ce serveur n’a pas d’image de profil.',
    es: '⛔ Este servidor no tiene foto de perfil propia.',
    pt: '⛔ Este servidor não tem foto de perfil própria.',
    ru: '⛔ У этого сервера нет собственного аватара.',
    ja: '⛔ このサーバーにはプロフィール画像がありません。',
    ko: '⛔ 이 서버에는 프로필 사진이 없어요.',
    zh: '⛔ 此服务器没有自己的头像。',
    it: '⛔ Questo server non ha un’immagine del profilo.',
  },

  // ----------------------------------------------------------
  // Tägliche Geburtstags-Glückwünsche
  // ----------------------------------------------------------
  bdayCongratsTitle: {
    de: '🎂 Alles Gute zum Geburtstag!',
    en: '🎂 Happy birthday!',
    fr: '🎂 Joyeux anniversaire !',
    es: '🎂 ¡Feliz cumpleaños!',
    pt: '🎂 Feliz aniversário!',
    ru: '🎂 С днём рождения!',
    ja: '🎂 お誕生日おめでとう！',
    ko: '🎂 생일 축하해요!',
    zh: '🎂 生日快乐！',
    it: '🎂 Buon compleanno!',
  },
  bdayCongratsBody: {
    de: 'Heute hat {user} Geburtstag! Sag deinen Glückwunsch! 🥳',
    en: 'Today is {user}’s birthday! Send your wishes! 🥳',
    fr: 'C’est l’anniversaire de {user} aujourd’hui ! Envoie tes vœux ! 🥳',
    es: '¡Hoy es el cumpleaños de {user}! ¡Envía tus deseos! 🥳',
    pt: 'Hoje é o aniversário de {user}! Envie seus desejos! 🥳',
    ru: 'Сегодня день рождения у {user}! Отправь свои пожелания! 🥳',
    ja: '今日は {user} の誕生日！お祝いの言葉を送ろう！🥳',
    ko: '오늘은 {user}님의 생일이에요! 축하 인사를 보내세요! 🥳',
    zh: '今天是{user}的生日！送上你的祝福吧！🥳',
    it: 'Oggi è il compleanno di {user}! Invia i tuoi auguri! 🥳',
  },
  congratsField: {
    de: '🎉 Glückwünsche ({count})',
    en: '🎉 Wishes ({count})',
    fr: '🎉 Vœux ({count})',
    es: '🎉 Deseos ({count})',
    pt: '🎉 Desejos ({count})',
    ru: '🎉 Пожелания ({count})',
    ja: '🎉 お祝いの言葉 ({count})',
    ko: '🎉 축하 메시지 ({count})',
    zh: '🎉 祝福 ({count})',
    it: '🎉 Auguri ({count})',
  },
  congratsMore: {
    de: '… und {count} weitere',
    en: '… and {count} more',
    fr: '… et {count} autres',
    es: '… y {count} más',
    pt: '… e mais {count}',
    ru: '… и ещё {count}',
    ja: '…他 {count} 人',
    ko: '… 외 {count}명',
    zh: '…还有{count}人',
    it: '… e altri {count}',
  },
  cannotWishSelf: {
    de: '🙈 Du kannst dir nicht selbst zum Geburtstag gratulieren!',
    en: '🙈 You cannot wish yourself a happy birthday!',
    fr: '🙈 Tu ne peux pas te souhaiter toi-même un joyeux anniversaire !',
    es: '🙈 ¡No puedes felicitarte a ti mismo por tu cumpleaños!',
    pt: '🙈 Você não pode desejar feliz aniversário a si mesmo!',
    ru: '🙈 Нельзя поздравлять самого себя с днём рождения!',
    ja: '🙈 自分自身の誕生日をお祝いすることはできません！',
    ko: '🙈 자신의 생일을 직접 축하할 수는 없어요!',
    zh: '🙈 你不能祝自己生日快乐！',
    it: '🙈 Non puoi fare gli auguri di compleanno a te stesso!',
  },
  alreadyWished: {
    de: '💛 Du hast {user} bereits gratuliert!',
    en: '💛 You already wished {user}!',
    fr: '💛 Tu as déjà félicité {user} !',
    es: '💛 ¡Ya felicitaste a {user}!',
    pt: '💛 Você já parabenizou {user}!',
    ru: '💛 Ты уже поздравил {user}!',
    ja: '💛 すでに {user} をお祝いしました！',
    ko: '💛 이미 {user}님에게 축하했어요!',
    zh: '💛 你已经祝福过{user}了！',
    it: '💛 Hai già fatto gli auguri a {user}!',
  },
  wished: {
    de: '🎉 Du hast {user} gratuliert!',
    en: '🎉 You wished {user}!',
    fr: '🎉 Tu as félicité {user} !',
    es: '🎉 ¡Has felicitado a {user}!',
    pt: '🎉 Você parabenizou {user}!',
    ru: '🎉 Ты поздравил {user}!',
    ja: '🎉 {user} をお祝いしました！',
    ko: '🎉 {user}님에게 축하했어요!',
    zh: '🎉 你已祝福{user}！',
    it: '🎉 Hai fatto gli auguri a {user}!',
  },
  congratsExpired: {
    de: '⏰ Die Gratulations-Zeit für {user} ist vorbei (nur 24 Stunden).',
    en: '⏰ The wishing window for {user} has closed (24 hours only).',
    fr: '⏰ La fenêtre de félicitations pour {user} est terminée (24 heures seulement).',
    es: '⏰ La ventana de felicitaciones para {user} ha cerrado (solo 24 horas).',
    pt: '⏰ A janela de parabéns para {user} fechou (apenas 24 horas).',
    ru: '⏰ Окно поздравлений для {user} закрыто (только 24 часа).',
    ja: '⏰ {user} へのお祝い期間は終了しました（24時間のみ）。',
    ko: '⏰ {user}님에게 축하할 수 있는 시간이 지났어요(24시간만 가능).',
    zh: '⏰ 对{user}的祝福时间已结束（仅24小时）。',
    it: '⏰ Il periodo di auguri per {user} è terminato (solo 24 ore).',
  },

  // ----------------------------------------------------------
  // /help
  // ----------------------------------------------------------
  helpTitle: {
    de: '📖 Hilfe & Befehle',
    en: '📖 Help & Commands',
    fr: '📖 Aide et commandes',
    es: '📖 Ayuda y comandos',
    pt: '📖 Ajuda e comandos',
    ru: '📖 Помощь и команды',
    ja: '📖 ヘルプ＆コマンド',
    ko: '📖 도움말 및 명령어',
    zh: '📖 帮助与命令',
    it: '📖 Aiuto e comandi',
  },
  helpDesc: {
    de: 'Hier findest du alle Befehle des Geburtstags-Bots: 👇',
    en: 'Here are all the birthday bot’s commands: 👇',
    fr: 'Voici toutes les commandes du bot d’anniversaires : 👇',
    es: 'Aquí tienes todos los comandos del bot de cumpleaños: 👇',
    pt: 'Aqui estão todos os comandos do bot de aniversários: 👇',
    ru: 'Вот все команды бота дней рождения: 👇',
    ja: '誕生日ボットの全コマンドはこちら👇',
    ko: '생일 봇의 모든 명령어는 다음과 같아요 👇',
    zh: '以下是生日机器人的所有命令👇',
    it: 'Ecco tutti i comandi del bot compleanni: 👇',
  },
  helpSetup: {
    de: 'Richtet die Geburtstagsliste ein (Channel + Sprache).',
    en: 'Sets up the birthday list (channel + language).',
    fr: 'Configure la liste d’anniversaires (salon + langue).',
    es: 'Configura la lista de cumpleaños (canal + idioma).',
    pt: 'Configura a lista de aniversários (canal + idioma).',
    ru: 'Настраивает список дней рождения (канал + язык).',
    ja: '誕生日リストを設定します（チャンネル＋言語）。',
    ko: '생일 목록을 설정해요(채널 + 언어).',
    zh: '设置生日列表（频道+语言）。',
    it: 'Configura la lista dei compleanni (canale + lingua).',
  },
  helpSetLanguage: {
    de: 'Ändert die Sprache der bestehenden Liste. Nur Admins und erst nach /setup.',
    en: 'Changes the language of the existing list. Admins only, after /setup.',
    fr: 'Change la langue de la liste existante. Admins uniquement, après /setup.',
    es: 'Cambia el idioma de la lista existente. Solo admins y después de /setup.',
    pt: 'Altera o idioma da lista existente. Somente admins e após /setup.',
    ru: 'Меняет язык существующего списка. Только для админов и после /setup.',
    ja: '既存リストの言語を変更します。管理者のみ、/setup後。',
    ko: '기존 목록의 언어를 변경해요. 관리자 전용, /setup 후에.',
    zh: '更改现有列表的语言。仅限管理员，需先使用 /setup。',
    it: 'Cambia la lingua della lista esistente. Solo admin, dopo /setup.',
  },
  helpSetChannel: {
    de: 'Verschiebt die bestehende Liste in einen anderen Kanal. Nur Admins und erst nach /setup.',
    en: 'Moves the existing list to another channel. Admins only, after /setup.',
    fr: 'Déplace la liste existante vers un autre salon. Admins uniquement, après /setup.',
    es: 'Mueve la lista existente a otro canal. Solo admins y después de /setup.',
    pt: 'Move a lista existente para outro canal. Somente admins e após /setup.',
    ru: 'Перемещает существующий список в другой канал. Только для админов и после /setup.',
    ja: '既存リストを別のチャンネルへ移動します。管理者のみ、/setup後。',
    ko: '기존 목록을 다른 채널로 옮겨요. 관리자 전용, /setup 후에.',
    zh: '将现有列表移动到另一个频道。仅限管理员，需先使用 /setup。',
    it: 'Sposta la lista esistente in un altro canale. Solo admin, dopo /setup.',
  },
  helpSetBirthdayRole: {
    de: 'Legt die Rolle fest, die Geburtstagskinder 24 Stunden erhalten. Nur Admins und erst nach /setup.',
    en: 'Sets the role birthday users receive for 24 hours. Admins only, after /setup.',
    fr: 'Définit le rôle offert aux personnes fêtées pendant 24 h. Admins uniquement, après /setup.',
    es: 'Fija el rol que reciben los cumpleañeros durante 24 h. Solo admins y después de /setup.',
    pt: 'Define o cargo que os aniversariantes recebem por 24h. Somente admins e após /setup.',
    ru: 'Задаёт роль, которую именинники получают на 24 часа. Только для админов и после /setup.',
    ja: '誕生日の人に24時間付与するロールを設定します。管理者のみ、/setup後。',
    ko: '생일인 사람이 24시간 동안 받는 역할을 설정해요. 관리자 전용, /setup 후에.',
    zh: '设置寿星可获得24小时的身份组。仅限管理员，需先使用 /setup。',
    it: 'Imposta il ruolo che i festeggiati ricevono per 24 ore. Solo admin, dopo /setup.',
  },
  helpSetProfile: {
    de: 'Ändert das Profilbild des Bots auf diesem Server.',
    en: 'Changes the bot’s profile picture on this server.',
    fr: 'Modifie l’image de profil du bot sur ce serveur.',
    es: 'Cambia la foto de perfil del bot en este servidor.',
    pt: 'Altera a foto de perfil do bot neste servidor.',
    ru: 'Меняет аватар бота на этом сервере.',
    ja: 'このサーバーでのボットのプロフィール画像を変更します。',
    ko: '이 서버에서 봇의 프로필 사진을 변경해요.',
    zh: '更改机器人在此服务器上的头像。',
    it: 'Cambia l’immagine del profilo del bot su questo server.',
  },
  helpAdminSet: {
    de: 'Setzt den Geburtstag eines anderen Nutzers (nur Admins).',
    en: 'Sets another user’s birthday (admins only).',
    fr: 'Définit l’anniversaire d’un autre utilisateur (admins uniquement).',
    es: 'Fija el cumpleaños de otro usuario (solo admins).',
    pt: 'Define o aniversário de outro usuário (somente admins).',
    ru: 'Устанавливает день рождения другого пользователя (только для админов).',
    ja: '他のユーザーの誕生日を設定します（管理者のみ）。',
    ko: '다른 사용자의 생일을 설정해요(관리자 전용).',
    zh: '设置其他用户的生日（仅限管理员）。',
    it: 'Imposta il compleanno di un altro utente (solo admin).',
  },
  helpHelp: {
    de: 'Zeigt diese Übersicht an.',
    en: 'Shows this overview.',
    fr: 'Affiche cet aperçu.',
    es: 'Muestra esta vista general.',
    pt: 'Mostra esta visão geral.',
    ru: 'Показывает этот обзор.',
    ja: 'この概要を表示します。',
    ko: '이 개요를 보여줘요.',
    zh: '显示此概览。',
    it: 'Mostra questa panoramica.',
  },
  helpAdminPanel: {
    de: 'Owner-Panel (nur im DM mit dem Bot-Owner).',
    en: 'Owner panel (DM with the bot owner only).',
    fr: 'Panneau propriétaire (MP avec le propriétaire uniquement).',
    es: 'Panel del propietario (solo en DM con el propietario del bot).',
    pt: 'Painel do dono (somente no DM com o dono do bot).',
    ru: 'Панель владельца (только в ЛС с владельцем бота).',
    ja: 'オーナーパネル（ボット所有者とのDMのみ）。',
    ko: '소유자 패널(봇 소유자와의 DM에서만).',
    zh: '所有者面板（仅限与机器人所有者的私聊）。',
    it: 'Pannello proprietario (solo in DM con il proprietario del bot).',
  },

  // ----------------------------------------------------------
  // Events (/event create|delete) + Geburtstagsrolle
  // ----------------------------------------------------------
  setupRoleDesc: {
    de: 'Geburtstagsrolle: bekommt das Geburtstagskind 24h (optional)',
    en: 'Birthday role: the birthday person gets it for 24h (optional)',
    fr: 'Rôle d’anniversaire : offert 24 h à la personne fêtée (optionnel)',
    es: 'Rol de cumpleaños: el cumpleañero lo recibe 24 h (opcional)',
    pt: 'Cargo de aniversário: o aniversariante fica com ele 24h (opcional)',
    ru: 'Роль именинника: выдаётся на 24 часа (необязательно)',
    ja: '誕生日ロール：誕生日の人に24時間付与（任意）',
    ko: '생일 역할: 생일인 사람에게 24시간 부여(선택 사항)',
    zh: '生日身份组：寿星可获得24小时（可选）',
    it: 'Ruolo compleanno: lo riceve per 24 ore (opzionale)',
  },
  setupRoleSet: {
    de: 'Zusätzlich festgelegt: die Geburtstagsrolle {role} – jeder bekommt sie zu seinem Geburtstag für 24 Stunden. 🎖️',
    en: 'Also set: the birthday role {role} – everyone gets it on their birthday for 24 hours. 🎖️',
    fr: 'En plus : le rôle d’anniversaire {role} – chacun le reçoit 24 h pour son anniversaire. 🎖️',
    es: 'Además: el rol de cumpleaños {role} – cada uno lo recibe 24 h en su cumpleaños. 🎖️',
    pt: 'Também definido: o cargo de aniversário {role} – cada um o recebe por 24h no aniversário. 🎖️',
    ru: 'Дополнительно: роль именинника {role} – каждый получает её на 24 часа в свой день рождения. 🎖️',
    ja: '追加設定：誕生日ロール {role} – 誕生日の人に24時間付与されます。🎖️',
    ko: '추가 설정: 생일 역할 {role} – 생일인 사람에게 24시간 지급돼요. 🎖️',
    zh: '另外设置：生日身份组 {role} – 每位寿星当天可获得24小时。🎖️',
    it: 'Inoltre: il ruolo compleanno {role} – ognuno lo riceve per 24 ore il giorno del compleanno. 🎖️',
  },
  errRoleBad: {
    de: '⛔ Diese Rolle kann ich nicht verwalten! Meine höchste Rolle muss ÜBER der Geburtstagsrolle liegen und ich brauche „Rollen verwalten“.',
    en: '⛔ I cannot manage that role! My highest role must be ABOVE the birthday role and I need “Manage Roles”.',
    fr: '⛔ Je ne peux pas gérer ce rôle ! Mon rôle le plus haut doit être AU-DESSUS et il me faut « Gérer les rôles ».',
    es: '⛔ ¡No puedo gestionar ese rol! Mi rol más alto debe estar POR ENCIMA y necesito «Gestionar roles».',
    pt: '⛔ Não consigo gerenciar esse cargo! Meu maior cargo deve estar ACIMA e preciso de «Gerenciar cargos».',
    ru: '⛔ Не могу управлять этой ролью! Моя высшая роль должна быть ВЫШЕ, и нужно право «Управление ролями».',
    ja: '⛔ そのロールは管理できません！私の最高ロールがその上にあり、「ロールの管理」権限が必要です。',
    ko: '⛔ 그 역할은 관리할 수 없어요! 내 최고 역할이 그보다 위에 있어야 하고 “역할 관리” 권한이 필요해요.',
    zh: '⛔ 我无法管理该身份组！我的最高身份组必须在其上方，且需要“管理身份组”权限。',
    it: '⛔ Non riesco a gestire quel ruolo! Il mio ruolo più alto deve stare SOPRA e mi serve «Gestisci ruoli».',
  },
  helpEvent: {
    de: 'Erstellt oder löscht ein Event (Auswahl: create/delete). Nur für Admins – max. 5 Events.',
    en: 'Creates or deletes an event (choice: create/delete). Admins only – max. 5 events.',
    fr: 'Crée ou supprime un événement (choix : create/delete). Admins uniquement – max. 5 événements.',
    es: 'Crea o borra un evento (opción: create/delete). Solo admins – máx. 5 eventos.',
    pt: 'Cria ou apaga um evento (escolha: create/delete). Só admins – máx. 5 eventos.',
    ru: 'Создаёт или удаляет событие (выбор: create/delete). Только для админов – макс. 5 событий.',
    ja: 'イベントを作成・削除します（create/delete を選択）。管理者のみ・最大5件。',
    ko: '이벤트를 만들거나 삭제해요(create/delete 선택). 관리자 전용 – 최대 5개.',
    zh: '创建或删除活动（选择 create/delete）。仅限管理员——最多5个。',
    it: 'Crea o elimina un evento (scelta: create/delete). Solo admin – max. 5 eventi.',
  },
  eventActionDesc: {
    de: 'Was soll passieren? create oder delete',
    en: 'What should happen? create or delete',
    fr: 'Que faire ? create ou delete',
    es: '¿Qué hacer? create o delete',
    pt: 'O que fazer? create ou delete',
    ru: 'Что сделать? create или delete',
    ja: '何をしますか？ create または delete',
    ko: '무엇을 할까요? create 또는 delete',
    zh: '要做什么？create 或 delete',
    it: 'Cosa fare? create o delete',
  },
  eventModalTitle: {
    de: '🚀 Event eintragen',
    en: '🚀 Add event',
    fr: '🚀 Ajouter un événement',
    es: '🚀 Añadir evento',
    pt: '🚀 Adicionar evento',
    ru: '🚀 Добавить событие',
    ja: '🚀 イベントを追加',
    ko: '🚀 이벤트 추가',
    zh: '🚀 添加活动',
    it: '🚀 Aggiungi evento',
  },
  eventNameLabel: {
    de: 'Name des Events (z.B. Sommerfest)',
    en: 'Event name (e.g. Summer Party)',
    fr: 'Nom de l’événement (ex. Fête d’été)',
    es: 'Nombre del evento (ej. Fiesta)',
    pt: 'Nome do evento (ex. Festa)',
    ru: 'Название события (напр. Летний фест)',
    ja: 'イベント名（例： 夏祭り）',
    ko: '이벤트 이름(예: 여름 축제)',
    zh: '活动名称（如 夏日庆典）',
    it: 'Nome dell’evento (es. Festa)',
  },
  eventNamePlaceholder: {
    de: 'Wie heißt das Event? Max. 45 Zeichen.',
    en: 'What is it called? Max. 45 characters.',
    fr: 'Comment s’appelle-t-il ? Max. 45 caractères.',
    es: '¿Cómo se llama? Máx. 45 caracteres.',
    pt: 'Como se chama? Máx. 45 caracteres.',
    ru: 'Как называется? Макс. 45 символов.',
    ja: '名前は？ 最大45文字。',
    ko: '이름이 뭐예요? 최대 45자.',
    zh: '叫什么名字？最多45个字符。',
    it: 'Come si chiama? Max. 45 caratteri.',
  },
  eventInvalidName: {
    de: '⛔ Bitte gib einen gültigen Event-Namen an (1–45 Zeichen, ohne * | @).',
    en: '⛔ Please give a valid event name (1–45 characters, no * | @).',
    fr: '⛔ Donne un nom d’événement valide (1–45 caractères, sans * | @).',
    es: '⛔ Indica un nombre de evento válido (1–45 caracteres, sin * | @).',
    pt: '⛔ Dê um nome de evento válido (1–45 caracteres, sem * | @).',
    ru: '⛔ Укажи допустимое название события (1–45 символов, без * | @).',
    ja: '⛔ 有効なイベント名を入力してね（1〜45文字、* | @ なし）。',
    ko: '⛔ 올바른 이벤트 이름을 입력하세요(1~45자, * | @ 제외).',
    zh: '⛔ 请输入有效的活动名称（1–45个字符，不含 * | @）。',
    it: '⛔ Inserisci un nome evento valido (1–45 caratteri, senza * | @).',
  },
  eventConfirmBody: {
    de: 'Soll das Event {name} am **{date}** eingetragen werden? Um 0 Uhr an dem Tag sage ich allen Bescheid!',
    en: 'Should the event {name} on **{date}** be added to the list? I’ll announce it at midnight that day!',
    fr: 'Faut-il inscrire l’événement {name} le **{date}** à la liste ? Je l’annoncerai à minuit ce jour-là !',
    es: '¿Añado el evento {name} el **{date}** a la lista? ¡Lo anunciaré a medianoche ese día!',
    pt: 'Adiciono o evento {name} em **{date}** à lista? Aviso à meia-noite nesse dia!',
    ru: 'Добавить событие {name} на **{date}** в список? Я объявлю о нём в полночь!',
    ja: 'イベント {name}（**{date}**）をリストに追加しますか？ 当日の0時にお知らせするよ！',
    ko: '이벤트 {name}(**{date}**)을 목록에 추가할까요? 당일 자정에 알려 드릴게요!',
    zh: '要把活动 {name}（**{date}**）加入列表吗？当天零点我会通知大家！',
    it: 'Aggiungo l’evento {name} il **{date}** alla lista? Lo annuncerò a mezzanotte di quel giorno!',
  },
  eventCreated: {
    de: '🚀 Das Event {name} am **{date}** ist eingetragen! Es steht jetzt mit in der Liste. 🎉',
    en: '🚀 The event {name} on **{date}** is saved! It’s in the list now. 🎉',
    fr: '🚀 L’événement {name} le **{date}** est enregistré ! Il est dans la liste maintenant. 🎉',
    es: '🚀 ¡El evento {name} el **{date}** está guardado! Ya está en la lista. 🎉',
    pt: '🚀 O evento {name} em **{date}** está salvo! Já está na lista. 🎉',
    ru: '🚀 Событие {name} на **{date}** сохранено! Оно уже в списке. 🎉',
    ja: '🚀 イベント {name}（**{date}**）を登録したよ！リストに入っています。🎉',
    ko: '🚀 이벤트 {name}(**{date}**)이 저장됐어요! 이제 목록에 있어요. 🎉',
    zh: '🚀 活动 {name}（**{date}**）已保存！现在已在列表中。🎉',
    it: '🚀 L’evento {name} il **{date}** è salvato! Ora è nella lista. 🎉',
  },
  eventDeleted: {
    de: '🗑️ Das Event {name} wurde gelöscht!',
    en: '🗑️ The event {name} has been deleted!',
    fr: '🗑️ L’événement {name} a été supprimé !',
    es: '🗑️ ¡El evento {name} ha sido borrado!',
    pt: '🗑️ O evento {name} foi excluído!',
    ru: '🗑️ Событие {name} удалено!',
    ja: '🗑️ イベント {name} を削除しました！',
    ko: '🗑️ 이벤트 {name}이 삭제됐어요!',
    zh: '🗑️ 活动 {name} 已删除！',
    it: '🗑️ L’evento {name} è stato eliminato!',
  },
  eventLimit: {
    de: '⛔ Maximal {max} Events können gleichzeitig eingetragen sein! Lösche erst eins mit /event delete.',
    en: '⛔ Max. {max} events can be saved at once! Delete one first with /event delete.',
    fr: '⛔ {max} événements max. en même temps ! Supprimes-en un d’abord avec /event delete.',
    es: '⛔ ¡Máx. {max} eventos a la vez! Borra uno antes con /event delete.',
    pt: '⛔ Máx. {max} eventos de uma vez! Apague um antes com /event delete.',
    ru: '⛔ Максимум {max} событий одновременно! Сначала удали одно через /event delete.',
    ja: '⛔ イベントは最大 {max} 件まで！先に /event delete で1件削除してね。',
    ko: '⛔ 이벤트는 최대 {max}개까지 동시에 등록할 수 있어요! /event delete로 먼저 하나 삭제하세요.',
    zh: '⛔ 最多只能同时有 {max} 个活动！请先用 /event delete 删除一个。',
    it: '⛔ Max. {max} eventi alla volta! Eliminane prima uno con /event delete.',
  },
  eventNoEvents: {
    de: 'ℹ️ Es sind noch keine Events eingetragen. Mit /event create legst du eins an!',
    en: 'ℹ️ No events saved yet. Create one with /event create!',
    fr: 'ℹ️ Aucun événement pour le moment. Crées-en un avec /event create !',
    es: 'ℹ️ Aún no hay eventos. ¡Crea uno con /event create!',
    pt: 'ℹ️ Ainda não há eventos. Crie um com /event create!',
    ru: 'ℹ️ Событий пока нет. Создай одно через /event create!',
    ja: 'ℹ️ まだイベントがありません。/event create で追加しよう！',
    ko: 'ℹ️ 아직 등록된 이벤트가 없어요. /event create로 추가하세요!',
    zh: 'ℹ️ 还没有活动。用 /event create 创建一个吧！',
    it: 'ℹ️ Ancora nessun evento. Creane uno con /event create!',
  },
  eventSelectPlaceholder: {
    de: 'Event zum Löschen auswählen …',
    en: 'Pick the event to delete …',
    fr: 'Choisis l’événement à supprimer …',
    es: 'Elige el evento a borrar …',
    pt: 'Escolha o evento para apagar …',
    ru: 'Выбери событие для удаления …',
    ja: '削除するイベントを選んでね …',
    ko: '삭제할 이벤트를 선택하세요 …',
    zh: '选择要删除的活动……',
    it: 'Scegli l’evento da eliminare …',
  },
  eventDeleteTitle: {
    de: '🗑️ Event löschen',
    en: '🗑️ Delete event',
    fr: '🗑️ Supprimer un événement',
    es: '🗑️ Borrar evento',
    pt: '🗑️ Apagar evento',
    ru: '🗑️ Удалить событие',
    ja: '🗑️ イベントを削除',
    ko: '🗑️ 이벤트 삭제',
    zh: '🗑️ 删除活动',
    it: '🗑️ Elimina evento',
  },
  eventCongratsTitle: {
    de: '🚀 Heute findet ein Event statt!',
    en: '🚀 An event is happening today!',
    fr: '🚀 Un événement a lieu aujourd’hui !',
    es: '🚀 ¡Hoy hay un evento!',
    pt: '🚀 Hoje acontece um evento!',
    ru: '🚀 Сегодня состоится событие!',
    ja: '🚀 今日イベントがあるよ！',
    ko: '🚀 오늘 이벤트가 있어요!',
    zh: '🚀 今天有活动！',
    it: '🚀 Oggi c’è un evento!',
  },
  eventCongratsBody: {
    de: 'Heute findet das Event {name} statt! Habt ihr Interesse?',
    en: 'Today the event {name} is happening! Are you interested?',
    fr: 'Aujourd’hui a lieu l’événement {name} ! Ça vous intéresse ?',
    es: '¡Hoy tiene lugar el evento {name}! ¿Os interesa?',
    pt: 'Hoje acontece o evento {name}! Têm interesse?',
    ru: 'Сегодня пройдёт событие {name}! Вам интересно?',
    ja: '今日はイベント {name} があるよ！ 興味ある？',
    ko: '오늘 이벤트 {name}이(가) 있어요! 관심 있나요?',
    zh: '今天活动 {name} 开始了！你们有兴趣吗？',
    it: 'Oggi si tiene l’evento {name}! Vi interessa?',
  },
  eventInterestedField: {
    de: '🙋 Interessenten ({count})',
    en: '🙋 Interested ({count})',
    fr: '🙋 Intéressés ({count})',
    es: '🙋 Interesados ({count})',
    pt: '🙋 Interessados ({count})',
    ru: '🙋 Заинтересованы ({count})',
    ja: '🙋 興味あり ({count})',
    ko: '🙋 관심 있음 ({count})',
    zh: '🙋 感兴趣（{count}）',
    it: '🙋 Interessati ({count})',
  },
  btnEventInterested: {
    de: 'Interessant! 😂',
    en: 'Interesting! 😂',
    fr: 'Intéressant ! 😂',
    es: '¡Interesante! 😂',
    pt: 'Interessante! 😂',
    ru: 'Интересно! 😂',
    ja: '気になる！ 😂',
    ko: '흥미로워요! 😂',
    zh: '有意思！ 😂',
    it: 'Interessante! 😂',
  },
  eventAlreadyInterested: {
    de: '💛 Du bist bei {name} schon als Interessent eingetragen!',
    en: '💛 You already marked yourself as interested in {name}!',
    fr: '💛 Tu t’es déjà déclaré intéressé par {name} !',
    es: '💛 ¡Ya te marcaste como interesado en {name}!',
    pt: '💛 Você já se marcou como interessado em {name}!',
    ru: '💛 Ты уже отметился как заинтересованный в {name}!',
    ja: '💛 すでに {name} に興味あり登録済みだよ！',
    ko: '💛 이미 {name}에 관심 있다고 했어요!',
    zh: '💛 你已经对 {name} 表示过感兴趣了！',
    it: '💛 Ti sei già segnato come interessato a {name}!',
  },
  eventInterestedDone: {
    de: '🙌 Notiert! Du bist bei {name} als Interessent dabei!',
    en: '🙌 Noted! You’re in as interested for {name}!',
    fr: '🙌 Noté ! Tu es inscrit comme intéressé pour {name} !',
    es: '🙌 ¡Anotado! Estás como interesado en {name}!',
    pt: '🙌 Anotado! Você está como interessado em {name}!',
    ru: '🙌 Записал! Ты в списке заинтересованных для {name}!',
    ja: '🙌 メモったよ！{name} の興味ありリストに入った！',
    ko: '🙌 기록했어요! {name}에 관심 있음으로 등록됐어요!',
    zh: '🙌 记下了！你对 {name} 感兴趣！',
    it: '🙌 Segnato! Sei tra gli interessati per {name}!',
  },
  eventInterestClosed: {
    de: '⏰ Das Event {name} ist vorbei – Interesse kann nicht mehr gemeldet werden.',
    en: '⏰ The event {name} is over – no more sign-ups possible.',
    fr: '⏰ L’événement {name} est terminé – plus d’inscriptions possibles.',
    es: '⏰ El evento {name} ya pasó – ya no se puede apuntar nadie.',
    pt: '⏰ O evento {name} já passou – não dá mais para se inscrever.',
    ru: '⏰ Событие {name} уже прошло – больше нельзя записаться.',
    ja: '⏰ イベント {name} は終わったよ – もう登録できません。',
    ko: '⏰ 이벤트 {name}은(는) 지났어요 – 더 이상 신청할 수 없어요.',
    zh: '⏰ 活动 {name} 已结束——不能再报名了。',
    it: '⏰ L’evento {name} è finito – non ci si può più iscrivere.',
  },

  // Combined birthday/event message (multiple on same day)
  combinedTitle: {
    de: '🎉 Heute wird gefeiert!',
    en: '🎉 Today we celebrate!',
    fr: '🎉 On fête aujourd’hui !',
    es: '🎉 ¡Hoy celebramos!',
    pt: '🎉 Hoje é dia de festa!',
    ru: '🎉 Сегодня празднуем!',
    ja: '🎉 今日はお祝いだよ！',
    ko: '🎉 오늘은 축하하는 날!',
    zh: '🎉 今天一起庆祝！',
    it: '🎉 Oggi si festeggia!',
  },
  combinedDesc: {
    de: 'Heute haben mehrere Geburtstag oder es finden Events statt – schaut vorbei! 🥳',
    en: 'Multiple birthdays or events today – check them out! 🥳',
    fr: 'Plusieurs anniversaires ou événements aujourd’hui – jetez un œil ! 🥳',
    es: 'Varios cumpleaños o eventos hoy – ¡échales un vistazo! 🥳',
    pt: 'Vários aniversários ou eventos hoje – confiram! 🥳',
    ru: 'Сегодня несколько дней рождения или событий – загляните! 🥳',
    ja: '今日は誕生日やイベントが盛りだくさん – チェックしてね！🥳',
    ko: '오늘은 생일과 이벤트가 많아요 – 확인해 보세요! 🥳',
    zh: '今天有多个生日或活动——快来看看吧！🥳',
    it: 'Oggi ci sono più compleanni o eventi – date un’occhiata! 🥳',
  },

  // ----------------------------------------------------------
  // Unregistered Birthday Reminder (/ping_unregistered)
  // ----------------------------------------------------------
  pingUnregisteredHelp: {
    de: 'Erinnert alle ohne Geburtstagseintrag per DM (nur Admins, nach /setup).',
    en: 'Reminds everyone without a birthday entry via DM (admins only, after /setup).',
    fr: 'Rappelle à tous ceux sans anniversaire par DM (admins, après /setup).',
    es: 'Recuerda por DM a los que no tienen cumpleaños registrado (solo admins, tras /setup).',
    pt: 'Lembra por DM quem não tem aniversário registrado (só admins, após /setup).',
    ru: 'Напоминает всем без дня рождения в ЛС (только админы, после /setup).',
    ja: '誕生日未登録の全員にDMでリマインドします（管理者のみ、/setup後）。',
    ko: '생일이 등록되지 않은 모두에게 DM으로 알립니다 (관리자 전용, /setup 이후).',
    zh: '通过私信提醒所有未登记生日的人（仅管理员，需先 /setup）。',
    it: 'Ricorda via DM a chi non ha il compleanno registrato (solo admin, dopo /setup).',
  },
  pingUnregisteredModalTitle: {
    de: 'Unerfasste Mitglieder erinnern',
    en: 'Remind unregistered members',
    fr: 'Rappeler les non-inscrits',
    es: 'Recordar a los no registrados',
    pt: 'Lembrar não registrados',
    ru: 'Напомнить незарегистрированным',
    ja: '未登録メンバーにリマインド',
    ko: '미등록 멤버에게 알리기',
    zh: '提醒未登记成员',
    it: 'Ricorda ai non registrati',
  },
  pingUnregisteredModalLabel: {
    de: 'Nachricht an die nicht eingetragenen Mitglieder',
    en: 'Message to unregistered members',
    fr: 'Message aux membres non inscrits',
    es: 'Mensaje para los miembros no registrados',
    pt: 'Mensagem para os não registrados',
    ru: 'Сообщение незарегистрированным',
    ja: '未登録メンバーへのメッセージ',
    ko: '미등록 멤버에게 보낼 메시지',
    zh: '发送给未登记成员的消息',
    it: 'Messaggio ai non registrati',
  },
  pingUnregisteredExample: {
    de: 'Hey! 👋 Du hast deinen Geburtstag auf unserem Server noch nicht eingetragen. Klick unter der Geburtstagsliste auf „Geburtstag eintragen“ und trag dich ein – damit wir an deinem Ehrentag gemeinsam feiern können! 🎂🎉',
    en: 'Hey! 👋 You haven’t added your birthday on our server yet. Click “Add birthday” under the birthday list and add it – so we can celebrate together! 🎂🎉',
    fr: 'Salut ! 👋 Tu n’as pas encore ajouté ton anniversaire. Clique sur « Ajouter mon anniversaire » sous la liste ! 🎂🎉',
    es: '¡Hola! 👋 Aún no has añadido tu cumpleaños. ¡Haz clic en “Añadir cumpleaños” debajo de la lista! 🎂🎉',
    pt: 'Olá! 👋 Você ainda não adicionou seu aniversário. Clique em “Adicionar aniversário” abaixo da lista! 🎂🎉',
    ru: 'Привет! 👋 Ты ещё не добавил свой день рождения. Нажми «Добавить день рождения» под списком! 🎂🎉',
    ja: 'やあ！ 👋 まだ誕生日を登録してないよ。下のリストの「誕生日を登録」を押してね！ 🎂🎉',
    ko: '안녕! 👋 아직 생일을 등록하지 않았어요. 목록 아래의 “생일 등록”을 눌러 추가해 주세요! 🎂🎉',
    zh: '嗨！👋 你还没有登记生日。点击生日列表下的“添加生日”来添加吧！🎂🎉',
    it: 'Ciao! 👋 Non hai ancora aggiunto il tuo compleanno. Clicca su “Aggiungi compleanno” sotto la lista! 🎂🎉',
  },
  pingUnregisteredNeedSetup: {
    de: '⚠️ Es gibt noch keine Geburtstagsliste. Bitte nutze zuerst **/setup**!',
    en: '⚠️ There is no birthday list yet. Please use **/setup** first!',
    fr: '⚠️ Aucune liste d’anniversaires. Utilise d’abord **/setup** !',
    es: '⚠️ No hay lista de cumpleaños. ¡Usa primero **/setup**!',
    pt: '⚠️ Não há lista de aniversários. Use **/setup** primeiro!',
    ru: '⚠️ Список дней рождения отсутствует. Сначала используй **/setup**!',
    ja: '⚠️ 誕生日リストがありません。先に **/setup** を使ってね！',
    ko: '⚠️ 생일 목록이 없어요. 먼저 **/setup**을 사용하세요!',
    zh: '⚠️ 还没有生日列表，请先使用 **/setup**！',
    it: '⚠️ Non c’è ancora una lista di compleanni. Usa prima **/setup**!',
  },
  pingUnregisteredNoMembers: {
    de: 'ℹ️ Jeder auf dem Server hat bereits einen Geburtstag eingetragen – nichts zu tun! 🎉',
    en: 'ℹ️ Everyone on the server already has a birthday entry – nothing to do! 🎉',
    fr: 'ℹ️ Tout le monde est déjà inscrit – rien à faire ! 🎉',
    es: 'ℹ️ Todos ya tienen su cumpleaños registrado – ¡nada que hacer! 🎉',
    pt: 'ℹ️ Todos já têm aniversário registrado – nada a fazer! 🎉',
    ru: 'ℹ️ У всех уже есть день рождения – делать нечего! 🎉',
    ja: 'ℹ️ 全員すでに登録済み – やることなし！ 🎉',
    ko: 'ℹ️ 모든 사람이 이미 생일을 등록했어요 – 할 일 없음! 🎉',
    zh: 'ℹ️ 服务器上的每个人都已登记生日——无需操作！🎉',
    it: 'ℹ️ Tutti hanno già registrato il compleanno – nulla da fare! 🎉',
  },
  pingUnregisteredAlreadyRunning: {
    de: '⏳ Es läuft bereits eine Erinnerungs-Aktion auf diesem Server. Bitte warte, bis sie fertig ist.',
    en: '⏳ A reminder campaign is already running on this server. Please wait until it finishes.',
    fr: '⏳ Une campagne de rappel est déjà en cours. Attends qu’elle se termine.',
    es: '⏳ Ya hay una campaña de recordatorio en curso. Espera a que termine.',
    pt: '⏳ Já tem uma campanha de lembrete rolando. Espere terminar.',
    ru: '⏳ На этом сервере уже идёт рассылка напоминаний. Подожди.',
    ja: '⏳ このサーバーではすでにリマインド送信中だよ。終わるまで待ってね。',
    ko: '⏳ 이 서버에서 이미 알림 캠페인이 진행 중이에요. 끝날 때까지 기다려 주세요.',
    zh: '⏳ 此服务器已有提醒任务在进行，请等它完成。',
    it: '⏳ È già in corso una campagna di promemoria. Aspetta che finisca.',
  },
  pingUnregisteredProgress: {
    de: '📨 DMs werden gesendet …\n\n{bar} **{percent}%**\n**{done}/{total}** Mitglieder bearbeitet\n\n✅ Erfolgreich: **{ok}**\n⛔ Fehlgeschlagen: **{failed}** (z. B. DMs blockiert)',
    en: '📨 Sending DMs …\n\n{bar} **{percent}%**\n**{done}/{total}** members processed\n\n✅ Succeeded: **{ok}**\n⛔ Failed: **{failed}** (e.g. DMs blocked)',
    fr: '📨 Envoi des DMs …\n\n{bar} **{percent}%**\n**{done}/{total}** membres traités\n\n✅ Réussis : **{ok}**\n⛔ Échecs : **{failed}**',
    es: '📨 Enviando DMs …\n\n{bar} **{percent}%**\n**{done}/{total}** miembros procesados\n\n✅ Correctos: **{ok}**\n⛔ Fallidos: **{failed}**',
    pt: '📨 Enviando DMs …\n\n{bar} **{percent}%**\n**{done}/{total}** membros processados\n\n✅ Sucesso: **{ok}**\n⛔ Falhas: **{failed}**',
    ru: '📨 Отправляю DM …\n\n{bar} **{percent}%**\n**{done}/{total}** участников обработано\n\n✅ Успешно: **{ok}**\n⛔ Ошибки: **{failed}**',
    ja: '📨 DM送信中…\n\n{bar} **{percent}%**\n**{done}/{total}** 人を処理\n\n✅ 成功: **{ok}**\n⛔ 失敗: **{failed}**',
    ko: '📨 DM 전송 중…\n\n{bar} **{percent}%**\n**{done}/{total}**명 처리됨\n\n✅ 성공: **{ok}**\n⛔ 실패: **{failed}**',
    zh: '📨 正在发送私信……\n\n{bar} **{percent}%**\n已处理 **{done}/{total}** 名成员\n\n✅ 成功：**{ok}**\n⛔ 失败：**{failed}**',
    it: '📨 Invio DM …\n\n{bar} **{percent}%**\n**{done}/{total}** membri elaborati\n\n✅ Riusciti: **{ok}**\n⛔ Errori: **{failed}**',
  },
  pingUnregisteredDone: {
    de: '✅ Fertig! **{total}** nicht erfasste Mitglieder bearbeitet\n\n✅ DM erfolgreich: **{ok}**\n⛔ Nicht erreichbar (z. B. DMs aus): **{failed}**',
    en: '✅ Done! **{total}** unregistered members processed\n\n✅ DM sent: **{ok}**\n⛔ Unreachable (e.g. DMs off): **{failed}**',
    fr: '✅ Terminé ! **{total}** membres non inscrits traités\n\n✅ DM envoyés : **{ok}**\n⛔ Injoignables : **{failed}**',
    es: '✅ ¡Listo! **{total}** miembros no registrados procesados\n\n✅ DM enviados: **{ok}**\n⛔ Inalcanzables: **{failed}**',
    pt: '✅ Pronto! **{total}** não registrados processados\n\n✅ DMs enviados: **{ok}**\n⛔ Inalcançáveis: **{failed}**',
    ru: '✅ Готово! Обработано: **{total}**\n\n✅ DM отправлено: **{ok}**\n⛔ Недоступны: **{failed}**',
    ja: '✅ 完了！ **{total}** 人の未登録メンバーを処理\n\n✅ DM送信: **{ok}**\n⛔ 届かない: **{failed}**',
    ko: '✅ 완료! **{total}**명의 미등록 멤버 처리됨\n\n✅ DM 전송: **{ok}**\n⛔ 연락 불가: **{failed}**',
    zh: '✅ 完成！已处理 **{total}** 名未登记成员\n\n✅ 私信成功：**{ok}**\n⛔ 无法联系：**{failed}**',
    it: '✅ Fatto! **{total}** non registrati elaborati\n\n✅ DM inviati: **{ok}**\n⛔ Irraggiungibili: **{failed}**',
  },

  // ----------------------------------------------------------
  // Owner-Admin-Panel (bewusst nur Deutsch)
  // ----------------------------------------------------------
  apTitle: { de: '🛠️ Admin Panel' },
  apServerListDesc: {
    de: 'Hier ist die Übersicht aller **{count}** Server, auf denen der Bot ist:\n\n{list}\n\n🔴 = Bot-Owner ist nicht auf dem Server\n\nWähle unten einen Server aus, um Details zu sehen.',
  },
  apNoServers: { de: '😢 Der Bot ist noch auf keinem Server. Zeit, Freunde einzuladen!' },
  apPage: { de: 'Seite {page} von {total}' },
  apSelectPlaceholder: { de: 'Server auswählen …' },
  apSelectLabel: { de: 'Server wählen' },
  apDetailTitle: { de: '🗂️ Server-Übersicht' },
  apDetailOwner: { de: '👑 **Owner:** {mention}' },
  apDetailName: { de: '🏷️ **Name:** {name}' },
  apDetailMembers: { de: '👥 **Mitglieder:** {count}' },
  apDetailSetup: { de: '📅 **Geburtstagsliste:** {status}' },
  apDetailBdays: { de: '🎂 **Eingetragene Geburtstage:** {count}' },
  apSetupYes: { de: '✅ Eingerichtet' },
  apSetupNo: { de: '❌ Nicht eingerichtet' },
  apBtnBack: { de: '◀ Zurück' },
  apBtnInvite: { de: '🔗 Einladung' },
  apBtnLeave: { de: '🚪 Verlassen' },
  apBtnRefresh: { de: '🔄 Aktualisieren' },
  apBtnPrev: { de: '◀' },
  apBtnNext: { de: '▶' },
  apLeaveAsk: { de: 'Sicher, dass der Bot **{name}** verlassen soll? Klicke erneut auf **Wirklich verlassen**.' },
  apBtnLeaveConfirm: { de: '🚪 Wirklich verlassen' },
  apBtnLeaveCancel: { de: '↩️ Abbrechen' },
  apInviteSent: { de: '🔗 Einladung erstellt – gültig **1 Stunde**, **1× nutzbar**!' },
  apInviteLink: { de: '**Einladungslink:** {url}' },
  apInviteFailed: { de: '⛔ Konnte keine Einladung erstellen: {error}' },
  apLeft: { de: '✅ Der Bot hat **{name}** verlassen.' },
  apJoinNotice: {
    de: '👋 **Neuer Server!**\n\n🏷️ **{name}**\n👥 **{members}** Mitglieder\n👑 **Owner:** {owner}\n\nSchau mal ins **/adminpanel** – da kannst du alles verwalten! 🛠️',
  },
  apInvalidGuild: { de: '⛔ Diesen Server konnte ich nicht finden.' },
  apNeedDm: { de: '⛔ Das Admin-Panel funktioniert nur im Privatchat mit dem Bot-Owner!' },
};

// ============================================================================
//  Hilfsfunktionen (i18n)
// ============================================================================

/** Übersetzt einen Key; fällt bei fehlender Sprache auf Deutsch zurück. */
function t(key, lang, vars = {}) {
  const entry = T[key];
  if (!entry) return `??${key}??`;
  let text = entry[lang] || entry.de || '';
  for (const [k, v] of Object.entries(vars)) {
    text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

/** Zeitzone einer Sprache, mit optionalem Env-Override (z. B. BIRTHDAY_BOT_TZ_EN). */
function tzOf(code) {
  const override = process.env[`BIRTHDAY_BOT_TZ_${String(code).toUpperCase()}`];
  return override || (LANGS[code] && LANGS[code].tz) || 'Europe/Berlin';
}

/** Formatiert einen Geburtstag sprachgerecht, z. B. „4. September“ oder „September 4“. */
function formatBirthday(day, month, lang) {
  const locale = (LANGS[lang] && LANGS[lang].locale) || 'en-US';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, day))
  );
}

/**
 * Formatiert den Countdown hinter einer Geburtstags-Erwähnung.
 * Für die meisten Sprachen reicht die Unterscheidung 1/mehrere; Russisch
 * benötigt zusätzlich die Formen für 2–4 und 5–20 (inkl. der Zehnerregeln).
 * 0 Tage = Heute.
 */
function formatDaysUntil(days, lang) {
  const count = Math.max(0, Math.round(Number(days) || 0));
  if (count === 0) return t('birthdayToday', lang);
  let category = count === 1 ? 'one' : 'other';

  if (lang === 'ru') {
    category = new Intl.PluralRules('ru').select(count);
  }

  const suffix = category[0].toUpperCase() + category.slice(1);
  const key = `birthdayInDays${suffix}`;
  return t(key, lang, { count });
}

/** Formatiert das aktuelle Datum (voll, inkl. Wochentag) in Sprache + Zeitzone. */
function formatToday(lang, date = new Date()) {
  const locale = (LANGS[lang] && LANGS[lang].locale) || 'en-US';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: tzOf(lang) }).format(date);
}

// --- Fuzzy-Monatserkennung ------------------------------------------------

function normalizeStr(s) {
  return String(s)
    .toLowerCase()
    .replace(/[\s.,\-/']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** Baut alle Erkennungsvarianten eines Monats in ALLEN 10 Sprachen. */
function monthVariants() {
  const variants = Array.from({ length: 12 }, () => []);
  for (const lang of Object.values(LANGS)) {
    for (let i = 0; i < 12; i++) {
      const n = i + 1;
      variants[i].push(
        String(n),
        String(n).padStart(2, '0'),
        `${n}.`,
        lang.months[i],
        lang.short[i],
        ...(lang.extra[i] || [])
      );
      if (lang.kanji) variants[i].push(lang.kanji[i]);
      if (lang.hangul) variants[i].push(lang.hangul[i]);
      if (lang.numeralSuffix) {
        variants[i].push(`${n}${lang.numeralSuffix}`, `${String(n).padStart(2, '0')}${lang.numeralSuffix}`);
      }
    }
  }
  return variants.map((list) => list.filter(Boolean));
}

const VARIANT_CACHE = monthVariants();

/**
 * Erkennt den Monat aus Zahlen ODER Wörtern in allen 10 Sprachen –
 * inklusive Tippfehlern. Es gewinnt IMMER das ähnlichste Wort
 * (Levenshtein-Score), egal wie kaputt die Eingabe ist.
 *
 * Rückgabe: { month, exact, fuzzy, score, variant, input } oder null.
 */
function matchMonth(raw) {
  const input = String(raw ?? '').trim();
  const n = normalizeStr(input);
  if (!n) return null;

  // Reine Zahlen: 9, 09, 9.
  if (/^\d{1,2}$/.test(n)) {
    const d = parseInt(n, 10);
    if (d >= 1 && d <= 12) return { month: d, exact: true, fuzzy: false, score: 1, variant: n, input };
  }

  let best = null;
  for (let i = 0; i < 12; i++) {
    for (const variant of VARIANT_CACHE[i]) {
      const score = similarity(n, normalizeStr(variant));
      if (!best || score > best.score) {
        best = { month: i + 1, score, variant, input };
      }
    }
  }
  if (!best) return null;

  const exact = best.score >= 0.99;
  return { month: best.month, exact, fuzzy: !exact, score: best.score, variant: best.variant, input };
}

/**
 * Unsere Sprach-Codes → Discord-Locale-Codes (für Command-Lokalisierung).
 * Discord akzeptiert z. B. „en-US“ aber kein nacktes „en“.
 */
const DISCORD_LOCALE = {
  de: 'de',
  en: 'en-US',
  fr: 'fr',
  es: 'es-ES',
  pt: 'pt-BR',
  ru: 'ru',
  ja: 'ja',
  ko: 'ko',
  zh: 'zh-CN',
  it: 'it',
};

/** Mappt die Discord-Client-Locale eines Nutzers auf unsere Sprach-Codes. */
const DISCORD_LOCALE_MAP = {
  de: 'de',
  'en-US': 'en',
  'en-GB': 'en',
  fr: 'fr',
  'es-ES': 'es',
  'pt-BR': 'pt',
  'pt-PT': 'pt',
  ru: 'ru',
  ja: 'ja',
  ko: 'ko',
  'zh-CN': 'zh',
  'zh-TW': 'zh',
  it: 'it',
};

function langFromDiscord(locale) {
  return DISCORD_LOCALE_MAP[locale] || 'en';
}

module.exports = {
  LANGS,
  T,
  t,
  tzOf,
  formatBirthday,
  formatDaysUntil,
  formatToday,
  matchMonth,
  langFromDiscord,
  DISCORD_LOCALE,
};
