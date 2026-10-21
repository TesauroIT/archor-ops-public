# Archon Ops

UI interna para gestionar entornos multi-tenant de Dynatrace: encola y ejecuta
comandos de [Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code)
(`deploy` / `download`) y versiona cada backup en un repositorio Git local por
cliente/entorno, sin depender de ningun servicio externo.

Ver `specs/requirements.md`, `specs/design.md` y `specs/tasks.md` para el
detalle funcional y la arquitectura.

## ⚠️ Descargo de responsabilidad (Disclaimer)

Este software se proporciona **"tal cual" (AS IS)**, sin garantía de ningún
tipo, expresa o implícita. Al usarlo aceptas que:

- Las operaciones de **deploy sobrescriben configuraciones reales** en tus
  entornos de Dynatrace y pueden modificarlas, dejarlas inconsistentes o
  dañarlas si no sabes lo que estás haciendo. La app exige una doble
  confirmación antes de todo deploy real, pero **la responsabilidad de
  ejecutar la operación es exclusivamente del operador**.
- Los autores y contribuidores **no asumen ninguna responsabilidad** por
  pérdida de configuraciones, interrupciones de monitoreo, costos de consumo,
  ni ningún otro daño directo o indirecto derivado del uso de esta
  herramienta.
- Antes de un deploy real, ejecuta siempre un **dry-run** y revisa su log
  completo. Mantén backups recientes de los entornos involucrados (la app
  los facilita, pero verificarlos es responsabilidad del operador).
- Esta herramienta **no es un producto oficial de Dynatrace** ni está
  afiliada a Dynatrace LLC. Monaco CLI y las APIs utilizadas pertenecen a
  sus respectivos dueños; revisa sus términos de uso.

Úsala primero contra entornos de prueba y valida tu flujo antes de operar
entornos productivos.

## Requisitos

- Node.js 20.19+ / 22.12+ (recomendado; ver nota de compatibilidad abajo)
- Git instalado en el servidor/máquina
- El binario de **Dynatrace Monaco CLI (v2)** instalado y accesible en el `PATH` (o configurar `MONACO_BIN_PATH` en el `.env` apuntando a su ruta absoluta).

### Instalación de Monaco CLI

