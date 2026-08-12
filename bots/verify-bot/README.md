# ✅ Verify Bot – Regeln & Verifizierung (ohne Datenbank)

Der Verify-Bot bringt Regel-Nachrichten und eine komplette Verifizierung in
deinen Server – **komplett ohne Datenbank**. Alles (Modus, Rollen, Log-Kanal,
Prüf-Modus, Formularfelder, Bild/Banner) steckt als unsichtbarer
Zero-Width-Blob in der Nachricht selbst. Neustarts und Ausfälle überlebt der
Bot durch Selbstheilung: Bei jedem Klick liest er die Konfiguration frisch aus
der Nachricht.

## Commands

| Command | Was er kann |
|---|---|
| `/create_verify_rules [channel] [logging_channel] [unverified_role] [verified_role]` | **Nur Admins:** Erstellt eine Regeln-Nachricht mit grünem Verifizier-Button. Öffnet ein Formular (große Textbox = Regeln, kleines Feld = Button-Name). Existieren schon Regeln, ist das Formular vorbefüllt. Beim Absenden werden alte Regeln überall auf dem Server gelöscht. |
| `/create_classic_rules [channel]` | **Nur Admins:** Wie oben, aber klassisch – nur Regeln (mit Bild/Banner), ohne Button und Rollen. |
| `/set_verify_form [auswahl]` | **Nur Admins, nur wenn Verify-Regeln existieren:** `Keine Überprüfung`, `Überprüfung ohne Formular` oder `Überprüfung mit Formular`. |
| `/set_language [sprache]` | **Nur Admins:** Stellt die Sprache des Bots auf diesem Server ein (10 Sprachen). |
| `/admin_set_bot_profile [image]` | **Nur Admins:** Serverspezifisches Profilbild des Bots (Standard / Server-Icon / Owner-Bild). |
| `/help` | Übersicht aller Befehle. |
| `/adminpanel` | Owner-Panel – nur im Privatchat mit dem Bot-Owner (wie bei den anderen Bots). |

## Die drei Verifizierungs-Modi

### 1. Keine Überprüfung
Klick auf den grünen Button → der Bot entfernt die `UNVERIFIED`-Rolle, gibt die
`VERIFIED`-Rolle und loggt im Log-Kanal (für Admins). Wer schon verifiziert ist
(abgeglichen an den Rollen), wird **nicht** erneut geloggt.

### 2. Überprüfung ohne Formular
Klick auf den Button → im Log-Kanal erscheint „🙋 @User möchte sich
verifizieren“ mit **Annehmen** / **Ablehnen** (nur Admins). Der Klicker wird
informiert, dass das Team prüft.

- **Annehmen:** Der Nutzer bekommt die Rollen und wird per DM benachrichtigt.
- **Ablehnen:** Öffnet ein Formular für den Ablehnungsgrund. Der Nutzer wird
  **anonym** (ohne zu verraten, wer abgelehnt hat) per DM benachrichtigt und
  kann es jederzeit erneut versuchen.
- Solange eine Anfrage offen ist, kann man keine zweite einreichen.

### 3. Überprüfung mit Formular
Beim Auswählen von „Überprüfung mit Formular“ öffnet sich ein **Editor**, in
dem du eigene Formular-Felder anlegst: Frage, Platzhalter, vorausgefüllter
Wert, kurzes oder großes (mehrzeiliges) Textfeld, Pflichtfeld ja/nein. Beim
Klick auf den Button öffnet sich dieses Formular; die Antworten landen im
Log-Kanal mit Annehmen/Ablehnen.

## Bild & Banner (ohne URL)

Discord-Modals können keine Dateien hochladen. Deshalb läuft das so:

1. Im Editor nach dem Formular auf **🖼️ Bild hochladen** bzw.
   **🎨 Banner hochladen** klicken.
2. Das Bild einfach als **Datei-Anhang** in den Kanal schicken (90 Sekunden
   Zeit). Der Bot übernimmt die Bild-URL, räumt deine Nachricht weg und
   aktualisiert die Vorschau.
3. Bild = oben rechts (Thumbnail), Banner = oben über die volle Breite.
   Beides ist **optional**.

> Hinweis: Der Bot nutzt die Discord-CDN-URL des Anhangs direkt. Damit die URL
> stabil bleibt, ist es gut, die Regeln-Nachricht nicht zu löschen und neu zu
> senden, wenn du die Bilder behalten willst.

## Nur mit der UNVERIFIED-Rolle

Verifizieren kann man nur, wenn man die `UNVERIFIED`-Rolle trägt. Wer die
`VERIFIED`-Rolle schon hat, bekommt einen freundlichen Hinweis statt einer
weiteren Log-Nachricht.

## 10 Sprachen & Humor

Deutsch 🇩🇪, Englisch 🇬🇧, Französisch 🇫🇷, Spanisch 🇪🇸, Portugiesisch 🇧🇷,
Russisch 🇷🇺, Japanisch 🇯🇵, Koreanisch 🇰🇷, Chinesisch 🇨🇳, Italienisch 🇮🇹 –
im selben lockeren Ton wie die anderen Bots. Die Sprache folgt deinem
Discord-Client oder wird per `/set_language` festgelegt.

## Umgebungsvariablen

| Variable | Bedeutung |
|---|---|
| `VERIFY_BOT_TOKEN` | Token des Verify-Bots |
| `VERIFY_BOT_OWNER_ID` | Optional: Owner fürs `/adminpanel` (Fallback: `BIRTHDAY_BOT_OWNER_ID`) |
| `VERIFY_BOT_GUILD_ID` | Optional: Dev-Server für sofortige Command-Registrierung |
