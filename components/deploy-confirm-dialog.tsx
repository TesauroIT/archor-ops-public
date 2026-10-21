"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Doble confirmacion obligatoria para todo deploy REAL (self o promote):
//  1) el operador acepta explicitamente que entiende el riesgo (checkbox);
//  2) escribe el nombre del entorno destino para habilitar la ejecucion.
// Ademas muestra el comando de Monaco equivalente, copiable, por si el
// operador prefiere ejecutarlo por su cuenta en lugar de usar la app.

interface CommandInfo {
  commandLine: string;
  cwd: string;
  tokenEnvVar: string;
  targetUrl: string;
  isPromote: boolean;
}

export function DeployConfirmDialog({
  open,
  onOpenChange,
  targetEnvironmentId,
  targetName,
  sourceEnvironmentId,
  summary,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetEnvironmentId: string;
  targetName: string;
  sourceEnvironmentId?: string;
  /** Resumen de lo que se va a desplegar (origen, tipos, etc.). */
  summary: string;
  onConfirm: () => void;
}) {
  const { dict, f } = useI18n();
  const t = dict.deployDialog;
  const [step, setStep] = useState<1 | 2>(1);
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [command, setCommand] = useState<CommandInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const url =
      `/api/environments/${targetEnvironmentId}/deploy-command` +
      (sourceEnvironmentId ? `?source=${encodeURIComponent(sourceEnvironmentId)}` : "");
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setCommand(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, targetEnvironmentId, sourceEnvironmentId]);

  // Reset completo al cerrar: la friccion en cada apertura es intencional.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep(1);
      setAccepted(false);
      setTypedName("");
      setCommand(null);
    }
    onOpenChange(next);
  }

  const nameMatches = typedName.trim() === targetName;

  const manualBlock = command
    ? [
        `# ${t.manualServer}`,
        `cd "${command.cwd}"`,
        ``,
        `# ${t.manualTokenNote}`,
        `#   ${t.manualPowerShell.replace("{var}", command.tokenEnvVar)}`,
        `#   ${t.manualBash.replace("{var}", command.tokenEnvVar)}`,
        ...(command.isPromote
          ? [``, `# ${t.manualTargetUrl.replace("{url}", command.targetUrl)}`]
          : []),
        ``,
        command.commandLine,
      ].join("\n")
    : null;

  async function copyCommand() {
    if (!manualBlock) return;
    try {
      await navigator.clipboard.writeText(manualBlock);
      toast.success(t.copied);
    } catch {
      toast.error(t.copyError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            {f(t.title, { target: targetName })}
          </DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium">{t.step1Title}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t.step1Item1}</li>
                <li>{t.step1Item2}</li>
                <li>{t.step1Item3}</li>
                <li>{t.step1Item4}</li>
              </ul>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-primary"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              {t.understanding}
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button disabled={!accepted} onClick={() => setStep(2)}>
                {t.continue}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <TerminalSquare className="size-4" />
                {t.commandTitle}
              </p>
              <pre className="max-h-48 overflow-auto rounded-md border bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                {manualBlock ?? t.loadingCommand}
              </pre>
              <Button variant="outline" size="sm" onClick={copyCommand} disabled={!manualBlock}>
                <Copy className="size-3.5" />
                {t.copyCommand}
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deploy-confirm-name">
                {f(t.secondConfirm, { target: targetName })}
              </Label>
              <Input
                id="deploy-confirm-name"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={targetName}
                autoComplete="off"
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>
                {t.back}
              </Button>
              <Button
                variant="destructive"
                disabled={!nameMatches}
                title={nameMatches ? undefined : t.nameHint}
                onClick={() => {
                  handleOpenChange(false);
                  onConfirm();
                }}
              >
                {f(t.execute, { target: targetName })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
