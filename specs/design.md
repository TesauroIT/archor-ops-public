# Arquitectura y Decisiones de Diseno

## 1. Stack Tecnologico
* **Framework:** Next.js 14+ (App Router), un solo repo para frontend + backend (API Routes).
* **Base de datos y ORM:** Prisma ORM. SQLite por defecto (`DATABASE_URL="file:./dev.db"`) para uso local sin dependencias; Postgres recomendado para el servidor interno con muchos clientes (basta cambiar `provider` + `DATABASE_URL`).
* **Auth:** NextAuth v5 (Credentials Provider) contra el modelo `User` de Prisma. Passwords con `bcryptjs`.
* **Ejecucion de CLI:** `child_process.spawn` (no `exec`, para poder transmitir stdout/stderr en streaming y evitar shell injection).
* **Versionado local:** `simple-git` operando sobre carpetas locales (no repos remotos, no GitHub/GitLab).
* **Cola de trabajos:** Sin Redis/BullMQ. Se usa una tabla `Job` en la misma DB + un worker en proceso (singleton con `setInterval`, protegido de doble arranque en hot-reload de Next.js con `globalThis`).
* **UI/Estilos:** Tailwind CSS + shadcn/ui.
* **Validacion:** zod en los API Routes.

Esta eleccion evita cualquier infraestructura adicional (Redis, brokers externos) porque el requisito explicito es que la misma base de codigo corra tanto en el servidor interno del usuario (muchos clientes) como en la maquina local de alguien que solo gestiona su propio entorno.

## 2. Modelo de Datos (`schema.prisma`)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite" // cambiar a "postgresql" en el servidor interno
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
}

model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         Role     @default(ADMIN)
  createdAt    DateTime @default(now())
}

model Tenant {
  id           String        @id @default(uuid())
  name         String        @unique
  slug         String        @unique
  environments Environment[]
  createdAt    DateTime      @default(now())
}

enum EnvironmentStatus {
  IDLE
  RUNNING
}

model Environment {
  id            String            @id @default(uuid())
  name          String            // ej. Dev, QA, Prod
  slug          String
  url           String            // URL del tenant Dynatrace (ej. https://abc123.live.dynatrace.com)
  tokenCipher   String            // token encriptado (AES-256-GCM), nunca en texto plano
  localPath     String            // carpeta local con el repo Git de config (DATA_DIR/<tenantSlug>/<envSlug>)
  status        EnvironmentStatus @default(IDLE)
  tenantId      String
  tenant        Tenant            @relation(fields: [tenantId], references: [id])
  jobs          Job[]
  createdAt     DateTime          @default(now())

  @@unique([tenantId, slug])
}

enum JobType {
  DEPLOY
  BACKUP
}

enum JobStatus {
  PENDING
  RUNNING
  SUCCESS
  FAILED
}

model Job {
  id            String      @id @default(uuid())
  type          JobType
  status        JobStatus   @default(PENDING)
  output        String      @default("") // log acumulado (stdout+stderr), sanitizado
  triggeredBy   String      // email del usuario que disparo el job
  environmentId String
  environment   Environment @relation(fields: [environmentId], references: [id])
  createdAt     DateTime    @default(now())
  startedAt     DateTime?
  finishedAt    DateTime?
}
```

## 3. Flujo de ejecucion (Deploy / Backup)

1. UI llama `POST /api/environments/:id/jobs` con `{ type: "DEPLOY" | "BACKUP" }`.
2. El API Route verifica que no exista un `Job` `RUNNING` para ese `environmentId` (lock logico via query a la tabla `Job`/campo `Environment.status`); si existe, responde `409 Conflict`.
3. Se crea el `Job` en estado `PENDING` y se marca `Environment.status = RUNNING`.
4. El worker interno (loop cada ~1s dentro del mismo proceso Node del server Next.js) recoge el `Job` `PENDING` mas antiguo por entorno libre y lo ejecuta:
   - **BACKUP:** `gitRunner.ensureRepo(localPath)` -> `monacoRunner.download(environment, localPath)` -> si exit code 0, `gitRunner.commit(localPath, "backup: <timestamp>")`.
   - **DEPLOY:** `gitRunner.ensureRepo(localPath)` -> `monacoRunner.deploy(environment, localPath)` -> si exit code 0, `gitRunner.commit(localPath, "deploy: <timestamp>")`.
5. Cada chunk de stdout/stderr del proceso hijo se apendea a `Job.output` (con un throttle de escritura a DB, ej. cada 300ms, para no saturar la DB).
6. Al finalizar, `Job.status = SUCCESS|FAILED`, `Environment.status = IDLE`.
7. La UI consume el progreso via `GET /api/jobs/:id/stream` (Server-Sent Events), que hace polling ligero sobre el `Job.output` en DB y empuja los deltas al cliente. Evita la complejidad de WebSockets para el volumen esperado.

## 4. Seguridad
* **Token de Dynatrace:** encriptado en reposo con AES-256-GCM (`lib/crypto.ts`), usando `ENCRYPTION_KEY` (32 bytes, variable de entorno, nunca en el repo). Se desencripta solo en memoria, en el momento de invocar `monaco`, y se inyecta como variable de entorno del subproceso (`DT_API_TOKEN`), nunca como argumento de CLI (evita que quede en `ps`/logs del SO).
* **Sanitizacion de logs:** antes de persistir `Job.output`, se aplica un regex que reemplaza cualquier substring que matchee el patron de token de Dynatrace (`dt0c01\.[A-Z0-9]+\.[A-Za-z0-9]+`) por `***REDACTED***`.
* **Comandos:** siempre `spawn` con array de argumentos (nunca interpolar strings en un shell), para eliminar riesgo de command injection.

## 5. Backups y versionado local
* Estructura de carpetas: `DATA_DIR/<tenantSlug>/<environmentSlug>/` — cada una es un repo Git independiente (no un monorepo de todos los clientes), para que el historial de un cliente nunca se mezcle con el de otro.
* `gitRunner.ts` (via `simple-git`) expone: `ensureRepo(path)`, `commit(path, message)`, `log(path)`, `diff(path, commitA, commitB)`.
* No hay remoto configurado por defecto. Si en el futuro un usuario quiere sincronizar a un servidor propio, se podria anadir `git remote add origin <url-interna>` de forma opcional por Environment — fuera de alcance de la version actual.

## 6. Portabilidad servidor <-> local
* Todo el estado vive en Prisma (SQLite o Postgres, misma migracion) y en `DATA_DIR` (carpetas locales). No hay dependencia de Redis, colas externas, ni servicios cloud.
* `docker-compose.yml` opcional para el modo servidor (Postgres + la app), pero `npm run dev` con SQLite debe funcionar sin ningun servicio adicional para el modo local de un solo usuario.

## 7. Estructura de carpetas propuesta
```
app/
  (auth)/login/page.tsx
  (dashboard)/page.tsx                 -> lista de Tenants
  (dashboard)/tenants/[id]/page.tsx    -> entornos del tenant
  (dashboard)/environments/[id]/page.tsx -> detalle: Deploy/Backup + historial de Jobs + historial Git
  api/auth/[...nextauth]/route.ts
  api/tenants/route.ts
  api/tenants/[id]/route.ts
  api/environments/route.ts
  api/environments/[id]/route.ts
  api/environments/[id]/jobs/route.ts
  api/jobs/[id]/route.ts
  api/jobs/[id]/stream/route.ts
