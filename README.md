# 🤖 Multi-Discord-Bot-Hoster

**Mehrere Discord-Bots gleichzeitig hosten – in EINEM Render-Server, mit EINEM kostenlosen Prozess.**

Dieses Repository ist ein komplettes Setup, um beliebig viele Discord-Bots parallel
auf **Render Free** zu betreiben. Jeder Bot hat seinen eigenen Ordner, seinen eigenen
Token (als Umgebungsvariable) und läuft unabhängig – aber alle in einem einzigen
Node.js-Prozess, damit ein einziger Render-Free-Dyno genügt.

> ⏰ **UptimeRobot**: Render-Free-Server schlafen nach ~15 Minuten Inaktivität ein.
> Deshalb pingt UptimeRobot den Health-Endpunkt regelmäßig – so bleiben ALLE Bots wach.

---

## 📦 Was ist drin?

| Bereich | Beschreibung |
|---|---|
| 🎂 **Birthday Bot** | Kompletter Geburtstags-Bot **ohne Datenbank** – modernes Container-Layout (Components V2, kein Farbrand, Trennlinien & Buttons im Container). 10 Sprachen, Fuzzy-Monatserkennung, 7-Tage-Regel, tägliche Geburtstags-Glückwünsche (**Glückwunsch-Liste kompakt nebeneinander mit Uhrzeit**), **7-Tage-Aufräumregel unter der Liste**, Owner-Admin-Panel im DM. |
| ⭐ **XP Level Bot** | **RAM-first & Turso-persistiert** – XP pro Wort (Spam-Erkennung krass, 3 XP/Wort, max 30, 30s Cooldown) + **15 XP für Bilder/Videos/Sprachnachrichten**, Level-Kurve 80→1999 XP, täglicher 5%-Basis-Schwund (bei Inaktivität steigend), Voice 25 XP/Min, Top15-Leaderboard **stündlich + bei Level-Ups**, Nicknames `[Lvl X 🥇]` (Top 3, **Rang-Verschiebungen werden zuverlässig nachgezogen**), **Level-Belohnungsrollen via Formular** (`/level_roles`), **`/update_leaderboard` (Admin, 5-Min-Cooldown)**, /rank + /setup (2 Kanäle) + Adminpanel. |
| 💘 **Love Tester Bot** | Schätzt die Liebe zwischen zwei Personen anhand eurer Chatverläufe – **10 Sprachen, humorvolle Groq-Analyse** (`/test_love` mit Datenschutz-Bestätigung & Live-Fortschritt %), `/setup`-Assistent (3 Schritte: Sprache → Kanäle → Groq-Key), nutzt **dieselbe Turso-DB wie der XP-Bot**, Admin-Panel + /help wie die anderen Bots. |
| 🛠️ **Multi-Bot-Hoster** | Loader, der alle Bots im `bots/`-Ordner automatisch startet (nur die mit gesetztem Token), plus Health-Server für UptimeRobot. |

## 🗂️ Projektstruktur

```
.
├── src/                      # Multi-Bot-Hoster (gemeinsame Infrastruktur)
│   ├── index.js              # Einstiegspunkt: lädt .env, startet Bots + Health-Server
│   ├── loader.js             # findet Bots in /bots und startet sie (Token-basiert)
│   ├── health.js             # HTTP-Health-Server (Port für Render/UptimeRobot)
│   └── logger.js             # hübscher Konsolen-Logger
│
├── bots/                     # ⬅ HIER kommen alle Bots rein (1 Ordner = 1 Bot)
│   ├── birthday-bot/         # 🎂 Geburtstags-Bot (komplett)
│   │   ├── index.js          # Bot-Einstieg (Factory für den Loader)
│   │   └── src/              # gesamte Bot-Logik
│   ├── xp-level-bot/         # ⭐ XP-Level-Bot (Turso-persistiert)
│   │   ├── index.js
│   │   └── src/              # gesamte Bot-Logik
│   └── love-tester-bot/      # 💘 Love Tester Bot (nutzt dieselbe Turso-DB wie der XP-Bot)
│       ├── index.js
│       └── src/              # Wizard, Analyse-Runner, Groq, 10 Sprachen
│
├── tests/                    # Tests (npm test) – ohne Discord-Verbindung
├── render.yaml               # Render-Blueprint (Deployment-Config)
├── .env.example              # Vorlage für alle Umgebungsvariablen
└── package.json              # npm start / npm test
```

