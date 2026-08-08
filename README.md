# 🤖 Multi-Discord-Bot-Hoster

**Mehrere Discord-Bots gleichzeitig hosten – in EINEM Render-Server, mit EINEM kostenlosen Prozess.**

Dieses Repository ist ein komplettes Setup, um beliebig viele Discord-Bots parallel
auf **Render Free** zu betreiben. Jeder Bot hat seinen eigenen Ordner, seinen eigenen
Token (als Umgebungsvariable) und läuft unabhängig – aber alle in einem einzigen
Node.js-Prozess, damit ein einziger Render-Free-Dyno genügt.

> ⏰ **UptimeRobot**: Render-Free-Server schlafen nach ~15 Minuten Inaktivität ein.
> Deshalb pinguft UptimeRobot den Health-Endpunkt regelmäßig – so bleiben ALLE Bots wach.

---

## 📦 Was ist drin?

| Bereich | Beschreibung |
|---|---|
| 🎂 **Birthday Bot** | Kompletter Geburtstags-Bot **ohne Datenbank** – er liest seine eigene Embed-Liste selbst wieder aus. 10 Sprachen, Fuzzy-Monatserkennung, 7-Tage-Regel, tägliche Geburtstags-Glückwünsche, Owner-Admin-Panel. |
| ⚒️ **XP Level Bot** | **Platzhalter** – Ordner + Token-Verwaltung stehen, das XP-System kommt in einem späteren Update. |
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
│   └── xp-level-bot/         # ⚒️ XP-Level-Bot (Platzhalter, System folgt)
│       └── index.js
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
| `XP_BOT_TOKEN` | Token des XP-Bots (Platzhalter, kann leer bleiben) |
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
| `/setup [language] [channel]` | Richtet die Geburtstagsliste ein. Ohne Channel wird der aktuelle Kanal genommen. **10 Sprachen** zur Auswahl. Eine bereits existierende Liste wird automatisch gefunden: Einträge bleiben erhalten, nur Sprache + Kanal ändern sich. |
| „🎂 Geburtstag eintragen“ (Button) | Öffnet ein Formular: **Tag** (nur Zahlen, `4` oder `04`) + **Monat** (Zahl, Name oder sogar Tippfehler wie „Sebtemger“ → Fuzzy-Erkennung in allen 10 Sprachen). Danach Bestätigungs-Embed mit 3 Buttons: ✅ Bestätigen / ✏️ Bearbeiten (Formular vorbefüllt) / ❌ Abbrechen. |
| `/set_bot_profile [image]` | Ändert das **serverspezifische** Profilbild des Bots. Nur 3 Optionen: Standard-Profilbild, Server-Profilbild, Server-Owner-Profilbild – **kein eigener Upload!** |
| `/admin_set_birthday [user]` | Nur mit **Administrator**-Berechtigung. Setzt den Geburtstag eines anderen Nutzers (gleiches Formular, ohne 7-Tage-Regel). |
| `/help` | Übersicht aller Befehle. |
| `/adminpanel` | Owner-Panel – **nur im Privatchat mit dem Bot-Owner** (Deine ID aus `BIRTHDAY_BOT_OWNER_ID`). Serverliste mit Seiten (◀ ▶), sortiert: erst Server, auf denen du **🔴** nicht bist, dann nach Mitgliederzahl. Server-Detail mit Owner-Mention, Bild, Mitgliederzahl, Geburtstagsliste-Status. Buttons: **Einladung** (1h gültig, 1× nutzbar) und **Verlassen** (mit Sicherheitsabfrage). Bei Server-Beitritt bekommst du automatisch eine Info-Nachricht. |

### Wie funktioniert das ohne Datenbank? 🤯

Die Geburtstagsliste **steckt komplett im Embed**:

- Jeder Monat ist ein Feld; jede Zeile ist `04.09 ✦ @Nutzer`.
- Im Footer sitzt ein unsichtbarer Marker (`bday::v1::<sprache>`).
- Der Bot findet seine Liste selbst wieder (Channel-Scan nach dem Marker),
  liest alle Einträge neu aus dem Embed und aktualisiert sich selbst.

