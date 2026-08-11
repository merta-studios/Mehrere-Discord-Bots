# 💘 Love Tester Bot

Der Love Tester schätzt die Liebe zwischen zwei Personen anhand eurer
**Discord-Chatverläufe** – humorvoll, in 10 Sprachen, mit dem gleichen modernen
**Container-Layout (Components V2)** wie Birthday- und XP-Bot. Die Analyse
übernimmt **Groq** (`llama-3.3-70b-versatile`) – schnell, stark und mit 128k
Kontext.

> ⚠️ **Datenschutz-Hinweis:** Für einen Love Test werden Chat-Ausschnitte an
> **Groq** (Drittanbieter) gesendet. Jeder Test startet deshalb mit einer
> sichtbaren Bestätigung, die der Aufrufende erst annehmen muss.

---

## ✨ Funktionen

| Feature | Details |
|---|---|
| **`/setup`** (Admin) | 3-Schritte-Assistent: **1. Sprache** (10 Sprachen, Auswahlmenü) → **2. Kanäle** (mehrere, Kanal-Auswahlmenü) → **3. Groq-API-Key** (Modal). Mit **Zurück / Weiter / Bestätigen / Abbrechen**, Zusammenfassung am Ende und klarer Anleitung pro Schritt. Bestehende Setups lassen sich jederzeit überschreiben. |
| **`/test_love [user1] [user2]`** (alle) | Nur möglich, wenn das Setup abgeschlossen ist. Zuerst erscheint eine **öffentliche Bestätigung** mit Datenschutz-Hinweis – die Buttons **✅ Annehmen** / **❌ Ablehnen** kann **nur der Command-Sender** bedienen. |
| **Analyse mit Live-Fortschritt** | Nach dem Annehmen wird die Nachricht laufend bearbeitet: echter Fortschrittsbalken, **Prozentsatz** und reale Scan-Zahlen (gelesene Nachrichten, Kanäle, Ausschnitte) – ohne Fake-Witze. |
| **Chat-Scan** | Durchsucht die eingerichteten Kanäle – **maximal 500 Nachrichten** pro Scan über alle Kanäle. „Weiter analysieren“ holt die nächsten 500 älteren Nachrichten. |
| **Ausschnitt-Sortierung** | Pro Ausschnitt: **4 Nachrichten davor** + der **Kern** (Nachrichten der beiden User, maximal 3 fremde nacheinander dazwischen) + **der Rest danach** für den Kontext (mind. 9 Nachrichten gesamt). Die Ausschnitte werden verständlich nummeriert und chronologisch sortiert. |
| **KI-freundliche Umwandlung** | Bilder → `*hat ein Bild gesendet*`, Videos, Sprachnachrichten, Dateien, Sticker, Antworten (`*hat auf eine Nachricht von [USER] mit dem Inhalt „…“ geantwortet mit:*`), Server-Emojis → `:name:`, Erwähnungen → `@Name`, Rollen/Kanäle/Timestamps werden aufgelöst. **Beide User werden im Text markiert** (`[USER1]` / `[USER2]`), damit die KI sie eindeutig erkennt. |
| **Prompts für Groq** | System-Prompt: teen-tauglicher, aber fairer Ship-Richter, **5 ausführlich begründete Sätze** (beide Charaktere, Gemeinsamkeiten, mögliche Reibung, Gesamturteil) + finale Zeile `### XX %`. Der Fokus liegt auf Charakter und Persönlichkeit; **fehlende Interaktion wird weder erwähnt noch negativ bewertet**. Auch niedrige Prozentwerte sind möglich, wenn die Charaktere nicht zusammenpassen. Keine erfundenen Zitate, passende Emojis und abwechslungsreiche Zahlen. User-Prompt enthält Username, Discord-Anzeigenamen, Server-Nickname & ID. **Namen im Urteil werden automatisch zu echten Mentions.** **Token-Budget** wird überwacht (Ausschnitte mit beiden Usern haben Vorrang, zu große Kontexte werden automatisch gestutzt). |
| **Fehlerbehandlung** | Groq-Limit (429), API-Fehler, Discord-Rate-Limits, keine Nachrichten gefunden → verständliche Fehler-Container mit **🔄 Erneut versuchen** (Groq-Call wiederholt sich, Scan bleibt erhalten), **📚 Weiter analysieren** (scannt mehr Nachrichten) und **🛑 Abbrechen**. Nichts geht verloren! |
| **10 Sprachen** | Deutsch, Englisch, Französisch, Spanisch, Portugiesisch, Russisch, Japanisch, Koreanisch, Chinesisch, Italienisch. |
| **Admin-Panel & Hilfe** | `/help` und `/adminpanel` (Owner-DM, Serverliste, Einladung, Verlassen) identisch zu Birthday-/XP-Bot, plus `/admin_set_bot_profile`. |

---

## 🗄️ Datenbank: DIESELBE wie der XP-Bot

Der Love Tester nutzt **dieselbe Turso-Datenbank mit denselben Zugangsdaten**
wie der XP-Level-Bot (`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN`) – er legt nur
**eigene Tabellen** an (`love_configs`, `love_metadata`) und speichert bewusst
kaum etwas:

