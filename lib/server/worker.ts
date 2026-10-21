import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { decryptToken, sanitizeLogOutput } from "@/lib/crypto";
import { getInvocation, runInvocation, TOKEN_ENV_VAR } from "@/lib/server/monacoRunner";
import { ensureRepo, commitAll, pruneHistory } from "@/lib/server/gitRunner";
import { prepareDeploy } from "@/lib/server/promote";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { logActivity } from "@/lib/server/activity";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import {
  getConsumptionSummary,
  getSubscriptionOverview,
} from "@/lib/server/dynatraceSubscription";
import { todayKey, writeSnapshot } from "@/lib/server/dpsSnapshots";
import type { Job } from "@prisma/client";

// Cola de trabajos sin Redis/BullMQ: los Jobs viven en la tabla `Job` y este
// worker (un loop dentro del mismo proceso Node de Next.js) los procesa.
// Ver specs/design.md secciones 1 y 3 para el porque de esta decision.

const TICK_MS = 1000;
const FLUSH_MS = 1500;
// Tope del output persistido por job: un deploy --verbose puede generar
// muchos MB; guardamos el final (que es donde esta el resultado y los errores).
const MAX_OUTPUT_CHARS = 2_000_000;
const SCHEDULER_MS = 60_000;
const DPS_TICK_MS = 60_000;
// Pausa entre cuentas/entornos al capturar consumo DPS: la Account API es una
// sola para todas las cuentas y con rate limit; en background sobra el tiempo.
const DPS_PAUSE_MS = 20_000;
const MAX_CONCURRENT_JOBS = 4;

type WorkerGlobal = typeof globalThis & {
  __monacoWorkerStarted?: boolean;
  __monacoWorkerProcessing?: Set<string>;
  __monacoWorkerBuffers?: Map<string, string>;
  __monacoWorkerDirty?: Set<string>;
  __dpsCaptureRunning?: boolean;
};

const g = globalThis as WorkerGlobal;

function processingSet(): Set<string> {
  if (!g.__monacoWorkerProcessing) g.__monacoWorkerProcessing = new Set();
  return g.__monacoWorkerProcessing;
}

// El output COMPLETO de cada job en curso vive en memoria; a la base solo se
// escribe periodicamente (y sin leer antes). El esquema anterior era
// leer-todo + escribir-todo dentro de una transaccion cada 500 ms: con logs
// grandes eso retiene el lock de escritura de SQLite y congela toda la app.
function outputBuffers(): Map<string, string> {
  if (!g.__monacoWorkerBuffers) g.__monacoWorkerBuffers = new Map();
  return g.__monacoWorkerBuffers;
}

function dirtyJobs(): Set<string> {
  if (!g.__monacoWorkerDirty) g.__monacoWorkerDirty = new Set();
  return g.__monacoWorkerDirty;
}

function appendOutput(jobId: string, chunk: string) {
  const buffers = outputBuffers();
  let total = (buffers.get(jobId) ?? "") + chunk;
  if (total.length > MAX_OUTPUT_CHARS) {
    total =
      "[worker] Output truncado por tamaño: se conserva el tramo final.\n...\n" +
      total.slice(total.length - Math.floor(MAX_OUTPUT_CHARS * 0.75));
  }
  buffers.set(jobId, total);
  dirtyJobs().add(jobId);
}

function readOutput(jobId: string): string {
  return outputBuffers().get(jobId) ?? "";
}

function releaseOutput(jobId: string) {
  outputBuffers().delete(jobId);
  dirtyJobs().delete(jobId);
}

// Persiste el output de los jobs con cambios: un solo UPDATE por job, sin
// transaccion ni lectura previa.
async function flushBuffers() {
  const dirty = dirtyJobs();
  if (dirty.size === 0) return;

  const ids = Array.from(dirty);
  dirty.clear();

  await Promise.all(
    ids.map((jobId) =>
      prisma.job
        .update({ where: { id: jobId }, data: { output: readOutput(jobId) } })
        .catch(() => undefined)
    )
  );
}

