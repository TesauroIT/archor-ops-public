import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/server/settings";

// Estado en vivo del "agente" (el worker de jobs + scheduler de backups):
// que esta corriendo, que hay en cola, proximo ciclo automatico y ultimos
// resultados. Lo consume el monitor de la pagina Actividad via polling.

interface JobInfo {
  id: string;
  type: string;
  dryRun: boolean;
  status: string;
  triggeredBy: string;
  environmentId: string;
  environmentLabel: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorSummary: string | null;
}

function toInfo(job: {
  id: string;
  type: string;
  dryRun: boolean;
  status: string;
  triggeredBy: string;
  environmentId: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorSummary: string | null;
  environment: { name: string; tenant: { name: string } };
}): JobInfo {
  return {
    id: job.id,
    type: job.type,
    dryRun: job.dryRun,
    status: job.status,
    triggeredBy: job.triggeredBy,
    environmentId: job.environmentId,
    environmentLabel: `${job.environment.tenant.name} / ${job.environment.name}`,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    errorSummary: job.errorSummary,
  };
}

const jobInclude = { environment: { include: { tenant: true } } } as const;

export async function GET() {
  const [settings, running, pending, recent] = await Promise.all([
    getSettings(),
    prisma.job.findMany({
      where: { status: "RUNNING" },
      include: jobInclude,
      orderBy: { startedAt: "asc" },
    }),
    prisma.job.findMany({
      where: { status: "PENDING" },
      include: jobInclude,
      orderBy: { createdAt: "asc" },
    }),
    prisma.job.findMany({
      where: { status: { in: ["SUCCESS", "FAILED"] } },
      include: jobInclude,
      orderBy: { finishedAt: "desc" },
      take: 5,
    }),
  ]);

  // Proximo ciclo de un scheduler: ultimo ciclo + intervalo. Si nunca corrio,
  // se dispara en el proximo tick (dentro de 1 minuto).
  function nextRun(lastRunAt: Date | null, intervalHours: number): string {
    if (!lastRunAt) return new Date().toISOString();
    return new Date(lastRunAt.getTime() + intervalHours * 60 * 60 * 1000).toISOString();
  }

  return NextResponse.json({
    now: new Date().toISOString(),
    autoBackup: {
      enabled: settings.autoBackupEnabled,
      intervalHours: settings.autoBackupIntervalHours,
      lastRunAt: settings.lastAutoBackupAt?.toISOString() ?? null,
      nextRunAt: settings.autoBackupEnabled
        ? nextRun(settings.lastAutoBackupAt, settings.autoBackupIntervalHours)
        : null,
    },
    dpsSnapshot: {
      enabled: settings.dpsSnapshotEnabled,
      intervalHours: settings.dpsSnapshotIntervalHours,
      lastRunAt: settings.lastDpsSnapshotAt?.toISOString() ?? null,
      nextRunAt: settings.dpsSnapshotEnabled
        ? nextRun(settings.lastDpsSnapshotAt, settings.dpsSnapshotIntervalHours)
        : null,
    },
    running: running.map(toInfo),
    pending: pending.map(toInfo),
    recent: recent.map(toInfo),
  });
}
