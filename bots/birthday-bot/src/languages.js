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
  helpFooter: {
    de: '💡 Tipp: Klicke unten auf „Geburtstag eintragen“, um dich einzutragen!',
    en: '💡 Tip: click “Add birthday” below to add yours!',
    fr: '💡 Astuce : clique sur « Ajouter mon anniversaire » ci-dessous !',
    es: '💡 Consejo: ¡haz clic en «Añadir cumpleaños» abajo para añadir el tuyo!',
    pt: '💡 Dica: clique em «Adicionar aniversário» abaixo para adicionar o seu!',
    ru: '💡 Совет: нажми «Добавить день рождения» ниже, чтобы добавить свой!',
    ja: '💡 ヒント：下の「誕生日を登録」をクリックして登録しよう！',
    ko: '💡 팁: 아래의 「생일 등록」을 눌러 여러분의 생일을 등록하세요!',
    zh: '💡 提示：点击下方「添加生日」来添加你的生日！',
    it: '💡 Consiglio: clicca su «Aggiungi compleanno» qui sotto per aggiungere il tuo!',
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

/** Formatiert das aktuelle Datum (voll, inkl. Wochentag) in Sprache + Zeitzone. */
function formatToday(lang) {
  const locale = (LANGS[lang] && LANGS[lang].locale) || 'en-US';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: tzOf(lang) }).format(new Date());
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

module.exports = { LANGS, T, t, tzOf, formatBirthday, formatToday, matchMonth, langFromDiscord, DISCORD_LOCALE };
