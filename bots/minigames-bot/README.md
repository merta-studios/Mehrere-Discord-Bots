# 🎮 Minigames Bot – Battles direkt im Discord-Channel

Der frühere Verify-Bot wurde vollständig durch diesen Minigames-Bot ersetzt.
Alle Regeln-, Rollen- und Verifizierungsfunktionen wurden entfernt. Zum Start
sind genau zwei Spiele enthalten: **Tic-Tac-Toe** und **Vier Gewinnt**.

## Befehle

| Befehl | Funktion |
|---|---|
| `/play [game] [gegner]` | Startet im aktuellen Channel eine öffentliche Herausforderung. `game` bietet **Tic-Tac-Toe** und **Vier Gewinnt** zur Auswahl; `gegner` ist ein Servermitglied. |
| `/set_language [sprache]` | Nur Admins: wählt die Sprache für zukünftige Battles. Es stehen 10 Sprachen zur Wahl. |
| `/admin_set_bot_profile [image]` | Nur Admins: setzt das serverspezifische Bot-Bild auf Standard, Server-Icon oder Owner-Profilbild. |
| `/help` | Zeigt Spiele, Ablauf und Befehle. |
| `/adminpanel` | Owner-Panel im DM: Serverliste, Einladungslink und Server verlassen. |

## Ablauf einer Herausforderung

1. Ein Spieler nutzt `/play`, wählt ein Spiel und einen Gegner.
2. Im selben Channel erscheint eine auffällige Battle-Anfrage. Der Gegner wird
   gepingt und kann **annehmen** oder **ablehnen**.
3. Nur der ausgewählte Gegner darf die Anfrage bedienen. Selbst-Herausforderungen
   und Bot-Gegner werden abgewiesen.
4. Erfolgt innerhalb von **einer Stunde** keine Annahme, läuft die Anfrage ab und
   ihre Buttons werden deaktiviert. Der Minuten-Scheduler aktualisiert sie auch
   ohne weiteren Klick.
5. Nach der Annahme wird dieselbe Nachricht direkt zum interaktiven Spielfeld.
   Nur der Spieler, der gerade am Zug ist, kann einen gültigen Zug setzen.

Gleichzeitige Klicks werden pro Nachricht serialisiert. Spielstand, Spieler,
Sprache und Ablaufzeit stecken als vollständig unsichtbarer Marker in der
Discord-Nachricht. Deshalb laufen offene Spiele nach Bot- oder Render-Neustarts
weiter; eine Datenbank ist nicht erforderlich.

## Spiele

### ❌ Tic-Tac-Toe ⭕

- **Genau ein Spielfeld:** das 3×3-Raster besteht selbst aus Buttons. Es gibt
  kein zusätzliches Text-Brett mehr über den Buttons.
- Herausforderer spielt ❌ und beginnt, Gegner spielt ⭕
- Belegte Felder werden deaktiviert, die Gewinnlinie wird grün
- Sieg und Unentschieden erscheinen als kurze Zeile unter dem Feld

### 🔴 Vier Gewinnt 🟡

- **5×6-Spielfeld** – bewusst fünf statt sieben Spalten, weil Discord genau
  fünf Buttons pro Reihe erlaubt.
- **Alle fünf Drop-Buttons stehen dadurch in einer einzigen Reihe** direkt
  unter dem Brett: der erste Button gehört zur ersten Spalte, der zweite zur
  zweiten und so weiter. Spaltennummern muss niemand mehr abzählen.
- Jeder Button zeigt nur ⬇️ – anklicken, Chip fällt auf das unterste freie Feld
- Volle Spalten werden ausgegraut und deaktiviert
- Horizontale, vertikale und diagonale Viererreihen werden erkannt und als
  🟥/🟨 hervorgehoben

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
- Intents: **Server Members Intent** aktivieren
- Rechte: Kanäle ansehen, Nachrichten senden, Links einbetten; für das
  Owner-Panel optional Einladungen erstellen; für den Profilbefehl das
  serverspezifische Profil bearbeiten
