# ⭐ XP Level Bot – RAM-first, Turso-persistiert, 10 Sprachen, krasses Design

> **Leveln durch Chatten!** 3 XP pro echtem Wort (max 30 XP) + **15 XP für Bilder, Videos & Sprachnachrichten**, 30s Cooldown gegen Spam, Voice 10 XP/Minute (einfach im Voice sein), täglicher **5%-Schwund um Mitternacht** (wer inaktiv bleibt: **+3 Prozentpunkte je weiterem Inaktiv-Tag** – 5 %, 8 %, 11 % …), Leaderboard Top15 **zuverlässig stündlich + bei Level-Ups**, **geplante Bonus-Geschenke (30–70 XP, 2–4×/Tag) mit „Einsammeln“-Button im Haupt-Chat**, **Invite-XP (40–80 XP für den Invite-Ersteller, wenn der Eingeladene wirklich beitritt)**, **Level-Belohnungsrollen per Formular** – alles in 10 Sprachen, modernen Components V2 & mit Turso so sparsam wie möglich!

Dieser Bot ist **1:1 so robust & krass designed wie der Birthday Bot**: gleiche Container-Optik (kein Farbrand, Divider, Buttons im Container), gleiche `/adminpanel` Logik, gleiche 10-Sprachen-Datei, gleicher `/admin_set_bot_profile`.

---

## 🎮 Wie funktioniert das System?

