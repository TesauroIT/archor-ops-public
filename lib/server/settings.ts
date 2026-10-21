import { prisma } from "@/lib/prisma";
import type { AppSettings } from "@prisma/client";

// Configuracion global de la app: una unica fila con id "default".
// Si no existe todavia (primera vez), se crea con los defaults del schema.

const SETTINGS_ID = "default";

export async function getSettings(): Promise<AppSettings> {
  return prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

export async function updateSettings(data: {
  backupRetention?: number;
  autoBackupEnabled?: boolean;
  autoBackupIntervalHours?: number;
  lastAutoBackupAt?: Date;
  dpsSnapshotEnabled?: boolean;
  dpsSnapshotIntervalHours?: number;
  lastDpsSnapshotAt?: Date;
  ollamaUrl?: string;
  ollamaModel?: string;
  dashboardPrompt?: string | null;
}): Promise<AppSettings> {
  return prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: { id: SETTINGS_ID, ...data },
  });
}
