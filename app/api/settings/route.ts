import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings, updateSettings } from "@/lib/server/settings";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

const updateSettingsSchema = z.object({
  backupRetention: z.number().int().min(1).max(500).optional(),
  autoBackupEnabled: z.boolean().optional(),
  autoBackupIntervalHours: z.number().int().min(1).max(720).optional(),
  dpsSnapshotEnabled: z.boolean().optional(),
  dpsSnapshotIntervalHours: z.number().int().min(1).max(168).optional(),
  ollamaUrl: z.string().min(1).max(500).optional(),
  ollamaModel: z.string().min(1).max(200).optional(),
  // "" = volver al prompt por defecto (se guarda null).
  dashboardPrompt: z.string().max(20000).optional(),
});

export async function PATCH(request: Request) {
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Un prompt vacio significa "usar el default": se persiste como null.
  const data = { ...parsed.data };
  if (typeof data.dashboardPrompt === "string" && data.dashboardPrompt.trim() === "") {
    (data as { dashboardPrompt?: string | null }).dashboardPrompt = null;
  }

  const settings = await updateSettings(data);
  await logActivity({
    type: "SETTINGS",
    title: "Configuracion actualizada",
    message:
      `Backups: retener ${settings.backupRetention}, ` +
      `automatico ${settings.autoBackupEnabled ? `activado (cada ${settings.autoBackupIntervalHours} h)` : "desactivado"}. ` +
      `Snapshot DPS: ${settings.dpsSnapshotEnabled ? `activado (cada ${settings.dpsSnapshotIntervalHours} h)` : "desactivado"}.`,
    triggeredBy,
  });
  return NextResponse.json(settings);
}