| Mechanik | Details |
|---|---|
| **Start** | Jeder startet bei **Lvl 1, 0 XP**. |
| **Nachrichten-XP** | Worte werden an Leerzeichen/Zeilenumbrüchen gezählt. **Krasse Spam-Erkennung**: doppelte Leerzeichen ≠ extra Wort, nur Tokens mit Buchstaben, keine URLs/Mentions/Emojis als Wort, keine `aaaaa`/`lololol`/`abcabc` Spams, Buchstaben-Anteil ≥60% etc. **1 Wort = 3 XP … 10+ Worte = 30 XP (max)**. **Bilder, Videos, Sprachnachrichten & Sticker** geben **15 XP** pro Nachricht (entspricht einem 5-Wörter-Text – ausgeglichen, nicht overpowered); Text + Medien zusammen sind auf 30 XP gedeckelt. Gleicher 30s-Cooldown wie bei Text. |
| **Cooldown** | Nach XP-Gewinn **30 Sekunden** kein XP mehr. |
| **Level-Kurve** | `XP benötigt ≈ 80 + 13.9·(lvl-1) + 0.058·(lvl-1)²` → Lvl1→2 **80 XP**, Lvl99→100 **1999 XP**. Fast linear, kaum spürbar schwerer, aber schön kurvig & konstantes Belohnungsgefühl. Bei Aufstieg wird XP auf **0 resettet** (Überschuss verfällt). Max Lvl 100. |
| **Täglicher Schwund** | **Jeden Tag um 0 Uhr** (Zeitzone der Server-Sprache) verliert jeder **5 %** der für sein nächstes Level nötigen XP. **Inaktivitäts-Streak:** Hat ein Nutzer in den letzten 24 h **keine XP verdient**, steigt der Anteil pro weiterem inaktivem Tag um **+3 Prozentpunkte** (1. inaktiver Tag = 5 %, dann 8 %, 11 %, 14 % …). Sobald wieder XP verdient wird, fällt der Satz auf **5 %** zurück. Wer auf Level 1 mit 0 XP steht, verliert nichts. Fällt XP unter 0, **verlierst du ein Level** und der Restbetrag wird korrekt vom vorherigen Level abgezogen. `/rank` zeigt als Stichpunkt, **wie viel XP du heute um 0 Uhr verlieren wirst**. ⚠️ Hinweis steht auch im Leaderboard. |
| **Bonus-Geschenke** | **Geplant & zeitgesteuert**: Pro Server werden täglich **2–4 feste Termine** ausgelöst (deterministisch aus Server-ID + Datum – **jeder Server hat andere, aber stabile Zeiten**, kein Neuwürfeln bei Neustarts). Alle Termine liegen **mindestens 1 h auseinander** und nur **zwischen 06:00 und 23:59 Uhr Ortszeit**. Zusätzlich prüft **jede Chat-Nachricht** (gedrosselt), ob ein Termin fällig oder verpasst ist – so erscheint der Drop, **wenn Leute online sind** und schnell klicken können, selbst wenn der Minuten-Scheduler hängt. Zum Termin erscheint ein Bonus mit **zufällig 30–70 XP**, „🎁 Einsammeln“-Button – **der erste Klick gewinnt**. Der Drop ist **1 Stunde gültig**, bleibt auch nach einem Bot-/Render-Neustart einsammelbar und verfällt danach (Button wird deaktiviert). Verpasste Termine werden mit genau einem Drop nachgeholt. Wenn Discord Components V2 ablehnt, fällt der Bot auf ein klassisches Embed + Button zurück. Wer einsammelt, gilt wieder als aktiv – **sein täglicher XP-Schwund fällt auf 5 % zurück**. Ohne Leaderboard-Setup gibt es keine Boni. |
| **Voice-XP** | **10 XP pro voller Minute** – einfach dafür, dass man in einem Voice-Channel ist. Egal ob **stumm/taub** (Self-/Server-Mute/Deaf), allein im Channel oder im Stage: **Anwesend = XP**. Der V3-Watchdog gleicht alle 15 Sekunden sowohl VoiceStates als auch Voice-Channel-Mitglieder ab, erkennt bestehende Calls nach Neustarts und holt verspätete volle Minuten nach. Er hängt nicht mehr von einem einzelnen Event, Channel-Cache oder Member-REST-Fetch ab. |
| **Invite-XP** | Bei jedem Serverbeitritt versucht der Bot herauszufinden, **über welchen Invite-Link** der Neue gekommen ist: Er vergleicht die `uses`-Zähler aller Invites mit dem gespeicherten Snapshot (Delta-Erkennung, pro Server serialisiert, mit kurzem Retry, weil Discord die Zähler manchmal erst verzögert spiegelt). Wird der Invite **eindeutig** zugeordnet und hat er einen **Ersteller**, bekommt dieser **zufällig 40–80 XP** und wird im **Haupt-Chat** gepingt (Nachricht im Level-Up-Look: `##`-Überschrift, gleiche Schriftgröße) – „Du hast jemanden eingeladen und er/sie ist sogar beigetreten!“. Der Ersteller muss noch auf dem Server sein und darf kein Bot sein. Vanity-/Link-lose Invites (ohne Ersteller) geben nichts. **Rejoin-Schutz:** Wer innerhalb von **7 Tagen** nach dem Verlassen zurückkehrt, bringt **niemandem** XP und löst **keine Nachricht** aus – egal über welchen Invite und egal wem er gehört (das Leave-Log wird beim Verlassen gespeichert und überlebt auch die Löschung der XP-Daten). Benötigt die Permission **„Server verwalten“ (MANAGE_GUILD)**, um die Invite-Liste zu lesen – fehlt sie, läuft der Rest des Bots normal weiter (einmalige Warnung im Log). |
| **Verlassen** | Wer den Server verlässt, verliert alle Level/XP sofort (Daten gelöscht). Das Leave-Log für den Invite-Rejoin-Schutz bleibt bewusst erhalten (7-Tage-Fenster). |
| **Nickname** | Sofort nach Level Up/Down: `[Lvl {LVL} 🥇] Anzeigename` – nur die **Top 3** bekommen eine Medaille (`🥇🥈🥉`) in den Nicknamen. **Standardmäßig an**, per `/toggle_nicknames` (Admin, erst nach `/setup`) komplett abschaltbar. `/sync_nicknames` geht **alle Mitglieder** durch (mit Ladebalken) und setzt fehlende Tags bzw. entfernt sie, wenn die Funktion aus ist. **Rang-Verschiebungen werden zuverlässig nachgezogen:** Bei jedem Level-Up/Down werden die Top 5 + der betroffene Nutzer geprüft, damit z.B. ein neuer Platz 2 sofort 🥈 im Anzeigenamen bekommt (auch wer aus den Top 3 fällt, verliert die Medaille). Selbst XP-only-Überholer (gleiches Level) werden per 2-Minuten-Check abgefangen. Wird bestehender Tag überschrieben, bei >32 Zeichen wird Anzeigename rechts gekürzt. Kann Bot nicht umbenennen → Ping im Haupt-Chat: „Ich brauche Rolle über allen anderen!“ (Ausnahme: der **Server-Owner** bekommt diesen Hinweis nicht, da Discord es nie erlaubt, ihn umzubenennen). |
| **Leaderboard** | **Zuverlässig stündlich** aktualisiert (eigener persistierter Stunden-Timestamp, vollständig unabhängig von Level-Up-Edits; sofort beim Start und **immer nach dem 0-Uhr-Schwund**) **plus bei jedem Level-Up/Down**, aber frühestens alle **10 Minuten** (Throttle). Bonus-, Decay- und Leaderboard-Scheduler laufen getrennt, damit ein langsamer Request die anderen Zeitaufgaben nicht blockiert. Mit **letzter Aktualisierung + Zeitzone**, Update-Hinweis & **kurzer Schwund-Warnung**. Schlägt das Editieren fehl, wird zuerst eine neue Nachricht gesendet und erst nach deren Erfolg die alte gelöscht. Marker `xp_leader::v1::` für Self-Healing (Scan 100 Nachrichten tief). |
| **Announcements** | **Chat-Level-Up:** sofortiger Reply auf die auslösende Nachricht, egal in welchem Textkanal. **Voice-/Bonus-Level-Up und alle Level-Downs:** Haupt-Chat aus `/setup`. Fallback-Kette: Quellkanal → Haupt-Chat → Systemkanal sowie Plain-Text, falls Discord Components V2 ablehnt. Nickname-, Rollen-, Leaderboard- und Turso-Requests laufen erst danach bzw. parallel und können die sichtbare Nachricht nicht mehr blockieren. Enthält User-Mention, neues Level + `xp/needed XP` in der Server-Sprache. Die Level-Up-Zeile ist eine `##`-Überschrift. |
| **Belohnungsrollen** | `/level_roles` (Admin) öffnet ein **Formular**: Feld 1 = Rollen-Format (Standard `Level {LEVEL}`, `{LEVEL}` ist der Platzhalter für die Zahl), Feld 2 = Level-Zahlen kommagetrennt (Standard `3,6,10,20`; Leerzeichen, doppelte Kommas, Punkte & Tippfehler wie `1O` werden intelligent korrigiert, Unverständliches wird ignoriert). Beim Absenden **löscht der Bot alte Level-Rollen** (per gespeicherter ID oder Namens-Muster), **erstellt neue, sortiert aufsteigend** und legt sie **ganz unten** in der Rollenliste ab – **mehr Level = weiter oben**. Antwort: „Erledigt – du kannst Farben & Namen jetzt manuell anpassen“ + Liste. Bei **Level Up UND Level Down** werden danach alle fehlenden Level-Rollen vergeben (mehrere möglich: Level 6 bekommt z.B. Rolle 3 **und** 6) – vorhandene Rollen werden **nie entfernt** (auch nicht bei Abstieg). |

