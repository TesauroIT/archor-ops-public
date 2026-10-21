"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { JobLogViewer } from "@/components/job-log-viewer";
import { DeployConfirmDialog } from "@/components/deploy-confirm-dialog";
import { useI18n } from "@/lib/i18n/context";

export interface EnvOption {
  id: string;
  label: string; // "Cliente / Entorno"
}

function comboKey(targetId: string, wholeBackup: boolean, selected: string[]): string {
  const types = wholeBackup ? "ALL" : [...selected].sort().join(",");
  return `${targetId}|${types}`;
}

export function PromoteCard({
  sourceEnvironmentId,
  environments,
}: {
  sourceEnvironmentId: string;
  environments: EnvOption[];
}) {
  const router = useRouter();
  const { dict, f } = useI18n();
  const t = dict.promoteCard;
  const [targetId, setTargetId] = useState<string>("");
  const [allTypes, setAllTypes] = useState<string[]>([]);
  const [wholeBackup, setWholeBackup] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [validatedCombos, setValidatedCombos] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/environments/${sourceEnvironmentId}/config-types`)
      .then((r) => r.json())
      .then((d) => setAllTypes(d.types ?? []))
      .catch(() => setAllTypes([]));
  }, [sourceEnvironmentId]);

  const selectedList = [...selected];
  const currentKey = targetId ? comboKey(targetId, wholeBackup, selectedList) : "";
  const dryRunOk = currentKey ? validatedCombos.has(currentKey) : false;
  const selectionValid = wholeBackup || selectedList.length > 0;

  function toggleType(type: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function run(dryRun: boolean) {
    if (!targetId) {
      toast.error(t.noTarget);
      return;
    }
    if (!selectionValid) {
      toast.error(t.noSelection);
      return;
    }
    if (!dryRun) {
      // Deploy real: doble confirmacion obligatoria en el dialogo.
      setConfirmOpen(true);
      return;
    }
    void execute(true);
  }

  async function execute(dryRun: boolean) {
    setBusy(true);
    const body = {
      type: "DEPLOY" as const,
      dryRun,
      sourceEnvironmentId,
      ...(wholeBackup ? {} : { configTypes: selectedList }),
    };
    const res = await fetch(`/api/environments/${targetId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? t.deployStartError);
      return;
    }
    const job = await res.json();
    toast.success(dryRun ? t.dryRunRunning : t.deployRunning);
    setActiveJobId(job.id);
    router.refresh();
  }

  function onJobDone(status: "SUCCESS" | "FAILED") {
    if (status === "SUCCESS" && currentKey) {
      // Si el ultimo job fue un dry-run exitoso, habilita el deploy real de esa combinacion.
      setValidatedCombos((prev) => new Set(prev).add(currentKey));
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t.targetEnv}</Label>
          <Select value={targetId} onValueChange={(v) => setTargetId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t.targetPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>{t.whatToDeploy}</Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={wholeBackup}
              onChange={(e) => setWholeBackup(e.target.checked)}
            />
            {f(t.wholeBackup, { count: allTypes.length })}
          </label>

          {!wholeBackup && (
            <ScrollArea className="h-48 rounded-md border p-2">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {allTypes.map((type) => (
                  <label key={type} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.has(type)}
                      onChange={() => toggleType(type)}
                    />
                    <span className="truncate" title={type}>
                      {type}
                    </span>
                  </label>
                ))}
                {allTypes.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t.noTypes}</p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => run(true)} disabled={busy || !targetId}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {t.dryRun}
          </Button>
          <Button
            onClick={() => run(false)}
            disabled={busy || !targetId || !dryRunOk}
            title={
              dryRunOk ? t.deployRealHint : t.deployRealDisabled
            }
          >
            {t.deployReal}
          </Button>
          {!dryRunOk && targetId && (
            <span className="text-xs text-muted-foreground">{t.dryRunHint}</span>
          )}
        </div>

        {activeJobId && (
          <div className="pt-2">
            <JobLogViewer jobId={activeJobId} onDone={onJobDone} />
          </div>
        )}

        <DeployConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          targetEnvironmentId={targetId}
          targetName={environments.find((e) => e.id === targetId)?.label ?? ""}
          sourceEnvironmentId={sourceEnvironmentId}
          summary={
            wholeBackup
              ? t.confirmTitle
              : f(t.confirmPartial, { count: selectedList.length })
          }
          onConfirm={() => void execute(false)}
        />
      </CardContent>
    </Card>
  );
}
