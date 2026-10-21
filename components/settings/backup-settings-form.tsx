"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";

export interface BackupSettings {
  backupRetention: number;
  autoBackupEnabled: boolean;
  autoBackupIntervalHours: number;
  lastAutoBackupAt: string | null;
  dpsSnapshotEnabled: boolean;
  dpsSnapshotIntervalHours: number;
  lastDpsSnapshotAt: string | null;
}

export function BackupSettingsForm({ initial }: { initial: BackupSettings }) {
  const router = useRouter();
  const { locale, dict, f } = useI18n();
  const t = dict.backupForm;
  const [isPending, startTransition] = useTransition();
  const [retention, setRetention] = useState(String(initial.backupRetention));
  const [enabled, setEnabled] = useState(initial.autoBackupEnabled);
  const [intervalHours, setIntervalHours] = useState(String(initial.autoBackupIntervalHours));
  const [dpsEnabled, setDpsEnabled] = useState(initial.dpsSnapshotEnabled);
  const [dpsIntervalHours, setDpsIntervalHours] = useState(
    String(initial.dpsSnapshotIntervalHours)
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    const backupRetention = Number(retention);
    const autoBackupIntervalHours = Number(intervalHours);
    const dpsSnapshotIntervalHours = Number(dpsIntervalHours);
    if (!Number.isInteger(backupRetention) || backupRetention < 1) {
      toast.error(t.errRetention);
      return;
    }
    if (!Number.isInteger(autoBackupIntervalHours) || autoBackupIntervalHours < 1) {
      toast.error(t.errInterval);
      return;
    }
    if (!Number.isInteger(dpsSnapshotIntervalHours) || dpsSnapshotIntervalHours < 1) {
      toast.error(t.errDpsInterval);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupRetention,
          autoBackupEnabled: enabled,
          autoBackupIntervalHours,
          dpsSnapshotEnabled: dpsEnabled,
          dpsSnapshotIntervalHours,
        }),
      });
      if (!res.ok) {
        toast.error(t.errSave);
        return;
      }
      toast.success(t.saved);
      startTransition(() => router.refresh());
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="backup-retention">{t.retentionLabel}</Label>
          <Input
            id="backup-retention"
            type="number"
            min={1}
            className="max-w-40"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t.retentionHelp}</p>
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            {t.autoBackupLabel}
          </label>
          <div className="space-y-2">
            <Label htmlFor="backup-interval">{t.intervalLabel}</Label>
            <Input
              id="backup-interval"
              type="number"
              min={1}
              className="max-w-40"
              value={intervalHours}
              onChange={(e) => setIntervalHours(e.target.value)}
              disabled={!enabled}
            />
            <p className="text-xs text-muted-foreground">
              {t.autoBackupHelp}
              {initial.lastAutoBackupAt &&
                f(t.lastAutoCycle, {
                  date: new Date(initial.lastAutoBackupAt).toLocaleString(locale),
                })}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={dpsEnabled}
              onChange={(e) => setDpsEnabled(e.target.checked)}
            />
            {t.dpsLabel}
          </label>
          <div className="space-y-2">
            <Label htmlFor="dps-interval">{t.intervalLabel}</Label>
            <Input
              id="dps-interval"
              type="number"
              min={1}
              className="max-w-40"
              value={dpsIntervalHours}
              onChange={(e) => setDpsIntervalHours(e.target.value)}
              disabled={!dpsEnabled}
            />
            <p className="text-xs text-muted-foreground">
              {t.dpsHelp}
              {initial.lastDpsSnapshotAt &&
                f(t.dpsLastCycle, {
                  date: new Date(initial.lastDpsSnapshotAt).toLocaleString(locale),
                })}
            </p>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button onClick={save} disabled={saving || isPending}>
          {saving ? dict.common.saving : t.saveButton}
        </Button>
      </CardFooter>
    </Card>
  );
}
