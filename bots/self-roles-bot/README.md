# 🎭 Self-Roles Bot – Rollen zum Selbstbedienen, **ohne Datenbank**

Klick → Rolle. Nochmal klick → Rolle wieder weg. Und die Zahl daneben ist
**immer** aktuell, egal ob jemand den Button drückt oder ein Admin die Rolle
von Hand verteilt. Alles ohne eine einzige Datenbankzeile. 🤯

> **Wie ohne DB?** Genau wie beim Geburtstags-Bot: Titel, Beschreibung,
> Sprache, Auswahl-Modus und die komplette Rollenliste stecken als
> **unsichtbarer Zero-Width-Blob** in der Nachricht selbst
> (siehe [`src/zw-marker.js`](src/zw-marker.js)). Der Bot liest seine eigene
> Nachricht einfach wieder aus – Neustarts, Abstürze und Registry-Verluste
> sind ihm herzlich egal.

---

## 📋 Commands

| Command | Was er kann |
|---|---|
| `/create_self_role [channel]` | **Nur Admins.** Öffnet ein Formular mit **großer Textbox** (Beschreibung) und **kleinem Feld** (Titel). Danach erscheint die **Bearbeitungs-/Bestätigungs-Nachricht** mit Kanal, Titel, Beschreibung, Auswahl-Modus und der Rollenliste. |
| `/edit_self_role` | **Nur Admins.** Auswahlmenü aller bestehenden Self-Roles-Nachrichten → derselbe Editor, Änderungen gehen erst mit **💾 Speichern** live. |
| `/set_role_logging [status] [language]` | **Nur Admins.** Schaltet kurze, sachliche Privat-DMs bei Rollenänderungen ein (`True`) oder aus (`False`) und setzt optional die Benachrichtigungssprache. Standardmäßig für jeden Server **an** und im Zero-Width-Marker auf Discord persistiert. |
| `/admin_set_bot_profile [image]` | **Nur Admins.** Serverspezifisches Profilbild (Standard / Server-Icon / Server-Owner-Icon). |
| `/help` | Befehlsübersicht in **10 Sprachen** (folgt der Discord-Sprache des Nutzers). |
| `/adminpanel` | Owner-Panel – **nur im Privatchat** mit dem Bot-Owner. Serverliste mit Seiten, Detailansicht, Einladung (1 h, 1×) und Verlassen mit Sicherheitsabfrage. |

---

## 🛠️ Der Editor

Nach dem Formular bekommst du eine **ephemere** Bearbeitungs-Nachricht als
Bestätigung – dort steht nochmal alles drin:

```
🛠️ Self-Roles-Werkstatt
Letzter Check, bevor das Ding live geht. Alles korrekt? Dann Feuer frei! 🚀
──────────────────────────────
📍 Kanal:        #rollen
🏷️ Titel:        Wähle deine Rollen 🎉
📝 Beschreibung: Klick dich reich – alles einzeilig.
🎚️ Auswahl:      so viele wie du willst (Sammelwut erlaubt) 🧺
──────────────────────────────
### 🎭 Rollen (0/20)
🫥 Noch keine Rollen konfiguriert. Minimum sind 2, Maximum 20 – ran an die Buttons!

⚠️ Es fehlen noch 2 Rolle(n) bis zum Minimum von 2.
──────────────────────────────
[➕ Rolle hinzufügen] [➖ Rolle entfernen] [✏️ Titel & Text] [🎚️ Auswahl umschalten]
[🚀 Absenden] [❌ Abbrechen]
```

- **➕ Rolle hinzufügen** öffnet ein Formular mit **Rollenname** (so heißt die
  Rolle später auf dem Server) und **Text-Platzhalter** (das, was in der
  Nachricht und auf dem Button steht).
- **➖ Rolle entfernen** öffnet ein Auswahlmenü.
- **🎚️ Auswahl umschalten** wechselt zwischen *eine Rolle* (neue Wahl wirft die
  alte raus) und *mehrere Rollen*.
- **🚀 Absenden** ist gesperrt, solange nicht **mindestens 2** Rollen (maximal
  **20**) konfiguriert sind.

### Wichtig: Beschreibung ist immer einzeilig

Jeder Zeilenumbruch (auch `\r\n` und Unicode-Zeilentrenner) wird zu einem
**Leerzeichen**, Mehrfach-Leerzeichen werden zusammengefasst. Das gilt im
Editor, in der Bestätigung und in der finalen Nachricht.

---

## 🚀 Was beim Absenden passiert

1. **Erst jetzt** werden die Rollen erstellt – mit den eingegebenen Namen.
2. Sie landen automatisch **ganz unten** in der Rollenliste (direkt über
   `@everyone`), sind **erwähnbar**, ohne Berechtigungen und ohne Hoist.
3. Dann geht die Nachricht raus:

```
# Wähle deine Rollen 🎉
Klick dich reich – alles in einer Zeile.
──────────────────────────────
🎮 Zocker (12) - @Gamer
🎨 Künstler (3) - @Artist
──────────────────────────────
[ 🎮 Zocker (12) ]  [ 🎨 Künstler (3) ]     ← alle Buttons grau
```

Geht beim Senden etwas schief, werden die frisch erstellten Rollen
**automatisch wieder gelöscht** (Rollback) – kein Rollen-Müll auf dem Server.

