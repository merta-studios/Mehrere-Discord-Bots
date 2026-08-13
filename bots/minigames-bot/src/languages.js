/** Alle sichtbaren Texte des Minigames-Bots in den 10 unterstützten Sprachen. */

const LANGS = {
  de: { name: 'Deutsch', names: { de: 'Deutsch', en: 'German', fr: 'Allemand', es: 'Alemán', pt: 'Alemão', ru: 'Немецкий', ja: 'ドイツ語', ko: '독일어', zh: '德语', it: 'Tedesco' }, flag: '🇩🇪' },
  en: { name: 'English', names: { de: 'Englisch', en: 'English', fr: 'Anglais', es: 'Inglés', pt: 'Inglês', ru: 'Английский', ja: '英語', ko: '영어', zh: '英语', it: 'Inglese' }, flag: '🇬🇧' },
  fr: { name: 'Français', names: { de: 'Französisch', en: 'French', fr: 'Français', es: 'Francés', pt: 'Francês', ru: 'Французский', ja: 'フランス語', ko: '프랑스어', zh: '法语', it: 'Francese' }, flag: '🇫🇷' },
  es: { name: 'Español', names: { de: 'Spanisch', en: 'Spanish', fr: 'Espagnol', es: 'Español', pt: 'Espanhol', ru: 'Испанский', ja: 'スペイン語', ko: '스페인어', zh: '西班牙语', it: 'Spagnolo' }, flag: '🇪🇸' },
  pt: { name: 'Português', names: { de: 'Portugiesisch', en: 'Portuguese', fr: 'Portugais', es: 'Portugués', pt: 'Português', ru: 'Португальский', ja: 'ポルトガル語', ko: '포르투갈어', zh: '葡萄牙语', it: 'Portoghese' }, flag: '🇧🇷' },
  ru: { name: 'Русский', names: { de: 'Russisch', en: 'Russian', fr: 'Russe', es: 'Ruso', pt: 'Russo', ru: 'Русский', ja: 'ロシア語', ko: '러시아어', zh: '俄语', it: 'Russo' }, flag: '🇷🇺' },
  ja: { name: '日本語', names: { de: 'Japanisch', en: 'Japanese', fr: 'Japonais', es: 'Japonés', pt: 'Japonês', ru: 'Японский', ja: '日本語', ko: '일본어', zh: '日语', it: 'Giapponese' }, flag: '🇯🇵' },
  ko: { name: '한국어', names: { de: 'Koreanisch', en: 'Korean', fr: 'Coréen', es: 'Coreano', pt: 'Coreano', ru: 'Корейский', ja: '韓国語', ko: '한국어', zh: '韩语', it: 'Coreano' }, flag: '🇰🇷' },
  zh: { name: '中文', names: { de: 'Chinesisch', en: 'Chinese', fr: 'Chinois', es: 'Chino', pt: 'Chinês', ru: 'Китайский', ja: '中国語', ko: '중국어', zh: '中文', it: 'Cinese' }, flag: '🇨🇳' },
  it: { name: 'Italiano', names: { de: 'Italienisch', en: 'Italian', fr: 'Italien', es: 'Italiano', pt: 'Italiano', ru: 'Итальянский', ja: 'イタリア語', ko: '이탈리아어', zh: '意大利语', it: 'Italiano' }, flag: '🇮🇹' },
};

const DISCORD_LOCALE = {
  de: 'de', en: 'en-US', fr: 'fr', es: 'es-ES', pt: 'pt-BR',
  ru: 'ru', ja: 'ja', ko: 'ko', zh: 'zh-CN', it: 'it',
};

