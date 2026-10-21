# Checklist de Implementacion

Estado al 2026-08-16. El alcance original (`specs/requirements.md`) esta
implementado; el bloque "Fuera del alcance original" recoge lo que se
construyo despues y no estaba en la lista inicial.

## Alcance original

- [x] Inicializar proyecto Next.js (App Router, TypeScript) con Tailwind CSS.
  Next 16.2.9 / React 19.2.4 / Tailwind 4.
- [x] Anadir shadcn/ui y componentes base (button, card, table, dialog, input, badge).
  Ver `components/ui/` y `components.json`.
- [x] Instalar y configurar Prisma (SQLite por defecto), definir `schema.prisma`
  (User, Tenant, Environment, Job).
- [x] Crear `lib/prisma.ts` (singleton) y migraciones aplicadas
  (`prisma/migrations/`, 6 migraciones desde `init`).
- [x] Configurar NextAuth (Credentials) contra `User`, con proteccion de rutas
  salvo `/login` y `/` (landing). En Next 16 el middleware vive en `proxy.ts`,
  no en `middleware.ts`.
- [x] Escribir `prisma/seed.ts` que cree el usuario `admin` (`admin123` hasheado).
  El hook de seed se declara en `prisma.config.ts`, no en `package.json#prisma.seed`
  (Prisma 6).
- [x] Implementar `lib/crypto.ts` (AES-256-GCM) para encriptar/desencriptar `tokenCipher`.
- [x] Implementar `lib/server/monacoRunner.ts` (spawn de `monaco deploy` / `monaco download`,
  streaming de stdout/stderr).
- [x] Implementar `lib/server/gitRunner.ts` (`simple-git`: ensureRepo, commit, log, diff)
  sobre carpetas locales.
- [x] Implementar `lib/server/worker.ts`: loop singleton que procesa Jobs `PENDING`,
  respeta el lock por Environment, actualiza `Job.output`/`status` y dispara el
  commit Git correspondiente. Arranque via `instrumentation.ts`.
- [x] Crear API Routes: `tenants` (CRUD), `environments` (CRUD + encriptar token al crear),
  `environments/:id/jobs` (crear Job), `jobs/:id` (detalle), `jobs/:id/stream` (SSE),
  `jobs/:id/log` (descarga).
- [x] Construir pagina de login (`app/login/page.tsx`).
- [x] Construir dashboard: lista de Tenants -> Entornos (`components/tenant-list.tsx`).
- [x] Construir pagina de detalle de Environment: Deploy/Backup, estado (IDLE/RUNNING),
  historial de Jobs, visor de log en vivo (SSE), historial de commits Git con diff
  (`app/environments/[id]/page.tsx`, `components/environment-detail.tsx`,
  `components/job-log-viewer.tsx`, `components/file-browser.tsx`).
- [x] Escribir `.env.example` (DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY,
  MONACO_BIN_PATH, DATA_DIR) y README con instrucciones de instalacion local vs servidor.
- [x] Verificar build (`npm run build`). Verificado el 2026-08-16 sobre `18b9ca1`.
  Gotcha: `tsconfig.json` incluye `**/*.ts` y solo excluye `node_modules`, asi que
  tambien type-checkea los tipos generados por `next dev` en `.next/dev/types/`.
  Si quedaron rancios el build falla con "Unexpected keyword or identifier" en
  `validator.ts`; se resuelve con `rm -rf .next` antes de compilar.

## Fuera del alcance original (ya implementado)

- [x] Internacionalizacion completa (es/en/de/ja/pt/zh) con `lib/i18n/` y READMEs por idioma.
- [x] Landing publica + shell de aplicacion (`components/landing-page.tsx`, `app-shell.tsx`).
- [x] Consumo DPS: snapshots diarios persistidos (`model DpsSnapshot`,
  `lib/server/dpsSnapshots.ts`), vista global (`app/consumption/`) y por entorno
  (`app/environments/[id]/consumption/`).
- [x] Gestion de dashboards por entorno: listar, copiar, borrar, compartir, transferir,
  bloquear y cambiar visibilidad (`app/api/environments/[id]/dashboards/*`,
  `components/dashboards-manager.tsx`).
- [x] Analisis de dashboards con IA local via Ollama (`lib/server/ollama.ts`,
  `model DashboardAnalysis`, prompt configurable desde `/settings`).
- [x] Lookups del Grail Resource Store: subir, bajar, borrar, ver contenido y probar
  patrones DPL (`app/api/environments/[id]/lookups/*`, `components/lookups-manager.tsx`).
- [x] Pagina de settings con retencion de backups, backup automatico programado,
  intervalo de snapshots DPS y config de IA (`model AppSettings`, `components/settings/`).
- [x] Administracion de usuarios y tenants desde settings (`app/api/users/*`,
  `components/settings/users-manager.tsx`, `tenant-admin.tsx`).
- [x] Registro de actividad (`model ActivityLog`, `app/activity/`,
  `components/route-activity-logger.tsx`).
- [x] Monitor de agentes y pruebas de conectividad Dynatrace
  (`app/api/agent/status`, `app/api/dynatrace/{test,iam-test,documents-test,lookups-test}`).
- [x] Promocion de configuracion entre entornos (`lib/server/promote.ts`,
  `components/promote-card.tsx`).
- [x] Pagina de ayuda (`app/help/`) y despliegue con PM2 (`ecosystem.config.js`).

## Pendiente

- [ ] Smoke test manual end-to-end en el servidor interno (login, alta de tenant/entorno,
  backup real contra un entorno de prueba, deploy en dry-run).
- [ ] Migrar el datasource de SQLite a PostgreSQL en el servidor interno
  (ver nota en `prisma/schema.prisma` y `specs/design.md`).
