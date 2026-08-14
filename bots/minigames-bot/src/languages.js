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
    de: 'Optional: Wen möchtest du herausfordern? Ohne Angabe darf jeder antreten', en: 'Optional: who do you want to challenge? If empty, anyone can join', fr: 'Facultatif : qui veux-tu défier ? Sans réponse, tout le monde peut jouer', es: 'Opcional: ¿a quién desafías? Si lo dejas vacío, puede unirse cualquiera', pt: 'Opcional: quem você quer desafiar? Sem indicar, qualquer um pode entrar', ru: 'Необязательно: кого вызвать? Без выбора сыграть может любой', ja: '任意: 誰に挑戦しますか？未指定なら誰でも参加できます', ko: '선택: 누구에게 도전할까요? 비워두면 누구나 참여할 수 있어요', zh: '可选：你想挑战谁？留空则任何人都能加入', it: 'Facoltativo: chi vuoi sfidare? Se vuoto, può unirsi chiunque',
  },
  cmdCountingDesc: {
    de: 'Legt den Counting-Channel fest (Zählen ab 1)', en: 'Sets the counting channel (count starts at 1)', fr: 'Définit le salon de comptage (on démarre à 1)', es: 'Define el canal de conteo (empieza en 1)', pt: 'Define o canal de contagem (começa em 1)', ru: 'Назначить канал для счёта (начинаем с 1)', ja: 'カウントチャンネルを設定（1から数えます）', ko: '카운팅 채널을 설정해요 (1부터 시작)', zh: '设置计数频道（从 1 开始）', it: 'Imposta il canale di conteggio (si parte da 1)',
  },
  countingChannelDesc: {
    de: 'In welchem Channel soll gezählt werden?', en: 'Which channel should be used for counting?', fr: 'Dans quel salon faut-il compter ?', es: '¿En qué canal se cuenta?', pt: 'Em qual canal vamos contar?', ru: 'В каком канале считать?', ja: 'どのチャンネルで数えますか？', ko: '어느 채널에서 셀까요?', zh: '在哪个频道计数？', it: 'In quale canale si conta?',
  },
  countingActiveDesc: {
    de: 'An (Standard) oder aus, um den Channel wieder freizugeben', en: 'On (default) or off to release the channel again', fr: 'Activé (défaut) ou désactivé pour libérer le salon', es: 'Activado (predeterminado) o desactivado para liberar el canal', pt: 'Ligado (padrão) ou desligado para liberar o canal', ru: 'Включить (по умолчанию) или выключить, чтобы освободить канал', ja: 'オン（既定）／オフでチャンネルを解放', ko: '켜기(기본) 또는 끄기로 채널을 해제해요', zh: '开启（默认）或关闭以释放该频道', it: 'Attivo (predefinito) o disattivo per liberare il canale',
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

  challengeLine: {
    de: '{challenger} fordert {opponent} heraus.', en: '{challenger} challenges {opponent}.', fr: '{challenger} défie {opponent}.', es: '{challenger} desafía a {opponent}.', pt: '{challenger} desafia {opponent}.', ru: '{challenger} вызывает {opponent}.', ja: '{challenger} が {opponent} に挑戦。', ko: '{challenger}님이 {opponent}님에게 도전했어요.', zh: '{challenger} 向 {opponent} 发起挑战。', it: '{challenger} sfida {opponent}.',
  },
  deadlineShort: {
    de: '⏳ Läuft {deadline} ab.', en: '⏳ Expires {deadline}.', fr: '⏳ Expire {deadline}.', es: '⏳ Caduca {deadline}.', pt: '⏳ Expira {deadline}.', ru: '⏳ Истекает {deadline}.', ja: '⏳ {deadline}に期限切れ。', ko: '⏳ {deadline} 만료돼요.', zh: '⏳ {deadline}过期。', it: '⏳ Scade {deadline}.',
  },
  challengeOpenLine: {
    de: '{challenger} sucht jemanden für eine Runde **{game}** – wer traut sich?', en: '{challenger} is looking for someone to play **{game}** – who dares?', fr: '{challenger} cherche quelqu’un pour une partie de **{game}** — qui ose ?', es: '{challenger} busca a alguien para jugar a **{game}**: ¿quién se atreve?', pt: '{challenger} procura alguém para jogar **{game}** – quem encara?', ru: '{challenger} ищет соперника для игры **{game}** — кто рискнёт?', ja: '{challenger} が **{game}** の相手を探しています。挑戦する人は？', ko: '{challenger}님이 **{game}** 상대를 찾고 있어요. 누가 도전할까요?', zh: '{challenger} 正在寻找 **{game}** 的对手——谁来挑战？', it: '{challenger} cerca qualcuno per una partita a **{game}**: chi osa?',
  },
  randomStarterHint: {
    de: '🎲 Wer beginnt, entscheidet der Zufall.', en: '🎲 The starting player is picked at random.', fr: '🎲 Le joueur qui commence est tiré au sort.', es: '🎲 Quién empieza se decide al azar.', pt: '🎲 Quem começa é sorteado.', ru: '🎲 Кто ходит первым — решает случай.', ja: '🎲 先手はランダムで決まります。', ko: '🎲 선공은 무작위로 정해져요.', zh: '🎲 由随机决定谁先手。', it: '🎲 Chi inizia viene scelto a caso.',
  },
  btnJoin: { de: '⚔️ Ich trete an', en: '⚔️ I’ll play', fr: '⚔️ Je relève le défi', es: '⚔️ Yo juego', pt: '⚔️ Eu topo', ru: '⚔️ Я играю', ja: '⚔️ 挑戦する', ko: '⚔️ 제가 할게요', zh: '⚔️ 我来应战', it: '⚔️ Ci sto' },
  btnCancelSearch: { de: 'Suche abbrechen', en: 'Cancel search', fr: 'Annuler la recherche', es: 'Cancelar búsqueda', pt: 'Cancelar busca', ru: 'Отменить поиск', ja: '募集をやめる', ko: '모집 취소', zh: '取消寻找', it: 'Annulla la ricerca' },
  notChallenger: { de: '🛡️ Nur wer die Runde gestartet hat, kann die Suche abbrechen.', en: '🛡️ Only the player who started can cancel the search.', fr: '🛡️ Seul l’auteur du défi peut annuler la recherche.', es: '🛡️ Solo quien inició puede cancelar la búsqueda.', pt: '🛡️ Só quem começou pode cancelar a busca.', ru: '🛡️ Отменить поиск может только автор.', ja: '🛡️ 募集を取り消せるのは開始した人だけです。', ko: '🛡️ 시작한 사람만 모집을 취소할 수 있어요.', zh: '🛡️ 只有发起者可以取消寻找。', it: '🛡️ Solo chi ha aperto la sfida può annullare la ricerca.' },
  selfJoin: { de: '🪞 Gegen dich selbst geht nicht – warte auf jemand anderen.', en: '🪞 You cannot play yourself—wait for someone else.', fr: '🪞 Tu ne peux pas jouer contre toi-même — attends quelqu’un.', es: '🪞 No puedes jugar contra ti; espera a alguien.', pt: '🪞 Você não pode jogar contra si mesmo — espere alguém.', ru: '🪞 С собой играть нельзя — подожди кого-нибудь.', ja: '🪞 自分とは対戦できません。誰かを待ちましょう。', ko: '🪞 자기 자신과는 못 해요. 다른 사람을 기다리세요.', zh: '🪞 不能和自己对战——再等等别人吧。', it: '🪞 Non puoi giocare contro te stesso: aspetta qualcuno.' },
  cancelledTitle: { de: '🚪 SUCHE ABGEBROCHEN', en: '🚪 SEARCH CANCELLED', fr: '🚪 RECHERCHE ANNULÉE', es: '🚪 BÚSQUEDA CANCELADA', pt: '🚪 BUSCA CANCELADA', ru: '🚪 ПОИСК ОТМЕНЁН', ja: '🚪 募集を取り消しました', ko: '🚪 모집 취소됨', zh: '🚪 已取消寻找', it: '🚪 RICERCA ANNULLATA' },
  cancelledBody: { de: '{challenger} sucht doch keinen Gegner mehr. Neue Runde mit **/play**.', en: '{challenger} is no longer looking for an opponent. New round with **/play**.', fr: '{challenger} ne cherche plus d’adversaire. Nouvelle partie avec **/play**.', es: '{challenger} ya no busca rival. Nueva ronda con **/play**.', pt: '{challenger} não procura mais adversário. Nova rodada com **/play**.', ru: '{challenger} больше не ищет соперника. Новая игра — **/play**.', ja: '{challenger} は募集をやめました。**/play** で再挑戦できます。', ko: '{challenger}님이 모집을 그만뒀어요. **/play**로 새로 시작하세요.', zh: '{challenger} 不再寻找对手了。可用 **/play** 重新开始。', it: '{challenger} non cerca più un avversario. Nuova partita con **/play**.' },
  expiredOpenBody: { de: 'Niemand wollte gegen {challenger} antreten. Neue Runde mit **/play**.', en: 'Nobody wanted to face {challenger}. Start a new round with **/play**.', fr: 'Personne n’a voulu affronter {challenger}. Relance avec **/play**.', es: 'Nadie quiso enfrentarse a {challenger}. Inicia otra ronda con **/play**.', pt: 'Ninguém quis enfrentar {challenger}. Inicie outra rodada com **/play**.', ru: 'Никто не захотел играть против {challenger}. Начните заново через **/play**.', ja: '{challenger} の相手は現れませんでした。**/play** で再挑戦できます。', ko: '{challenger}님과 겨룰 사람이 없었어요. **/play**로 다시 시작하세요.', zh: '没有人愿意挑战 {challenger}。可用 **/play** 重新发起。', it: 'Nessuno ha voluto sfidare {challenger}. Ricomincia con **/play**.' },
  btnAccept: { de: '⚔️ Annehmen', en: '⚔️ Accept challenge', fr: '⚔️ Accepter le défi', es: '⚔️ Aceptar desafío', pt: '⚔️ Aceitar desafio', ru: '⚔️ Принять вызов', ja: '⚔️ 挑戦を受ける', ko: '⚔️ 도전 수락', zh: '⚔️ 接受挑战', it: '⚔️ Accetta la sfida' },
  btnDecline: { de: 'Ablehnen', en: 'Decline', fr: 'Refuser', es: 'Rechazar', pt: 'Recusar', ru: 'Отклонить', ja: '辞退する', ko: '거절', zh: '拒绝', it: 'Rifiuta' },
  notOpponent: { de: '🛡️ Nur der herausgeforderte Gegner darf darauf antworten.', en: '🛡️ Only the challenged opponent can respond.', fr: '🛡️ Seul l’adversaire défié peut répondre.', es: '🛡️ Solo el rival desafiado puede responder.', pt: '🛡️ Só o adversário desafiado pode responder.', ru: '🛡️ Ответить может только вызванный игрок.', ja: '🛡️ 挑戦された相手だけが返答できます。', ko: '🛡️ 도전받은 상대만 응답할 수 있어요.', zh: '🛡️ 只有被挑战的对手可以回应。', it: '🛡️ Solo l’avversario sfidato può rispondere.' },
  declinedTitle: { de: '🛡️ HERAUSFORDERUNG ABGELEHNT', en: '🛡️ CHALLENGE DECLINED', fr: '🛡️ DÉFI REFUSÉ', es: '🛡️ DESAFÍO RECHAZADO', pt: '🛡️ DESAFIO RECUSADO', ru: '🛡️ ВЫЗОВ ОТКЛОНЁН', ja: '🛡️ 挑戦は辞退されました', ko: '🛡️ 도전 거절됨', zh: '🛡️ 挑战已拒绝', it: '🛡️ SFIDA RIFIUTATA' },
  declinedBody: { de: '{opponent} möchte diesmal nicht gegen {challenger} antreten.', en: '{opponent} does not want to face {challenger} this time.', fr: '{opponent} ne souhaite pas affronter {challenger} cette fois.', es: '{opponent} no quiere enfrentarse a {challenger} esta vez.', pt: '{opponent} não quer enfrentar {challenger} desta vez.', ru: '{opponent} не хочет играть против {challenger} в этот раз.', ja: '{opponent} は今回は {challenger} との対戦を辞退しました。', ko: '{opponent}님이 이번에는 {challenger}님과 대결하지 않아요.', zh: '{opponent} 这次不想与 {challenger} 对战。', it: '{opponent} non vuole affrontare {challenger} questa volta.' },
  expiredTitle: { de: '⌛ BATTLE-ANFRAGE ABGELAUFEN', en: '⌛ BATTLE REQUEST EXPIRED', fr: '⌛ DÉFI EXPIRÉ', es: '⌛ DESAFÍO CADUCADO', pt: '⌛ DESAFIO EXPIRADO', ru: '⌛ ВЫЗОВ ИСТЁК', ja: '⌛ 対戦リクエスト期限切れ', ko: '⌛ 대결 신청 만료', zh: '⌛ 对战邀请已过期', it: '⌛ SFIDA SCADUTA' },
  expiredBody: { de: '{opponent} hat nicht rechtzeitig geantwortet. Startet bei Bedarf eine neue Runde mit **/play**.', en: '{opponent} did not respond in time. Start a new round with **/play**.', fr: '{opponent} n’a pas répondu à temps. Relance avec **/play**.', es: '{opponent} no respondió a tiempo. Inicia otra ronda con **/play**.', pt: '{opponent} não respondeu a tempo. Inicie outra rodada com **/play**.', ru: '{opponent} не ответил вовремя. Начните заново через **/play**.', ja: '{opponent} は時間内に返答しませんでした。**/play** で再挑戦できます。', ko: '{opponent}님이 제시간에 응답하지 않았어요. **/play**로 새로 시작하세요.', zh: '{opponent} 未及时回应。可使用 **/play** 重新发起。', it: '{opponent} non ha risposto in tempo. Ricomincia con **/play**.' },

  turn: { de: '⚡ **Am Zug:** {player}', en: '⚡ **Your move:** {player}', fr: '⚡ **Au tour de :** {player}', es: '⚡ **Turno de:** {player}', pt: '⚡ **Vez de:** {player}', ru: '⚡ **Ходит:** {player}', ja: '⚡ **手番:** {player}', ko: '⚡ **차례:** {player}', zh: '⚡ **轮到：** {player}', it: '⚡ **Tocca a:** {player}' },
  notPlayer: { de: '🍿 Du bist nur Zuschauer bei diesem Battle.', en: '🍿 You are only a spectator in this battle.', fr: '🍿 Tu es seulement spectateur de ce duel.', es: '🍿 Solo eres espectador en esta batalla.', pt: '🍿 Você é apenas espectador nesta batalha.', ru: '🍿 Ты только зритель в этой игре.', ja: '🍿 あなたはこの対戦の観戦者です。', ko: '🍿 이 대결에서는 관전자예요.', zh: '🍿 你只是本场对战的观众。', it: '🍿 Sei solo spettatore in questa sfida.' },
  notTurn: { de: '⏱️ Noch nicht – dein Gegner ist gerade am Zug.', en: '⏱️ Not yet—your opponent is playing.', fr: '⏱️ Pas encore — c’est au tour de ton adversaire.', es: '⏱️ Aún no; es el turno de tu rival.', pt: '⏱️ Ainda não — é a vez do adversário.', ru: '⏱️ Ещё рано — сейчас ход соперника.', ja: '⏱️ まだです。相手の手番です。', ko: '⏱️ 아직 아니에요. 상대 차례예요.', zh: '⏱️ 还没轮到你——现在是对手的回合。', it: '⏱️ Non ancora: tocca al tuo avversario.' },
  cellTaken: { de: '🚧 Dieses Feld ist schon besetzt.', en: '🚧 That cell is already occupied.', fr: '🚧 Cette case est déjà occupée.', es: '🚧 Esa casilla ya está ocupada.', pt: '🚧 Essa casa já está ocupada.', ru: '🚧 Эта клетка уже занята.', ja: '🚧 そのマスはすでに埋まっています。', ko: '🚧 이미 사용된 칸이에요.', zh: '🚧 该格已经被占用。', it: '🚧 Questa casella è già occupata.' },
  columnFull: { de: '🚧 Diese Spalte ist voll – nimm eine andere.', en: '🚧 That column is full—choose another.', fr: '🚧 Cette colonne est pleine — choisis-en une autre.', es: '🚧 Esa columna está llena; elige otra.', pt: '🚧 Essa coluna está cheia — escolha outra.', ru: '🚧 Этот столбец заполнен — выбери другой.', ja: '🚧 その列は満杯です。別の列を選んでね。', ko: '🚧 그 열은 가득 찼어요. 다른 열을 고르세요.', zh: '🚧 该列已满，请选择其他列。', it: '🚧 Questa colonna è piena: scegline un’altra.' },
  noLongerActive: { de: '🏁 Dieses Battle ist bereits beendet.', en: '🏁 This battle has already ended.', fr: '🏁 Ce duel est déjà terminé.', es: '🏁 Esta batalla ya ha terminado.', pt: '🏁 Esta batalha já terminou.', ru: '🏁 Эта игра уже закончена.', ja: '🏁 この対戦はすでに終了しています。', ko: '🏁 이 대결은 이미 끝났어요.', zh: '🏁 本场对战已经结束。', it: '🏁 Questa sfida è già terminata.' },

  winnerShort: { de: '🏆 {winner} gewinnt!', en: '🏆 {winner} wins!', fr: '🏆 {winner} gagne !', es: '🏆 ¡{winner} gana!', pt: '🏆 {winner} venceu!', ru: '🏆 {winner} побеждает!', ja: '🏆 {winner} の勝ち！', ko: '🏆 {winner}님 승리!', zh: '🏆 {winner} 获胜！', it: '🏆 Vince {winner}!' },
  drawShort: { de: '🤝 Unentschieden!', en: '🤝 Draw!', fr: '🤝 Égalité !', es: '🤝 ¡Empate!', pt: '🤝 Empate!', ru: '🤝 Ничья!', ja: '🤝 引き分け！', ko: '🤝 무승부!', zh: '🤝 平局！', it: '🤝 Pareggio!' },
  rematchShort: { de: 'Revanche mit **/play**.', en: 'Rematch with **/play**.', fr: 'Revanche avec **/play**.', es: 'Revancha con **/play**.', pt: 'Revanche com **/play**.', ru: 'Реванш через **/play**.', ja: '再戦は **/play**。', ko: '재대결은 **/play**.', zh: '再来一局：**/play**。', it: 'Rivincita con **/play**.' },

  // --- Counting-Spiel ---------------------------------------------------
  countFailureSafe: {
    de: '❌ Zählfehler {variant}: {user} hat **{got}** geschrieben, erwartet war **{expected}**. Der Zähler startet wieder bei **1**.',
    en: '❌ Counting error {variant}: {user} wrote **{got}**, but **{expected}** was expected. The counter starts again at **1**.',
    fr: '❌ Erreur de comptage {variant} : {user} a écrit **{got}**, mais **{expected}** était attendu. Le compteur repart à **1**.',
    es: '❌ Error de conteo {variant}: {user} escribió **{got}**, pero se esperaba **{expected}**. El contador vuelve al **1**.',
    pt: '❌ Erro de contagem {variant}: {user} escreveu **{got}**, mas o esperado era **{expected}**. O contador volta ao **1**.',
    ru: '❌ Ошибка счёта {variant}: {user} написал **{got}**, а ожидалось **{expected}**. Счётчик снова с **1**.',
    ja: '❌ カウントエラー {variant}：{user} は **{got}** と書きましたが、正しくは **{expected}** です。カウンターは **1** から再開します。',
    ko: '❌ 카운팅 오류 {variant}: {user}님이 **{got}**을 썼지만 **{expected}**가 맞았어요. 카운터는 **1**부터 다시 시작합니다.',
    zh: '❌ 计数错误 {variant}：{user} 写了 **{got}**，但正确答案是 **{expected}**。计数器从 **1** 重新开始。',
    it: '❌ Errore di conteggio {variant}: {user} ha scritto **{got}**, ma ci si aspettava **{expected}**. Il contatore riparte da **1**.'
  },
  // Sichere, skalierende Showeinlage: Der Bot wird mit dem Zählstand
  // dramatischer, ohne den User zu beschämen, andere zu pingen oder den Server
  // mit Spam zu fluten.
  countRageSafeTitle: {
    de: '{bar} COUNTING-ALARM {level}: {user} hat **{got}** statt **{expected}** geschrieben. Der Zähler startet bei **1** – dramatischer Soundeffekt inklusive!',
    en: '{bar} COUNTING ALARM {level}: {user} wrote **{got}** instead of **{expected}**. The counter restarts at **1** — dramatic sound effect included!',
    fr: '{bar} ALERTE COMPTAGE {level} : {user} a écrit **{got}** au lieu de **{expected}**. Le compteur repart à **1** — effet dramatique inclus !',
    es: '{bar} ¡ALARMA DE CONTEO {level}! {user} escribió **{got}** en vez de **{expected}**. El contador vuelve al **1** — ¡efecto dramático incluido!',
    pt: '{bar} ALERTA DE CONTAGEM {level}: {user} escreveu **{got}** em vez de **{expected}**. O contador volta ao **1** — efeito dramático incluído!',
    ru: '{bar} ТРЕВОГА СЧЁТА {level}: {user} написал **{got}** вместо **{expected}**. Счётчик возвращается к **1** — драматичный эффект прилагается!',
    ja: '{bar} カウント警報 {level}：{user} は **{expected}** ではなく **{got}** と書きました。カウンターは **1** に戻ります――効果音は想像で！',
    ko: '{bar} 카운팅 경보 {level}: {user}님이 **{expected}** 대신 **{got}**을 썼어요. 카운터는 **1**로 돌아갑니다 — 극적인 효과음 포함!',
    zh: '{bar} 计数警报 {level}：{user} 写了 **{got}**，而不是 **{expected}**。计数器回到 **1**——戏剧音效请自行想象！',
    it: '{bar} ALLARME CONTEGGIO {level}: {user} ha scritto **{got}** invece di **{expected}**. Il contatore riparte da **1** — effetto drammatico incluso!'
  },
  countRageSafePulse: {
    de: '{bar} Wir waren bereits bei **{streak}**. Der Bot schaltet auf Wut-Theater – kurz durchatmen, dann fair gemeinsam bei **1** weitermachen.',
    en: '{bar} We had already reached **{streak}**. The bot is switching to rage theatre — take a breath, then continue fairly from **1** together.',
    fr: '{bar} Nous étions déjà à **{streak}**. Le bot passe en théâtre de la colère — on respire, puis on reprend ensemble à **1**.',
    es: '{bar} Ya habíamos llegado a **{streak}**. El bot activa el teatro de la rabia — respiramos y seguimos juntos desde **1**.',
    pt: '{bar} Já tínhamos chegado a **{streak}**. O bot ativa o teatro da raiva — respirem e continuem juntos a partir do **1**.',
    ru: '{bar} Мы уже дошли до **{streak}**. Бот включает театральную ярость — выдыхаем и вместе продолжаем с **1**.',
    ja: '{bar} すでに **{streak}** まで来ていました。Botは怒りの演出モード――深呼吸して、みんなで **1** から再開しましょう。',
    ko: '{bar} 이미 **{streak}**까지 왔어요. 봇이 분노 연출 모드로 전환합니다 — 숨을 고르고 **1**부터 함께 다시 시작해요.',
    zh: '{bar} 我们已经数到 **{streak}** 了。机器人开启戏剧化生气模式——先深呼吸，再一起从 **1** 重新开始。',
    it: '{bar} Eravamo già arrivati a **{streak}**. Il bot passa alla rabbia teatrale — respiriamo e ripartiamo insieme da **1**.'
  },
  countRageSafeBody: {
    de: '🎬 Kein Spam, keine Jagd: nur eine kurze Showeinlage. Nächster Versuch gemeinsam ab **1**!',
    en: '🎬 No pile-on, no spam: just a short theatrical bit. Next attempt starts together at **1**!',
    fr: '🎬 Pas de chasse ni de spam : juste une courte mise en scène. Le prochain essai repart ensemble à **1** !',
    es: '🎬 Sin acoso ni spam: solo una breve escena teatral. ¡El próximo intento empieza juntos en **1**!',
    pt: '🎬 Nada de perseguição ou spam: apenas uma pequena cena teatral. A próxima tentativa começa junto no **1**!',
    ru: '🎬 Никакой травли и спама: только короткая театральная сценка. Следующая попытка вместе с **1**!',
    ja: '🎬 責めたりスパムしたりせず、短い演出だけ。次はみんなで **1** から！',
    ko: '🎬 몰아세우기나 스팸 없이 짧은 연출만 할게요. 다음 시도는 **1**부터 함께!',
    zh: '🎬 不围攻、不刷屏，只来一段短小的戏剧表演。下一次一起从 **1** 开始！',
    it: '🎬 Niente accanimento né spam: solo una breve scenetta. Il prossimo tentativo riparte insieme da **1**!'
  },

  countingTopicLabel: { de: '🔢 Counting-Channel | Aktuelle Zahl: {count} | weiter geht’s bei der nächsten Zahl', en: '🔢 Counting channel | Current number: {count} | next number continues the streak', fr: '🔢 Salon de comptage | Nombre actuel : {count} | continuez avec le suivant', es: '🔢 Canal de conteo | Número actual: {count} | sigue con el siguiente', pt: '🔢 Canal de contagem | Número atual: {count} | continue com o próximo', ru: '🔢 Канал счёта | Текущее число: {count} | продолжайте следующим', ja: '🔢 カウントチャンネル | 現在の数: {count} | 次の数へ', ko: '🔢 카운팅 채널 | 현재 숫자: {count} | 다음 숫자로 이어가요', zh: '🔢 计数频道 | 当前数字：{count} | 请接着数下一个', it: '🔢 Canale di conteggio | Numero attuale: {count} | si continua col prossimo' },
  countingEnabled: { de: '🔢 {channel} ist jetzt der Counting-Channel!\nEs geht bei **1** los, niemand darf zweimal hintereinander zählen – und bei einem Fehler beginnt alles von vorne.', en: '🔢 {channel} is now the counting channel!\nStart at **1**, nobody may count twice in a row—and one mistake resets everything.', fr: '🔢 {channel} est désormais le salon de comptage !\nOn démarre à **1**, personne ne compte deux fois de suite, et une erreur remet tout à zéro.', es: '🔢 ¡{channel} ahora es el canal de conteo!\nEmpezamos en **1**, nadie cuenta dos veces seguidas y un fallo lo reinicia todo.', pt: '🔢 {channel} agora é o canal de contagem!\nComeça no **1**, ninguém conta duas vezes seguidas e um erro reinicia tudo.', ru: '🔢 {channel} теперь канал для счёта!\nНачинаем с **1**, подряд дважды считать нельзя, ошибка сбрасывает всё.', ja: '🔢 {channel} をカウントチャンネルにしました！\n**1** から開始、同じ人が連続で数えるのは禁止、間違えると最初からです。', ko: '🔢 이제 {channel}이 카운팅 채널이에요!\n**1**부터 시작하고, 연속으로 두 번 셀 수 없으며, 틀리면 처음부터예요.', zh: '🔢 {channel} 现在是计数频道！\n从 **1** 开始，不能连续数两次，数错就全部重来。', it: '🔢 {channel} è ora il canale di conteggio!\nSi parte da **1**, nessuno conta due volte di fila e un errore azzera tutto.' },
  countingDisabled: { de: '🧹 {channel} ist kein Counting-Channel mehr.', en: '🧹 {channel} is no longer a counting channel.', fr: '🧹 {channel} n’est plus un salon de comptage.', es: '🧹 {channel} ya no es un canal de conteo.', pt: '🧹 {channel} não é mais um canal de contagem.', ru: '🧹 {channel} больше не канал для счёта.', ja: '🧹 {channel} はカウントチャンネルではなくなりました。', ko: '🧹 {channel}은(는) 더 이상 카운팅 채널이 아니에요.', zh: '🧹 {channel} 不再是计数频道。', it: '🧹 {channel} non è più un canale di conteggio.' },
  countingAlready: { de: 'ℹ️ {channel} war schon ein Counting-Channel – der Zähler startet wieder bei **1**.', en: 'ℹ️ {channel} was already a counting channel—the counter restarts at **1**.', fr: 'ℹ️ {channel} était déjà un salon de comptage — le compteur repart à **1**.', es: 'ℹ️ {channel} ya era canal de conteo; el contador vuelve a **1**.', pt: 'ℹ️ {channel} já era canal de contagem — o contador volta ao **1**.', ru: 'ℹ️ {channel} уже был каналом счёта — счётчик снова с **1**.', ja: 'ℹ️ {channel} はすでにカウントチャンネルでした。カウントは **1** から再開します。', ko: 'ℹ️ {channel}은(는) 이미 카운팅 채널이었어요. 카운터가 **1**부터 다시 시작해요.', zh: 'ℹ️ {channel} 已经是计数频道——计数将从 **1** 重新开始。', it: 'ℹ️ {channel} era già un canale di conteggio: il contatore riparte da **1**.' },
  countingNotSet: { de: 'ℹ️ {channel} ist gar kein Counting-Channel.', en: 'ℹ️ {channel} is not a counting channel.', fr: 'ℹ️ {channel} n’est pas un salon de comptage.', es: 'ℹ️ {channel} no es un canal de conteo.', pt: 'ℹ️ {channel} não é um canal de contagem.', ru: 'ℹ️ {channel} не является каналом счёта.', ja: 'ℹ️ {channel} はカウントチャンネルではありません。', ko: 'ℹ️ {channel}은(는) 카운팅 채널이 아니에요.', zh: 'ℹ️ {channel} 并不是计数频道。', it: 'ℹ️ {channel} non è un canale di conteggio.' },
  errCountingChannel: { de: '📵 Dort kann ich nicht mitzählen – bitte wähle einen normalen Textkanal.', en: '📵 I cannot count there—please pick a normal text channel.', fr: '📵 Je ne peux pas compter là — choisis un salon textuel normal.', es: '📵 Ahí no puedo contar; elige un canal de texto normal.', pt: '📵 Não consigo contar aí — escolha um canal de texto normal.', ru: '📵 Там считать не получится — выбери обычный текстовый канал.', ja: '📵 そこでは数えられません。通常のテキストチャンネルを選んでね。', ko: '📵 거기서는 셀 수 없어요. 일반 텍스트 채널을 골라주세요.', zh: '📵 我无法在那里计数，请选择普通文字频道。', it: '📵 Lì non posso contare: scegli un canale testuale normale.' },
  errCountingTopic: { de: '🔐 Mir fehlt die Berechtigung **Kanal verwalten**, um das Thema zu setzen.', en: '🔐 I lack the **Manage Channel** permission to set the topic.', fr: '🔐 Il me manque la permission **Gérer le salon** pour définir le sujet.', es: '🔐 Me falta el permiso **Gestionar canal** para poner el tema.', pt: '🔐 Falta a permissão **Gerenciar canal** para definir o tópico.', ru: '🔐 Нет права **Управление каналом**, чтобы задать тему.', ja: '🔐 トピックを設定する **チャンネルの管理** 権限がありません。', ko: '🔐 주제를 설정할 **채널 관리** 권한이 없어요.', zh: '🔐 我缺少**管理频道**权限，无法设置主题。', it: '🔐 Mi manca il permesso **Gestisci canale** per impostare l’argomento.' },
  countingNeedManageMessages: { de: '⚠️ Hinweis: Ohne **Nachrichten verwalten** kann ich falsche Beiträge nicht löschen.', en: '⚠️ Note: without **Manage Messages** I cannot delete invalid posts.', fr: '⚠️ Note : sans **Gérer les messages**, je ne peux pas supprimer les messages invalides.', es: '⚠️ Nota: sin **Gestionar mensajes** no puedo borrar los mensajes inválidos.', pt: '⚠️ Aviso: sem **Gerenciar mensagens** não posso apagar mensagens inválidas.', ru: '⚠️ Внимание: без **Управления сообщениями** я не смогу удалять лишние сообщения.', ja: '⚠️ 注意: **メッセージの管理** がないと不正な投稿を削除できません。', ko: '⚠️ 참고: **메시지 관리** 권한이 없으면 잘못된 글을 지울 수 없어요.', zh: '⚠️ 注意：没有**管理消息**权限时，我无法删除无效消息。', it: '⚠️ Nota: senza **Gestisci messaggi** non posso cancellare i messaggi non validi.' },
  countFail1: { de: '❌ {user} kann nicht zählen! Erwartet war **{expected}**, gekommen ist **{got}**. Wir fangen wieder bei **1** an.', en: '❌ {user} cannot count! Expected **{expected}**, got **{got}**. Back to **1** we go.', fr: '❌ {user} ne sait pas compter ! Attendu **{expected}**, reçu **{got}**. On repart à **1**.', es: '❌ ¡{user} no sabe contar! Se esperaba **{expected}** y llegó **{got}**. Volvemos al **1**.', pt: '❌ {user} não sabe contar! Esperado **{expected}**, veio **{got}**. Voltamos ao **1**.', ru: '❌ {user} не умеет считать! Ожидалось **{expected}**, пришло **{got}**. Начинаем с **1**.', ja: '❌ {user} は数えられません！期待は **{expected}**、来たのは **{got}**。**1** からやり直しです。', ko: '❌ {user}님, 숫자를 못 세네요! **{expected}**이어야 하는데 **{got}**이라니. 다시 **1**부터예요.', zh: '❌ {user} 不会数数！应该是 **{expected}**，却写了 **{got}**。从 **1** 重来。', it: '❌ {user} non sa contare! Serviva **{expected}**, è arrivato **{got}**. Si riparte da **1**.' },
  countFail2: { de: '💀 Danke für nichts, {user}. **{got}** statt **{expected}** – Zähler zerstört, zurück auf **1**.', en: '💀 Thanks for nothing, {user}. **{got}** instead of **{expected}**—streak destroyed, back to **1**.', fr: '💀 Merci pour rien, {user}. **{got}** au lieu de **{expected}** — série détruite, retour à **1**.', es: '💀 Gracias por nada, {user}. **{got}** en vez de **{expected}**: racha destruida, al **1**.', pt: '💀 Obrigado por nada, {user}. **{got}** em vez de **{expected}** — sequência destruída, de volta ao **1**.', ru: '💀 Спасибо ни за что, {user}. **{got}** вместо **{expected}** — серия сломана, снова **1**.', ja: '💀 台無しだよ、{user}。**{expected}** のはずが **{got}**。記録は崩壊、**1** から。', ko: '💀 고마워요 {user}… **{expected}** 대신 **{got}**. 기록 파괴, 다시 **1**.', zh: '💀 谢谢你什么都没做对，{user}。应为 **{expected}** 却是 **{got}**，连胜终结，回到 **1**。', it: '💀 Grazie di nulla, {user}. **{got}** invece di **{expected}**: serie distrutta, si torna a **1**.' },
  countFail3: { de: '🧮 Mathe-Alarm bei {user}: nach **{expected}** kommt bestimmt nicht **{got}**. Neustart bei **1**.', en: '🧮 Math alert for {user}: **{got}** definitely does not follow **{expected}**. Restarting at **1**.', fr: '🧮 Alerte maths pour {user} : **{got}** ne suit clairement pas **{expected}**. On recommence à **1**.', es: '🧮 Alerta matemática para {user}: **{got}** no sigue a **{expected}**. Reinicio en **1**.', pt: '🧮 Alerta de matemática para {user}: **{got}** não vem depois de **{expected}**. Recomeço no **1**.', ru: '🧮 Тревога по математике, {user}: **{got}** явно не после **{expected}**. Снова с **1**.', ja: '🧮 {user} に算数警報：**{expected}** の次が **{got}** のはずないでしょ。**1** から再開。', ko: '🧮 {user}님 수학 경보: **{expected}** 다음이 **{got}**일 리가요. **1**부터 다시.', zh: '🧮 {user} 数学警报：**{expected}** 后面绝不是 **{got}**。从 **1** 重启。', it: '🧮 Allarme matematica per {user}: dopo **{expected}** non viene **{got}**. Si riparte da **1**.' },
  countFail4: { de: '🎓 {user} hat den Zahlenstrahl verloren: **{expected}** war gesucht, **{got}** kam an. Zurück auf **1**.', en: '🎓 {user} lost the number line: **{expected}** was wanted, **{got}** arrived. Back to **1**.', fr: '🎓 {user} a perdu la droite numérique : il fallait **{expected}**, on a eu **{got}**. Retour à **1**.', es: '🎓 {user} perdió la recta numérica: tocaba **{expected}** y llegó **{got}**. De vuelta al **1**.', pt: '🎓 {user} perdeu a reta numérica: era **{expected}**, veio **{got}**. De volta ao **1**.', ru: '🎓 {user} потерял числовую прямую: нужно было **{expected}**, а пришло **{got}**. Снова **1**.', ja: '🎓 {user} は数直線を見失いました：必要なのは **{expected}**、来たのは **{got}**。**1** に戻ります。', ko: '🎓 {user}님이 수직선을 잃었어요: **{expected}**이 필요했는데 **{got}**. 다시 **1**.', zh: '🎓 {user} 弄丢了数轴：需要 **{expected}**，却来了 **{got}**。回到 **1**。', it: '🎓 {user} ha perso la retta dei numeri: serviva **{expected}**, è arrivato **{got}**. Di nuovo **1**.' },
  countFail5: { de: '🚨 {user} hat es geschafft, an **{expected}** vorbeizuzählen (**{got}**). Alle sagen Danke – wir starten bei **1**.', en: '🚨 {user} managed to miss **{expected}** (**{got}**). Everyone says thanks—we restart at **1**.', fr: '🚨 {user} a réussi à rater **{expected}** (**{got}**). Merci à lui — on repart à **1**.', es: '🚨 {user} logró saltarse el **{expected}** (**{got}**). Gracias a ti: volvemos al **1**.', pt: '🚨 {user} conseguiu errar o **{expected}** (**{got}**). Valeu mesmo — recomeçamos no **1**.', ru: '🚨 {user} умудрился промахнуться мимо **{expected}** (**{got}**). Все благодарны — начинаем с **1**.', ja: '🚨 {user} が **{expected}** を外しました（**{got}**）。みんな大喜び、**1** から再開。', ko: '🚨 {user}님이 **{expected}**을(를) 놓쳤어요 (**{got}**). 모두가 감사합니다 — **1**부터 다시.', zh: '🚨 {user} 成功地数错了 **{expected}**（写成 **{got}**）。大家都谢谢你——从 **1** 开始。', it: '🚨 {user} è riuscito a sbagliare **{expected}** (**{got}**). Grazie tante: si riparte da **1**.' },
  countFail6: { de: '🫠 {user}, zwischen **{expected}** und **{got}** liegen Welten. Der Zähler liegt jetzt wieder bei **0** – bitte mit **1** weitermachen.', en: '🫠 {user}, **{expected}** and **{got}** are worlds apart. The counter is back at **0**—continue with **1**.', fr: '🫠 {user}, entre **{expected}** et **{got}** il y a un monde. Le compteur est à **0** — reprends avec **1**.', es: '🫠 {user}, entre **{expected}** y **{got}** hay un abismo. El contador está en **0**: sigue con **1**.', pt: '🫠 {user}, **{expected}** e **{got}** são mundos diferentes. O contador voltou a **0** — continue com **1**.', ru: '🫠 {user}, между **{expected}** и **{got}** пропасть. Счётчик снова **0** — продолжай с **1**.', ja: '🫠 {user}、**{expected}** と **{got}** は別世界です。カウンターは **0**、**1** から続けてね。', ko: '🫠 {user}님, **{expected}**와 **{got}**는 완전 딴 세상이에요. 카운터는 **0**, **1**부터 이어가요.', zh: '🫠 {user}，**{expected}** 和 **{got}** 差得也太远了。计数归 **0**，请从 **1** 继续。', it: '🫠 {user}, tra **{expected}** e **{got}** c’è un abisso. Il contatore è a **0**: riparti da **1**.' },
  countFail7: { de: '🫵 {user}, schäm dich! Nach **{expected}** kommt **{got}** nur, wenn man die Grundschule geschwänzt hat. Neustart bei **1**.', en: '🫵 {user}, shame on you! After **{expected}** comes **{got}** only if you skipped primary school. Restart at **1**.', fr: '🫵 {user}, honte à toi ! Après **{expected}**, on écrit **{got}** seulement si on a séché l’école. On repart à **1**.', es: '🫵 ¡{user}, qué vergüenza! Después de **{expected}** viene **{got}** solo si faltaste a primaria. De vuelta al **1**.', pt: '🫵 {user}, que vergonha! Depois de **{expected}** vem **{got}** só se você matou a escola. De volta ao **1**.', ru: '🫵 {user}, как не стыдно! После **{expected}** идёт **{got}**, только если прогулял начальную школу. Начинаем с **1**.', ja: '🫵 {user}、恥を知れ！**{expected}** の次が **{got}** になるのは学校をサボった人だけ。**1** からやり直し。', ko: '🫵 {user}님, 부끄러운 줄 아세요! **{expected}** 다음에 **{got}**이 오는 건 학교를 안 다닌 사람뿐이에요. 다시 **1**부터.', zh: '🫵 {user}，你不害臊吗！**{expected}** 后面是 **{got}**，只有逃学的人才写得出来。从 **1** 重来。', it: '🫵 {user}, vergogna! Dopo **{expected}** viene **{got}** solo se hai marinato la scuola. Si riparte da **1**.' },
  countFail8: { de: '🤡 Großer Auftritt für {user}: **{got}** statt **{expected}** – der ganze Server applaudiert. Zurück auf **1**.', en: '🤡 What an entrance, {user}: **{got}** instead of **{expected}** – the whole server is applauding. Back to **1**.', fr: '🤡 Quelle entrée, {user} : **{got}** au lieu de **{expected}** — tout le serveur applaudit. Retour à **1**.', es: '🤡 Menuda entrada, {user}: **{got}** en vez de **{expected}** – todo el servidor aplaude. Al **1**.', pt: '🤡 Que entrada, {user}: **{got}** em vez de **{expected}** – o servidor inteiro aplaude. De volta ao **1**.', ru: '🤡 Какой выход, {user}: **{got}** вместо **{expected}** — весь сервер аплодирует. Снова **1**.', ja: '🤡 登場が派手だね、{user}。**{expected}** のはずが **{got}** — サーバー中が拍手喝采。**1** から。', ko: '🤡 등장이 화려하네요, {user}님. **{expected}** 대신 **{got}** — 서버 전체가 박수를 보내요. 다시 **1**.', zh: '🤡 好一出登场，{user}：写了 **{got}** 而不是 **{expected}**——全服都在鼓掌。回到 **1**。', it: '🤡 Che entrata, {user}: **{got}** invece di **{expected}** – tutto il server applaude. Si torna a **1**.' },
  countFail9: { de: '📉 {user} hat den Rekord geknackt: von **{expected}** auf **{got}** in einem einzigen Fehler. **1**, bitte.', en: '📉 {user} just set a record: **{expected}** to **{got}** in one single mistake. **1**, please.', fr: '📉 {user} a battu un record : de **{expected}** à **{got}** en une seule erreur. On reprend à **1**.', es: '📉 {user} batió un récord: de **{expected}** a **{got}** en un solo fallo. **1**, por favor.', pt: '📉 {user} bateu um recorde: de **{expected}** para **{got}** em um único erro. **1**, por favor.', ru: '📉 {user} поставил рекорд: с **{expected}** на **{got}** одной ошибкой. **1**, пожалуйста.', ja: '📉 {user} が記録更新：たった一度のミスで **{expected}** から **{got}** へ。**1** からどうぞ。', ko: '📉 {user}님이 기록을 세웠어요: 단 한 번의 실수로 **{expected}**에서 **{got}**으로. **1**부터요.', zh: '📉 {user} 创造了纪录：一次失误就从 **{expected}** 跳到 **{got}**。请回到 **1**。', it: '📉 {user} ha fatto il record: da **{expected}** a **{got}** in un solo errore. **1**, prego.' },
  countFail10: { de: '🙈 {user}, wir zählen bis **{expected}** – nicht irgendwohin. **{got}**? Ernsthaft? Von vorne.', en: '🙈 {user}, we were counting towards **{expected}** – not wherever. **{got}**? Seriously? Start over.', fr: '🙈 {user}, on compte vers **{expected}** — pas n’importe où. **{got}** ? Sérieusement ? On recommence.', es: '🙈 {user}, íbamos por el **{expected}**, no hacia cualquier lado. ¿**{got}**? ¿En serio? Desde el principio.', pt: '🙈 {user}, estávamos contando até **{expected}** – não para qualquer lugar. **{got}**? Sério? Do começo.', ru: '🙈 {user}, мы считали до **{expected}**, а не куда попало. **{got}**? Серьёзно? Заново.', ja: '🙈 {user}、**{expected}** まで数えてるんだけど。**{got}**？本気？最初から。', ko: '🙈 {user}님, **{expected}**까지 세고 있었는데요. **{got}**? 진심이에요? 처음부터.', zh: '🙈 {user}，我们在往 **{expected}** 数，不是随便数。**{got}**？认真的吗？重来。', it: '🙈 {user}, stavamo contando verso **{expected}** — non a casaccio. **{got}**? Sul serio? Da capo.' },
  countFail11: { de: '🚑 Sanitäter für {user}! Zahlenkollaps bei **{got}** statt **{expected}**. Der Zähler beginnt wieder bei **1**.', en: '🚑 Medic for {user}! Number collapse at **{got}** instead of **{expected}**. The counter starts again at **1**.', fr: '🚑 Un médecin pour {user} ! Collapsus numérique à **{got}** au lieu de **{expected}**. Le compteur repart à **1**.', es: '🚑 ¡Un médico para {user}! Colapso numérico en **{got}** en vez de **{expected}**. El contador vuelve al **1**.', pt: '🚑 Médico para {user}! Colapso numérico em **{got}** em vez de **{expected}**. O contador recomeça no **1**.', ru: '🚑 Врача для {user}! Числовой коллапс: **{got}** вместо **{expected}**. Счётчик снова с **1**.', ja: '🚑 {user} に救急隊を！**{expected}** のはずが **{got}** で数字崩壊。カウンターは **1** から。', ko: '🚑 {user}님 응급차를 불러주세요! **{expected}** 대신 **{got}**으로 숫자 붕괴. 카운터는 **1**부터 다시.', zh: '🚑 快给 {user} 叫救护车！**{expected}** 写成了 **{got}**，数字崩了。计数从 **1** 重新开始。', it: '🚑 Un medico per {user}! Collasso numerico: **{got}** invece di **{expected}**. Il contatore riparte da **1**.' },
  countFail12: { de: '🗿 {user} hat gerade bewiesen, dass **{got}** die neue **{expected}** ist … nein, ist es nicht. Zurück auf **1**.', en: '🗿 {user} just proved that **{got}** is the new **{expected}** … no, it isn’t. Back to **1**.', fr: '🗿 {user} vient de prouver que **{got}** est le nouveau **{expected}** … non, pas du tout. Retour à **1**.', es: '🗿 {user} acaba de demostrar que **{got}** es el nuevo **{expected}**… no, no lo es. De vuelta al **1**.', pt: '🗿 {user} acabou de provar que **{got}** é o novo **{expected}**… não, não é. De volta ao **1**.', ru: '🗿 {user} только что доказал, что **{got}** — это новое **{expected}**… нет, не доказал. Снова **1**.', ja: '🗿 {user} は **{got}** が新しい **{expected}** だと証明した…いや、してない。**1** に戻ります。', ko: '🗿 {user}님이 **{got}**이 새로운 **{expected}**임을 증명했어요… 아니, 아니에요. 다시 **1**.', zh: '🗿 {user} 刚刚证明了 **{got}** 就是新的 **{expected}**……不，才不是。回到 **1**。', it: '🗿 {user} ha appena dimostrato che **{got}** è il nuovo **{expected}**… no, non lo è. Si torna a **1**.' },
  // Die Ausrast-Sequenzen sind absichtlich wie hektische Chat-Nachrichten
  // geschrieben: Satzabbrüche, Vertipper und direkte Selbstkorrekturen sind
  // Teil des Tons – keine Übersetzungsfehler. Jede Person wird nur im Titel
  // tatsächlich erwähnt; `countRageAside` ersetzt die Erwähnung danach.
  countRageAside: {
    de: 'ehrlich jetzt', en: 'seriously', fr: 'franchement', es: 'en serio', pt: 'fala sério',
    ru: 'серьёзно', ja: 'ほんとに', ko: '진짜로', zh: '说真的', it: 'sul serio'
  },
  countRageSpiral1: {
    de: 'nein nein nien das kann doch nich euer ernst sein',
    en: 'no no nO this cannot be hapening right now',
    fr: 'non non nON c’est pas possble là',
    es: 'no no nO esto no puede estar pasnando',
    pt: 'não não nÃo isso não pode tá acontcendo',
    ru: 'нет нет неет этого сейчас не может происхоидть',
    ja: 'いやいやちが、違う、こんなの今起きるわけない',
    ko: '아니 아니 아ㄴ... 이게 지금 말이 돼??',
    zh: '不不不等下，这不可能发、发生吧',
    it: 'no no nO non può star succedendo davero'
  },
  countRageSpiral2: {
    de: 'ich kann das alles nciht mehr',
    en: 'i actualy cannot do this anymore',
    fr: 'jpeux vrmt plus là',
    es: 'ya no peudo con esto',
    pt: 'eu não aguento mias isso',
    ru: 'я болше так не могу',
    ja: 'もうむり、ほんとにむり',
    ko: '나 진짜 더는 모ㅅ하겠어',
    zh: '我真搞不下去里',
    it: 'io non ce la facico più'
  },
  countRageSpiral3: {
    de: 'WIE PASSIERT DAS IMEMR WIEDER',
    en: 'HOW DOES THIS KEPE HAPPENING',
    fr: 'COMMENT ÇA ARRVIE ENCORE',
    es: 'CÓMO PASA ESTO OTRA VZE',
    pt: 'COMO ISSO ACONTEEC DE NOVO',
    ru: 'КАК ЭТО ОПЯТЬ ПРОИСХОИДТ',
    ja: 'なんでまたこうなてるの',
    ko: '이게 왜 계쏙 일어나는데',
    zh: '怎么又又又变成这祥',
    it: 'COME FA A SUCCEDRE SEMPRE'
  },
  countRageSpiral4: {
    de: 'warte ich muss mich kurz sammlen... sammelN. ach egal',
    en: 'wait i need to clam down... calm. CALM. whatever',
    fr: 'attends faut que je me clame... calme. bref',
    es: 'espera tengo que calmarne... calmarme. da igual',
    pt: 'pera eu preciso me acalmar... acalnar. ah esquece',
    ru: 'подожди мне надо успокоится... успокоиться. да всё равно',
    ja: '待って落ちつ、落ち着かないと... もういい',
    ko: '잠깐 진정해ㅇ... 진정해야 돼. 아 몰라',
    zh: '等等我得冷、冷静一下... 算了',
    it: 'aspetta devo calmami... calmarmi. vabbè'
  },
  countRageStreakLoss: {
    de: '{bar} wir waren bei **{streak}**. BEI {streak}. ich hab jede einzelne zahl gesehn 😭',
    en: '{bar} we were at **{streak}**. AT {streak}. i watched every single number happen 😭',
    fr: '{bar} on était à **{streak}**. À {streak}. j’ai vu passer chaque nombre 😭',
    es: '{bar} estábamos en **{streak}**. EN {streak}. vi pasar cada número 😭',
    pt: '{bar} a gente tava no **{streak}**. NO {streak}. eu vi cada número passar 😭',
    ru: '{bar} мы дошли до **{streak}**. ДО {streak}. я видел каждое число 😭',
    ja: '{bar} **{streak}** まで来てた。{streak} だよ。全部の数字を見守ってたのに 😭',
    ko: '{bar} **{streak}**까지 왔었다고. {streak}. 숫자 하나하나 다 지켜봤는데 😭',
    zh: '{bar} 我们都到 **{streak}** 了。{streak} 啊。每一个数我都看着过来的 😭',
    it: '{bar} eravamo a **{streak}**. A {streak}. li ho visti passare tutti quei numeri 😭'
  },
  countRageAftershock: {
    de: '{bar} mein prozessor macht grade geräusche die ein prozessor nich machen sollte',
    en: '{bar} my processor is making noises a processor shoud not make',
    fr: '{bar} mon processeur fait des bruits qu’un processeur devrait vraimnt pas faire',
    es: '{bar} mi procesador hace ruidos que un procesador no deberia hacer',
    pt: '{bar} meu processador tá fazendo barulhos que um processador não devia fazer',
    ru: '{bar} мой процессор издаёт звуки которые процессор издавать не долежн',
    ja: '{bar} プロセッサから絶対しちゃいけない音がしてる',
    ko: '{bar} 내 프로세서에서 나면 안 되는 소리가 나고 잇어',
    zh: '{bar} 我的处理器正在发出处理器绝对不该有的声音',
    it: '{bar} il mio processore fa rumori che un processore non dovrebe fare'
  },
  countRageCatastrophe: {
    de: '{bar} **{streak}** ZAHLEN. einfach weg. ich werd nie wieder der selbe bot sein',
    en: '{bar} **{streak}** NUMBERS. just gone. i will never be the same bot again',
    fr: '{bar} **{streak}** NOMBRES. envolés. je serai plus jamais le même bot',
    es: '{bar} **{streak}** NÚMEROS. desaparecidos. nunca volveré a ser el mismo bot',
    pt: '{bar} **{streak}** NÚMEROS. sumiram. eu nunca mais vou ser o mesmo bot',
    ru: '{bar} **{streak}** ЧИСЕЛ. просто исчезли. я уже никогда не буду прежним ботом',
    ja: '{bar} **{streak}** 個の数字が。全部消えた。もう前のBotには戻れない',
    ko: '{bar} 숫자 **{streak}**개가. 그냥 사라졌어. 난 이제 예전의 봇이 아니야',
    zh: '{bar} **{streak}** 个数字。全没了。我再也不是以前那个机器人了',
    it: '{bar} **{streak}** NUMERI. spariti. non sarò mai più lo stesso bot'
  },
  countRageReset1: {
    de: 'ok... wieder bei **1**. ganz ruhig. wir kriegn das hin. glaub ich',
    en: 'ok... back to **1**. stay calm. we can do thsi. i think',
    fr: 'ok... retour à **1**. on respire. on va y ariver. je crois',
    es: 'ok... otra vez en **1**. tranquilos. podemso hacerlo. creo',
    pt: 'ok... de volta ao **1**. calma. a gente consgue. eu acho',
    ru: 'ладно... снова **1**. спокойно. мы справимя. наверное',
    ja: 'おけ... **1** に戻る。落ち着こう。たぶんできる、たぶん',
    ko: '오케... 다시 **1**. 진정하자. 할 수 이써. 아마도',
    zh: '好... 回到 **1**。冷静。我们能行的。大概',
    it: 'ok... si torna a **1**. calma. ce la faccimo. credo'
  },
  countRageReset2: {
    de: 'also nochmal ab **1**. und diesma— diesmal bitte richtig',
    en: 'so again from **1**. and thsi ti— this time please get it right',
    fr: 'donc on reprend à **1**. et cete fo— cette fois correctement svp',
    es: 'otra vez desde **1**. y esta ve— esta vez bien por favor',
    pt: 'então de novo no **1**. e dessa ve— dessa vez certo por favor',
    ru: 'значит снова с **1**. и в этот ра— в этот раз правильно пожалуйста',
    ja: 'じゃあ **1** から。こんどこ、今度こそちゃんとお願い',
    ko: '그럼 다시 **1**부터. 이버네— 이번에는 제발 제대로',
    zh: '所以再从 **1**。这次一、这一次拜托数对',
    it: 'quindi di nuovo da **1**. e stavol— stavolta giusto per favore'
  },
  countRageReset3: {
    de: 'alles auf **0**. der nächste schreibt **1**. ich brauch kurz',
    en: 'everything is at **0**. next person writes **1**. i need a minute',
    fr: 'tout est à **0**. le prochain écrit **1**. laissez-moi une seconde',
    es: 'todo a **0**. el siguiente escribe **1**. necesito un momento',
    pt: 'tudo em **0**. o próximo manda **1**. preciso de um minuto',
    ru: 'всё на **0**. следующий пишет **1**. мне нужна минутка',
    ja: '全部 **0**。次の人は **1**。ちょっと時間ちょうだい',
    ko: '전부 **0**. 다음 사람은 **1**. 나 잠깐만',
    zh: '全部归 **0**。下一个人写 **1**。让我缓一下',
    it: 'tutto a **0**. il prossimo scrive **1**. mi serve un attimo'
  },
  countRageReset4: {
    de: 'von vorne. **1**. ich vertrau euch jetzt einfach nochmal (mein fehler)',
    en: 'from the top. **1**. i am just trusting you all again (my mistake)',
    fr: 'on recommence. **1**. je vous fais encore confiance (mon erreur)',
    es: 'desde el principio. **1**. vuelvo a confiar en ustedes (error mío)',
    pt: 'do começo. **1**. vou confiar em vocês de novo (erro meu)',
    ru: 'сначала. **1**. я снова вам доверюсь (моя ошибка)',
    ja: '最初から。**1**。もう一回みんなを信じる（これが間違い）',
    ko: '처음부터. **1**. 다들 다시 믿어볼게 (내 실수지)',
    zh: '从头来。**1**。我再信你们一次（是我的错）',
    it: 'da capo. **1**. mi fido di nuovo di voi (errore mio)'
  },

  countRageTitle1: { de: '😱 {user} WAS... nein. WIE KONNTEST DU NUR?!', en: '😱 {user} … HOW COULD YOU?!', fr: '😱 {user} … COMMENT AS-TU PU ?!', es: '😱 {user}… ¿¡CÓMO PUDISTE!?', pt: '😱 {user}… COMO VOCÊ PÔDE?!', ru: '😱 {user}… КАК ТЫ МОГ?!', ja: '😱 {user}… よくもやってくれたね！？', ko: '😱 {user}님… 어떻게 이럴 수가?!', zh: '😱 {user}……你怎么能这样？！', it: '😱 {user}… COME HAI POTUTO?!' },
  countRageTitle2: { de: '🔔 NEIN NEIN NEIN {user} SAG MIR DAS WAR EIN TYPO', en: '🔔 SHAME ON YOU, {user}! THE WHOLE SERVER IS WATCHING YOU!', fr: '🔔 HONTE À TOI, {user} ! TOUT LE SERVEUR TE REGARDE !', es: '🔔 ¡QUÉ VERGÜENZA, {user}! ¡TODO EL SERVIDOR TE ESTÁ MIRANDO!', pt: '🔔 QUE VERGONHA, {user}! O SERVIDOR INTEIRO ESTÁ OLHANDO PARA VOCÊ!', ru: '🔔 КАК НЕ СТЫДНО, {user}! ВЕСЬ СЕРВЕР СМОТРИТ НА ТЕБЯ!', ja: '🔔 {user}、恥を知りなさい！サーバー中の視線が君に集まっている！', ko: '🔔 {user}님, 부끄러운 줄 아세요! 서버 전체가 지켜보고 있어요!', zh: '🔔 {user}，你不害臊吗！全服的人都在看着你！', it: '🔔 VERGOGNATI, {user}! TUTTO IL SERVER TI STA GUARDANDO!' },
  countRageTitle3: { de: '💥 warte— WAS?! {user} HAT GERADE DIE MATHEMATIK ZERSTÖRT', en: '💥 EMERGENCY! {user} HAS DESTROYED MATH!', fr: '💥 URGENCE ! {user} A DÉTRUIT LES MATHÉMATIQUES !', es: '💥 ¡EMERGENCIA! ¡{user} HA DESTRUIDO LAS MATEMÁTICAS!', pt: '💥 EMERGÊNCIA! {user} DESTRUIU A MATEMÁTICA!', ru: '💥 ТРЕВОГА! {user} УНИЧТОЖИЛ МАТЕМАТИКУ!', ja: '💥 緊急事態！{user} が数学を破壊した！', ko: '💥 비상! {user}님이 수학을 파괴했어요!', zh: '💥 紧急情况！{user} 摧毁了数学！', it: '💥 EMERGENZA! {user} HA DISTRUTTO LA MATEMATICA!' },
  countRageTitle4: { de: '🚨 {user} ICH WAR ZWEI SEKUNDEN WEG. ZWEI.', en: '🚨 {user}, YOU HAVE OFFENDED THE COUNTING GOD!', fr: '🚨 {user}, TU AS OFFENSÉ LE DIEU DU COMPTAGE !', es: '🚨 {user}, ¡HAS OFENDIDO AL DIOS DEL CONTEO!', pt: '🚨 {user}, VOCÊ OFENDEU O DEUS DA CONTAGEM!', ru: '🚨 {user}, ТЫ ОСКОРБИЛ БОГА СЧЁТА!', ja: '🚨 {user}、カウントの神を怒らせたね！', ko: '🚨 {user}님, 카운팅의 신을 화나게 했어요!', zh: '🚨 {user}，你冒犯了计数之神！', it: '🚨 {user}, HAI OFFESO IL DIO DEL CONTEGGIO!' },
  countRageBody1: { de: 'Es sollte **{expected}** kommen. Du hast **{got}** geschrieben. WIE SOLL ICH DA RUHIG BLEIBEN?! ZURÜCK AUF **1**!', en: 'It should have been **{expected}**. You wrote **{got}**. HOW AM I SUPPOSED TO STAY CALM?! BACK TO **1**!', fr: 'Il fallait écrire **{expected}**. Tu as mis **{got}**. COMMENT VEUX-TU QUE JE RESTE CALME ?! ON REPART À **1** !', es: 'Tocaba **{expected}**. Tú escribiste **{got}**. ¿¡CÓMO SE SUPONE QUE ME QUEDE TRANQUILO!? ¡DE VUELTA AL **1**!', pt: 'Era para vir **{expected}**. Você escreveu **{got}**. COMO EU VOU FICAR CALMO?! DE VOLTA AO **1**!', ru: 'Должно было быть **{expected}**. Ты написал **{got}**. КАК ТУТ ОСТАВАТЬСЯ СПОКОЙНЫМ?! СНОВА **1**!', ja: '**{expected}** のはずだった。君が書いたのは **{got}**。これで落ち着いていられると思う？**1** に戻る！', ko: '**{expected}**이어야 했는데 **{got}**을 쓰셨네요. 제가 어떻게 침착하겠어요?! 다시 **1**!', zh: '本来应该是 **{expected}**。你却写了 **{got}**。我怎么可能冷静？！回到 **1**！', it: 'Doveva esserci **{expected}**. Tu hai scritto **{got}**. COME FACCIO A RESTARE CALMO?! SI TORNA A **1**!' },
  countRageBody2: { de: 'Wir waren bei **{expected}**, {user}. **{expected}**! Und du kommst mit **{got}** an?! DER ZÄHLER WEINT. Neustart bei **1**.', en: 'We were at **{expected}**, {user}. **{expected}**! And you show up with **{got}**?! THE COUNTER IS CRYING. Restart at **1**.', fr: 'On en était à **{expected}**, {user}. **{expected}** ! Et tu arrives avec **{got}** ?! LE COMPTEUR PLEURE. On repart à **1**.', es: 'Íbamos por **{expected}**, {user}. ¡**{expected}**! ¿Y llegas con **{got}**?! EL CONTADOR ESTÁ LLORANDO. Reinicio en **1**.', pt: 'Estávamos no **{expected}**, {user}. **{expected}**! E você chega com **{got}**?! O CONTADOR ESTÁ CHORANDO. Recomeço no **1**.', ru: 'Мы были на **{expected}**, {user}. На **{expected}**! А ты приходишь с **{got}**?! СЧЁТЧИК ПЛАЧЕТ. Заново с **1**.', ja: '**{expected}** まで来てたんだよ、{user}。**{expected}**！なのに **{got}** って何？カウンターが泣いてる。**1** から再開。', ko: '**{expected}**까지 왔었잖아요, {user}님. **{expected}**! 그런데 **{got}**이라니?! 카운터가 울고 있어요. **1**부터 다시.', zh: '我们都到 **{expected}** 了，{user}。**{expected}**！结果你写了个 **{got}**？！计数器都哭了。从 **1** 重新开始。', it: 'Eravamo a **{expected}**, {user}. **{expected}**! E tu arrivi con **{got}**?! IL CONTATORE STA PIANGENDO. Si riparte da **1**.' },
  countRageBody3: { de: '{user}, nicht mal ein Taschenrechner könnte dich retten. **{got}** statt **{expected}** – das geht in die Geschichtsbücher ein. Von vorn: **1**.', en: '{user}, not even a calculator could save you. **{got}** instead of **{expected}** – this is going in the history books. From the top: **1**.', fr: '{user}, même une calculatrice ne pourrait pas te sauver. **{got}** au lieu de **{expected}** — ça rentre dans les livres d’histoire. On repart à **1**.', es: '{user}, ni una calculadora te salvaría. **{got}** en vez de **{expected}**: esto pasa a los libros de historia. Desde el principio: **1**.', pt: '{user}, nem uma calculadora te salvaria. **{got}** em vez de **{expected}** – isso vai para os livros de história. Do começo: **1**.', ru: '{user}, тебя не спасёт даже калькулятор. **{got}** вместо **{expected}** — это войдёт в учебники истории. Сначала: **1**.', ja: '{user}、電卓でも君は救えないよ。**{expected}** のはずが **{got}** — これは歴史に残るね。最初から：**1**。', ko: '{user}님, 계산기로도 못 구해요. **{expected}** 대신 **{got}** — 이건 역사책에 실릴 일이에요. 처음부터: **1**.', zh: '{user}，连计算器都救不了你。**{expected}** 写成了 **{got}**——这要载入史册。从头开始：**1**。', it: '{user}, non ti salverebbe nemmeno una calcolatrice. **{got}** invece di **{expected}**: finisce nei libri di storia. Da capo: **1**.' },
  countRageBody4: { de: 'Ich fasse es nicht. **{expected}** war dran, und du servierst uns **{got}**. Alle auf Anfang – **1**!', en: 'I can’t believe it. **{expected}** was next, and you serve us **{got}**. Everyone back to **1**!', fr: 'Je n’y crois pas. **{expected}** était le suivant, et tu nous sers **{got}**. Tout le monde repart à **1** !', es: 'No me lo creo. Tocaba **{expected}** y nos sirves **{got}**. ¡Todos de vuelta al **1**!', pt: 'Não acredito. Era a vez do **{expected}** e você nos serve **{got}**. Todo mundo de volta ao **1**!', ru: 'Не верю. Следующим было **{expected}**, а ты подаёшь нам **{got}**. Все снова на **1**!', ja: '信じられない。次は **{expected}** だったのに、君が出したのは **{got}**。みんな、**1** から！', ko: '믿을 수가 없네요. 다음은 **{expected}**이었는데 **{got}**을 주시다니. 모두 다시 **1**부터!', zh: '我简直不敢相信。接下来应该是 **{expected}**，你却给我们端上 **{got}**。大家都回到 **1**！', it: 'Non ci credo. Toccava **{expected}** e tu ci servi **{got}**. Tutti di nuovo a **1**!' },

  helpTitle: { de: '🎮 MINIGAMES BOT – BATTLE HUB', en: '🎮 MINIGAMES BOT – BATTLE HUB', fr: '🎮 BOT MINI-JEUX – ARÈNE', es: '🎮 BOT DE MINIJUEGOS – ARENA', pt: '🎮 BOT DE MINIGAMES – ARENA', ru: '🎮 БОТ МИНИ-ИГР – АРЕНА', ja: '🎮 ミニゲームBOT – バトルハブ', ko: '🎮 미니게임 봇 – 배틀 허브', zh: '🎮 小游戏机器人 – 对战中心', it: '🎮 BOT MINIGIOCHI – ARENA' },
  helpDesc: { de: 'Fordere Freunde heraus, nimm Battles an und kläre direkt im Channel, wer gewinnt.', en: 'Challenge friends, accept battles, and settle who wins right in the channel.', fr: 'Défie tes amis et découvre directement dans le salon qui gagne.', es: 'Desafía a tus amigos y decidid en el canal quién gana.', pt: 'Desafie amigos e descubra no canal quem vence.', ru: 'Вызывай друзей и выясняй победителя прямо в канале.', ja: '友達に挑戦し、チャンネルで勝者を決めよう。', ko: '친구에게 도전하고 채널에서 바로 승자를 가려보세요.', zh: '挑战好友，直接在频道中决出胜负。', it: 'Sfida gli amici e decidete nel canale chi vince.' },
  helpPlay: { de: 'Wähle **Tic-Tac-Toe** oder **Vier Gewinnt**. Der Gegner ist optional – ohne Angabe darf jeder antreten. Wer beginnt, entscheidet der Zufall.', en: 'Choose **Tic-Tac-Toe** or **Connect Four**. The opponent is optional—if empty, anyone can join. The starting player is random.', fr: 'Choisis le **Morpion** ou **Puissance 4**. L’adversaire est facultatif : sans lui, tout le monde peut jouer. Le premier joueur est tiré au sort.', es: 'Elige **Tres en raya** o **Conecta 4**. El rival es opcional: si lo dejas vacío, puede unirse cualquiera. Quién empieza es al azar.', pt: 'Escolha **Jogo da velha** ou **Ligue 4**. O adversário é opcional — sem ele, qualquer um entra. Quem começa é sorteado.', ru: 'Выбери **Крестики-нолики** или **Четыре в ряд**. Соперник необязателен — тогда сыграть может любой. Первый ход определяется случайно.', ja: '**三目並べ**か**四目並べ**を選択。相手の指定は任意で、未指定なら誰でも参加できます。先手はランダムです。', ko: '**틱택토** 또는 **사목**을 고르세요. 상대는 선택 사항이라 비워두면 누구나 참여할 수 있고, 선공은 무작위예요.', zh: '选择**井字棋**或**四子棋**。对手为可选项，留空则任何人都能加入，先手随机决定。', it: 'Scegli **Tris** o **Forza 4**. L’avversario è facoltativo: se vuoto può unirsi chiunque. Chi inizia è casuale.' },
  helpCounting: { de: 'Legt einen Counting-Channel fest: Zählen ab **1**, niemand zweimal hintereinander, bei Fehlern geht es von vorne los. Nur für Admins.', en: 'Sets a counting channel: count from **1**, never twice in a row, mistakes reset everything. Admins only.', fr: 'Définit un salon de comptage : on compte depuis **1**, jamais deux fois de suite, une erreur remet à zéro. Admins uniquement.', es: 'Define un canal de conteo: se cuenta desde **1**, nunca dos veces seguidas, un fallo lo reinicia. Solo admins.', pt: 'Define um canal de contagem: conte a partir de **1**, nunca duas vezes seguidas, erros reiniciam tudo. Apenas admins.', ru: 'Назначает канал для счёта: считаем с **1**, не дважды подряд, ошибка сбрасывает всё. Только для админов.', ja: 'カウントチャンネルを設定します：**1** から数え、連続投稿は禁止、間違いで最初から。管理者専用。', ko: '카운팅 채널을 지정해요: **1**부터 세고, 연속 금지, 틀리면 처음부터. 관리자 전용.', zh: '设置计数频道：从 **1** 开始，不能连续数两次，出错则重来。仅限管理员。', it: 'Imposta un canale di conteggio: si conta da **1**, mai due volte di fila, un errore azzera tutto. Solo admin.' },
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
  apDetailVoice: { de: '**Call:** {status}' }, apDetailGames: { de: '**Laufende Battles:** {count}' },
  apBtnBack: { de: '← Zurück' }, apBtnInvite: { de: '🔗 Einladung' },
  apBtnCallJoin: { de: '🔊 Call joinen' }, apBtnCallLeave: { de: '🔇 Call verlassen' },
  apBtnLeave: { de: '🚪 Verlassen' },
  apBtnLeaveConfirm: { de: 'Ja, verlassen' }, apBtnLeaveCancel: { de: 'Abbrechen' },
  apLeaveAsk: { de: 'Soll der Bot **{name}** wirklich verlassen?' },
  apInviteSent: { de: 'Einladung erstellt (1 Stunde, einmal nutzbar):' }, apInviteLink: { de: '{url}' },
  apInviteFailed: { de: '❌ Einladung fehlgeschlagen: {error}' }, apLeft: { de: '✅ Server **{name}** verlassen.' },
  apCallJoined: { de: '✅ Der Bot ist jetzt still in {channel} und hält die Verbindung aktiv.' },
  apCallLeft: { de: '✅ Der Bot hat den Call verlassen.' },
  apCallFailed: { de: '❌ Call-Aktion fehlgeschlagen: {error}' },
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