**Stündlich** wird die Liste neu gebaut:
- aktueller Monat zuerst, dann bis Jahresende, dann Januar bis davor (rotierend)
- Nutzer, die den Server verlassen haben, fliegen automatisch raus
- das aktuelle Datum (in der Zeitzone der Sprache) steht oben

**Jeden Tag um 0 Uhr** (in der Zeitzone der Sprache) wird geprüft, wer Geburtstag
hat. Jedes Geburtstagskind bekommt ein kurzes, hübsches Gruß-Embed mit Profilbild
und einem **🎉 Gratulieren**-Button. Glückwünsche + Anzahl werden ins Embed
geschrieben (auch das ohne DB!) – doppelt gratulieren geht nicht.

**Aufräumen:** Unter der Liste sind maximal **3 Nachrichten** erlaubt (egal ob von
Nutzern oder vom Bot). Ältere werden automatisch gelöscht, damit das Embed immer
sofort sichtbar ist.

### Die 10 Sprachen & Zeitzonen

Deutsch 🇩🇪, Englisch 🇬🇧, Französisch 🇫🇷, Spanisch 🇪🇸, Portugiesisch 🇧🇷,
Russisch 🇷🇺, Japanisch 🇯🇵, Koreanisch 🇰🇷, Chinesisch 🇨🇳, Italienisch 🇮🇹

Jede Sprache hat ihre **eigene Zeitzone** (z. B. Deutsch → `Europe/Berlin`,
Japanisch → `Asia/Tokyo`), damit „heute“ und die 0-Uhr-Prüfung stimmen. Du kannst
sie pro Sprache überschreiben: `BIRTHDAY_BOT_TZ_EN=Europe/London` usw.

**Alle Texte stehen in EINER Datei**: `bots/birthday-bot/src/languages.js`.
Jeder Text-Key enthält direkt untereinander alle 10 Sprachen – du musst also nie
10 Dateien durchsuchen, um einen Satz zu ändern. Die Owner-Panel-Texte (`ap…`)
sind bewusst nur auf Deutsch.

### Wichtige Hinweise zum Birthday Bot

- **Löscht jemand das Listen-Embed**, erstellt der Bot es beim nächsten Refresh
  automatisch neu (solange er läuft). Wird die Liste gelöscht, **während der Bot
  offline ist**, bitte einmal `/setup` neu ausführen (Einträge sind dann weg –
  ohne DB gibt es kein Backup).
- Die **7-Tage-Regel**: Ein Geburtstag, dessen nächstes Vorkommen in weniger als
  7 Tagen liegt, kann nicht eingetragen werden (Spam-Schutz). Nach deinem
  Geburtstag (ab dem Folgetag) klappt es wieder.
- `/adminpanel` ist global registriert (Discord kann Befehle nicht nur für DMs
  registrieren), funktioniert aber **nur** im DM des Owners.

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

Die Kernlogik (Fuzzy-Monatserkennung, 7-Tage-Regel, Embed-Roundtrip) ist ohne
Discord-Verbindung testbar:

```bash
npm test
```

---

## ❓ FAQ / Troubleshooting

| Problem | Lösung |
|---|---|
| „Kein Token gefunden“ im Log | Die Env-Variable `BIRTHDAY_BOT_TOKEN` ist leer – auf Render unter **Environment** nachtragen. |
| Bots gehen nach 15 Min offline | UptimeRobot-Monitor auf `…/healthz` anlegen (siehe oben). |
| Commands erscheinen nicht | Globale Registration dauert bis zu 1h. Für Tests `BIRTHDAY_BOT_GUILD_ID` setzen. |
| `/adminpanel` „funktioniert nur im Privatchat“ | Die Nachricht muss im **DM mit dem Bot** geschrieben werden und `BIRTHDAY_BOT_OWNER_ID` muss deine ID sein. |
| `Missing Access` / Mitglieder werden nicht geladen | `SERVER MEMBERS INTENT` im Developer Portal aktivieren und auf Render neu deployen. |
| Profilbild ändern schlägt fehl | Der Bot braucht in dem Server die Berechtigung, sein Profil zu ändern (Standardrolle reicht meist) – Fehlermeldung gibt Details. |
| Embed-Liste ist weg | Siehe „Wichtige Hinweise“ – ggf. `/setup` neu ausführen. |

---

## 📄 Lizenz

MIT – viel Spaß beim Bots bauen! 🎉
