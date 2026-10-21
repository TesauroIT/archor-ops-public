# Archon Ops

Interne Benutzeroberfläche zur Verwaltung von mandantenfähigen Dynatrace-Umgebungen: Reiht [Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code)-Befehle (`deploy` / `download`) in die Warteschlange ein, führt sie aus und versioniert jedes Backup in einem lokalen Git-Repository pro Client/Umgebung, ohne von externen Diensten abhängig zu sein.

Detaillierte Funktions- und Architekturdetails finden Sie in den Spezifikationen `specs/requirements.md`, `specs/design.md` und `specs/tasks.md`.

## ⚠️ Haftungsausschluss (Disclaimer)

Diese Software wird **"wie besehen" (AS IS)** zur Verfügung gestellt, ohne jegliche Gewährleistung, weder ausdrücklich noch stillschweigend. Durch die Nutzung erklären Sie sich mit Folgendem einverstanden:

- **Bereitstellungsoperationen (deploy) überschreiben reale Konfigurationen** in Ihren Dynatrace-Umgebungen und können diese ändern, in einen inkonsistenten Zustand versetzen oder beschädigen, wenn Sie nicht genau wissen, was Sie tun. Die App erfordert vor jeder realen Bereitstellung eine doppelte Bestätigung, aber **die Verantwortung für die Durchführung liegt ausschließlich beim Bediener**.
- Die Autoren und Mitwirkenden **übernehmen keine Haftung** für Konfigurationsverluste, Überwachungsunterbrechungen, Verbrauchskosten oder andere direkte oder indirekte Schäden, die aus der Nutzung dieses Tools entstehen.
- Führen Sie vor einer echten Bereitstellung immer einen **Trockenlauf (dry-run)** durch und überprüfen Sie das vollständige Protokoll. Halten Sie aktuelle Backups der beteiligten Umgebungen bereit (die App erleichtert dies, aber die Überprüfung liegt in der Verantwortung des Bedieners).
- Dieses Tool ist **kein offizielles Dynatrace-Produkt** und steht in keiner Verbindung zu Dynatrace LLC. Die Monaco CLI und die verwendeten APIs gehören ihren jeweiligen Eigentümern; bitte überprüfen Sie deren Nutzungsbedingungen.

Verwenden Sie das Tool zunächst in Testumgebungen und validieren Sie Ihren Arbeitsablauf, bevor Sie in Produktionsumgebungen arbeiten.

## Voraussetzungen

- Node.js 20.19+ / 22.12+ (empfohlen; siehe Kompatibilitätshinweis unten)
- Git auf dem Server/Rechner installiert
- Die **Dynatrace Monaco CLI (v2)**-Binärdatei installiert und im `PATH` verfügbar (oder konfigurieren Sie `MONACO_BIN_PATH` in der `.env` mit dem absoluten Pfad).

### Monaco CLI-Installation

