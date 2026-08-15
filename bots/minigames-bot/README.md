# 🎮 Minigames Bot – Battles direkt im Discord-Channel

Der frühere Verify-Bot wurde vollständig durch diesen Minigames-Bot ersetzt.
Alle Regeln-, Rollen- und Verifizierungsfunktionen wurden entfernt. Enthalten
sind zwei Battle-Spiele – **Tic-Tac-Toe** und **Vier Gewinnt** –, der
Single-Player-Modus mit **2048** sowie das Dauer-Spiel **Counting** für einen
eigenen Channel.

## Befehle

| Befehl | Funktion |
|---|---|
| `/multiplayer [game] (gegner)` | **Früher `/play`.** Startet im aktuellen Channel eine öffentliche Herausforderung. `game` bietet **Tic-Tac-Toe** und **Vier Gewinnt** zur Auswahl. `gegner` ist **optional**: ohne Angabe darf jeder beitreten. |
| `/singleplayer [game]` | Startet eine Solo-Runde – ohne Gegner, sofort spielbar. `game` bietet derzeit **2048**. |
| `/set_language [sprache]` | Nur Admins: wählt die Sprache für zukünftige Battles. Es stehen 10 Sprachen zur Wahl. |
| `/set_counting_channel [channel] (aktiv)` | Nur Admins: erklärt einen Textkanal zum Counting-Channel. `aktiv: False` schaltet ihn wieder ab. |
| `/admin_set_bot_profile [image]` | Nur Admins: setzt das serverspezifische Bot-Bild auf Standard, Server-Icon oder Owner-Profilbild. |
| `/help` | Zeigt Spiele, Ablauf und Befehle. |
| `/adminpanel` | Owner-Panel im DM: Serverliste, Einladungslink, still einen Call joinen/verlassen und Server verlassen. |

## Ablauf einer Herausforderung

1. Ein Spieler nutzt `/multiplayer` und wählt ein Spiel. Ein Gegner **kann** angegeben
   werden, muss aber nicht.
2. Im selben Channel erscheint eine auffällige Battle-Anfrage:
   - **Mit Gegner:** die genannte Person wird gepingt und kann **annehmen**
     oder **ablehnen**. Niemand sonst darf die Buttons bedienen.
   - **Ohne Gegner:** die Anfrage sagt, dass der Spieler jemanden sucht. Dann
     darf **jeder** auf *Antreten* klicken – wer zuerst klickt, spielt. Der
     Herausforderer selbst kann nur abbrechen, nicht beitreten.
3. Selbst-Herausforderungen und Bot-Gegner werden abgewiesen.
4. Erfolgt innerhalb von **einer Stunde** keine Annahme, läuft die Anfrage ab und
   ihre Buttons werden deaktiviert. Der Minuten-Scheduler aktualisiert sie auch
   ohne weiteren Klick.
5. Nach der Annahme wird dieselbe Nachricht direkt zum interaktiven Spielfeld.
   **Wer beginnt, wird ausgelost** – nicht automatisch der Command-Nutzer. Nur
   der Spieler, der gerade am Zug ist, kann einen gültigen Zug setzen.

Gleichzeitige Klicks werden pro Nachricht serialisiert. Spielstand, Spieler,
Sprache und Ablaufzeit stecken als vollständig unsichtbarer Marker in der
Discord-Nachricht. Deshalb laufen offene Spiele nach Bot- oder Render-Neustarts
weiter; eine Datenbank ist nicht erforderlich.

## Spiele

### ❌ Tic-Tac-Toe ⭕

- **Genau ein Spielfeld:** das 3×3-Raster besteht selbst aus Buttons. Es gibt
  kein zusätzliches Text-Brett mehr über den Buttons.
- Herausforderer spielt ❌, Gegner ⭕ – **der Startspieler wird ausgelost**
- Belegte Felder werden deaktiviert, die Gewinnlinie wird grün
- Sieg und Unentschieden erscheinen als kurze Zeile unter dem Feld

### 🔴 Vier Gewinnt 🟡

- **Klassische Größe: 7×6** – sieben Spalten, sechs Reihen, genau wie das
  Original.
