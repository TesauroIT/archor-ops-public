"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CircleCheck, CircleX, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";
import type { Dictionary } from "@/lib/i18n/dict/es";

const POLL_MS = 5000;

type AgentDict = Dictionary["agentMonitor"];

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

interface SchedulerStatus {
  enabled: boolean;
  intervalHours: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

interface AgentStatus {
  now: string;
  autoBackup: SchedulerStatus;
  dpsSnapshot: SchedulerStatus;
  running: JobInfo[];
  pending: JobInfo[];
  recent: JobInfo[];
}

function jobLabel(job: JobInfo, t: AgentDict): string {
  if (job.type === "DEPLOY") return job.dryRun ? t.deployDryRun : t.deploy;
  return t.backup;
}

function triggeredByLabel(job: JobInfo, t: AgentDict): string {
  return job.triggeredBy === "scheduler" ? t.byAgent : job.triggeredBy;
}

// "hace 2 min", "en 5 h 12 min", etc. con granularidad de minuto, usando las
// plantillas del idioma activo.
function relativeTime(
  target: string | null,
  now: Date,
  t: AgentDict,
  f: (template: string, vars: Record<string, string | number>) => string
): string {
  if (!target) return t.relNone;
  const diffMs = new Date(target).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const span =
    hours > 0
      ? f(t.relHm, { hours, min: rest })
      : minutes > 0
        ? f(t.relMin, { min: minutes })
        : t.relSoon;
  return f(diffMs >= 0 ? t.relIn : t.relAgo, { span });
}

export function AgentMonitor() {
  const { dict, f } = useI18n();
  const t = dict.agentMonitor;
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/agent/status");
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? t.errState);
          return;
        }
        setStatus(body as AgentStatus);
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [t.errState]);

  const now = status ? new Date(status.now) : new Date();
  const working = (status?.running.length ?? 0) > 0;
  const queued = status?.pending.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="relative mt-0.5">
              <Bot className="size-6 text-muted-foreground" />
              <span
                className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ${
                  working
                    ? "animate-pulse bg-green-500"
                    : status?.autoBackup.enabled
                      ? "bg-blue-500"
                      : "bg-muted-foreground/40"
                }`}
              />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                {t.title}
                {working ? (
                  <Badge>{t.working}</Badge>
                ) : (
                  <Badge variant="secondary">{t.idle}</Badge>
                )}
                {queued > 0 && <Badge variant="outline">{f(t.queued, { count: queued })}</Badge>}
              </CardTitle>
              <CardDescription>
                {status === null && !error && t.consulting}
                {error && <span className="text-destructive">{error}</span>}
                {status && (
                  <>
                    {status.autoBackup.enabled ? (
                      <>
                        {f(t.autoBackupEnabled, {
                          hours: status.autoBackup.intervalHours,
                          next: relativeTime(status.autoBackup.nextRunAt, now, t, f),
                        })}
                        {status.autoBackup.lastRunAt &&
                          f(t.autoBackupLast, {
                            last: relativeTime(status.autoBackup.lastRunAt, now, t, f),
                          })}
                      </>
                    ) : (
                      <>
                        {t.autoBackupDisabledBefore}{" "}
                        <Link href="/settings" className="underline">
                          {t.settingsLink}
                        </Link>
                        {t.autoBackupDisabledAfter}
                      </>
                    )}
                    <br />
                    {status.dpsSnapshot.enabled ? (
                      f(t.dpsEnabled, {
                        hours: status.dpsSnapshot.intervalHours,
                        next: relativeTime(status.dpsSnapshot.nextRunAt, now, t, f),
                      }) +
                      (status.dpsSnapshot.lastRunAt
                        ? f(t.autoBackupLast, {
                            last: relativeTime(status.dpsSnapshot.lastRunAt, now, t, f),
                          })
                        : "")
                    ) : (
                      t.dpsDisabled
                    )}
                  </>
                )}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      {status && (status.running.length > 0 || status.pending.length > 0 || status.recent.length > 0) && (
        <CardContent className="space-y-4">
          {status.running.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.sectionRunning}
              </p>
              <ul className="space-y-1.5">
                {status.running.map((job) => (
                  <li key={job.id} className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                    <span className="font-medium">{jobLabel(job, t)}</span>
                    <Link href={`/environments/${job.environmentId}`} className="hover:underline">
                      {job.environmentLabel}
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {f(t.startedBy, {
                        rel: relativeTime(job.startedAt, now, t, f),
                        by: triggeredByLabel(job, t),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status.pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.sectionQueued}
              </p>
              <ul className="space-y-1.5">
                {status.pending.map((job, index) => (
                  <li key={job.id} className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
                    <Clock className="size-4 shrink-0 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">#{index + 1}</span>
                    <span className="font-medium">{jobLabel(job, t)}</span>
                    <Link href={`/environments/${job.environmentId}`} className="hover:underline">
                      {job.environmentLabel}
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {f(t.queuedBy, {
                        rel: relativeTime(job.createdAt, now, t, f),
                        by: triggeredByLabel(job, t),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {status.recent.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t.sectionRecent}
              </p>
              <ul className="space-y-1.5">
                {status.recent.map((job) => (
                  <li key={job.id} className="flex items-center gap-2 px-3 py-1 text-sm">
                    {job.status === "SUCCESS" ? (
                      <CircleCheck className="size-4 shrink-0 text-green-600" />
                    ) : (
                      <CircleX className="size-4 shrink-0 text-destructive" />
                    )}
                    <span>{jobLabel(job, t)}</span>
                    <Link
                      href={`/environments/${job.environmentId}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {job.environmentLabel}
                    </Link>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {f(t.finishedBy, {
                        rel: relativeTime(job.finishedAt, now, t, f),
                        by: triggeredByLabel(job, t),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