async function runJob(job: Job) {
  const environment = await prisma.environment.findUnique({ where: { id: job.environmentId } });
  if (!environment) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), output: "Environment no encontrado." },
    });
    processingSet().delete(job.id);
    return;
  }

  // El entorno del job es el DESTINO: aporta URL + token para el deploy.
  const target = {
    url: environment.url,
    decryptedToken: decryptToken(environment.tokenCipher),
    localPath: environment.localPath,
    environmentName: environment.name,
  };

  // Promote = deploy cross-tenant: se despliega el backup de otro entorno origen.
  const isPromote = job.type === "DEPLOY" && !!job.sourceEnvironmentId;

  await prisma.job.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  let cwd = environment.localPath;
  let manifestName = "manifest.yaml";
  let cleanup: () => Promise<void> = async () => {};

  try {
    if (isPromote) {
      const source = await prisma.environment.findUnique({
        where: { id: job.sourceEnvironmentId! },
      });
      if (!source) throw new Error("Entorno origen del deploy no encontrado.");
      const configTypes = job.configTypes ? (JSON.parse(job.configTypes) as string[]) : null;
      const prepared = await prepareDeploy(source.localPath, environment.url, configTypes);
      cwd = prepared.cwd;
      manifestName = prepared.manifestName;
      cleanup = prepared.cleanup;
      appendOutput(
        job.id,
        `[deploy] origen: ${source.name} -> destino: ${environment.name}\n` +
          `[deploy] tipos: ${configTypes ? configTypes.join(", ") : "TODOS"}\n`
      );
    } else {
      // BACKUP y self-deploy trabajan sobre la carpeta del propio entorno.
      await ensureRepo(environment.localPath);
    }

    const invocation = getInvocation(job.type, target, { dryRun: job.dryRun, manifestName });
    await prisma.job.update({ where: { id: job.id }, data: { command: invocation.commandLine } });

    appendOutput(
      job.id,
      `$ ${invocation.commandLine}\n` +
        `(el token real se pasa por la variable de entorno ${TOKEN_ENV_VAR}, no se muestra aqui)\n` +
        `cwd: ${cwd}\n\n`
    );
    await flushBuffers();

    const onOutput = (chunk: string) => appendOutput(job.id, chunk);
    const result = await runInvocation(invocation, cwd, target.decryptedToken, onOutput);

    if (result.timedOut) {
      appendOutput(job.id, "\n[worker] Timeout: el proceso fue terminado.\n");
    }
    await flushBuffers();

    const success = !result.timedOut && result.exitCode === 0;

    // Monaco deja el detalle de los errores en <cwd>/.logs/*-errors.log y en
    // la salida solo dice "check logs for details". Volcamos ese detalle al
    // output del job para que la UI muestre el motivo real del fallo.
    if (!success && !result.timedOut) {
      const errorTail = await readMonacoErrorTail(cwd);
      if (errorTail) {
        appendOutput(job.id, `\n[monaco] Detalle del error (.logs):\n${errorTail}\n`);
        await flushBuffers();
      }
    }

    // Solo el backup/self-deploy versiona la carpeta propia. El dry-run y el
    // promote (que escribe en un tenant remoto) no generan commit local.
    if (success && !job.dryRun && !isPromote) {
      const prefix = job.type === "DEPLOY" ? "deploy" : "backup";
      const commit = await commitAll(environment.localPath, `${prefix}: ${new Date().toISOString()}`);
      appendOutput(
        job.id,
        commit
          ? `\n[git] commit ${commit.slice(0, 8)} creado en el repo local.\n`
          : `\n[git] sin cambios que versionar (no se creo commit).\n`
      );

      // Retencion: despues de un backup exitoso se recorta el historial a la
      // cantidad configurada en Configuracion > Backups.
      if (job.type === "BACKUP") {
        try {
          const settings = await getSettings();
          const removed = await pruneHistory(environment.localPath, settings.backupRetention);
          if (removed > 0) {
            appendOutput(
              job.id,
              `[git] retencion: se eliminaron ${removed} backup(s) antiguo(s), se conservan los ultimos ${settings.backupRetention}.\n`
            );
          }
        } catch (error) {
          appendOutput(
            job.id,
            `[git] aviso: no se pudo aplicar la retencion de backups: ${(error as Error).message}\n`
          );
        }
      }
      await flushBuffers();
    }

    const currentOutput = readOutput(job.id);

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: success ? "SUCCESS" : "FAILED",
        finishedAt: new Date(),
        exitCode: result.exitCode ?? undefined,
        output: currentOutput,
        errorSummary: success ? null : summarizeFailure(currentOutput, result),
      },
    });
  } catch (error) {
    appendOutput(job.id, `\n[worker] Error: ${(error as Error).message}\n`);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        output: readOutput(job.id),
        errorSummary: describeSpawnError(error as Error),
      },
    });
  } finally {
    releaseOutput(job.id);
    await cleanup();
    await prisma.environment.update({ where: { id: environment.id }, data: { status: "IDLE" } });
    processingSet().delete(job.id);
  }
}