#### Unter Windows (PowerShell):
1. Laden Sie die ausführbare Datei von der [Dynatrace-Releases-Seite](https://github.com/dynatrace/dynatrace-configuration-as-code/releases) herunter:
   ```powershell
   # Laden Sie die neueste stabile Version herunter (Beispiel für Windows amd64)
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. Fügen Sie `C:\dynatrace\` zu den Systemumgebungsvariablen (`PATH`) hinzu oder definieren Sie den genauen Pfad in Ihrer `.env`-Datei:
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### Unter Linux / macOS (Bash):
1. Herunterladen und Ausführungsrechte erteilen:
   ```bash
   # Download für Linux amd64
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. Wenn Sie die Datei lieber in einem Benutzerverzeichnis speichern möchten, konfigurieren Sie dies in Ihrer `.env`:
   ```env
   MONACO_BIN_PATH="/home/benutzer/bin/monaco"
   ```

> **Kompatibilitätshinweis:** Das Projekt wurde unter Node 20.16 initialisiert und getestet. Wenn Ihr Node 20.16 oder ähnlich ist, verwenden Sie die installierten Versionen `prisma@6`/`@prisma/client@6` — Prisma 7+ erfordert Node 20.19+.

## Installation (Lokale Nutzung, Einzelbenutzer)

```bash
npm install
cp .env.example .env
# Bearbeiten Sie .env: Ändern Sie mindestens ENCRYPTION_KEY und SEED_ADMIN_PASSWORD.
# Generieren Sie einen ENCRYPTION_KEY mit:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # Erstellt den Admin-Benutzer (SEED_ADMIN_EMAIL/PASSWORD)

# Starten Sie den Entwicklungsserver auf dem Standardport (3000) oder einem benutzerdefinierten Port
PORT=3080 npm run dev
```

Öffnen Sie http://localhost:3000 (oder den von Ihnen definierten Port), melden Sie sich mit den Seed-Anmeldeinformationen an und erstellen Sie Ihren ersten Kunden + Umgebung.

## Server-Nutzung (Mehrere Kunden & Persistenz)

1. Ändern Sie `datasource.provider` in `prisma/schema.prisma` zu `"postgresql"` und passen Sie `DATABASE_URL` in `.env` an Ihre Postgres-Datenbank an.
2. Definieren Sie `DATA_DIR` auf einen persistenten Pfad auf dem Server (z. B. eine dedizierte Festplatte), auf der die Git-Repositories für jeden Kunden/jede Umgebung gespeichert werden.
3. Erstellen Sie die Anwendung für die Produktion:
   ```bash
   npm run build
   ```
4. **Ausführung mit PM2**:
   Das Projekt enthält eine direkt einsatzbereite `ecosystem.config.js`-Datei. Sie können PM2 global installieren und die Anwendung einfach starten:
   ```bash
   # PM2 global installieren (falls nicht vorhanden)
   npm install -g pm2

   # Anwendung starten (standardmäßig auf dem im Ecosystem/Env konfigurierten Port)
   pm2 start ecosystem.config.js

   # Wenn Sie den Port zur Laufzeit beim Start mit PM2 ändern möchten:
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *Hinweis: Der Job-Worker läuft im selben Node-Prozess; es ist kein externer Redis- oder Warteschlangendienst erforderlich.*

## Funktionsweise

- **Deploy/Backup**-Aktionen werden über die UI einer Umgebung ausgelöst und erstellen einen `Job`-Datensatz in der Datenbank (der Befehl wird nicht in derselben HTTP-Anfrage ausgeführt).
- Ein interner Worker (`lib/server/worker.ts`) ruft Jobs im Status `PENDING` ab, ruft `monaco` über `child_process.spawn` auf (wobei das Token als Umgebungsvariable übergeben und nicht im Protokoll ausgegeben wird) und streamt das Live-Protokoll über Server-Sent Events (`/api/jobs/:id/stream`) an die Benutzeroberfläche.
- Nach erfolgreichem Abschluss eines Backups (oder Deploys) wird automatisch ein Commit im lokalen Git-Repository dieser Umgebung (`DATA_DIR/<kunde>/<umgebung>`) erstellt. Es ist kein Remote konfiguriert; dies dient lediglich als lokaler Verlauf.
- Dynatrace-Tokens werden verschlüsselt gespeichert (AES-256-GCM) und vor dem Speichern aus den Protokollen unkenntlich gemacht.

## Dynatrace-Berechtigungen (Tokens und Scopes)

Jede Umgebung verwendet bis zu **drei verschiedene Zugangsdaten**, und jede Funktion fordert nur das an, was sie benötigt. Wenn ein Abschnitt `403` zurückgibt, fehlen den entsprechenden Zugangsdaten Scopes aus dieser Tabelle. Im Formular "Umgebung" verfügt jede Berechtigung über eine Schaltfläche **Test**, um die Berechtigungen vor dem Speichern zu überprüfen.

| Zugangsdaten | Verwendet für | Erforderliche Scopes / Berechtigungen |
|---|---|---|
| **Klassischer API-Token** (`Api-Token`) | Monaco: `download` und `deploy` | `ReadConfig`, `settings.read` (Backup) · `WriteConfig`, `settings.write` (Deploy) |
| **Platform-Token** (`dt0s16`) — Dashboards | Dashboard-Verwaltung (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform-Token** (`dt0s16`) — Lookups | Upload/Liste/Download/Löschen von Grail-Dateien (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **Account-OAuth-Client** (`dt0s02`) | Auflösen von SSO-ID → E-Mail (Account-API) | `account-idm-read` |

> Es gibt **nur einen** Platform-Token pro Umgebung: Derselbe Token verwaltet Dashboards und Grail-Dateien, solange er über **beide** Scope-Gruppen verfügt.

### ⚠️ Platform-Tokens haben ZWEI Schlösser

Bei einem Platform-Token reicht es nicht aus, die Scopes bei der Erstellung anzukreuzen. Die **effektive** Berechtigung ist die Schnittmenge:

```
effektive Berechtigung = (Token-Scopes)  ∩  (IAM-Richtlinie des Token-Besitzers)
```

Das heißt, zusätzlich zu den Token-Scopes muss die **IAM-Richtlinie der Gruppe des Benutzers, der den Token erstellt hat**, diese Berechtigungen gewähren. Für Grail-Dateien (lookups) muss diese Richtlinie Folgendes enthalten (passen Sie die Pfadbegrenzung nach Belieben an):

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

Häufige Fehlerquellen, wenn ein `403` zurückgegeben wird, obwohl der Token über den Scope "verfügt":

- **Einem Platform-Token können nach seiner Erstellung keine Scopes hinzugefügt werden.** Wenn Sie Berechtigungen ändern, generieren Sie einen neuen Token und fügen Sie ihn erneut in der Umgebung ein.
- Der Token wird mit den Berechtigungen **seines Besitzers** ausgeführt. Wenn sich die Richtlinie in einer Gruppe befindet, der der Token-Besitzer nicht angehört, wird sie nicht angewendet.
- Eine Richtlinienbegrenzung (**boundary** nach Pfad oder Umgebung), die nicht übereinstimmt, führt zu einer stillschweigenden Ablehnung: Überprüfen Sie, ob sie die Umgebung und `/lookups/` enthält.

Die Schaltfläche **Test** im Abschnitt "Lookups" meldet Lese- und Schreibberechtigungen separat (`read` / `write`), um genau zu isolieren, welche Berechtigung fehlt.

## Struktur

Siehe Abschnitt 7 von `specs/design.md` für Ordnerdetails (`app/`, `lib/`, `prisma/`).