---

## 🚀 Schnellstart (lokal testen)

### 1. Discord-Apps anlegen

Für jeden Bot brauchst du eine eigene App im [Discord Developer Portal](https://discord.com/developers/applications):

1. **New Application** → Name, z. B. „Mein Geburtstags-Bot“
2. Links **Bot** → **Reset Token** → Token kopieren
3. ⚠️ **Privileged Gateway Intents aktivieren** (wichtig!):
   - `SERVER MEMBERS INTENT` (Mitgliederlisten, Owner-Erkennung)
   - `MESSAGE CONTENT INTENT` (Nachrichten-Inhalte für Aufräum-/XP-Logik)
4. Unter **OAuth2 → URL Generator** → Scope `bot` + `applications.commands` →
   Berechtigungen `View Channels`, `Send Messages`, `Embed Links`, `Manage Messages`
   (zum Aufräumen), `Create Instant Invite`, `Change Nickname` – fertige URL öffnen
   und den Bot einladen.

> Tipp: Für den Geburtstags-Bot zusätzlich eine zweite App für den XP-Bot anlegen,
> wenn du beide später parallel willst. **Jeder Bot bekommt seinen eigenen Token!**

### 2. Umgebungsvariablen

```bash
cp .env.example .env
```

In `.env` eintragen:

| Variable | Bedeutung |
|---|---|
| `BIRTHDAY_BOT_TOKEN` | Token des Geburtstags-Bots |
| `BIRTHDAY_BOT_OWNER_ID` | **Deine Discord-ID** – der Bot-Owner fürs `/adminpanel` |
| `BIRTHDAY_BOT_GUILD_ID` | optional: eine Server-ID zum sofortigen Testen der Commands (sonst leer lassen) |
| `XP_BOT_TOKEN` | Token des XP-Bots |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Turso-DB – **eine DB für XP-Bot UND Love Tester** (gleiche Zugangsdaten) |
| `LOVE_BOT_TOKEN` | Token des Love-Tester-Bots |
| `LOVE_BOT_OWNER_ID` | optional: Owner fürs Love-Tester-`/adminpanel` (Fallback: XP-/Birthday-Owner) |
| `LOVE_BOT_GUILD_ID` | optional: Dev-Server für sofortige Love-Tester-Command-Registrierung |
| `PORT` | Port für den Health-Server (Standard 10000) |

**Deine Discord-ID findest du so:** Discord → Einstellungen → Erweitert → „Entwicklermodus“
an → Rechtsklick auf deinen Namen → „ID kopieren“.

### 3. Starten

```bash
npm install
npm start
```

Im Log siehst du, welche Bots online gehen. Ohne Token wird ein Bot einfach übersprungen.

> **Commands erscheinen nicht sofort:** Global registrierte Slash-Commands brauchen
> bis zu 1 Stunde. Mit `BIRTHDAY_BOT_GUILD_ID` (einer Dev-Server-ID) sind sie sofort
> da – perfekt zum Testen. Im Produktivbetrieb die Variable einfach leer lassen.

---

## ☁️ Auf Render deployen

### Variante A: Blueprint (empfohlen)

1. Dieses Repository nach **GitHub** pushen.
2. Auf [render.com](https://render.com) → **New → Blueprint** → Repository auswählen.
3. Render liest `render.yaml` automatisch und legt den Service an.
4. **Nach dem ersten Deployment** einmalig die Variablen mit leerem Wert ausfüllen
   (Service → **Environment**): `BIRTHDAY_BOT_TOKEN`, `BIRTHDAY_BOT_OWNER_ID`, …
   → **Save Changes** → Render startet neu, fertig. 🎉

### Variante B: Manuell

1. **New → Web Service** → GitHub-Repository verbinden.
2. Einstellungen:
   - **Name:** `multi-discord-bot-hoster`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
   - **Health Check Path:** `/healthz`
3. Unter **Environment** alle Variablen eintragen (siehe `.env.example`).
4. **Deploy** – fertig.

### Nach dem Deployment: URL merken

Jeder Render-Service bekommt eine URL wie `https://multi-discord-bot-hoster.onrender.com`.
Diese brauchst du für UptimeRobot.

---

## ⏰ UptimeRobot (Server wach halten)

Render Free fährt den Server nach ~15 Minuten ohne Traffic herunter – dann sind
**alle** Bots offline. UptimeRobot weckt ihn wieder:

1. Auf [uptimerobot.com](https://uptimerobot.com) einen **neuen Monitor** anlegen.
2. **Monitor Type:** HTTPS
3. **URL:** `https://dein-service.onrender.com/healthz`
4. **Interval:** 5 Minuten (kostenlos)
5. Speichern. ✅

Der Health-Endpunkt antwortet mit `{"status":"ok", …}` und zeigt auch, welche Bots
online sind (siehe `src/health.js`).

---

## 🎂 Birthday Bot – alle Funktionen

### Commands

| Command | Was er kann |
|---|---|
| `/setup [language] [channel]` | **Nur für Admins:** Richtet die Geburtstagsliste ein. Ohne Channel wird der aktuelle Kanal genommen. **10 Sprachen** zur Auswahl. Eine bereits existierende Liste wird automatisch gefunden: Einträge bleiben erhalten, nur Sprache + Kanal ändern sich. |
| „🎂 Geburtstag eintragen“ (Button) | Öffnet ein Formular: **Tag** (nur Zahlen, `4` oder `04`) + **Monat** (Zahl, Name oder sogar Tippfehler wie „Sebtemger“ → Fuzzy-Erkennung in allen 10 Sprachen). Danach **ephemerer** Bestätigungs-Container (nur für die eintragende Person sichtbar) mit 3 Buttons: ✅ Bestätigen / ✏️ Bearbeiten (Formular vorbefüllt) / ❌ Abbrechen. **Tipp:** Beide Felder einfach **leer lassen** und bestätigen → dein eigener Geburtstag wird **gelöscht**. |
| `/admin_set_bot_profile [image]` | **Nur für Admins:** Ändert das **serverspezifische** Profilbild des Bots (Standard / Server-Icon / Server-Owner-Icon) sofort via Discord-API. |
| `/admin_set_birthday [user]` | **Nur für Admins:** Setzt den Geburtstag eines anderen Nutzers (gleiches Formular, ohne 7-Tage-Regel). **Beide Felder leer lassen + bestätigen** löscht den Geburtstag des Nutzers. |
| `/help` | Übersicht aller Befehle für normale Nutzer und Admins auf dem Server. |
| `/adminpanel` | Owner-Panel – **nur im Privatchat mit dem Bot-Owner** (Deine ID aus `BIRTHDAY_BOT_OWNER_ID`). Auf Servern unsichtbar und nicht in `/help`. Serverliste mit Seiten (◀ ▶), sortiert: erst Server, auf denen du **🔴** nicht bist, dann nach Mitgliederzahl. Server-Detail mit Owner-Mention, Bild, Mitgliederzahl, Geburtstagsliste-Status. Buttons: **Einladung** (1h gültig, 1× nutzbar) und **Verlassen** (mit Sicherheitsabfrage). Bei Server-Beitritt bekommst du automatisch eine Info-Nachricht. |

### Layout & Components V2 (ohne Datenbank) 🤯

Die Geburtstagsliste nutzt **Discord Layout Components (Components V2)**:

- **Kein farbiger Rand:** Neutrales, aufgeräumtes Design ohne störenden Seitenstreifen.
- **Titel oben beim Datum:** Der Titel `🎂 Geburtstage` steht direkt oben beim Tagesdatum.
- **Keine störenden Footer:** Keine Zeitzonen-/Sprach-Fußzeilen oder Zeitstempel mehr am Ende.
- **Trennlinien & Buttons direkt im Container:** Trennlinien (Dividers) und Buttons (`bday_add` etc.) sind direkt in den Container integriert.
- Es werden nur Monate mit Einträgen angezeigt; jede Zeile ist `04.09 | @Nutzer – in 27 Tagen` (der Countdown steht in der jeweiligen Listensprache und wird automatisch aktualisiert).
- Der Bot findet seine Liste selbst wieder, liest alle Einträge neu aus und aktualisiert sich selbst.

**Stündlich** wird die Liste neu gebaut:
- aktueller Monat zuerst, dann bis Jahresende, dann Januar bis davor (rotierend)
- Nutzer, die den Server verlassen haben, fliegen automatisch raus
- das aktuelle Datum (in der Zeitzone der Sprache) steht oben

**Jeden Tag um 0 Uhr** (in der Zeitzone der Sprache) wird geprüft, wer Geburtstag
hat. Jedes Geburtstagskind bekommt einen hübschen Gruß-Container mit
einem **🎉 Gratulieren**-Button. Glückwünsche + Anzahl werden direkt
in den Container geschrieben (auch das ohne DB!) – doppelt gratulieren geht nicht.
Die Glückwünsche (und Event-Interessenten) stehen **kompakt nebeneinander**
(statt untereinander) und zeigen jeweils die **Uhrzeit** des Gratulierens.
Gratulieren ist nur in den **nächsten 24 Stunden** nach dem Gruß möglich – danach
nimmt der Bot keine Glückwünsche mehr an.

**7-Tage-Aufräumregel:** Geburtstags-Grüße & Event-Posts bleiben **insgesamt 7 Tage**
unter der Liste stehen. Danach werden sie gelöscht – und zwar zusammen mit
**allen Nachrichten, die darüber bis zur Liste liegen**. So bleibt der Bereich
unter der Liste sauber, ohne dass frische Posts oder Konversation vorzeitig
verschwinden. (Vorher: max. 3 Nachrichten unter der Liste, älteste flog raus.)

### Die 10 Sprachen & Zeitzonen

Deutsch 🇩🇪, Englisch 🇬🇧, Französisch 🇫🇷, Spanisch 🇪🇸, Portugiesisch 🇧🇷,
Russisch 🇷🇺, Japanisch 🇯🇵, Koreanisch 🇰🇷, Chinesisch 🇨🇳, Italienisch 🇮🇹

Jede Sprache hat ihre **eigene Zeitzone** (z. B. Deutsch → `Europe/Berlin`,
Japanisch → `Asia/Tokyo`), damit „heute“ und die 0-Uhr-Prüfung stimmen. Du kannst
sie pro Sprache überschreiben: `BIRTHDAY_BOT_TZ_EN=Europe/London` usw.

**Alle Texte stehen in EINER Datei**: `bots/birthday-bot/src/languages.js`.
Jeder Text-Key enthält direkt untereinander alle 10 Sprachen. Die Owner-Panel-Texte (`ap…`)
sind bewusst nur auf Deutsch.

---

## ⭐ XP Level Bot – alle Funktionen (neu!)

Kurzfassung – Details siehe [`bots/xp-level-bot/README.md`](bots/xp-level-bot/README.md):

- **`/setup <leaderboard> <mainchat> <language>`** (nur Admins) – richtet Kanäle + Sprache ein, erstellt sofort das **Leaderboard** (Top15, Components V2, kurzer Decay-Hinweis & Zeit+TZ). Es aktualisiert sich **stündlich** und zusätzlich **bei jedem Level-Up/Down** (frühestens alle 10 Minuten).
- **XP pro Nachricht**: Worte zählen (Leerzeichen/Zeilen, doppelte Leerzeichen ignoriert, **krasse Spam-Erkennung** mit Buchstaben-Check & Muster-Erkennung), `1 Wort=3XP … 10+ Worte=30XP max`, **30s Cooldown**. **Bilder, Videos, Sprachnachrichten & Sticker** geben ausgeglichen **15 XP** (Text+Medien zusammen max. 30 XP).
- **Level-Up-Nachricht**: Die Level-Up-Zeile wird als **`## `-Heading** dargestellt – größerer Text, fällt sofort ins Auge. 🎉
- **Level-Kurve**: `lvl1→2 80 XP`, `lvl99→100 ~1999 XP` (fast linear, kaum spürbar schwerer, reset auf 0 bei Aufstieg).
- **Täglich 0 Uhr** (TZ der Server-Sprache): **-5% Basis** von `needed XP` (je weiterem Inaktiv-Tag +3 Prozentpunkte); bei einem Level-Down wird der echte Restbetrag sauber ins vorige Level übernommen statt pauschal auf `93%` zu springen.
- **Voice**: `25 XP/min` im Voice (nicht stumm/taub, mind. 1 andere Person, ≥5s geredet + Pause).
- **`/level_roles`** (nur Admins): öffnet ein **Formular** – Rollen-Format (Standard `Level {LEVEL}`, `{LEVEL}` = Platzhalter) + Level-Zahlen kommagetrennt (Standard `3,6,10,20`, Tippfehler werden korrigiert). Der Bot löscht alte Level-Rollen, erstellt neue, **sortiert sie (mehr Level = weiter oben)** und legt sie **ganz unten** in der Rollenliste ab. Bei Level Up/Down bekommen Nutzer alle fehlenden Level-Rollen (mehrere möglich), vorhandene werden nie entfernt.
- **`/rank`** (alle): Platz, Level, `xp/needed`, Balken & fehlende XP.
- **`/update_leaderboard`** (nur Admins): rendert das Leaderboard **sofort** neu
  (z. B. nach manuellen Änderungen) – **5-Minuten-Cooldown** gegen Spam.
- **`/help` + `/admin_set_bot_profile` + `/adminpanel`** – identisch zum Birthday Bot, mit XP-Details.
- **Nicknames**: `[Lvl X 🥇] Name` – nur Top 3 mit Medaille, bei Auf-/Abstieg sofort. **Verrückte Plätze werden zuverlässig nachgezogen** (Top-5-Refresh bei jedem Level-Change, XP-only-Überholer alle 2 Min geprüft), 32-Zeichen-Cap, Rechte-Fehler → Ping im Haupt-Chat (außer für den Server-Owner).
- **Turso**: **RAM-first**, ein Batch-Load beim Start, alle Ops im RAM, Flush nur bei `SIGTERM`, alle 5 Min & bei Level-Change – spart Limits extrem.

---

## 💘 Love Tester Bot – alle Funktionen

Details siehe [`bots/love-tester-bot/README.md`](bots/love-tester-bot/README.md):

- **`/setup`** (nur Admins): **3-Schritte-Assistent** – 1. Sprache (Auswahlmenü,
  10 Sprachen), 2. mehrere Kanäle (Kanal-Auswahlmenü), 3. Groq-API-Key (Formular).
  Mit **Zurück / Weiter / Bestätigen / Abbrechen**, guter Anleitung pro Schritt und
  Zusammenfassung vor dem Speichern.
- **`/test_love <user1> <user2>`** (alle, nur nach Setup): öffentliche
  **Datenschutz-Bestätigung** (Chatverläufe → Groq), Buttons nur für den
  Command-Sender. Danach humorvolle **Live-Analyse mit Fortschrittsbalken in %**.
- **Scan**: max. **500 Nachrichten** über alle eingerichteten Kanäle; Ausschnitte
  mit 4 Nachrichten davor, Kern (max. 3 Fremde dazwischen) und Rest danach.
- **KI-Text-Umwandlung**: Bilder, Videos, Sprachnachrichten, Antworten, Sticker,
  Server-Emojis, Erwähnungen → lesbarer Text; beide User markiert als `[USER1]`/`[USER2]`.
- **Groq** (`llama-3.3-70b-versatile`): humorvoller System-Prompt, 3–5 begründete
  Sätze, finale Zeile `### XX %`. Token-Budget wird überwacht.
- **Fehler-Resilienz**: Groq-Limit, API-Fehler, Discord-Rate-Limits →
  „Erneut versuchen“ / „Weiter analysieren“ / „Abbrechen“, Fortschritt bleibt erhalten.
- **Datenbank**: dieselbe Turso-DB wie der XP-Bot (eigene Tabellen, kaum Daten).
- `/help` + `/admin_set_bot_profile` + `/adminpanel` – wie bei den anderen Bots.

---

## ➕ Neuen Bot hinzufügen (z. B. dein nächstes Projekt)

1. Ordner anlegen: `bots/mein-bot/index.js`
2. Dort ein Modul exportieren:

```js
const { GatewayIntentBits, Events } = require('discord.js');

module.exports = {
  id: 'mein-bot',
  name: 'Mein Bot',
  tokenEnv: 'MEIN_BOT_TOKEN',          // ← Umgebungsvariable mit dem Token
  intents: [GatewayIntentBits.Guilds],
  async create({ client, token, logger, env }) {
    client.on(Events.ClientReady, () => logger.info('Mein Bot ist da!'));
    // … deine Bot-Logik …
  },
};
```

3. Token in `.env` bzw. im Render-Dashboard eintragen → fertig.
   Ohne Token wird der Bot automatisch übersprungen, der Rest läuft weiter.

---

## 🧪 Tests

Die Kernlogik (Fuzzy-Monatserkennung, 7-Tage-Regel, Container-Roundtrip) ist ohne
Discord-Verbindung testbar:

```bash
npm test
```

---

## 📄 Lizenz

MIT – viel Spaß beim Bots bauen! 🎉