// Ultimas lineas del log de errores mas reciente que Monaco escribe en
// <cwd>/.logs. Se sanitiza por si algun token quedara en el log.
async function readMonacoErrorTail(cwd: string, maxLines = 60): Promise<string | null> {
  try {
    const dir = path.join(cwd, ".logs");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith("-errors.log")).sort();
    const latest = files.at(-1);
    if (!latest) return null;
    const content = await fs.readFile(path.join(dir, latest), "utf8");
    const lines = content.trimEnd().split("\n");
    return sanitizeLogOutput(lines.slice(-maxLines).join("\n"));
  } catch {
    return null; // sin carpeta .logs o sin permisos: no es critico
  }
}

// Traduce un error de spawn (comando no encontrado, etc.) a algo accionable.
function describeSpawnError(error: Error & { code?: string }): string {
  if (error.code === "ENOENT") {
    return "No se encontro el binario de Monaco. Verifica que 'monaco' este instalado y en el PATH, o define MONACO_BIN_PATH en .env.";
  }
  return `Error al ejecutar Monaco: ${error.message}`;
}

// Extrae un motivo de fallo legible a partir del log (lineas error/fatal).
function summarizeFailure(
  output: string,
  result: { exitCode: number | null; timedOut: boolean }
): string {
  if (result.timedOut) {
    return "El proceso excedio el tiempo limite (timeout) y fue terminado.";
  }

  const errorLines = output
    .split("\n")
    .filter((line) => /\b(error|fatal)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean);

  const codeMsg = `Monaco termino con codigo de salida ${result.exitCode ?? "desconocido"}.`;
  if (errorLines.length === 0) return codeMsg;

  const lastErrors = errorLines.slice(-3).join("\n");
  return `${codeMsg}\nUltimos errores:\n${lastErrors}`;
}

async function tick() {
  try {
    const processing = processingSet();
    if (processing.size >= MAX_CONCURRENT_JOBS) return;

    const candidates = await prisma.job.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { environment: true },
      take: 20,
    });

    for (const job of candidates) {
      if (processing.size >= MAX_CONCURRENT_JOBS) break;
      if (processing.has(job.id)) continue;
      if (job.environment.status === "RUNNING") continue; // lock por entorno

      processing.add(job.id);
      await prisma.environment.update({ where: { id: job.environmentId }, data: { status: "RUNNING" } });

      runJob(job).catch(() => undefined);
    }
  } catch {
    // Un error de un tick no debe tumbar el worker; se reintenta en el siguiente.
  }
}