- **Steuerung per Zeiger statt Spalten-Buttons.** Discord erlaubt hart nur
  fünf Buttons pro Reihe – sieben Spalten-Buttons in *einer* Reihe sind
  technisch unmöglich. Statt das Brett zu verkleinern oder die Buttons auf
  zwei Reihen zu verteilen, steuert genau **eine** Reihe mit fünf Buttons das
  volle 7er-Brett:

  ```
  🔽⬛⬛⬛⬛⬛⬛      ← Zeiger direkt über dem Brett
  ⚫⚫⚫⚫⚫⚫⚫
  ⚫⚫⚫⚫⚫⚫⚫
  ⚫⚫⚫⚫🔴⚫⚫
  ⚫⚫⚫🟡🔴⚫⚫
  ⚫⚫🔴🟡🟡⚫⚫
  ⚫🟡🔴🔴🟡⚫⚫
  [ ⏮️ ][ ◀️ ][ ⬇️ ][ ▶️ ][ ⏭️ ]
  ```

  `⏮️`/`⏭️` springen zur ersten bzw. letzten freien Spalte, `◀️`/`▶️` gehen
  einen Schritt (mit Umlauf) und **überspringen volle Spalten**, `⬇️` wirft
  den Chip.
- **Kein Versatz mehr zwischen Brett und Steuerung.** Das Brett besteht aus
  gleich breiten Emoji ohne Trennzeichen, und die Zeiger-Zeile nutzt dieselbe
  Breite (⬛ als unsichtbarer Platzhalter). Der 🔽 steht damit exakt über
  seiner Spalte – unabhängig davon, wie viele Buttons darunter liegen.
- Volle Spalten sind für den Zeiger tabu; ist die Zielspalte voll, wird ⬇️
  deaktiviert.
- Horizontale, vertikale und diagonale Viererreihen werden erkannt und als
  🟥/🟨 hervorgehoben.

### 🧩 2048 – der Single-Player-Modus

`/singleplayer game:2048` legt sofort ein eigenes Brett im Channel an. Kein
Gegner, keine Annahme, kein Warten – die Runde läuft direkt los.

- **Originalgetreue Mechanik.** 4×4, Start mit zwei Steinen, neue Steine sind
  zu 90 % eine 2 und zu 10 % eine 4. Gleiche Zahlen verschmelzen, aber jeder
  Stein **nur einmal pro Zug** – aus `2 2 2 2` wird `4 4`, nicht `8`.
- **Farbiges Brett statt Zahlenwüste.** Das Feld steckt in einem
  `ansi`-Codeblock: Auf Desktop und Web bekommt jeder Stein seine eigene Farbe
  im Stil des Originals, auf dem Handy rendert Discord denselben Block sauber
  monospaced. Weil alle Zellen exakt gleich breit sind, bleibt das Raster
  überall bündig.

  ```
  ┏━━━━━━┳━━━━━━┳━━━━━━┳━━━━━━┓
  ┃  2   ┃  4   ┃  8   ┃  16  ┃
  ┣━━━━━━╋━━━━━━╋━━━━━━╋━━━━━━┫
  ┃  32  ┃  64  ┃ 128  ┃ 256  ┃
  ┣━━━━━━╋━━━━━━╋━━━━━━╋━━━━━━┫
  ┃ 512  ┃ 1024 ┃[2048]┃ 4096 ┃
  ┣━━━━━━╋━━━━━━╋━━━━━━╋━━━━━━┫
  ┃  ·   ┃  2   ┃  ·   ┃  8   ┃
  ┗━━━━━━┻━━━━━━┻━━━━━━┻━━━━━━┛
  ```

- **Man sieht, was der Zug bewirkt hat.** Der neu erschienene Stein ist
  unterstrichen, frisch verschmolzene Steine stehen in `[Klammern]` – das
  funktioniert auch dort, wo Discord keine Farben zeigt.
- **Kopfzeile mit allem Wichtigen:** Punktestand, der Gewinn des letzten Zuges
  (`+48`), bester Stein, Zugzähler und ein Fortschrittsbalken bis 2048. Dazu
  ein Rang, der mit dem besten Stein mitwächst – von *Frisch gestartet* bis
  *Unaufhaltsam*.
