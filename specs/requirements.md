# Requerimientos Funcionales (Notacion EARS)

## 1. Autenticacion y Acceso
* **[Ubiquitous]** El sistema debera exigir autenticacion (NextAuth, Credentials Provider) para acceder a cualquier pantalla o API, excepto `/login`.
* **[Ubiquitous]** El sistema debera sembrar un usuario `admin` por defecto (password `admin123`) mediante script de seed, con un campo `role` en el modelo `User` que permita anadir roles adicionales en el futuro sin migrar el esquema.
* **[Unwanted behavior]** Si las credenciales son invalidas, el sistema debera rechazar el acceso y no revelar si el usuario existe o no.

## 2. Gestion de Clientes (Tenants) y Entornos
* **[Ubiquitous]** El sistema debera proveer una interfaz web para administrar el catalogo de clientes (Tenant) y sus entornos de Dynatrace (Environment: Dev/QA/Prod, etc).
* **[Event-driven]** Cuando un usuario registre un nuevo entorno, el sistema debera:
  - Persistir URL del entorno y token de acceso (encriptado con AES-256-GCM) via Prisma.
  - Crear una carpeta local dedicada (`DATA_DIR/<tenantSlug>/<environmentSlug>`) e inicializar un repositorio Git local (`git init`) si no existe.
* **[Ubiquitous]** El token de un entorno nunca debera mostrarse en texto plano en la UI despues de guardado (solo mascarado, ej. `dt0c01***`).

## 3. Orquestacion de Monaco CLI (Deploy / Backup)
* **[Event-driven]** Cuando el usuario dispare una accion de Deploy o Backup (Download) desde la UI, el sistema debera encolar un registro `Job` (`type: DEPLOY|BACKUP`, `status: PENDING`) asociado al `Environment`, en lugar de ejecutar el comando de forma sincrona en el request HTTP.
* **[State-driven]** Mientras exista un `Job` en estado `RUNNING` para un `Environment`, el sistema debera rechazar la creacion de nuevos Jobs para ese mismo `Environment` (lock logico), permitiendo Jobs concurrentes para otros entornos.
* **[Event-driven]** Un worker interno debera tomar Jobs en estado `PENDING`, marcarlos `RUNNING`, invocar el binario `monaco` (via `child_process.spawn`, inyectando el token via variable de entorno, nunca via argumento de linea de comandos) y transmitir su salida (stdout/stderr) incrementalmente al campo `Job.output`.
* **[Event-driven]** Cuando un comando de Monaco finalice, el sistema debera marcar el `Job` como `SUCCESS` o `FAILED` segun el codigo de salida del proceso.

## 4. Versionado Local (Backups)
* **[Event-driven]** Cuando un Job de tipo `BACKUP` finalice exitosamente, el sistema debera ejecutar `git add -A && git commit -m "backup: <timestamp>"` dentro de la carpeta local del `Environment`, generando un commit versionado sin push a ningun remoto externo.
* **[Event-driven]** Cuando un Job de tipo `DEPLOY` finalice exitosamente, el sistema podra registrar tambien un commit (`deploy: <timestamp>`) para dejar trazabilidad de que configuracion se aplico.
* **[Ubiquitous]** El sistema debera permitir listar el historial de commits (backups) de un `Environment` y ver el diff de un commit especifico directamente en la UI.

## 5. Auditoria
* **[Unwanted behavior]** Si la ejecucion de un comando de Monaco o Git falla, el sistema debera capturar el error y guardarlo en `Job.output`, sanitizando cualquier token o secreto antes de persistirlo.
* **[Ubiquitous]** El sistema debera mostrar un historial de Jobs por Environment (tipo, estado, duracion, usuario que lo disparo, fecha).

## 6. Portabilidad
* **[Ubiquitous]** El sistema debera poder ejecutarse tanto en un servidor central (multiples clientes, Postgres) como en una maquina local de un unico usuario (SQLite, sin infraestructura adicional como Redis), usando la misma base de codigo.
