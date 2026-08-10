# 🎂 Birthday Bot

Geburtstagsliste für Discord-Server – **komplett ohne Datenbank** mit modernem
**Container-Layout (Components V2)**. Der Bot sendet einen schönen Listen-Container
und liest ihn selbst immer wieder aus (Self-Healing). Alles, was er „weiß“,
steckt in den Komponenten selbst.

## Funktionen

- **/setup [language] [channel] [birthday_role]** – **Nur für Admins:** Liste in
  10 Sprachen einrichten (Kanal optional, sonst aktueller Kanal). Mit der
  optionalen **`birthday_role`** bekommen Geburtstagskinder diese Rolle für
  **24 Stunden** am Ehrentag (Vergabe um 0 Uhr, stündliches Aufräumen nimmt
  sie nach dem Tag wieder weg; die Rollen-ID steckt im Listen-Marker).
  Bestehende Listen werden gefunden: Einträge & Rolle bleiben beim Umstellen
  von Sprache/Kanal erhalten.
- **/event create | /event delete** – **Nur für Admins:** Server-Events in die
  Liste aufnehmen (Formular: Name, Tag, Monat – **jedes Datum erlaubt, keine
  7-Tage-Regel**, Bestätigungs-Container mit ✅/✏️/❌) oder per Auswahlmenü
  wieder entfernen. Events erscheinen mit **Namen statt Erwähnung**
  einsortiert in der Geburtstagsliste, **maximal 5 gleichzeitig**. Um 0 Uhr am
  Event-Tag postet der Bot **„🚀 Heute findet ein Event statt!“** mit
  „Interessenten“-Abschnitt und **„Interessant! 😂“**-Button (nur im
  betreffenden Kanal, 24 h lang klickbar). Danach wird das Event **aus der
  Liste gelöscht** (kein jährlicher Kreislauf wie bei Geburtstagen).
- **Modernes Container-Layout (Components V2)** – Kein farbiger Rand an der Seite,
  Titel `🎂 Geburtstage` direkt beim Datumstext oben, keine störenden Footer oder
  Zeitstempel unten, Trennlinien (Dividers) und Buttons direkt im Container.
- **„🎂 Geburtstag eintragen“-Button** im Container → Formular mit
  Tag (nur Zahlen) und Monat (Zahl, Name oder Tippfehler – Fuzzy-Erkennung
  über alle 10 Sprachen, es gewinnt immer das beste Wort).
  Danach ein **ephemerer** Bestätigungs-Container (nur für die eintragende
  Person sichtbar) mit ✅ Bestätigen / ✏️ Bearbeiten / ❌ Abbrechen.
  **Beide Felder leer lassen + bestätigen** löscht den eigenen Geburtstag.
- **7-Tage-Regel** als Spam-Schutz beim Eintragen.
- **Stündliches Self-Refresh**: aktueller Monat zuerst (dann Jahresrest,
  dann Januar bis davor), Nutzer, die den Server verlassen haben, werden
  entfernt, Datum oben in der Zeitzone der Sprache. Hinter jeder Erwähnung
  steht der lokalisierte Countdown bis zum nächsten Geburtstag (z. B.
  `@Nutzer – in 1 Tag`, `@Nutzer – in 5 Tagen` bzw. die entsprechende Form
  in der gewählten Sprache).
- **Täglich um 0 Uhr** (Sprach-Zeitzone): Geburtstagskinder bekommen einen
  Gruß-Container mit „🎉 Gratulieren“-Button; Glückwünsche und
  Anzahl stehen direkt im Container (keine Doppel-Glückwünsche).
  Gratulieren ist nur in den **nächsten 24 Stunden** nach dem Gruß möglich.
- **Max. 3 Nachrichten** unter der Liste – automatisches Aufräumen.
- **/admin_set_bot_profile** – **Nur für Admins:** serverspezifisches Bot-Profilbild
  (Standard / Server-Icon / Server-Owner-Icon) sofort per Discord-API geändert.
- **/admin_set_birthday** – **Nur für Admins:** setzt Geburtstage für andere
  (ohne 7-Tage-Regel). Beide Felder leer lassen + bestätigen löscht den
  Geburtstag des Ziel-Nutzers.
- **/help** – Befehlsübersicht in der Server-Sprache (nur die Befehle, ohne /adminpanel).
- **/adminpanel** – Owner-Panel **nur im Privatchat** mit dem Bot-Owner:
  auf Servern unsichtbar, Serverliste mit Seiten, sortiert (🔴-Server zuerst),
  Server-Detail, Einladung (1h/1×), Verlassen, Join-Benachrichtigung.

## Dateien

```
bots/birthday-bot/
├── index.js              # Bot-Factory: Events, Aufräumen, Scheduler
└── src/
    ├── languages.js      # ★ EINE Sprachdatei: alle Texte in 10 Sprachen
    ├── logic.js          # Datumslogik: Zeitzonen, 7-Tage-Regel, Monatsreihenfolge
    ├── embed-builder.js  # baut & liest die Listen-Container (die „Datenbank“)
    ├── store.js          # Registry, Channel-Scan, Refresh, Tages-Check
    ├── scheduler.js      # stündliches Refresh + 0-Uhr-Prüfung
    ├── commands.js       # Slash-Command-Definitionen & Handler
    ├── interactions.js   # Buttons & Formulare
    └── admin-panel.js    # Owner-Admin-Panel (deutsch)
```

## Konfiguration

| Variable | Zweck |
|---|---|
| `BIRTHDAY_BOT_TOKEN` | Bot-Token (Pflicht) |
| `BIRTHDAY_BOT_OWNER_ID` | Discord-ID des Owners fürs `/adminpanel` |
| `BIRTHDAY_BOT_GUILD_ID` | optional: Dev-Server für sofortige Command-Registrierung |
| `BIRTHDAY_BOT_TZ_<CODE>` | optional: Zeitzonen-Override, z. B. `BIRTHDAY_BOT_TZ_EN=Europe/London` |

Benötigte Intents: `Guilds`, `GuildMessages`, `MessageContent`,
`GuildMembers` (privilegiert!), `DirectMessages`.