#### En Windows (PowerShell):
1. Descarga el ejecutable desde la [página de Releases de Dynatrace](https://github.com/dynatrace/dynatrace-configuration-as-code/releases):
   ```powershell
   # Descargar la última versión estable (ejemplo para Windows amd64)
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. Agrega `C:\dynatrace\` a tus variables de entorno del sistema (`PATH`), o bien define su ubicación exacta en tu archivo `.env`:
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### En Linux / macOS (Bash):
1. Descarga y otorga permisos de ejecución:
   ```bash
   # Descargar para Linux amd64
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. Si prefieres guardarlo en una ruta de usuario, recuerda configurar en tu `.env`:
   ```env
   MONACO_BIN_PATH="/home/usuario/bin/monaco"
   ```

> **Nota de Compatibilidad:** el proyecto fue inicializado y probado con Node 20.16. Si tu Node
> es 20.16 o similar, usa `prisma@6`/`@prisma/client@6` (ya son los que estan
> instalados) — las versiones 7+ de Prisma requieren Node 20.19+.

## Instalacion (uso local, un solo usuario)

```bash
npm install
cp .env.example .env
# Edita .env: como minimo cambia ENCRYPTION_KEY y SEED_ADMIN_PASSWORD.
# Genera una ENCRYPTION_KEY con:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # crea el usuario admin (SEED_ADMIN_EMAIL/PASSWORD)

# Iniciar servidor de desarrollo en puerto por defecto (3000) o uno personalizado
PORT=3080 npm run dev
```

Abre http://localhost:3000 (o el puerto que definiste), inicia sesion con las credenciales sembradas y crea tu primer cliente + entorno.

## Uso en servidor (múltiples clientes y persistencia)

1. Cambia `datasource.provider` en `prisma/schema.prisma` a `"postgresql"` y ajusta `DATABASE_URL` en `.env` a tu Postgres.
2. Define `DATA_DIR` a una ruta persistente del servidor (ej. un disco dedicado) donde se guardaran los repos Git de cada cliente/entorno.
3. Compila la aplicación para producción:
   ```bash
   npm run build
   ```
4. **Ejecutar usando PM2**:
   El proyecto incluye un archivo `ecosystem.config.js` listo para usarse. Puedes instalar PM2 de forma global e iniciar la aplicación fácilmente:
   ```bash
   # Instalar PM2 si no lo tienes
   npm install -g pm2

   # Iniciar la app (por defecto levantará en el puerto configurado en el ecosystem/env)
   pm2 start ecosystem.config.js

   # Si deseas cambiar el puerto en caliente al iniciar con PM2:
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *Nota: El worker de Jobs vive dentro del mismo proceso Node, no requiere Redis ni un servicio de colas externo.*

## Como funciona

- **Deploy/Backup** se disparan desde la UI de un Environment y crean un
  registro `Job` en la base de datos (no se ejecuta el comando en el mismo
  request HTTP).
- Un worker interno (`lib/server/worker.ts`) toma los Jobs `PENDING`, invoca
  `monaco` via `child_process.spawn` inyectando el token como variable de
  entorno, y transmite el log en vivo a la UI via Server-Sent Events
  (`/api/jobs/:id/stream`).
- Al terminar un Backup (o un Deploy) exitoso, se hace un commit automatico en
  el repositorio Git local de ese Environment (`DATA_DIR/<cliente>/<entorno>`)
  — sin remoto configurado, es solo historial local.
- Los tokens de Dynatrace se guardan encriptados (AES-256-GCM) y se
  redactan de cualquier log antes de persistirse.

## Permisos de Dynatrace (tokens y scopes)

Cada entorno usa hasta **tres credenciales distintas**, y cada funcionalidad
pide solo lo que necesita. Si una sección da `403`, es que a la credencial
correspondiente le falta un scope de esta tabla. Desde el formulario de
Environment, cada credencial tiene su botón **Test** para validar los permisos
antes de guardar.

| Credencial | Se usa para | Scopes / permisos requeridos |
|---|---|---|
| **API token clásico** (`Api-Token`) | Monaco: `download` y `deploy` | `ReadConfig`, `settings.read` (download) · `WriteConfig`, `settings.write` (deploy) |
| **Platform token** (`dt0s16`) — Dashboards | Gestión de dashboards (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform token** (`dt0s16`) — Lookups | Subir/listar/bajar/borrar lookups (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **OAuth client de cuenta** (`dt0s02`) | Resolver SSO id → email (Account API) | `account-idm-read` |

> El Platform token es **uno solo** por entorno: el mismo token gestiona
> dashboards y lookups siempre que tenga **ambos** grupos de scopes.

### ⚠️ Los Platform tokens tienen DOS candados

Con un Platform token no alcanza con tildar los scopes al crearlo. El permiso
**efectivo** es la intersección:

```
permiso efectivo = (scopes del token)  ∩  (policy IAM del usuario dueño del token)
```

Es decir, además de los scopes del token, **la policy IAM del grupo del usuario
que creó el token** debe conceder esos permisos. Para lookups, esa policy debe
incluir (ajustá el boundary de path a tu gusto):

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

Gotchas frecuentes cuando da `403` aunque el token "tenga" el scope:

- **A un Platform token no se le pueden agregar scopes después de creado.** Si
  cambiás los permisos, generá un token nuevo y volvé a pegarlo en el entorno.
- El token corre con los permisos de **su dueño**. Si la policy está en un grupo
  al que el dueño del token no pertenece, no aplica.
- Un **boundary** de la policy (por path o por entorno) que no matchea deniega
  silenciosamente: verificá que incluya el entorno y `/lookups/`.

El botón **Test** de la sección Lookups reporta lectura y escritura por separado
(`read` / `write`), para aislar exactamente qué permiso falta.

## Estructura

Ver la seccion 7 de `specs/design.md` para el detalle de carpetas
(`app/`, `lib/`, `prisma/`).
