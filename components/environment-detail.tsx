"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { JobLogViewer } from "@/components/job-log-viewer";
import { EnvironmentForm, type EnvironmentFormInitial } from "@/components/environment-form";
import { FileBrowser } from "@/components/file-browser";
import { PromoteCard, type EnvOption } from "@/components/promote-card";
import { TopConfigsCard, type ConfigTypeStat } from "@/components/top-configs-card";
import { DeployConfirmDialog } from "@/components/deploy-confirm-dialog";
import { useI18n } from "@/lib/i18n/context";

interface JobRow {
  id: string;
  type: "DEPLOY" | "BACKUP";
  dryRun: boolean;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  triggeredBy: string;
  createdAtLabel: string;
  command: string;
  errorSummary: string | null;
  exitCode: number | null;
}

interface CommitRow {
  hash: string;
  dateLabel: string;
  message: string;
}

interface BackupStats {
  totalFiles: number;
  totalBytes: number;
  byTopFolder: { name: string; files: number; bytes: number }[];
  exists: boolean;
}

interface EnvironmentProps {
  id: string;
  name: string;
  url: string;
  envId: string | null;
  tokenMasked: string;
  accountUuid: string | null;
  oauthClientId: string | null;
  status: "IDLE" | "RUNNING";
  tenant: { name: string };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function EnvironmentDetail({
  environment,
  jobs,
  commits,
  stats,
  configStats,
  environments,
}: {
  environment: EnvironmentProps;
  jobs: JobRow[];
  commits: CommitRow[];
  stats: BackupStats;
  configStats: ConfigTypeStat[];
  environments: EnvOption[];
}) {
  const router = useRouter();
  const { dict, f } = useI18n();
  const t = dict.environmentDetail;
  const [, startTransition] = useTransition();
  const [activeJobId, setActiveJobId] = useState<string | null>(
    jobs.find((j) => j.status === "PENDING" || j.status === "RUNNING")?.id ?? null
  );
  const [triggering, setTriggering] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deployConfirmOpen, setDeployConfirmOpen] = useState(false);

  const activeJob = jobs.find((j) => j.id === activeJobId) ?? null;

  const formInitial: EnvironmentFormInitial = {
    name: environment.name,
    mode: environment.envId ? "saas" : "custom",
    envId: environment.envId ?? "",
    url: environment.url,
    accountUuid: environment.accountUuid ?? "",
    oauthClientId: environment.oauthClientId ?? "",
  };

