# Archon Ops

Internal UI to manage multi-tenant Dynatrace environments: queues and executes [Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code) commands (`deploy` / `download`) and versions each backup in a local Git repository per client/environment, without depending on any external services.

See `specs/requirements.md`, `specs/design.md`, and `specs/tasks.md` for functional details and architecture.

## ⚠️ Disclaimer

This software is provided **"as is" (AS IS)**, without warranty of any kind, express or implied. By using it, you agree that:

- **Deploy operations overwrite real configurations** in your Dynatrace environments and can modify them, leave them inconsistent, or damage them if you do not know what you are doing. The app requires double confirmation before any real deploy, but **the responsibility of executing the operation lies exclusively with the operator**.
- The authors and contributors **assume no responsibility** for configuration loss, monitoring interruptions, consumption costs, or any other direct or indirect damage derived from the use of this tool.
- Before a real deploy, always run a **dry-run** and review its full log. Maintain recent backups of the involved environments (the app facilitates them, but verifying them is the operator's responsibility).
- This tool **is not an official Dynatrace product** and is not affiliated with Dynatrace LLC. Monaco CLI and the APIs used belong to their respective owners; please review their terms of use.

Use it first against test environments and validate your workflow before operating in production environments.

## Requirements

- Node.js 20.19+ / 22.12+ (recommended; see compatibility note below)
- Git installed on the server/machine
- The **Dynatrace Monaco CLI (v2)** binary installed and accessible in the `PATH` (or configure `MONACO_BIN_PATH` in the `.env` pointing to its absolute path).

### Monaco CLI Installation

#### On Windows (PowerShell):
1. Download the executable from the [Dynatrace Releases page](https://github.com/dynatrace/dynatrace-configuration-as-code/releases):
   ```powershell
   # Download the latest stable version (example for Windows amd64)
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. Add `C:\dynatrace\` to your system environment variables (`PATH`), or define its exact location in your `.env` file:
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### On Linux / macOS (Bash):
1. Download and grant execution permissions:
   ```bash
   # Download for Linux amd64
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. If you prefer to save it in a user directory, remember to configure in your `.env`:
   ```env
   MONACO_BIN_PATH="/home/user/bin/monaco"
   ```

> **Compatibility Note:** the project was initialized and tested with Node 20.16. If your Node is 20.16 or similar, use `prisma@6` / `@prisma/client@6` (which are already installed) — Prisma version 7+ requires Node 20.19+.

## Installation (Local Use, Single User)

```bash
npm install
cp .env.example .env
# Edit .env: at minimum change ENCRYPTION_KEY and SEED_ADMIN_PASSWORD.
# Generate an ENCRYPTION_KEY with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # creates the admin user (SEED_ADMIN_EMAIL/PASSWORD)

# Start development server on default port (3000) or a custom one
PORT=3080 npm run dev
```

Open http://localhost:3000 (or the port you defined), log in with the seeded credentials, and create your first client + environment.

## Server Usage (Multiple Clients & Persistency)

1. Change `datasource.provider` in `prisma/schema.prisma` to `"postgresql"` and adjust `DATABASE_URL` in `.env` to your Postgres database.
2. Define `DATA_DIR` to a persistent path on the server (e.g. a dedicated disk) where the Git repositories for each client/environment will be saved.
3. Build the application for production:
   ```bash
   npm run build
   ```
4. **Run using PM2**:
   The project includes an `ecosystem.config.js` file ready to use. You can install PM2 globally and start the application easily:
   ```bash
   # Install PM2 if you don't have it
   npm install -g pm2

   # Start the app (by default it will listen on the port configured in the ecosystem/env)
   pm2 start ecosystem.config.js

   # If you want to change the port on the fly when starting with PM2:
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *Note: The Jobs worker runs within the same Node process; it does not require Redis or any external queue service.*

## How it Works

- **Deploy/Backup** actions are triggered from the UI of an Environment and create a `Job` record in the database (the command is not executed in the same HTTP request).
- An internal worker (`lib/server/worker.ts`) takes `PENDING` Jobs, invokes `monaco` via `child_process.spawn` injecting the token as an environment variable, and streams the live log to the UI via Server-Sent Events (`/api/jobs/:id/stream`).
- Upon successful completion of a Backup (or a Deploy), an automatic commit is made in the local Git repository of that Environment (`DATA_DIR/<client>/<environment>`) — with no remote configured, it serves purely as local history.
- Dynatrace tokens are stored encrypted (AES-256-GCM) and are redacted from any logs before persisting.

## Dynatrace Permissions (Tokens and Scopes)

Each environment uses up to **three different credentials**, and each feature requests only what it needs. If a section returns `403`, the corresponding credential lacks a scope from this table. From the Environment form, each credential has its own **Test** button to validate permissions before saving.

| Credential | Used for | Required Scopes / Permissions |
|---|---|---|
| **Classic API token** (`Api-Token`) | Monaco: `download` and `deploy` | `ReadConfig`, `settings.read` (download) · `WriteConfig`, `settings.write` (deploy) |
| **Platform token** (`dt0s16`) — Dashboards | Dashboard Management (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform token** (`dt0s16`) — Lookups | Upload/list/download/delete lookups (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **Account OAuth client** (`dt0s02`) | Resolve SSO id → email (Account API) | `account-idm-read` |

> The Platform token is **only one** per environment: the same token manages dashboards and lookups as long as it has **both** groups of scopes.

### ⚠️ Platform tokens have TWO Locks

With a Platform token, ticking the scopes upon creation is not enough. The **effective** permission is the intersection:

```
effective permission = (token scopes)  ∩  (IAM policy of the token owner user)
```

That is, in addition to the token scopes, **the IAM policy of the group of the user who created the token** must grant those permissions. For lookups, that policy must include (adjust path boundary to your liking):

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

Common gotchas when getting `403` even though the token "has" the scope:

- **A Platform token cannot have scopes added after it is created.** If you change permissions, generate a new token and paste it back into the environment.
- The token runs with the permissions of **its owner**. If the policy is in a group to which the token owner does not belong, it does not apply.
- A policy **boundary** (by path or by environment) that does not match will silently deny: verify that it includes the environment and `/lookups/`.

The **Test** button in the Lookups section reports read and write permissions separately (`read` / `write`), to isolate exactly which permission is missing.

## Structure

See section 7 of `specs/design.md` for directory details (`app/`, `lib/`, `prisma/`).