const T = {
  cmdPlayDesc: {
    de: 'Fordere einen Spieler zu einem Minigame heraus', en: 'Challenge a player to a minigame', fr: 'Défie un joueur dans un mini-jeu', es: 'Desafía a un jugador a un minijuego', pt: 'Desafie alguém para um minigame', ru: 'Вызвать игрока на мини-игру', ja: 'プレイヤーにミニゲームを挑む', ko: '플레이어에게 미니게임 대결을 신청해요', zh: '向玩家发起小游戏挑战', it: 'Sfida un giocatore a un minigioco',
  },
  playGameDesc: {
    de: 'Welches Spiel möchtet ihr spielen?', en: 'Which game do you want to play?', fr: 'À quel jeu voulez-vous jouer ?', es: '¿A qué juego queréis jugar?', pt: 'Qual jogo vocês querem jogar?', ru: 'В какую игру вы хотите сыграть?', ja: 'どのゲームで遊びますか？', ko: '어떤 게임을 할까요?', zh: '你们想玩哪个游戏？', it: 'A quale gioco volete giocare?',
  },
  playOpponentDesc: {
    de: 'Wen möchtest du herausfordern?', en: 'Who do you want to challenge?', fr: 'Qui veux-tu défier ?', es: '¿A quién quieres desafiar?', pt: 'Quem você quer desafiar?', ru: 'Кого ты хочешь вызвать?', ja: '誰に挑戦しますか？', ko: '누구에게 도전할까요?', zh: '你想挑战谁？', it: 'Chi vuoi sfidare?',
  },
  cmdSetLanguageDesc: {
    de: 'Stellt die Bot-Sprache auf diesem Server ein', en: 'Sets the bot language for this server', fr: 'Définit la langue du bot sur ce serveur', es: 'Configura el idioma del bot en este servidor', pt: 'Define o idioma do bot neste servidor', ru: 'Выбрать язык бота на сервере', ja: 'このサーバーのBot言語を設定', ko: '이 서버의 봇 언어를 설정해요', zh: '设置此服务器的机器人语言', it: 'Imposta la lingua del bot nel server',
  },
  setLanguageDesc: {
    de: 'Welche Sprache soll der Bot sprechen?', en: 'Which language should the bot use?', fr: 'Quelle langue le bot doit-il utiliser ?', es: '¿Qué idioma debe usar el bot?', pt: 'Qual idioma o bot deve usar?', ru: 'На каком языке должен говорить бот?', ja: 'Botが使う言語', ko: '봇이 사용할 언어', zh: '机器人应使用哪种语言？', it: 'Quale lingua deve usare il bot?',
  },
  cmdProfileDesc: {
    de: 'Ändert das serverspezifische Profilbild des Bots', en: 'Changes the bot profile picture for this server', fr: 'Modifie la photo du bot pour ce serveur', es: 'Cambia la imagen del bot en este servidor', pt: 'Altera a foto do bot neste servidor', ru: 'Изменить аватар бота на этом сервере', ja: 'このサーバーでのBotアイコンを変更', ko: '이 서버의 봇 프로필 사진을 변경해요', zh: '更改机器人在此服务器的头像', it: 'Cambia la foto del bot in questo server',
  },
  profileImageDesc: {
    de: 'Welches Bild soll verwendet werden?', en: 'Which image should be used?', fr: 'Quelle image utiliser ?', es: '¿Qué imagen se debe usar?', pt: 'Qual imagem deve ser usada?', ru: 'Какое изображение использовать?', ja: '使用する画像', ko: '사용할 이미지', zh: '要使用哪张图片？', it: 'Quale immagine usare?',
  },
  cmdHelpDesc: {
    de: 'Zeigt alle Befehle und Spiele', en: 'Shows all commands and games', fr: 'Affiche toutes les commandes et jeux', es: 'Muestra todos los comandos y juegos', pt: 'Mostra todos os comandos e jogos', ru: 'Показать все команды и игры', ja: 'コマンドとゲームをすべて表示', ko: '모든 명령어와 게임을 보여줘요', zh: '显示所有命令和游戏', it: 'Mostra tutti i comandi e giochi',
  },
  cmdAdminPanelDesc: {
    de: 'Owner-Admin-Panel (nur im DM)', en: 'Owner admin panel (DM only)', fr: 'Panel administrateur du propriétaire (MP)', es: 'Panel del propietario (solo MD)', pt: 'Painel do proprietário (só DM)', ru: 'Панель владельца (только ЛС)', ja: 'オーナー管理パネル（DMのみ）', ko: '소유자 관리 패널 (DM 전용)', zh: '所有者管理面板（仅私聊）', it: 'Pannello del proprietario (solo DM)',
  },

  gameTtt: { de: 'Tic-Tac-Toe', en: 'Tic-Tac-Toe', fr: 'Morpion', es: 'Tres en raya', pt: 'Jogo da velha', ru: 'Крестики-нолики', ja: '三目並べ', ko: '틱택토', zh: '井字棋', it: 'Tris' },
  gameConnect4: { de: 'Vier Gewinnt', en: 'Connect Four', fr: 'Puissance 4', es: 'Conecta 4', pt: 'Ligue 4', ru: 'Четыре в ряд', ja: '四目並べ', ko: '사목', zh: '四子棋', it: 'Forza 4' },

  errGuildOnly: {
    de: '🚫 Minigames können nur auf einem Server gespielt werden.', en: '🚫 Minigames can only be played in a server.', fr: '🚫 Les mini-jeux ne sont disponibles que sur un serveur.', es: '🚫 Los minijuegos solo se pueden jugar en un servidor.', pt: '🚫 Minigames só podem ser jogados em um servidor.', ru: '🚫 Мини-игры доступны только на сервере.', ja: '🚫 ミニゲームはサーバー内でのみ遊べます。', ko: '🚫 미니게임은 서버에서만 플레이할 수 있어요.', zh: '🚫 小游戏只能在服务器中进行。', it: '🚫 I minigiochi si possono giocare solo in un server.',
  },
  errNoPermission: {
    de: '🛑 Dafür brauchst du Administrator-Rechte.', en: '🛑 You need administrator permission for that.', fr: '🛑 Il te faut la permission administrateur.', es: '🛑 Necesitas permisos de administrador.', pt: '🛑 Você precisa da permissão de administrador.', ru: '🛑 Нужны права администратора.', ja: '🛑 管理者権限が必要です。', ko: '🛑 관리자 권한이 필요해요.', zh: '🛑 你需要管理员权限。', it: '🛑 Serve il permesso di amministratore.',
  },
  errSelf: {
    de: '🪞 Gegen dich selbst? Such dir einen echten Gegner!', en: '🪞 Against yourself? Pick a real opponent!', fr: '🪞 Contre toi-même ? Choisis un vrai adversaire !', es: '🪞 ¿Contra ti mismo? ¡Elige un rival real!', pt: '🪞 Contra você mesmo? Escolha um adversário de verdade!', ru: '🪞 Играть с собой? Выбери настоящего соперника!', ja: '🪞 自分自身とは戦えません。相手を選んでね！', ko: '🪞 자기 자신과요? 진짜 상대를 골라주세요!', zh: '🪞 和自己对战？请选择一个真正的对手！', it: '🪞 Contro te stesso? Scegli un vero avversario!',
  },
  errBot: {
    de: '🤖 Bots spielen nicht mit – fordere einen Menschen heraus.', en: '🤖 Bots do not play—challenge a human.', fr: '🤖 Les bots ne jouent pas — défie un humain.', es: '🤖 Los bots no juegan; desafía a una persona.', pt: '🤖 Bots não jogam — desafie uma pessoa.', ru: '🤖 Боты не играют — вызови человека.', ja: '🤖 Botはプレイできません。人間に挑戦してね。', ko: '🤖 봇은 플레이하지 않아요. 사람에게 도전하세요.', zh: '🤖 机器人不参赛——请挑战真人。', it: '🤖 I bot non giocano: sfida una persona.',
  },
  errOpponentMissing: {
    de: '👻 Dieser Gegner ist nicht mehr auf dem Server.', en: '👻 That opponent is no longer in this server.', fr: '👻 Cet adversaire n’est plus sur le serveur.', es: '👻 Ese rival ya no está en el servidor.', pt: '👻 Esse adversário não está mais no servidor.', ru: '👻 Этого соперника больше нет на сервере.', ja: '👻 その相手はもうサーバーにいません。', ko: '👻 그 상대는 더 이상 서버에 없어요.', zh: '👻 该对手已不在服务器中。', it: '👻 Questo avversario non è più nel server.',
  },
  errGeneric: {
    de: '💥 Das Spielfeld ist kurz explodiert. Versuch es nochmal!', en: '💥 The game board briefly exploded. Try again!', fr: '💥 Le plateau a explosé. Réessaie !', es: '💥 El tablero explotó un momento. ¡Inténtalo de nuevo!', pt: '💥 O tabuleiro explodiu. Tente de novo!', ru: '💥 Игровое поле взорвалось. Попробуй ещё раз!', ja: '💥 ゲーム盤が爆発しました。もう一度試してね！', ko: '💥 게임판이 잠깐 폭발했어요. 다시 해보세요!', zh: '💥 棋盘刚刚炸了一下，请重试！', it: '💥 Il tabellone è esploso. Riprova!',
  },
  errState: {
    de: '🧩 Dieser Spielstand ist nicht mehr lesbar. Starte mit **/play** neu.', en: '🧩 This game state can no longer be read. Start again with **/play**.', fr: '🧩 Cette partie est illisible. Recommence avec **/play**.', es: '🧩 Esta partida ya no se puede leer. Reinicia con **/play**.', pt: '🧩 Esta partida não pode mais ser lida. Reinicie com **/play**.', ru: '🧩 Состояние игры повреждено. Начни заново через **/play**.', ja: '🧩 ゲーム状態を読み取れません。**/play** でやり直してください。', ko: '🧩 게임 상태를 읽을 수 없어요. **/play**로 다시 시작하세요.', zh: '🧩 无法读取此对局，请用 **/play** 重新开始。', it: '🧩 La partita non è più leggibile. Ricomincia con **/play**.',
  },

  challengeTitle: { de: '🎮 NEUE BATTLE-ANFRAGE', en: '🎮 NEW BATTLE REQUEST', fr: '🎮 NOUVEAU DÉFI', es: '🎮 NUEVO DESAFÍO', pt: '🎮 NOVO DESAFIO', ru: '🎮 НОВЫЙ ВЫЗОВ', ja: '🎮 新しい対戦リクエスト', ko: '🎮 새로운 대결 신청', zh: '🎮 新的对战邀请', it: '🎮 NUOVA SFIDA' },
  challengeBody: {
    de: '{challenger} fordert {opponent} zu **{game}** heraus!\n\n> ⚡ {opponent}, traust du dich? Nimm die Herausforderung an und betritt die Arena.',
    en: '{challenger} challenges {opponent} to **{game}**!\n\n> ⚡ {opponent}, do you dare? Accept and enter the arena.',
    fr: '{challenger} défie {opponent} à **{game}** !\n\n> ⚡ {opponent}, oses-tu accepter et entrer dans l’arène ?',
    es: '¡{challenger} desafía a {opponent} a **{game}**!\n\n> ⚡ {opponent}, ¿te atreves? Acepta y entra en la arena.',
    pt: '{challenger} desafia {opponent} para **{game}**!\n\n> ⚡ {opponent}, aceita o desafio e entre na arena.',
    ru: '{challenger} вызывает {opponent} на **{game}**!\n\n> ⚡ {opponent}, принимаешь вызов? Выходи на арену.',
    ja: '{challenger} が {opponent} に **{game}** で挑戦！\n\n> ⚡ {opponent}、受けて立つ？アリーナへ！',
    ko: '{challenger}님이 {opponent}님에게 **{game}** 대결을 신청했어요!\n\n> ⚡ {opponent}, 도전을 받아 아레나에 입장하세요.',
    zh: '{challenger} 向 {opponent} 发起 **{game}** 挑战！\n\n> ⚡ {opponent}，敢接受挑战进入竞技场吗？',
    it: '{challenger} sfida {opponent} a **{game}**!\n\n> ⚡ {opponent}, accetti? Entra nell’arena.',
  },
  challengeDeadline: {
    de: '⏳ Antworte bis {deadline} – danach verfällt die Anfrage.', en: '⏳ Respond by {deadline}—after that, the request expires.', fr: '⏳ Réponds avant {deadline} — ensuite le défi expire.', es: '⏳ Responde antes de {deadline}; después caduca el desafío.', pt: '⏳ Responda até {deadline}; depois o desafio expira.', ru: '⏳ Ответь до {deadline}, затем вызов истечёт.', ja: '⏳ {deadline}までに返答しないと期限切れになります。', ko: '⏳ {deadline}까지 응답하지 않으면 만료돼요.', zh: '⏳ 请在{deadline}前回应，之后邀请将过期。', it: '⏳ Rispondi entro {deadline}, poi la sfida scade.',
  },
  btnAccept: { de: '⚔️ Herausforderung annehmen', en: '⚔️ Accept challenge', fr: '⚔️ Accepter le défi', es: '⚔️ Aceptar desafío', pt: '⚔️ Aceitar desafio', ru: '⚔️ Принять вызов', ja: '⚔️ 挑戦を受ける', ko: '⚔️ 도전 수락', zh: '⚔️ 接受挑战', it: '⚔️ Accetta la sfida' },
  btnDecline: { de: 'Ablehnen', en: 'Decline', fr: 'Refuser', es: 'Rechazar', pt: 'Recusar', ru: 'Отклонить', ja: '辞退する', ko: '거절', zh: '拒绝', it: 'Rifiuta' },
  notOpponent: { de: '🛡️ Nur der herausgeforderte Gegner darf darauf antworten.', en: '🛡️ Only the challenged opponent can respond.', fr: '🛡️ Seul l’adversaire défié peut répondre.', es: '🛡️ Solo el rival desafiado puede responder.', pt: '🛡️ Só o adversário desafiado pode responder.', ru: '🛡️ Ответить может только вызванный игрок.', ja: '🛡️ 挑戦された相手だけが返答できます。', ko: '🛡️ 도전받은 상대만 응답할 수 있어요.', zh: '🛡️ 只有被挑战的对手可以回应。', it: '🛡️ Solo l’avversario sfidato può rispondere.' },
  declinedTitle: { de: '🛡️ HERAUSFORDERUNG ABGELEHNT', en: '🛡️ CHALLENGE DECLINED', fr: '🛡️ DÉFI REFUSÉ', es: '🛡️ DESAFÍO RECHAZADO', pt: '🛡️ DESAFIO RECUSADO', ru: '🛡️ ВЫЗОВ ОТКЛОНЁН', ja: '🛡️ 挑戦は辞退されました', ko: '🛡️ 도전 거절됨', zh: '🛡️ 挑战已拒绝', it: '🛡️ SFIDA RIFIUTATA' },
  declinedBody: { de: '{opponent} möchte diesmal nicht gegen {challenger} antreten.', en: '{opponent} does not want to face {challenger} this time.', fr: '{opponent} ne souhaite pas affronter {challenger} cette fois.', es: '{opponent} no quiere enfrentarse a {challenger} esta vez.', pt: '{opponent} não quer enfrentar {challenger} desta vez.', ru: '{opponent} не хочет играть против {challenger} в этот раз.', ja: '{opponent} は今回は {challenger} との対戦を辞退しました。', ko: '{opponent}님이 이번에는 {challenger}님과 대결하지 않아요.', zh: '{opponent} 这次不想与 {challenger} 对战。', it: '{opponent} non vuole affrontare {challenger} questa volta.' },
  expiredTitle: { de: '⌛ BATTLE-ANFRAGE ABGELAUFEN', en: '⌛ BATTLE REQUEST EXPIRED', fr: '⌛ DÉFI EXPIRÉ', es: '⌛ DESAFÍO CADUCADO', pt: '⌛ DESAFIO EXPIRADO', ru: '⌛ ВЫЗОВ ИСТЁК', ja: '⌛ 対戦リクエスト期限切れ', ko: '⌛ 대결 신청 만료', zh: '⌛ 对战邀请已过期', it: '⌛ SFIDA SCADUTA' },
  expiredBody: { de: '{opponent} hat nicht rechtzeitig geantwortet. Startet bei Bedarf eine neue Runde mit **/play**.', en: '{opponent} did not respond in time. Start a new round with **/play**.', fr: '{opponent} n’a pas répondu à temps. Relance avec **/play**.', es: '{opponent} no respondió a tiempo. Inicia otra ronda con **/play**.', pt: '{opponent} não respondeu a tempo. Inicie outra rodada com **/play**.', ru: '{opponent} не ответил вовремя. Начните заново через **/play**.', ja: '{opponent} は時間内に返答しませんでした。**/play** で再挑戦できます。', ko: '{opponent}님이 제시간에 응답하지 않았어요. **/play**로 새로 시작하세요.', zh: '{opponent} 未及时回应。可使用 **/play** 重新发起。', it: '{opponent} non ha risposto in tempo. Ricomincia con **/play**.' },

  tttTitle: { de: '❌ TIC-TAC-TOE ⭕', en: '❌ TIC-TAC-TOE ⭕', fr: '❌ MORPION ⭕', es: '❌ TRES EN RAYA ⭕', pt: '❌ JOGO DA VELHA ⭕', ru: '❌ КРЕСТИКИ-НОЛИКИ ⭕', ja: '❌ 三目並べ ⭕', ko: '❌ 틱택토 ⭕', zh: '❌ 井字棋 ⭕', it: '❌ TRIS ⭕' },
  c4Title: { de: '🔴 VIER GEWINNT 🟡', en: '🔴 CONNECT FOUR 🟡', fr: '🔴 PUISSANCE 4 🟡', es: '🔴 CONECTA 4 🟡', pt: '🔴 LIGUE 4 🟡', ru: '🔴 ЧЕТЫРЕ В РЯД 🟡', ja: '🔴 四目並べ 🟡', ko: '🔴 사목 🟡', zh: '🔴 四子棋 🟡', it: '🔴 FORZA 4 🟡' },
  battleVs: { de: '{challenger}  **VS**  {opponent}', en: '{challenger}  **VS**  {opponent}', fr: '{challenger}  **VS**  {opponent}', es: '{challenger}  **VS**  {opponent}', pt: '{challenger}  **VS**  {opponent}', ru: '{challenger}  **VS**  {opponent}', ja: '{challenger}  **VS**  {opponent}', ko: '{challenger}  **VS**  {opponent}', zh: '{challenger}  **VS**  {opponent}', it: '{challenger}  **VS**  {opponent}' },
  turn: { de: '⚡ **Am Zug:** {player}', en: '⚡ **Your move:** {player}', fr: '⚡ **Au tour de :** {player}', es: '⚡ **Turno de:** {player}', pt: '⚡ **Vez de:** {player}', ru: '⚡ **Ходит:** {player}', ja: '⚡ **手番:** {player}', ko: '⚡ **차례:** {player}', zh: '⚡ **轮到：** {player}', it: '⚡ **Tocca a:** {player}' },
  c4Drop: { de: 'Wähle unten eine Spalte und lass deinen Chip fallen.', en: 'Choose a column below and drop your chip.', fr: 'Choisis une colonne ci-dessous pour lâcher ton jeton.', es: 'Elige una columna y deja caer tu ficha.', pt: 'Escolha uma coluna abaixo e solte sua peça.', ru: 'Выбери столбец и брось фишку.', ja: '下の列を選んでチップを落とそう。', ko: '아래에서 열을 골라 칩을 떨어뜨리세요.', zh: '选择下方的一列落下棋子。', it: 'Scegli una colonna e lascia cadere la pedina.' },
  notPlayer: { de: '🍿 Du bist nur Zuschauer bei diesem Battle.', en: '🍿 You are only a spectator in this battle.', fr: '🍿 Tu es seulement spectateur de ce duel.', es: '🍿 Solo eres espectador en esta batalla.', pt: '🍿 Você é apenas espectador nesta batalha.', ru: '🍿 Ты только зритель в этой игре.', ja: '🍿 あなたはこの対戦の観戦者です。', ko: '🍿 이 대결에서는 관전자예요.', zh: '🍿 你只是本场对战的观众。', it: '🍿 Sei solo spettatore in questa sfida.' },
  notTurn: { de: '⏱️ Noch nicht – dein Gegner ist gerade am Zug.', en: '⏱️ Not yet—your opponent is playing.', fr: '⏱️ Pas encore — c’est au tour de ton adversaire.', es: '⏱️ Aún no; es el turno de tu rival.', pt: '⏱️ Ainda não — é a vez do adversário.', ru: '⏱️ Ещё рано — сейчас ход соперника.', ja: '⏱️ まだです。相手の手番です。', ko: '⏱️ 아직 아니에요. 상대 차례예요.', zh: '⏱️ 还没轮到你——现在是对手的回合。', it: '⏱️ Non ancora: tocca al tuo avversario.' },
  cellTaken: { de: '🚧 Dieses Feld ist schon besetzt.', en: '🚧 That cell is already occupied.', fr: '🚧 Cette case est déjà occupée.', es: '🚧 Esa casilla ya está ocupada.', pt: '🚧 Essa casa já está ocupada.', ru: '🚧 Эта клетка уже занята.', ja: '🚧 そのマスはすでに埋まっています。', ko: '🚧 이미 사용된 칸이에요.', zh: '🚧 该格已经被占用。', it: '🚧 Questa casella è già occupata.' },
  columnFull: { de: '🚧 Diese Spalte ist voll – nimm eine andere.', en: '🚧 That column is full—choose another.', fr: '🚧 Cette colonne est pleine — choisis-en une autre.', es: '🚧 Esa columna está llena; elige otra.', pt: '🚧 Essa coluna está cheia — escolha outra.', ru: '🚧 Этот столбец заполнен — выбери другой.', ja: '🚧 その列は満杯です。別の列を選んでね。', ko: '🚧 그 열은 가득 찼어요. 다른 열을 고르세요.', zh: '🚧 该列已满，请选择其他列。', it: '🚧 Questa colonna è piena: scegline un’altra.' },
  noLongerActive: { de: '🏁 Dieses Battle ist bereits beendet.', en: '🏁 This battle has already ended.', fr: '🏁 Ce duel est déjà terminé.', es: '🏁 Esta batalla ya ha terminado.', pt: '🏁 Esta batalha já terminou.', ru: '🏁 Эта игра уже закончена.', ja: '🏁 この対戦はすでに終了しています。', ko: '🏁 이 대결은 이미 끝났어요.', zh: '🏁 本场对战已经结束。', it: '🏁 Questa sfida è già terminata.' },

  winnerTitle: { de: '🏆 BATTLE ENTSCHIEDEN', en: '🏆 BATTLE DECIDED', fr: '🏆 DUEL TERMINÉ', es: '🏆 BATALLA DECIDIDA', pt: '🏆 BATALHA DECIDIDA', ru: '🏆 БИТВА ОКОНЧЕНА', ja: '🏆 勝負あり', ko: '🏆 대결 종료', zh: '🏆 对战结束', it: '🏆 SFIDA DECISA' },
  winnerBody: { de: '## 👑 {winner} gewinnt!\n\nWas für ein Finish! {loser} muss sich diesmal geschlagen geben.', en: '## 👑 {winner} wins!\n\nWhat a finish! {loser} has to concede this time.', fr: '## 👑 {winner} gagne !\n\nQuelle fin ! {loser} doit s’incliner cette fois.', es: '## 👑 ¡{winner} gana!\n\n¡Qué final! {loser} debe aceptar la derrota esta vez.', pt: '## 👑 {winner} venceu!\n\nQue final! {loser} terá que aceitar a derrota desta vez.', ru: '## 👑 {winner} побеждает!\n\nВот это финал! {loser} уступает в этот раз.', ja: '## 👑 {winner} の勝利！\n\n見事な決着！今回は {loser} の敗北です。', ko: '## 👑 {winner}님 승리!\n\n멋진 마무리예요! 이번에는 {loser}님이 패배했어요.', zh: '## 👑 {winner} 获胜！\n\n精彩的终局！{loser} 本次遗憾落败。', it: '## 👑 Vince {winner}!\n\nChe finale! Stavolta {loser} deve arrendersi.' },
  drawTitle: { de: '🤝 UNENTSCHIEDEN', en: '🤝 DRAW', fr: '🤝 ÉGALITÉ', es: '🤝 EMPATE', pt: '🤝 EMPATE', ru: '🤝 НИЧЬЯ', ja: '🤝 引き分け', ko: '🤝 무승부', zh: '🤝 平局', it: '🤝 PAREGGIO' },
  drawBody: { de: 'Das Feld ist voll und niemand gibt nach. Starkes Battle!', en: 'The board is full and nobody gives in. Great battle!', fr: 'Le plateau est plein et personne ne cède. Beau duel !', es: 'El tablero está lleno y nadie cede. ¡Gran batalla!', pt: 'O tabuleiro está cheio e ninguém cede. Grande batalha!', ru: 'Поле заполнено, и никто не уступил. Отличная игра!', ja: '盤面が埋まり、どちらも譲らず。素晴らしい勝負！', ko: '보드가 가득 찼고 누구도 물러서지 않았어요. 멋진 대결!', zh: '棋盘已满，双方都不退让。精彩的对战！', it: 'Il tabellone è pieno e nessuno cede. Grande sfida!' },
  rematch: { de: '🔁 Lust auf eine Revanche? Startet sie direkt mit **/play**.', en: '🔁 Want a rematch? Start one with **/play**.', fr: '🔁 Une revanche ? Lance-la avec **/play**.', es: '🔁 ¿Revancha? Iníciala con **/play**.', pt: '🔁 Quer revanche? Comece com **/play**.', ru: '🔁 Хотите реванш? Запустите его через **/play**.', ja: '🔁 再戦する？**/play** ですぐ始められます。', ko: '🔁 재대결할까요? **/play**로 바로 시작하세요.', zh: '🔁 想再来一局？使用 **/play** 即可开始。', it: '🔁 Vuoi la rivincita? Avviala con **/play**.' },

  helpTitle: { de: '🎮 MINIGAMES BOT – BATTLE HUB', en: '🎮 MINIGAMES BOT – BATTLE HUB', fr: '🎮 BOT MINI-JEUX – ARÈNE', es: '🎮 BOT DE MINIJUEGOS – ARENA', pt: '🎮 BOT DE MINIGAMES – ARENA', ru: '🎮 БОТ МИНИ-ИГР – АРЕНА', ja: '🎮 ミニゲームBOT – バトルハブ', ko: '🎮 미니게임 봇 – 배틀 허브', zh: '🎮 小游戏机器人 – 对战中心', it: '🎮 BOT MINIGIOCHI – ARENA' },
  helpDesc: { de: 'Fordere Freunde heraus, nimm Battles an und kläre direkt im Channel, wer gewinnt.', en: 'Challenge friends, accept battles, and settle who wins right in the channel.', fr: 'Défie tes amis et découvre directement dans le salon qui gagne.', es: 'Desafía a tus amigos y decidid en el canal quién gana.', pt: 'Desafie amigos e descubra no canal quem vence.', ru: 'Вызывай друзей и выясняй победителя прямо в канале.', ja: '友達に挑戦し、チャンネルで勝者を決めよう。', ko: '친구에게 도전하고 채널에서 바로 승자를 가려보세요.', zh: '挑战好友，直接在频道中决出胜负。', it: 'Sfida gli amici e decidete nel canale chi vince.' },
  helpPlay: { de: 'Wähle **Tic-Tac-Toe** oder **Vier Gewinnt** und einen Gegner. Die gepingte Person hat eine Stunde Zeit, das Battle anzunehmen.', en: 'Choose **Tic-Tac-Toe** or **Connect Four** and an opponent. The pinged player has one hour to accept.', fr: 'Choisis le **Morpion** ou **Puissance 4** et un adversaire. Il a une heure pour accepter.', es: 'Elige **Tres en raya** o **Conecta 4** y un rival. Tiene una hora para aceptar.', pt: 'Escolha **Jogo da velha** ou **Ligue 4** e um adversário. Ele tem uma hora para aceitar.', ru: 'Выбери **Крестики-нолики** или **Четыре в ряд** и соперника. У него есть час на ответ.', ja: '**三目並べ**か**四目並べ**と相手を選択。相手は1時間以内に承認できます。', ko: '**틱택토** 또는 **사목**과 상대를 선택하세요. 상대는 1시간 안에 수락할 수 있어요.', zh: '选择**井字棋**或**四子棋**及对手。被挑战者有一小时接受。', it: 'Scegli **Tris** o **Forza 4** e un avversario. Ha un’ora per accettare.' },
  helpSetLanguage: { de: 'Ändert die Sprache aller zukünftigen Battles. Nur für Admins.', en: 'Changes the language of future battles. Admins only.', fr: 'Change la langue des prochains duels. Admins uniquement.', es: 'Cambia el idioma de futuras batallas. Solo admins.', pt: 'Altera o idioma das próximas batalhas. Só admins.', ru: 'Меняет язык будущих игр. Только для администраторов.', ja: '今後の対戦言語を変更します。管理者のみ。', ko: '앞으로의 대결 언어를 변경해요. 관리자 전용.', zh: '更改后续对战语言。仅限管理员。', it: 'Cambia la lingua delle prossime sfide. Solo admin.' },
  helpProfile: { de: 'Ändert das serverspezifische Profilbild des Bots. Nur für Admins.', en: 'Changes the server-specific bot picture. Admins only.', fr: 'Change la photo du bot sur ce serveur. Admins uniquement.', es: 'Cambia la imagen del bot en este servidor. Solo admins.', pt: 'Altera a foto do bot neste servidor. Só admins.', ru: 'Меняет аватар бота на сервере. Только для администраторов.', ja: 'サーバー固有のBotアイコンを変更。管理者のみ。', ko: '서버별 봇 프로필 사진을 변경해요. 관리자 전용.', zh: '更改机器人在本服务器的头像。仅限管理员。', it: 'Cambia la foto del bot nel server. Solo admin.' },
  helpHelp: { de: 'Zeigt genau diese Übersicht.', en: 'Shows this overview.', fr: 'Affiche cette vue d’ensemble.', es: 'Muestra este resumen.', pt: 'Mostra este resumo.', ru: 'Показывает эту справку.', ja: 'この一覧を表示します。', ko: '이 도움말을 보여줘요.', zh: '显示此概览。', it: 'Mostra questa panoramica.' },
  helpFooter: { de: '✨ Weitere Spiele können später modular ergänzt werden.', en: '✨ More games can be added later.', fr: '✨ D’autres jeux pourront être ajoutés plus tard.', es: '✨ Se podrán añadir más juegos después.', pt: '✨ Mais jogos poderão ser adicionados depois.', ru: '✨ Позже можно будет добавить другие игры.', ja: '✨ 今後さらにゲームを追加できます。', ko: '✨ 나중에 더 많은 게임을 추가할 수 있어요.', zh: '✨ 之后可以继续添加更多游戏。', it: '✨ Altri giochi potranno essere aggiunti in seguito.' },

  setLangUpdated: { de: '🌍 Sprache gespeichert: **{lang}**. Zukünftige Battles nutzen diese Sprache.', en: '🌍 Language saved: **{lang}**. Future battles will use it.', fr: '🌍 Langue enregistrée : **{lang}**. Les prochains duels l’utiliseront.', es: '🌍 Idioma guardado: **{lang}**. Las futuras batallas lo usarán.', pt: '🌍 Idioma salvo: **{lang}**. As próximas batalhas usarão esse idioma.', ru: '🌍 Язык сохранён: **{lang}**. Будущие игры будут на нём.', ja: '🌍 言語を **{lang}** に保存しました。今後の対戦で使用します。', ko: '🌍 언어 저장됨: **{lang}**. 앞으로의 대결에 사용돼요.', zh: '🌍 语言已保存：**{lang}**。后续对战将使用该语言。', it: '🌍 Lingua salvata: **{lang}**. Le prossime sfide la useranno.' },
  profileChoiceStandard: { de: 'Standardbild', en: 'Default image', fr: 'Image par défaut', es: 'Imagen predeterminada', pt: 'Imagem padrão', ru: 'Стандартное изображение', ja: '標準画像', ko: '기본 이미지', zh: '默认图片', it: 'Immagine predefinita' },
  profileChoiceServer: { de: 'Server-Icon', en: 'Server icon', fr: 'Icône du serveur', es: 'Icono del servidor', pt: 'Ícone do servidor', ru: 'Иконка сервера', ja: 'サーバーアイコン', ko: '서버 아이콘', zh: '服务器图标', it: 'Icona del server' },
  profileChoiceOwner: { de: 'Owner-Profilbild', en: 'Owner profile picture', fr: 'Photo du propriétaire', es: 'Imagen del propietario', pt: 'Foto do proprietário', ru: 'Аватар владельца', ja: 'オーナーのアイコン', ko: '소유자 프로필 사진', zh: '服务器主头像', it: 'Foto del proprietario' },
  profileSet: { de: '✅ Profilbild geändert: **{choice}**.', en: '✅ Profile picture changed: **{choice}**.', fr: '✅ Photo modifiée : **{choice}**.', es: '✅ Imagen cambiada: **{choice}**.', pt: '✅ Foto alterada: **{choice}**.', ru: '✅ Аватар изменён: **{choice}**.', ja: '✅ プロフィール画像を変更: **{choice}**。', ko: '✅ 프로필 사진 변경됨: **{choice}**.', zh: '✅ 头像已更改：**{choice}**。', it: '✅ Foto cambiata: **{choice}**.' },
  errServerNoIcon: { de: '🖼️ Dieser Server hat kein Icon.', en: '🖼️ This server has no icon.', fr: '🖼️ Ce serveur n’a pas d’icône.', es: '🖼️ Este servidor no tiene icono.', pt: '🖼️ Este servidor não tem ícone.', ru: '🖼️ У сервера нет иконки.', ja: '🖼️ このサーバーにはアイコンがありません。', ko: '🖼️ 이 서버에는 아이콘이 없어요.', zh: '🖼️ 此服务器没有图标。', it: '🖼️ Questo server non ha un’icona.' },
  errAvatarPerms: { de: '🔐 Mir fehlt die Berechtigung, mein Server-Profil zu ändern.', en: '🔐 I lack permission to change my server profile.', fr: '🔐 Je n’ai pas la permission de modifier mon profil.', es: '🔐 No tengo permiso para cambiar mi perfil.', pt: '🔐 Não tenho permissão para alterar meu perfil.', ru: '🔐 Нет права менять профиль на сервере.', ja: '🔐 サーバープロフィールを変更する権限がありません。', ko: '🔐 서버 프로필 변경 권한이 없어요.', zh: '🔐 我没有更改服务器资料的权限。', it: '🔐 Non ho il permesso di cambiare il profilo.' },
  errAvatar: { de: '💥 Profilbild konnte nicht geändert werden: {error}', en: '💥 Could not change the profile picture: {error}', fr: '💥 Impossible de changer la photo : {error}', es: '💥 No se pudo cambiar la imagen: {error}', pt: '💥 Não foi possível alterar a foto: {error}', ru: '💥 Не удалось изменить аватар: {error}', ja: '💥 プロフィール画像を変更できません: {error}', ko: '💥 프로필 사진을 변경하지 못했어요: {error}', zh: '💥 无法更改头像：{error}', it: '💥 Impossibile cambiare la foto: {error}' },

  // Owner-Panel ist wie bei den anderen Bots bewusst nur auf Deutsch.
  apNeedDm: { de: '🔒 Dieses Panel gibt es nur im Privatchat mit dem Bot-Owner.' },
  apTitle: { de: '🛰️ Minigames Owner-Panel' },
  apNoServers: { de: 'Der Bot ist aktuell auf keinem Server.' },
  apServerListDesc: { de: '**{count}** Server insgesamt:\n\n{list}' },
  apPage: { de: 'Seite {page}/{total}' },
  apSelectPlaceholder: { de: 'Server auswählen …' },
  apBtnPrev: { de: '◀' }, apBtnRefresh: { de: '🔄' }, apBtnNext: { de: '▶' },
  apDetailTitle: { de: '🔍 Server-Details' }, apDetailName: { de: '**Name:** {name}' },
  apDetailOwner: { de: '**Owner:** {mention}' }, apDetailMembers: { de: '**Mitglieder:** {count}' },
  apDetailGames: { de: '**Laufende Battles:** {count}' },
  apBtnBack: { de: '← Zurück' }, apBtnInvite: { de: '🔗 Einladung' }, apBtnLeave: { de: '🚪 Verlassen' },
  apBtnLeaveConfirm: { de: 'Ja, verlassen' }, apBtnLeaveCancel: { de: 'Abbrechen' },
  apLeaveAsk: { de: 'Soll der Bot **{name}** wirklich verlassen?' },
  apInviteSent: { de: 'Einladung erstellt (1 Stunde, einmal nutzbar):' }, apInviteLink: { de: '{url}' },
  apInviteFailed: { de: '❌ Einladung fehlgeschlagen: {error}' }, apLeft: { de: '✅ Server **{name}** verlassen.' },
  apJoinNotice: { de: 'Der Minigames-Bot wurde zu **{name}** hinzugefügt.\nMitglieder: **{members}**\nServer-Owner: {owner}' },
};

function t(key, lang = 'en', vars = {}) {
  const table = T[key] || {};
  let value = table[lang] ?? table.en ?? table.de ?? key;
  for (const [name, replacement] of Object.entries(vars)) {
    value = String(value).replaceAll(`{${name}}`, String(replacement));
  }
  return value;
}

function langFromDiscord(locale) {
  const value = String(locale || '').toLowerCase();
  if (value.startsWith('de')) return 'de';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('pt')) return 'pt';
  if (value.startsWith('ru')) return 'ru';
  if (value.startsWith('ja')) return 'ja';
  if (value.startsWith('ko')) return 'ko';
  if (value.startsWith('zh')) return 'zh';
  if (value.startsWith('it')) return 'it';
  return 'en';
}

module.exports = { LANGS, DISCORD_LOCALE, T, t, langFromDiscord };
