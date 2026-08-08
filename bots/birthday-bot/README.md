# 🎂 Birthday Bot

Geburtstagsliste für Discord-Server – **komplett ohne Datenbank**. Der Bot
sendet ein schönes Listen-Embed und liest es selbst immer wieder aus
(Self-Healing). Alles, was er „weiß“, steckt im Embed selbst.

## Funktionen

- **/setup [language] [channel]** – Liste in 10 Sprachen einrichten
  (Kanal optional, sonst aktueller Kanal). Bestehende Listen werden
  gefunden: Einträge bleiben beim Umstellen von Sprache/Kanal erhalten.
- **„🎂 Geburtstag eintragen“-Button** unter der Liste → Formular mit
  Tag (nur Zahlen) und Monat (Zahl, Name oder Tippfehler – Fuzzy-Erkennung
  über alle 10 Sprachen, es gewinnt immer das beste Wort).
  Danach Bestätigungs-Embed mit ✅ Bestätigen / ✏️ Bearbeiten / ❌ Abbrechen.
- **7-Tage-Regel** als Spam-Schutz beim Eintragen.
- **Stündliches Self-Refresh**: aktueller Monat zuerst (dann Jahresrest,
  dann Januar bis davor), Nutzer, die den Server verlassen haben, werden
  entfernt, Datum oben in der Zeitzone der Sprache.
- **Täglich um 0 Uhr** (Sprach-Zeitzone): Geburtstagskinder bekommen ein
  Gruß-Embed mit Profilbild + „🎉 Gratulieren“-Button; Glückwünsche und
  Anzahl stehen danach im Embed (keine Doppel-Glückwünsche).
- **Max. 3 Nachrichten** unter der Liste – automatisches Aufräumen.
- **/set_bot_profile** – serverspezifisches Bot-Profilbild
  (nur: Standard / Server / Server-Owner, kein Upload).
- **/admin_set_birthday** – Admins setzen Geburtstage für andere
  (ohne 7-Tage-Regel).
- **/help** – Befehlsübersicht in der Server-Sprache.
- **/adminpanel** – Owner-Panel nur im DM: Serverliste mit Seiten,
  sortiert (🔴-Server zuerst, dann nach Mitgliedern), Server-Detail,
  Einladung (1h/1×), Verlassen, Join-Benachrichtigung.

## Dateien

```
bots/birthday-bot/
├── index.js              # Bot-Factory: Events, Aufräumen, Scheduler
└── src/
    ├── languages.js      # ★ EINE Sprachdatei: alle Texte in 10 Sprachen
    ├── logic.js          # Datumslogik: Zeitzonen, 7-Tage-Regel, Monatsreihenfolge
    ├── embed-builder.js  # baut & liest die Listen-Embeds (die „Datenbank“)
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
