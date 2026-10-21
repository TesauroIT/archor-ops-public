import { prisma } from "@/lib/prisma";

// Persistencia diaria del consumo DPS. La Account API entrega datos por dia:
// el primer acceso del dia consulta a Dynatrace y guarda el snapshot; los
// siguientes se sirven desde la base. "Actualizar" (refresh) sobreescribe el
// dia. Se acumula un registro por dia, lo que ademas deja historial para
// futuras tendencias.

// USERS = padron de usuarios de la cuenta (key = environmentId). Es un valor
// mas de la columna `kind`, que es String: no requiere migracion.
export type SnapshotKind = "ENVIRONMENT" | "ACCOUNT" | "USERS";

// Fecha local del servidor como YYYY-MM-DD (no UTC, para que el "dia" corte
// a medianoche local).
export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface Snapshot<T> {
  data: T;
  day: string;
  createdAt: Date;
}

export async function readSnapshot<T>(
  kind: SnapshotKind,
  key: string,
  day: string
): Promise<Snapshot<T> | null> {
  const row = await prisma.dpsSnapshot.findUnique({
    where: { kind_key_day: { kind, key, day } },
  });
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as T, day: row.day, createdAt: row.createdAt };
  } catch {
    return null; // JSON corrupto: se ignora y se vuelve a consultar
  }
}

// Ultimo snapshot guardado (de cualquier dia), para servir datos viejos si la
// API no responde.
export async function readLatestSnapshot<T>(
  kind: SnapshotKind,
  key: string
): Promise<Snapshot<T> | null> {
  const row = await prisma.dpsSnapshot.findFirst({
    where: { kind, key },
    orderBy: { day: "desc" },
  });
  if (!row) return null;
  try {
    return { data: JSON.parse(row.data) as T, day: row.day, createdAt: row.createdAt };
  } catch {
    return null;
  }
}

export async function writeSnapshot(
  kind: SnapshotKind,
  key: string,
  day: string,
  data: unknown
): Promise<void> {
  const json = JSON.stringify(data);
  await prisma.dpsSnapshot.upsert({
    where: { kind_key_day: { kind, key, day } },
    update: { data: json, createdAt: new Date() },
    create: { kind, key, day, data: json },
  });
}