// Scheduler de backups automaticos: si esta habilitado en Configuracion y ya
// paso el intervalo configurado, encola un Job BACKUP por cada entorno que no
// tenga ya un backup pendiente o en curso.
async function schedulerTick() {
  try {
    const settings = await getSettings();
    if (!settings.autoBackupEnabled) return;

    const intervalMs = settings.autoBackupIntervalHours * 60 * 60 * 1000;
    const last = settings.lastAutoBackupAt?.getTime() ?? 0;
    if (Date.now() - last < intervalMs) return;

    // Marcar primero para que otro tick no encole el mismo ciclo dos veces.
    await updateSettings({ lastAutoBackupAt: new Date() });

    const environments = await prisma.environment.findMany({
      select: { id: true, name: true },
    });
    if (environments.length === 0) return;

    let queued = 0;
    for (const environment of environments) {
      const existing = await prisma.job.findFirst({
        where: {
          environmentId: environment.id,
          type: "BACKUP",
          status: { in: ["PENDING", "RUNNING"] },
        },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.job.create({
        data: { type: "BACKUP", environmentId: environment.id, triggeredBy: "scheduler" },
      });
      queued += 1;
    }

    if (queued > 0) {
      await logActivity({
        type: "JOB",
        title: "Backup automatico programado",
        message: `El scheduler encolo ${queued} backup(s) (intervalo: cada ${settings.autoBackupIntervalHours} h).`,
        triggeredBy: "scheduler",
      });
    }
  } catch {
    // Un error del scheduler no debe tumbar el worker; se reintenta en el siguiente ciclo.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Captura periodica del consumo DPS (ciclo propio, independiente del backup
// de Monaco). Recorre las cuentas EN SERIE y con pausas largas entre cada
// una: en background el rate limit de la Account API deja de ser un problema,
// y las vistas de consumo siempre encuentran el snapshot del dia en la base.
async function dpsSnapshotTick() {
  if (g.__dpsCaptureRunning) return;

  try {
    const settings = await getSettings();
    if (!settings.dpsSnapshotEnabled) return;

    const intervalMs = settings.dpsSnapshotIntervalHours * 60 * 60 * 1000;
    const last = settings.lastDpsSnapshotAt?.getTime() ?? 0;
    if (Date.now() - last < intervalMs) return;

    const environments = await prisma.environment.findMany({
      include: { tenant: true },
      orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
    });
    const withCreds = environments.filter(
      (env) => env.accountUuid && env.oauthClientId && env.oauthClientCipher
    );
    if (withCreds.length === 0) return;

    // Marcar primero para que otro tick no arranque el mismo ciclo dos veces.
    await updateSettings({ lastDpsSnapshotAt: new Date() });
    g.__dpsCaptureRunning = true;

    const day = todayKey();
    const seenAccounts = new Set<string>();
    let ok = 0;
    let failed = 0;

    for (const env of withCreds) {
      const creds = {
        accountUuid: normalizeAccountUuid(env.accountUuid!),
        clientId: env.oauthClientId!,
        clientSecret: decryptToken(env.oauthClientCipher!),
      };

      // Resumen por cuenta (vista general DPS): una vez por cuenta.
      if (!seenAccounts.has(creds.accountUuid)) {
        seenAccounts.add(creds.accountUuid);
        const overview = await getSubscriptionOverview(creds);
        if (overview.ok) await writeSnapshot("ACCOUNT", creds.accountUuid, day, overview);
        await sleep(DPS_PAUSE_MS);
      }

      // Detalle por entorno (panel de consumo).
      const summary = await getConsumptionSummary(creds, env.envId);
      if (summary.subscription.ok) {
        await writeSnapshot("ENVIRONMENT", env.id, day, summary);
        ok += 1;
      } else {
        failed += 1;
      }
      await sleep(DPS_PAUSE_MS);
    }

    await logActivity({
      type: "DPS",
      title: "Snapshot de consumo capturado",
      message:
        `El agente capturó el consumo DPS de ${ok} entorno(s)` +
        (failed > 0 ? ` (${failed} con error)` : "") +
        ` en ${seenAccounts.size} cuenta(s). Próximo ciclo en ${settings.dpsSnapshotIntervalHours} h.`,
      triggeredBy: "scheduler",
      status: failed > 0 ? "FAILED" : "SUCCESS",
    });
  } catch {
    // Un error del ciclo DPS no debe tumbar el worker; se reintenta luego.
  } finally {
    g.__dpsCaptureRunning = false;
  }
}

export function startWorker() {
  if (g.__monacoWorkerStarted) return;
  g.__monacoWorkerStarted = true;

  setInterval(tick, TICK_MS);
  setInterval(() => {
    schedulerTick().catch(() => undefined);
  }, SCHEDULER_MS);
  setInterval(() => {
    dpsSnapshotTick().catch(() => undefined);
  }, DPS_TICK_MS);
  setInterval(() => {
    flushBuffers().catch(() => undefined);
  }, FLUSH_MS);
}
