# ⚒️ XP Level Bot

> **Status: Platzhalter** – Der Ordner ist vorbereitet, das System wird in einem späteren Update gebaut.

Dieser Bot wird ein XP-Level-System für Discord-Server. Aktuell ist nur
die Grundstruktur da: Er meldet sich mit seinem eigenen Token an
(`XP_BOT_TOKEN`), mehr nicht. So bleibt der Multi-Bot-Hoster sofort
betriebsbereit, sobald du den Token einträgst.

## Geplantes System (Roadmap)

- **XP pro Nachricht** in Textchannels (Cooldown gegen Spam)
- **Level-System** mit XP-Kurve und Level-Rollen
- **Commands** (geplant):
  - `/rank` – eigenes Level anzeigen
  - `/leaderboard` – Top-10 der Server
  - `/xp_settings` – XP-Werte, Cooldown, Rollen (nur Admins)
  - `/xp_reset` – Level eines Nutzers zurücksetzen (nur Admins)
- **Belohnungen**: automatische Level-Rollen, evtl. Bonus-Bereiche (Channels mit mehr XP)

## Hinweise

- Eigener Token in der Umgebungsvariable `XP_BOT_TOKEN` (`.env` bzw. Render-Dashboard).
- Wenn der Token leer ist, wird dieser Bot einfach übersprungen – der
  Geburtstags-Bot läuft dann trotzdem.
- Privilegierter Intent `MessageContent` muss im Discord Developer Portal
  aktiviert sein, sobald XP auf Nachrichteninhalte zugreifen soll
  (oder man verzichtet darauf und vergibt XP pauschal pro Nachricht).
