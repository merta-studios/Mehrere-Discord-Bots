# ⭐ XP Level Bot – RAM-first, Turso-persistiert, 10 Sprachen, krasses Design

> **Leveln durch Chatten!** 3 XP pro echtem Wort (max 30 XP), 30s Cooldown gegen Spam, Voice 25 XP/Minute, täglicher 7%-Schwund um Mitternacht, Leaderboard Top15 stündlich – alles in 10 Sprachen, modernen Components V2 & mit Turso so sparsam wie möglich!

Dieser Bot ist **1:1 so robust & krass designed wie der Birthday Bot**: gleiche Container-Optik (kein Farbrand, Divider, Buttons im Container), gleiche `/adminpanel` Logik, gleiche 10-Sprachen-Datei, gleicher `/admin_set_bot_profile`.

---

## 🎮 Wie funktioniert das System?

| Mechanik | Details |
|---|---|
| **Start** | Jeder startet bei **Lvl 1, 0 XP**. |
| **Nachrichten-XP** | Worte werden an Leerzeichen/Zeilenumbrüchen gezählt. **Krasse Spam-Erkennung**: doppelte Leerzeichen ≠ extra Wort, nur Tokens mit Buchstaben, keine URLs/Mentions/Emojis als Wort, keine `aaaaa`/`lololol`/`abcabc` Spams, Buchstaben-Anteil ≥60% etc. **1 Wort = 3 XP … 10+ Worte = 30 XP (max)**. |
| **Cooldown** | Nach XP-Gewinn **30 Sekunden** kein XP mehr. |
| **Level-Kurve** | `XP benötigt ≈ 80 + 13.9·(lvl-1) + 0.058·(lvl-1)²` → Lvl1→2 **80 XP**, Lvl99→100 **1999 XP**. Fast linear, kaum spürbar schwerer, aber schön kurvig & konstantes Belohnungsgefühl. Bei Aufstieg wird XP auf **0 resettet** (Überschuss verfällt). Max Lvl 100. |
| **Täglicher Schwund** | **Jeden Tag um 0 Uhr** (Zeitzone der Server-Sprache) verliert jeder **7%** der für sein nächstes Level nötigen XP (`ceil(needed*0.07)`). Fällt XP ≤0, **verlierst du ein Level** und landest bei **93%** des neuen Levels. Viel chatten verhindert Abstieg! ⚠️ Hinweis steht auch im Leaderboard. |
| **Voice-XP** | Pro Minute im Voice (nicht stumm/taub, mind. 1 weitere nicht-stumme Person im selben Channel) **25 XP** – aber nur wenn in der Minute **≥5s aktiv gesprochen** wurde **und** mind. **eine Sprechpause** dabei war (60s Dauer-Sprechen ohne Pause zählt nicht). |
| **Verlassen** | Wer den Server verlässt, verliert alle Level/XP sofort (Daten gelöscht). |
| **Nickname** | Sofort nach Level Up/Down: `[Lvl {LVL} | #🥇] Anzeigename` – Top15 bekommen `#🥇🥈🥉` bzw. `#4` … `#15`. Wird bestehender Tag überschrieben, bei >32 Zeichen wird Anzeigename rechts gekürzt. Kann Bot nicht umbenennen (z.B. Owner) → Ping im Haupt-Chat: „Ich brauche Rolle über allen anderen!“. |
| **Leaderboard** | Stündlich aktualisiert, **Top15** nach Level → XP, mit **letzter Aktualisierung + Zeitzone** & Stunden-Hinweis & Schwund-Warnung. Marker `xp_leader::v1::` für Self-Healing. |
| **Announcements** | Bei Auf-/Abstieg **Reply auf die auslösende Nachricht** (oder Haupt-Chat als Fallback), User-Mention, neues Level + `xp/needed XP`, auf Server-Sprache. |

---

## 💬 Commands

