# 🛡️ Security Bot

Ein moderner, leistungsstarker Sicherheits- und Moderations-Bot für Discord mit direkter Anbindung an die **OpenAI Moderation API** (`omni-moderation-latest`).

Der Bot überwacht vollautomatisch alle Text- und Bildnachrichten von Nicht-Administratoren in Echtzeit, straft Regelverstöße gemäß anpassbaren Eskalationsstufen ab und schützt deinen Server vor toxischen Inhalten, Hassrede, Belästigung, Gewalt, NSFW und Selbstverletzung.

---

## 🌟 Highlights

- **OpenAI Moderation API**: Modernste KI-Erkennung für Text und Bilder (`omni-moderation-latest`).
- **Resilienz & Silent Fallback**: Bei fehlendem API-Key oder OpenAI-Fehlern/Rate-Limits arbeitet der Bot geräuschlos weiter ohne den Chat zu stören.
- **Admin-Bypass**: Mitglieder mit Administrator-Berechtigungen werden automatisch ignoriert.
- **10 Sprachen**: Vollständig lokalisiert auf Deutsch, Englisch, Französisch, Spanisch, Portugiesisch, Russisch, Japanisch, Koreanisch, Chinesisch und Italienisch.
- **Turso DB & RAM-First**: Nutzt dieselbe Turso-Datenbank wie der XP-Bot mit Dirty-Tracking, periodischem Backup und lokalem Datei-Fallback.
- **Kein Kick / Kein Ban**: Der Bot verhängt gezielt Verwarnungen und Timeouts (keine zerstörerischen Serverausschlüsse).
- **Modernes Design**: Alle Nachrichten und Menüs nutzen Discord Components V2 (Container-Layout).

---

## 📋 Slash-Commands

| Befehl | Berechtigung | Beschreibung |
|---|---|---|
| `/set_api_key` | **Admins** | Öffnet ein Modal-Formular zur sicheren Eingabe des OpenAI API-Keys für diesen Server. |
| `/set_language` | **Admins** | Wählt eine von 10 Sprachen aus, die dauerhaft für den Server gilt. |
| `/set_sensitivity` | **Admins** | Ändert das Schutzlevel (`Strikt` 30%, `Ausgewogen` 50%, `Tolerant` 75%). |
| `/configure_rules` | **Admins** | Interaktive Übersicht aller Moderationskategorien, Schwellenwerte und Auto-Delete-Optionen. |
| `/set_warnings` | **Admins** | Konfiguriert die maximale Anzahl an Verwarnungen, Verfallsdauer (in Tagen) und Aktionen pro Verwarnungsstufe. |
| `/status` | **Alle** | Zeigt dem Nutzer seine eigenen aktiven Verwarnungen, Timeout-Status und Historie an. |
| `/manage_user [user]` | **Admins** | Überprüft den Status beliebiger Nutzer, hebt Timeouts auf oder löscht einzelne Verwarnungen (z. B. bei Fehlalarmen). |
| `/test_text [text]` | **Admins** | Testet einen Text gegen die OpenAI Moderation API und liefert einen detaillierten Analysebericht mit Score-Balken. |
| `/admin_set_bot_profile` | **Admins** | Ändert das Server-Profilbild des Bots (`Standard`, `Server-Icon` oder `Server-Owner`). |
| `/help` | **Alle** | Listet alle Befehle mit klickbaren Mentions und Erklärungen in der Serversprache auf. |
| `/adminpanel` | **Bot-Owner** | Owner-Verwaltungsübersicht aller Server im Privatchat (DM) des Bots. |

---

## 🔧 Konfiguration (Umgebungsvariablen)

In der `.env`-Datei oder im Render-Dashboard:

```env
# Token des Sicherheitsbots
SECURITY_BOT_TOKEN=

# Owner Discord-ID für das /adminpanel und Beitritts-Benachrichtigungen
SECURITY_BOT_OWNER_ID=

# Optional: genau eine Gilde erhält zusätzlich sofort verfügbare Guild-Commands.
# Leer lassen, wenn ausschließlich der zuverlässige globale Satz gewünscht ist.
SECURITY_BOT_GUILD_ID=

# Turso-Datenbank (wird mit dem XP-Bot geteilt)
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
```

### Slash-Command-Registrierung

Der vollständige Satz wird zuerst global über
`PUT /applications/{application.id}/commands` registriert. Die zehn
Server-Commands tragen ausschließlich den Guild-Context; `/adminpanel` trägt
ausschließlich den Bot-DM-Context. Erst nachdem Discord alle elf globalen
Command-Namen und IDs zurückgegeben hat, werden alte Guild-Overrides entfernt.
Eine gültige `SECURITY_BOT_GUILD_ID`, in der der Bot Mitglied ist, behält
optional einen sofort sichtbaren Guild-Satz (ohne `/adminpanel`). Ein Fehler bei
diesem optionalen PUT beeinträchtigt den globalen Satz nicht.

Der Bot muss mit den OAuth2-Scopes **`bot` und `applications.commands`**
installiert sein. Ob eine bereits bestehende Guild-Installation den Scope
enthält, stellt Discord dem Bot nicht über den Command-Endpunkt zur Verfügung.
Falls der globale PUT laut Log erfolgreich ist, Commands aber nach der
Propagation weiterhin nicht erscheinen, den Bot über eine OAuth2-URL mit
beiden Scopes erneut autorisieren (kein Token erforderlich).

Die Startlogs nennen die Application-ID, konfigurierte Guild-ID, tatsächlichen
REST-Routen, den Render-Commit sowie jeden von Discord bestätigten
Command-Namen und dessen ID. Fehler enthalten HTTP-Status, Discord-Code und
`rawError`; Tokens und Request-Header werden bewusst nie geloggt.