- **Echtes Steuerkreuz** statt Button-Salat: `⬆️` oben, darunter
  `⬅️ ⬇️ ➡️`. Unsichtbare, deaktivierte Platzhalter formen das Kreuz, weil
  Discord nur Reihen à fünf Buttons kennt. Richtungen, in die sich nichts
  bewegt, werden **automatisch deaktiviert**.
- **↩️ Zurück** nimmt genau einen Zug zurück (Brett, Punkte und Zugzahl),
  **🔄 Neue Runde** startet in derselben Nachricht neu.
- **2048 ist nicht das Ende.** Der Siegstein wird einmal gefeiert, danach geht
  es per **▶️ Weiterspielen** im Endlos-Modus Richtung 4096, 8192 …
- **Nur die startende Person spielt.** Alle anderen bekommen eine private
  Notiz mit dem Hinweis, ihre eigene Runde zu starten.
- **Datenbanklos wie alles andere:** Der komplette Spielstand – inklusive des
  Undo-Schritts – steckt unsichtbar in der Nachricht. Eine Runde überlebt
  Bot-Neustarts und Render-Deployments.


### 🔢 Counting

`/set_counting_channel #channel` erklärt einen Textkanal zum Zähl-Kanal.

- **Gemerkt wird der Channel im Kanal-Thema** – passend zum datenbanklosen
  Konzept des Bots. Sichtbar steht dort `🔢 Counting-Channel | Aktuelle Zahl: 42`,
  direkt dahinter ein unsichtbarer Marker, den nur der Bot liest. Dieser hält
  neben dem Zählstand auch die mit `/set_language` gewählte Sprache dauerhaft
  fest, sodass sie Neustarts und lange Chatverläufe überlebt. Ein bereits
  vorhandenes Thema bleibt erhalten.
- **Es beginnt bei 1.** Jede Zahl muss genau die nächste sein.
- **Niemand darf zweimal hintereinander zählen** – es muss immer abgewechselt
  werden.
- Der Bot reagiert auf jede gültige Zahl mit **✅**, auf eine falsche mit **❌**.
- **Nur der Bot darf im Counting-Channel reagieren.** Jede von Nutzern oder
  anderen Bots hinzugefügte Reaktion wird wieder entfernt – auch ein zusätzliches
  **✅** oder **❌**. Die Reaktion des Minigames-Bots selbst bleibt bestehen.
- **Falsche Zahl → Neustart bei 1**, und der Bot dreht jetzt **jedes Mal** in
  einer kleinen, menschlich wirkenden Chat-Sequenz durch: mehrere wechselnde
  Einstiege, abgebrochene Gedanken, absichtliche Tippfehler, Selbstkorrekturen,
  „tippt …“-Anzeige und variierende Schreibpausen. Die Intensität und Länge
  steigen mit dem zerstörten Streak (Stufen ab 10/50/100), bleiben aber hart
  auf höchstens sieben kurze Nachrichten begrenzt. Der Bot nennt immer die
  falsche und die erwartete Zahl, erwähnt die verursachende Person höchstens
  einmal und verschickt **keine Mass-Pings, DMs oder Rollenaktionen**.
- **Zwei Zahlen derselben Person hintereinander** → Nachricht wird nur
  **gelöscht**, der Zählstand bleibt stehen.
- **Text statt Zahl** → Nachricht wird ebenfalls nur gelöscht, kein Neustart.
- **Bots und Webhooks spielen nicht mit** – ihre Nachrichten werden ignoriert.
- Zum Löschen braucht der Bot *Nachrichten verwalten*, zum Speichern des
  Zählstands *Kanal verwalten*. Fehlt ein Recht, sagt der Command das direkt.
- `/set_counting_channel #channel aktiv:False` schaltet den Kanal wieder ab und
  räumt das Thema auf.

## 🔊 Stille Call-Präsenz im Owner-Panel

Nur der konfigurierte Bot-Owner kann diese Funktion im DM-`/adminpanel`
verwenden. In der Server-Detailansicht erscheint **Call joinen**:

- Gibt es bereits belegte, beitretbare Voice-Channels, joint der Bot den mit den
  meisten Mitgliedern. Bei Gleichstand wird zufällig gewählt.