| Command | Wer | Was |
|---|---|---|
| `/setup <leaderboard> <mainchat> <language>` | **Admin** | Richtet System ein: Leaderboard-Kanal, Haupt-Chat (Level-Ups & Nick-Fehler) & Sprache (10 zur Wahl). Erstellt sofort das Leaderboard, löscht alte. `BIRTHDAY_BOT` Style mit Ephemeral-Bestätigung. |
| `/rank` | **Alle** | Zeigt deinen Platz im Server (von allen), Level, `xp/needed`, Fortschritts-Balken `████░░░░`, fehlende XP & Tipp. Auf Server-Sprache, ephemeral. |
| `/help` | **Alle** | Container-Übersicht aller Commands (Setup, Rank, Help, Profile) – wie Birthday Bot. |
| `/admin_set_bot_profile <image>` | **Admin** | Ändert **serverspezifisches** Bot-Avatar: `standard` (reset), `server` (Server-Icon), `owner` (Owner-Avatar) via `PATCH /guilds/{id}/members/@me` – kein 405! |
| `/adminpanel` | **Nur Owner im DM** | Serverliste paginiert (5/Seite, 🔴 ohne Owner zuerst), Detail mit Owner, Member, XP-Status, Buttons `Einladung` (1h/1×) & `Verlassen` (Confirm). |

---

## 🗄️ Datenbank – Turso, aber sparsam!

**Philosophie: So wenig Reads/Writes wie möglich – fast alles im RAM.**

- **Beim Start**: **Einmal** alle `guild_configs` + `user_levels` aus Turso in RAM laden.
- **Im Betrieb**: Alle XP-Vergaben nur **im RAM** (`Map`). Dirty-Tracking (`dirtyGuilds`, `dirtyUsers`).
- **Speichern**: Nur bei **SIGTERM** (Render schickt vor Restart), **alle 5 Minuten Backup** (Intervall) und bei **Level-Up/Down & täglichem Schwund** wird sofort geflusht.
- **Batch**: Beim Flush via `db.batch()` in Chunks à 50 Statements → **ein Write statt tausend**.
- **Fallback**: Ohne `TURSO_DATABASE_URL` läuft Bot rein im RAM + schreibt JSON `xp-data.json`/`data/xp-store.json` (ephemer auf Render, gut für lokal testen).
- **Schema**:
  ```sql
  guild_configs(guild_id PK, leaderboard_channel_id, main_channel_id, lang, leaderboard_message_id, last_daily_decay)
  user_levels(guild_id, user_id PK, level, xp, last_xp_gain)
  ```

**Vorteil**: UptimeRobot pingt `/healthz` alle 5 Min → Bot bleibt wach, Turso-Limits bleiben super niedrig (Free Tier 500 Reads/Writes pro sek. locker genug, wir machen <10 Writes/Stunde).

---

## 🛠️ Setup – Schritt für Schritt (wie beim Birthday Bot)

### 1. Discord App anlegen

1. https://discord.com/developers/applications → **New Application** → „XP Level Bot“
2. **Bot** → **Reset Token** → kopieren → `XP_BOT_TOKEN`
3. **Privileged Intents einschalten** (wichtig!):
   - ✅ `SERVER MEMBERS INTENT`
   - ✅ `MESSAGE CONTENT INTENT`
   - ✅ `GUILD VOICE STATES` (für Voice-XP, automatisch via `GuildVoiceStates` Intent)
4. **OAuth2 → URL Generator** → Scopes `bot` + `applications.commands` → Perms: `View Channels`, `Send Messages`, `Manage Messages` (Leaderboard Edit), `Change Nickname`, `Create Instant Invite`, `Use Voice Activity` → URL öffnen & einladen.
5. Bot-Rolle **ganz nach oben ziehen** (Server-Einstellungen → Rollen) – sonst kann er keine Nicknames ändern (Owner sowieso nicht).

### 2. Turso anlegen (einmalig)