- pro Server nur: Sprache, ausgewählte Kanäle, Groq-API-Key, Setup-Status
- **keine** Chat-Verläufe, **keine** Analyse-Ergebnisse

Ohne Turso-Variablen läuft der Bot lokal mit einer JSON-Datei
(`love-data.json` / `data/love-store.json`).

---

## 🛠️ Einrichtung

### 1. Discord-App anlegen

1. https://discord.com/developers/applications → **New Application** → „Love Tester“
2. **Bot** → **Reset Token** → kopieren → als `LOVE_BOT_TOKEN` eintragen
3. **Privileged Intents einschalten:**
   - ✅ `SERVER MEMBERS INTENT` (Mitglieder/Nicknames auflösen)
   - ✅ `MESSAGE CONTENT INTENT` (Chat-Inhalte für die Analyse)
4. **OAuth2 → URL Generator** → Scopes `bot` + `applications.commands` →
   Berechtigungen: `View Channels`, `Send Messages`, `Read Message History`,
   `Embed Links`, `Create Instant Invite`, `Change Nickname`
   → URL öffnen & einladen.

### 2. Groq-API-Key holen (einmalig, kostenlos)

1. https://console.groq.com → kostenlosen Account erstellen
2. **API Keys** → **Create API Key** → Key kopieren (Format `gsk_…`)
3. Der Key wird beim `/setup` auf dem Server hinterlegt und serverseitig
   gespeichert. Er wird NUR an die Groq-API gesendet.

### 3. Umgebungsvariablen

```bash
cp .env.example .env
```

| Variable | Bedeutung | Pflicht |
|---|---|---|
| `LOVE_BOT_TOKEN` | Token des Love-Tester-Bots | ✅ |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | **Dieselbe DB wie der XP-Bot** (sonst Datei-Fallback) | optional |
| `LOVE_BOT_OWNER_ID` | Owner-ID fürs `/adminpanel` (Fallback: XP/Birthday-Owner) | optional |
| `LOVE_BOT_GUILD_ID` | Dev-Server für sofortige Command-Registrierung | optional |
| `LOVE_BOT_TZ_<CODE>` | Zeitzonen-Override pro Sprache | optional |

### 4. Server-Setup (im Discord)

1. `/setup` ausführen → Schritt-für-Schritt-Assistent:
   - **Schritt 1:** Sprache wählen → **Weiter**
   - **Schritt 2:** eine oder mehrere Kanäle auswählen, die der Bot durchsuchen
     darf → **Weiter** (mit **Zurück** korrigierbar)
   - **Schritt 3:** **API-Key eingeben** → Key ins Formular → Zusammenfassung
     prüfen → **Bestätigen**
2. Fertig! Jetzt kann jeder `/test_love @Mia @Lukas` aufrufen. 💘

---

## 🧪 Wie ein Love Test abläuft

1. Jemand ruft `/test_love @User1 @User2` auf → **öffentliche Bestätigung**
   mit Datenschutz-Hinweis (Chatverläufe → Groq).
2. Der Aufrufende klickt **✅ Annehmen** → die Nachricht wird zu einem
   echten Ladebildschirm mit Fortschrittsbalken, Prozent und Scan-Zahlen.
3. Der Bot scannt die Kanäle (max. 500 Nachrichten), baut Ausschnitte
   (4 davor + Kern + Rest danach) und wandelt alles in KI-Text um
   (Bilder, Antworten, Sticker, Emojis, Erwähnungen …).
4. Groq analysiert als fairer Ship-Richter: 5 ausführlich begründete Sätze
   (beide Personen, Gemeinsamkeiten, mögliche Reibung und Gesamturteil) +
   `### XX %`. Die Zahl wird aus den Hinweisen abgeleitet und kann deshalb auch
   niedrig ausfallen, wenn die beiden nicht gut zusammenpassen. Nicknames im
   Text werden zu echten Mentions.
5. Das Ergebnis erscheint dicht und klein untereinander – mit der
   Prozentzeile als Discord-Überschrift. 🎉

Bei Fehlern (Groq-Limit, Rate-Limits …) gibt es **Erneut versuchen** /
**Weiter analysieren** / **Abbrechen** – der Scan-Fortschritt bleibt erhalten.

---

## 📁 Dateien

```
bots/love-tester-bot/
├── index.js              # Bot-Factory: Ready, Events, Session-Caps
└── src/
    ├── languages.js      # ★ ALLE Texte in 10 Sprachen (humorvoll)
    ├── store.js          # Turso (gleiche DB wie XP-Bot) + Datei-Fallback
    ├── embed-builder.js  # Container: Setup-Wizard, Bestätigung, Fortschritt, Ergebnis, Fehler
    ├── commands.js       # Slash-Commands & Registrierung
    ├── interactions.js   # Buttons/Selects/Modal (Wizard + Love-Test-Steuerung)
    ├── runner.js         # Scan-Ablauf, Fortschritt, Retry-Logik
    ├── analyzer.js       # ★ Kern: Ausschnitte, KI-Text, Prompts, Groq-Call
    ├── admin-panel.js    # Owner-Panel (wie die anderen Bots)
    └── message-payload.js# Components-V2-Payload-Helfer
```

Benötigte Intents: `Guilds`, `GuildMessages`, `MessageContent`,
`GuildMembers` (privilegiert!), `DirectMessages`.