---

## 🖱️ Was Nutzer erleben

- **Klick auf einen Button** → Rolle bekommen:
  „✅ Zack! @Gamer gehört jetzt dir. Trag sie mit Stolz. 😎“
- **Einzel-Modus** → „🔄 Rollentausch! @Alt raus, @Neu rein – Einzelauswahl eben.“
- **Rolle schon vorhanden** → „🤨 Du hast @Gamer längst. Soll ich sie dir wieder
  abnehmen?“ + Button **🗑️ Rolle wieder abgeben**.
- Danach: „🗑️ @Gamer ist weg. Falls du sie vermisst: Button ist noch da. 👋“

Alle Antworten sind **ephemer** – nur der klickende Nutzer sieht sie.

---

## 🔢 Wie die Zähler krass aktuell bleiben

Die Anzahl wird aus **mehreren Richtungen** gleichzeitig aktualisiert:

| Auslöser | Was passiert |
|---|---|
| Button-Klick | Zähler wird sofort neu berechnet und die Nachricht editiert |
| `guildMemberUpdate` | Ein Admin vergibt/entzieht eine Rolle **manuell** → betroffene Nachrichten werden sofort nachgezogen |
| `guildRoleDelete` | Gelöschte Rolle verschwindet aus Liste **und** Buttons |
| `guildRoleUpdate` | Umbenannte Rolle → Anzeige neu gerendert |
| `guildMemberRemove` | Mitglied verlässt den Server → Zähler sinkt |
| Scheduler (jede Minute) | Sicherheitsnetz: prüft alle Nachrichten, schreibt aber nur bei echter Änderung (Signatur-Vergleich) |
| Scheduler (alle 15 Min) | Erzwungener `members.fetch()` – korrigiert Zahlen nach Gateway-Aussetzern |
| Scheduler (stündlich) | Kompletter Rescan: findet Nachrichten wieder, die die Registry verloren hat |

---

## 🛟 Robustheit (der Bot darf ruhig mal ausfallen)

- **Kein State im RAM nötig:** Die Konfiguration steht in der Nachricht.
  Nach einem Neustart findet der Bot alles über `scanGuilds()` wieder – und
  falls doch mal nicht, holt der **erste Button-Klick** die Nachricht per
  Recovery zurück in die Registry.
- **Marker verloren?** Dann werden Rollen-IDs und Labels aus den **Buttons**
  selbst rekonstruiert (Fallback-Parser).
- **Locks pro Nachricht:** Gleichzeitige Klicks überholen sich nicht und
  schreiben keine veralteten Zähler zurück.
- **Timeout-Schutz:** Hängt ein Zähler-Update, antwortet der Bot trotzdem –
  das Update läuft im Hintergrund weiter.
- **Jeder Fehlerpfad antwortet:** Fehlende Rechte, gelöschte Rollen, kaputte
  Nachrichten, abgelaufene Sessions – es gibt nie ein stummes
  „Interaktion fehlgeschlagen“.
- **Sessions verfallen** nach 30 Minuten (kein RAM-Leck).

---

## 📦 Limits

| Grenze | Wert |
|---|---|
| Rollen pro Nachricht | **min. 2**, **max. 20** (4 Button-Reihen à 5) |
| Self-Roles-Nachrichten pro Server | **max. 10** |
| Titel | 100 Zeichen |
| Beschreibung | 900 Zeichen (einzeilig) |
| Text-Platzhalter | 60 Zeichen |

---

## ⚙️ Setup

```env
SELF_ROLES_BOT_TOKEN=dein-token
SELF_ROLES_BOT_OWNER_ID=deine-discord-id     # optional, sonst BIRTHDAY_BOT_OWNER_ID
SELF_ROLES_BOT_GUILD_ID=                     # optional: Dev-Server für sofortige Commands
```

**Discord Developer Portal:**
- Privileged Intent **`SERVER MEMBERS INTENT`** aktivieren (für die Zähler!)
- Bot-Berechtigungen: `View Channels`, `Send Messages`, **`Manage Roles`**
- Die Bot-Rolle muss **über** den Self-Roles-Rollen stehen – sonst darf der Bot
  sie nicht vergeben (der Bot sagt dir das aber auch deutlich 🔐).

---

## 🗂️ Aufbau

```
bots/self-roles-bot/
├── index.js                # Bot-Einstieg, Events (Rollen-/Member-Updates)
└── src/
    ├── commands.js         # Slash-Commands + Registrierung
    ├── interactions.js     # Buttons, Modals, Select-Menüs (Dispatch)
    ├── editor.js           # Editor-Sessions, Rollen-Erstellung, Publish
    ├── embed-builder.js    # Container, Modals, Parser („Datenbank“)
    ├── store.js            # Registry, Suche, Refresh, Zähler
    ├── scheduler.js        # Minütlich/15-Min/Stündlich
    ├── admin-panel.js      # Owner-Panel (DM)
    ├── languages.js        # 10 Sprachen in einer Datei
    ├── logic.js            # Limits, Text-Säuberung, Marker-Kodierung
    ├── message-payload.js  # Components-V2-Flags
    └── zw-marker.js        # Unsichtbare Zero-Width-Kodierung
```