  async function triggerJob(type: "DEPLOY" | "BACKUP", dryRun = false) {
    setTriggering(true);
    const res = await fetch(`/api/environments/${environment.id}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, dryRun }),
    });
    setTriggering(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? t.jobStartError);
      return;
    }

    const job = await res.json();
    toast.success(
      type === "DEPLOY"
        ? dryRun
          ? t.dryRunQueued
          : t.deployQueued
        : t.backupQueued
    );
    setActiveJobId(job.id);
    startTransition(() => router.refresh());
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/dynatrace/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentId: environment.id }),
      });
      const data = await res.json();
      setTestResult({ ok: !!data.ok, message: data.message ?? t.noResponse });
    } catch (error) {
      setTestResult({ ok: false, message: (error as Error).message });
    } finally {
      setTesting(false);
    }
  }

  const isBusy = environment.status === "RUNNING" || triggering;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          {f(t.backToTenant, { tenant: environment.tenant.name })}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{environment.name}</h1>
          <Badge variant={environment.status === "RUNNING" ? "default" : "secondary"}>
            {environment.status}
          </Badge>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger
              render={
                <Button variant="ghost" size="sm">
                  {t.edit}
                </Button>
              }
            />
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
              <DialogHeader>
                <DialogTitle>{t.editTitle}</DialogTitle>
                <DialogDescription>{t.editDescription}</DialogDescription>
              </DialogHeader>
              <EnvironmentForm
                mode="edit"
                environmentId={environment.id}
                initial={formInitial}
                onSuccess={() => setEditOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{environment.url}</p>
        <p className="text-xs text-muted-foreground">Token: {environment.tokenMasked}</p>
      </div>

      {/* Layout 2 columnas: izquierda (acciones) | derecha (resultados) */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* IZQUIERDA (1 col): Acciones + Promote (sticky en pantalla grande) */}
        <div className="space-y-6 lg:col-span-1">
          {/* Acciones */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.actions}</CardTitle>
              <CardDescription>
                {t.helpIntro}{" "}
                <Link href="/help" className="underline">
                  {t.helpLink}
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => triggerJob("BACKUP")}
                    disabled={isBusy}
                    title="Ejecuta 'monaco download' y versiona el resultado con un commit git local"
                  >
                    {isBusy && <Loader2 className="size-3.5 animate-spin" />}
                    {t.backupButton}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t.backupHelp}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => setDeployConfirmOpen(true)}
                      disabled={isBusy}
                      title="Ejecuta 'monaco deploy manifest.yaml' desde la carpeta del entorno"
                    >
                      {t.deploy}
                    </Button>
                    <DeployConfirmDialog
                      open={deployConfirmOpen}
                      onOpenChange={setDeployConfirmOpen}
                      targetEnvironmentId={environment.id}
                      targetName={environment.name}
                      summary={f(t.selfDeploySummary, { name: environment.name })}
                      onConfirm={() => void triggerJob("DEPLOY")}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => triggerJob("DEPLOY", true)}
                      disabled={isBusy}
                      title="Ejecuta 'monaco deploy manifest.yaml --dry-run' (valida sin aplicar)"
                    >
                      {isBusy && <Loader2 className="size-3.5 animate-spin" />}
                      {t.dryRun}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t.deployHint}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={testConnection} disabled={testing}>
                  {testing ? t.testing : t.test}
                </Button>
                {testResult && (
                  <span
                    className={testResult.ok ? "text-xs text-green-600" : "text-xs text-destructive"}
                  >
                    {testResult.message}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Promote */}
          <PromoteCard sourceEnvironmentId={environment.id} environments={environments} />
        </div>

        {/* DERECHA (2 cols): Resultados, Historial, etc (scrollable) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Ejecución en vivo */}
          {activeJobId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ejecucion</CardTitle>
                <CardDescription>Salida en vivo del proceso Monaco/Git.</CardDescription>
              </CardHeader>
              <CardContent>
                <JobLogViewer
                  jobId={activeJobId}
                  command={activeJob?.command}
                  errorSummary={activeJob?.errorSummary}
                  onDone={() => startTransition(() => router.refresh())}
                />
              </CardContent>
            </Card>
          )}

          {/* Contenido del backup */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.backupContent}</CardTitle>
              <CardDescription>{t.backupContentDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.exists && stats.totalFiles > 0 ? (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <span className="text-2xl font-semibold">{stats.totalFiles}</span>{" "}
                      <span className="text-muted-foreground">{t.files}</span>
                    </div>
                    <div>
                      <span className="text-2xl font-semibold">{formatBytes(stats.totalBytes)}</span>{" "}
                      <span className="text-muted-foreground">{t.onDisk}</span>
                    </div>
                    <div>
                      <span className="text-2xl font-semibold">{stats.byTopFolder.length}</span>{" "}
                      <span className="text-muted-foreground">{t.foldersCount}</span>
                    </div>
                  </div>
                  {stats.byTopFolder.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {stats.byTopFolder.map((folder) => (
                        <Badge key={folder.name} variant="outline" className="text-xs">
                          {folder.name}: {folder.files} archivo(s)
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t.noFiles}</p>
              )}
            </CardContent>
          </Card>

          {/* Top configuraciones */}
          <TopConfigsCard stats={configStats} />

          {/* Archivos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.files}</CardTitle>
              <CardDescription>{t.filesDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <FileBrowser environmentId={environment.id} />
            </CardContent>
          </Card>

          {/* Historial de Jobs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.jobHistory}</CardTitle>
              <CardDescription>{t.jobHistoryDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.type}</TableHead>
                      <TableHead>{t.status}</TableHead>
                      <TableHead>{t.reasonOutput}</TableHead>
                      <TableHead>{t.user}</TableHead>
                      <TableHead>{t.date}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs">
                          {job.type}
                          {job.dryRun && <span className="text-muted-foreground"> (dry-run)</span>}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              job.status === "SUCCESS"
                                ? "default"
                                : job.status === "FAILED"
                                  ? "destructive"
                                  : "secondary"
                            }
                            className="text-xs"
                          >
                            {job.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs">
                          {job.status === "FAILED" && job.errorSummary ? (
                            <span
                              className="line-clamp-2 text-xs text-destructive"
                              title={job.errorSummary}
                            >
                              {job.errorSummary}
                            </span>
                          ) : job.exitCode !== null ? (
                            <span className="text-xs text-muted-foreground">{f(t.exitCode, { code: job.exitCode })}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{job.triggeredBy}</TableCell>
                        <TableCell className="text-xs">{job.createdAtLabel}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActiveJobId(job.id)}
                            className="text-xs"
                          >
                            {t.view}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {jobs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          {t.noJobs}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Historial Git */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.gitHistoryTitle}</CardTitle>
              <CardDescription>{t.gitHistoryDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Commit</TableHead>
                      <TableHead>{t.date}</TableHead>
                      <TableHead>{t.message}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commits.map((commit) => (
                      <TableRow key={commit.hash}>
                        <TableCell className="font-mono text-xs">{commit.hash.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{commit.dateLabel}</TableCell>
                        <TableCell className="text-xs">{commit.message}</TableCell>
                      </TableRow>
                    ))}
                    {commits.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          {t.noCommits}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