lib/
  prisma.ts        -> singleton PrismaClient
  auth.ts          -> config de NextAuth
  crypto.ts        -> encrypt/decrypt token
  server/monacoRunner.ts
  server/gitRunner.ts
  server/worker.ts -> loop de procesamiento de Jobs
prisma/
  schema.prisma
  seed.ts
```

## 8. UI / Sistema de diseño (reglas, no "como caiga")

El objetivo es que cada pantalla se arme con los **mismos primitivos** y no con divs sueltos ad-hoc. Reglas:

* **Tokens de color:** SIEMPRE usar los tokens del tema (`bg-card`, `text-muted-foreground`, `border`, `bg-muted`, `text-destructive`, etc. definidos en `app/globals.css`). El tema base es monocromo; los **acentos de color** (azul/violeta/ámbar) se reservan para **distinguir secciones funcionales**, no para decorar.
* **Layout:** ancho fluido y responsive. Nada de contenido encajonado al centro en 1/3 de pantalla. Grillas que colapsan: `grid gap-4 md:grid-cols-2 xl:grid-cols-3` (1 col en móvil → 2 → 3). Diálogos anchos (`sm:max-w-4xl`) con `max-h-[90vh] overflow-y-auto` cuando el contenido es largo.
* **Secciones de formulario/panel:** usar el primitivo **`components/ui/form-section.tsx`** (`<FormSection accent icon title description action>`). Da barra de acento a la izquierda, chip con ícono, título, descripción y un slot de acción (ej. botón de validar). Acentos por dominio:
  * **Monaco (backups/deploy)** → `blue` + ícono `Server`.
  * **Dashboards (Platform token)** → `violet` + ícono `LayoutDashboard`.
  * **Correos / IAM (OAuth)** → `amber` + ícono `Mail`.
* **Íconos:** `lucide-react`, tamaño `size-5` dentro de chips, `size-3.5` en texto de estado.
* **Validación inline:** todo campo de credencial tiene un botón **"Probar"** en el header de su sección y un `TestFeedback` (ok verde / error rojo / cargando) debajo. Las validaciones pegan a endpoints `POST /api/dynatrace/{test,documents-test,iam-test}` que aceptan `{ environmentId }` (usa lo guardado) o los valores en claro (antes de guardar). Nunca se re-pide un secreto ya guardado solo para validar.
* **Cards de contenido:** `components/ui/card` para listas/tarjetas de nivel página; `FormSection` para agrupaciones dentro de un formulario o panel de detalle. Las **tablas** (Jobs, actividad, git, dashboards) van dentro de un `Card` para que no floten sueltas.
* **Encabezado de página:** usar el primitivo **`components/ui/page-header.tsx`** (`<PageHeader title description action>`) en TODA página. Reemplaza el bloque `<h1 class="text-2xl font-semibold tracking-tight">` + `<p>` que antes se copiaba a mano. El `action` es el slot derecho para el botón principal (ej. "Nuevo cliente").
* **Contenedor:** `AppShell` centra el contenido en `max-w-7xl px-6 py-8`. Ancho de lectura amplio para una herramienta de ops con tablas; nunca encajonar en 1/3.
* **Espaciado vertical:** las páginas usan `space-y-6` entre header y bloques; los formularios `space-y-5`; el interior de una sección `space-y-3`.

### Primitivos de UI (resumen)
| Primitivo | Archivo | Uso |
|---|---|---|
| `PageHeader` | `components/ui/page-header.tsx` | Título + descripción + acción de cada página |
| `FormSection` | `components/ui/form-section.tsx` | Sección con acento de color + ícono dentro de forms/paneles |
| `Card` | `components/ui/card.tsx` | Tarjetas de contenido y contenedor de tablas |
| `TestFeedback` (local a `environment-form`) | — | Resultado ok/error/cargando de una validación inline |

Antes de agregar una pantalla nueva: reutilizá estos primitivos en vez de armar `div`s a mano.