- Sind alle beitretbaren Voice-Channels leer, wird einer zufällig gewählt.
- Der Bot startet keinen Audio-Player und joint stumm/taub. Ein 15-Sekunden-
  Watchdog stellt die gewünschte Verbindung nach einem unerwarteten Disconnect
  wieder her und weicht auf einen anderen Voice-Channel aus, falls das Ziel
  gelöscht oder nicht mehr beitretbar ist.
- Solange der Bot verbunden ist, heißt derselbe Button **Call verlassen**.

## Design-Prinzip der Spielfelder

Beide Spiele nutzen dieselbe, absichtlich schlanke Struktur:

```
## <Symbole> <Spielname>
❌ @Spieler1   ⭕ @Spieler2
⚡ Am Zug: @Spieler1 ❌
────────────────
[ Spielfeld-Buttons ]
```

Keine doppelten Bretter, keine Legenden, keine langen Erklärtexte – nur
Titel, Spieler, Zug-Anzeige und das Feld selbst.

## Sprachen

Deutsch, Englisch, Französisch, Spanisch, Portugiesisch (BR), Russisch,
Japanisch, Koreanisch, Chinesisch (CN) und Italienisch.

`/set_language` speichert die Server-Sprache zusätzlich unsichtbar in seiner
Bestätigungsnachricht. Beim Start sucht der Bot diese Markierung wieder und
stellt die Sprache ohne externe Datenbank wieder her. Die Counting-Kanal-Themen
werden nach der schnellen Command-Bestätigung best-effort im Hintergrund
synchronisiert; ein langsamer Discord-Request hält die Antwort nicht mehr fest.

## Command-Registrierung auf bestehenden Servern

`/play` heißt jetzt `/multiplayer`, dazu kommt `/singleplayer`. Damit diese
Änderung auf **allen Servern sichtbar wird, auf denen der Bot schon ist** –
und das alte `/play` dort nicht als Karteileiche hängen bleibt – registriert
der Bot beim Start zweigleisig:

1. **Global** wird der komplette Befehlssatz per `PUT` geschrieben. Ein
   globales `PUT` ersetzt den alten Satz vollständig, wodurch `/play`
   automatisch verschwindet. Das erreicht auch Server, die gerade nicht im
   Cache liegen – allerdings mit Discords Propagationsverzögerung.
2. **Zusätzlich als Guild-Commands** auf jeden Server im Cache. Guild-Commands
   sind **sofort** im `/`-Menü sichtbar, überschatten die globalen und werden
   ebenfalls komplett ersetzt. Dadurch sind `/multiplayer` und
   `/singleplayer` ohne Wartezeit da und `/play` sofort weg.

Ein Server, auf dem der Schreibversuch scheitert (z. B. fehlender
`applications.commands`-Scope), wird geloggt und übersprungen – die übrigen
Server werden trotzdem aktualisiert. Neue Server bekommen ihre Commands direkt
beim Join. Solange Discord den alten globalen `/play` noch ausliefert, bleibt
er intern auf den Multiplayer-Command verdrahtet und funktioniert weiter,
statt eine Fehlermeldung zu zeigen.

## Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `MINIGAMES_BOT_TOKEN` | Token der Discord-App |
| `MINIGAMES_BOT_OWNER_ID` | Owner für `/adminpanel` |
| `MINIGAMES_BOT_GUILD_ID` | Optional: Dev-Server für sofortige Command-Registrierung |

Für ein Update ohne neue Render-Konfiguration bleiben die früheren Variablen
`VERIFY_BOT_TOKEN`, `VERIFY_BOT_OWNER_ID` und `VERIFY_BOT_GUILD_ID` als
Fallback unterstützt. Es ist also kein neuer Bot-Token erforderlich.

## Benötigte Discord-Einstellungen

- Scopes: `bot`, `applications.commands`
- Intents: **Server Members Intent** und **Message Content Intent** aktivieren
  (Message Content wird für das Counting-Spiel gebraucht)
- Rechte: Kanäle ansehen, Nachrichten senden, Links einbetten, Reaktionen
  hinzufügen; für Counting zusätzlich *Nachrichten verwalten* und
  *Kanal verwalten*; für das Owner-Panel optional *Einladungen erstellen* und
  für die Call-Funktion *Verbinden*; für den Profilbefehl das serverspezifische
  Profil bearbeiten