---

## 💬 Commands

| Command | Wer | Was |
|---|---|---|
| `/setup <leaderboard> <mainchat> <language>` | **Admin** | Richtet System ein: Leaderboard-Kanal, Haupt-Chat (Level-Ups & Nick-Fehler) & Sprache (10 zur Wahl). Erstellt sofort das Leaderboard, löscht alte. `BIRTHDAY_BOT` Style mit Ephemeral-Bestätigung. |
| `/rank` | **Alle** | Zeigt deinen Platz im Server (von allen), Level, `xp/needed`, Fortschritts-Balken `████░░░░` und als Stichpunkt **deinen voraussichtlichen XP-Verlust heute um 0 Uhr** (inkl. aktuellem Schwund-Prozentsatz). Auf Server-Sprache, ephemeral. |
| `/level_roles` | **Admin** | Öffnet ein Formular zum Anpassen der Level-Belohnungsrollen: Rollen-Format (Standard `Level {LEVEL}`) + Level-Zahlen (Standard `3,6,10,20`). Erstellt/löscht & sortiert die Rollen automatisch (ganz unten, mehr Level = weiter oben) und antwortet mit „Erledigt…“. Alte Level-Rollen werden bei erneuter Nutzung ersetzt. |
| `/update_leaderboard` | **Admin** | Aktualisiert das Leaderboard **sofort** (z. B. nach manuellen Rollen-/XP-Änderungen). **5-Minuten-Cooldown** pro Server gegen Spam – danach gibt es eine klare Meldung mit Restzeit. |
| `/toggle_nicknames <enabled>` | **Admin** | Schaltet die Level-Tags in Nicknames **an oder aus** (`true`/`false`). **Standard: an.** Nur nutzbar, wenn `/setup` bereits einmal gelaufen ist. Automatische Updates (Level-Up, Join, …) respektieren den Schalter sofort; bestehende Namen ändert erst `/sync_nicknames`. |
| `/sync_nicknames` | **Admin** | Geht **alle Mitglieder** des Servers durch und korrigiert Nicknames. **An:** fehlende/falsche Tags setzen. **Aus:** vorhandene Tags entfernen. Zeigt in der Command-Antwort einen **Ladebalken** (Discord-Thinking + Fortschritt). Nur nach `/setup`. |
| `/set_inactive_role <mode> [inactive_days] [role]` | **Admin** | Inaktiv-Rolle nach N Tagen ohne XP. `mode:On` + Tage + Rolle aktiviert, `mode:Off` deaktiviert. Bei Nutzung werden **alle Mitglieder sofort abgeglichen** (mit Ladebalken). Nur nach `/setup`. |
| `/ping_inactive_people <mode>` | **Admin** | Spricht **inaktive Mitglieder** an (nur nach `/setup` + Inaktiv-Rolle). **Main Channel:** Formular-Nachricht muss `{ROLEPING}` enthalten → wird durch die Inaktiv-Rollen-Mention ersetzt und in **den Kanal gesendet, in dem der Command benutzt wurde**. **Direct:** jedes Mitglied mit der Inaktiv-Rolle bekommt die Nachricht als **DM** (plain, kein Container) – der Command-Nutzer sieht nur für sich einen **Ladebalken** mit Erfolgen/Fehlschlägen (z. B. fremde DMs ausgeschaltet). Beispiel-Nachrichten sind im Formular vorbefüllt. |
| `/help` | **Alle** | Container-Übersicht aller Commands (Setup, Rank, Level-Rollen, Update-Leaderboard, Toggle-/Sync-Nicknames, Set-Inactive-Role, Ping-Inactive-People, Help, Profile) – wie Birthday Bot. |
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
  guild_configs(guild_id PK, leaderboard_channel_id, main_channel_id, lang,
                leaderboard_message_id, last_daily_decay, bonus_state,
                last_leaderboard_refresh, last_hourly_leaderboard_refresh, ...)
  user_levels(guild_id, user_id PK, level, xp, last_xp_gain, inactive_days, last_activity)
  invite_snapshots(guild_id PK, data, updated_at)        -- Invite-XP: {code: uses}
  invite_leave_log(guild_id, user_id PK, left_at)        -- Invite-XP: 7-Tage-Rejoin-Schutz
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
   - ℹ️ Für `GUILD VOICE STATES` gibt es im Developer Portal **keinen extra Schalter**. Der Bot fordert den normalen `GuildVoiceStates` Gateway-Intent bereits automatisch an.
