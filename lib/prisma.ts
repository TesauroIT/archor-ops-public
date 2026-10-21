import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const isNew = !globalForPrisma.prisma;

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (isNew) {
  // SQLite: WAL permite que las lecturas no se bloqueen mientras el worker
  // escribe el output de un job (sin esto, un deploy/backup con log grande
  // congela todas las paginas de la app). busy_timeout hace que una escritura
  // concurrente espere en vez de fallar con SQLITE_BUSY.
  // En PostgreSQL estos PRAGMA fallan y se ignoran sin efecto.
  void prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch(() => undefined);
  void prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;").catch(() => undefined);
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
