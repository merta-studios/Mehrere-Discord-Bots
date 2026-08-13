# 🎮 Minigames Bot – Battles direkt im Discord-Channel

Der frühere Verify-Bot wurde vollständig durch diesen Minigames-Bot ersetzt.
Alle Regeln-, Rollen- und Verifizierungsfunktionen wurden entfernt. Enthalten
sind zwei Battle-Spiele – **Tic-Tac-Toe** und **Vier Gewinnt** – sowie das
Dauer-Spiel **Counting** für einen eigenen Channel.

## Befehle

| Befehl | Funktion |
|---|---|
| `/play [game] (gegner)` | Startet im aktuellen Channel eine öffentliche Herausforderung. `game` bietet **Tic-Tac-Toe** und **Vier Gewinnt** zur Auswahl. `gegner` ist **optional**: ohne Angabe darf jeder beitreten. |
| `/set_language [sprache]` | Nur Admins: wählt die Sprache für zukünftige Battles. Es stehen 10 Sprachen zur Wahl. |
| `/set_counting_channel [channel] (aktiv)` | Nur Admins: erklärt einen Textkanal zum Counting-Channel. `aktiv: False` schaltet ihn wieder ab. |
| `/admin_set_bot_profile [image]` | Nur Admins: setzt das serverspezifische Bot-Bild auf Standard, Server-Icon oder Owner-Profilbild. |
| `/help` | Zeigt Spiele, Ablauf und Befehle. |
| `/adminpanel` | Owner-Panel im DM: Serverliste, Einladungslink und Server verlassen. |

## Ablauf einer Herausforderung

1. Ein Spieler nutzt `/play` und wählt ein Spiel. Ein Gegner **kann** angegeben
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

### 🔢 Counting

`/set_counting_channel #channel` erklärt einen Textkanal zum Zähl-Kanal.

- **Gemerkt wird der Channel im Kanal-Thema** – passend zum datenbanklosen
  Konzept des Bots. Sichtbar steht dort `🔢 Counting-Channel | Aktuelle Zahl: 42`,
  direkt dahinter ein unsichtbarer Marker, den nur der Bot liest. Ein bereits
  vorhandenes Thema bleibt erhalten.
- **Es beginnt bei 1.** Jede Zahl muss genau die nächste sein.
- **Niemand darf zweimal hintereinander zählen** – es muss immer abgewechselt
  werden.
- Der Bot reagiert auf jede gültige Zahl mit **✅**, auf eine falsche mit **❌**.
- **Falsche Zahl → Neustart bei 1**, und der Bot outet die Person mit einem von
  sechs wechselnden Sprüchen (in allen 10 Sprachen).
- **Zwei Zahlen derselben Person hintereinander** → Nachricht wird nur
  **gelöscht**, der Zählstand bleibt stehen.
- **Text statt Zahl** → Nachricht wird ebenfalls nur gelöscht, kein Neustart.
- **Bots und Webhooks spielen nicht mit** – ihre Nachrichten werden ignoriert.
- Zum Löschen braucht der Bot *Nachrichten verwalten*, zum Speichern des
  Zählstands *Kanal verwalten*. Fehlt ein Recht, sagt der Command das direkt.
- `/set_counting_channel #channel aktiv:False` schaltet den Kanal wieder ab und
  räumt das Thema auf.

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
stellt die Sprache ohne externe Datenbank wieder her.

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
  *Kanal verwalten*; für das Owner-Panel optional Einladungen erstellen; für
  den Profilbefehl das serverspezifische Profil bearbeiten