4. **OAuth2 → URL Generator** → Scopes `bot` + `applications.commands` → Perms: `View Channels`, `Send Messages`, `Manage Messages` (Leaderboard Edit), `Change Nickname`, `Manage Roles` (für Level-Belohnungsrollen), `Create Instant Invite`, `Use Voice Activity` – **optional, aber empfohlen für Invite-XP:** `Manage Server` (liest die Invite-Liste, ohne geht der Rest des Bots trotzdem) → URL öffnen & einladen.
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
- **Level-Rollen werden nicht erstellt?** Bot braucht die Berechtigung **`Manage Roles`** (Rollen verwalten). Nach dem `/level_roles`-Formular antwortet er sonst mit einem Hinweis.
- **Rollen erscheinen nicht im Sync?** Nach dem Einrichten zieht der Bot bestehende Mitglieder automatisch nach (best effort). Spätestens beim nächsten Level-Up/Down oder Serverbeitritt werden die Rollen vergeben.
- **Nicknames ändern nicht?** Rolle nach oben ziehen, `Change Nickname` geben. Owner kann nie umbenannt werden → er bekommt daher auch keinen Hinweis (für alle anderen pingt der Bot einmal pro Stunde im Haupt-Chat).
- **Voice-XP kommt nicht?** Nach einer vollen Minute erscheinen die 10 XP spätestens beim nächsten 15-Sekunden-Scan (also nach ca. 60–75 s). Nur Bots und Server ohne abgeschlossenes `/setup` sind ausgenommen; der Bot selbst muss nicht im Channel sein. Im Startlog bestätigt `Voice-V3` außerdem die Zahl der sichtbaren Voice-Nutzer.
- **Täglicher Decay zu hart?** Der Basissatz ist 5 %; bei längerer Inaktivität steigt er täglich um 3 Prozentpunkte. Sobald wieder XP verdient werden, fällt er auf 5 % zurück.
- **Turso Limits?** Check https://app.turso.tech → Metrics. Bei RAM-first sollten <100 Writes/Tag sein.

Viel Spaß beim Leveln! 🚀🔥