**Variante A – Cloud (empfohlen für Render):**
```bash
# Turso CLI installieren: https://docs.turso.tech/cli/installation
turso auth login          # Browser öffnet sich
turso db create xp-level-bot-db --group default
turso db show xp-level-bot-db --url   # → libsql://xp-level-bot-db-...turso.io
turso db tokens create xp-level-bot-db  # → eyJhbGc... (langer Token)
```
→ URL + Token in Render & `.env` eintragen als `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.

**Variante B – Lokal testen ohne Turso:**
Einfach `TURSO_DATABASE_URL` leer lassen – Bot schreibt `xp-data.json`. Daten gehen bei Neustart nicht verloren, aber bei Render-Crash potentiell. Für lokal perfekt.

**Variante C – Lokale Turso Dev:**
```bash
turso dev --db-file ./xp.db   # startet libsql auf sqlite file
# URL dann: http://127.0.0.1:8080  (siehe turso dev output)
```

### 3. Umgebungsvariablen

`cp .env.example .env` und ausfüllen:

| Variable | Beispiel | Pflicht |
|---|---|---|
| `XP_BOT_TOKEN` | `MTQ...` | ✅ |
| `XP_BOT_OWNER_ID` | `14146...` (deine ID) | ✅ (fällt auf BIRTHDAY_ zurück) |
| `TURSO_DATABASE_URL` | `libsql://xp-level-bot-db-...turso.io` | ✅ für Cloud |
| `TURSO_AUTH_TOKEN` | `eyJ...` | ✅ für Cloud |
| `XP_BOT_GUILD_ID` | `123456789` | ❌ nur Dev |
| `PORT` | `10000` | Render setzt selbst |

**ID finden:** Discord → Einstellungen → Erweitert → Entwicklermodus an → Rechtsklick Name → ID kopieren.

### 4. Lokal starten

```bash
npm install
npm start
# Log: [xp-level-bot] Bereit auf X Servern
```

Commands global brauchen bis zu 1h – mit `XP_BOT_GUILD_ID` sofort in Dev-Gilde.

### 5. Auf Render deployen (Blueprint – wie Birthday Bot)

1. Repo nach GitHub pushen.
2. Render → **New → Blueprint** → Repo wählen → `render.yaml` wird gelesen.
3. Nach Deploy: **Environment** → `XP_BOT_TOKEN`, `XP_BOT_OWNER_ID`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` eintragen → **Save** → Restart.
4. Health: `https://<service>.onrender.com/healthz` → UptimeRobot Monitor (5 Min, HTTPS) darauf.

---

## 🎨 Container-Design

Wie Birthday Bot 100% Components V2:
- `ContainerBuilder` + `Separator` + `TextDisplay` – **kein Farbrand**, **kein Footer**, **Divider im Container**
- Marker `xp_leader::v1::de` unsichtbar im Header für Self-Healing
- Stündlicher Edit via `componentsV2Payload([container])` mit `IsComponentsV2` Flag

---

## 🔧 Troubleshooting

- **Leaderboard erscheint nicht?** Bot braucht `View Channel` + `Send Messages` in beiden Setup-Kanälen. `/setup` neu ausführen.
- **Nicknames ändern nicht?** Rolle nach oben ziehen, `Change Nickname` geben. Owner kann nie umbenannt werden → Bot pingt dann im Haupt-Chat (einmal pro Stunde).
- **Voice-XP kommt nicht?** Mind. 2 unmuted Personen, 5s reden, Pause. Bot muss nicht im Channel sein – Heuristik über Mute-Toggles + Präsenz.
- **Täglicher Decay zu hart?** 7% ist wenig (bei Lvl50 ≈63 XP, bei Lvl1 ≈6 XP). Viel chatten = easy halten.
- **Turso Limits?** Check https://app.turso.tech → Metrics. Bei RAM-first sollten <100 Writes/Tag sein.

Viel Spaß beim Leveln! 🚀🔥
