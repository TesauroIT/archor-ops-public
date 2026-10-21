import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import {
  getSubscriptionOverview,
  type SubscriptionOverview,
} from "@/lib/server/dynatraceSubscription";
import {
  readSnapshot,
  readLatestSnapshot,
  writeSnapshot,
  todayKey,
} from "@/lib/server/dpsSnapshots";

// Vista general DPS: una fila por entorno con presupuesto usado/total, periodo
// de contrato y forecast. Los datos vienen por cuenta (accountUuid) y la API
// los entrega por dia, asi que se persisten como DpsSnapshot: el primer acceso
// del dia consulta a Dynatrace (en serie, por el rate limit) y guarda; los
// siguientes salen de la base. `?refresh=1` fuerza consultas nuevas.

export interface OverviewRow {
  environmentId: string;
  tenantName: string;
  environmentName: string;
  configured: boolean;
  overview: SubscriptionOverview | null;
  day?: string; // dia del snapshot servido (para marcar datos viejos)
  stale?: boolean;
}

export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const day = todayKey();
  const environments = await prisma.environment.findMany({
    include: { tenant: true },
    orderBy: [{ tenant: { name: "asc" } }, { name: "asc" }],
  });

  // Cache por cuenta dentro del request: entornos de la misma cuenta
  // comparten subscripcion y no se consulta dos veces.
  const byAccount = new Map<string, { overview: SubscriptionOverview; day: string; stale: boolean }>();
  const rows: OverviewRow[] = [];

  for (const env of environments) {
    const configured = !!(env.accountUuid && env.oauthClientId && env.oauthClientCipher);
    if (!configured) {
      rows.push({
        environmentId: env.id,
        tenantName: env.tenant.name,
        environmentName: env.name,
        configured: false,
        overview: null,
      });
      continue;
    }

    const accountUuid = normalizeAccountUuid(env.accountUuid!);
    let resolved = byAccount.get(accountUuid);

    if (!resolved) {
      // 1) Snapshot de hoy en la base.
      if (!refresh) {
        const stored = await readSnapshot<SubscriptionOverview>("ACCOUNT", accountUuid, day);
        if (stored) {
          resolved = { overview: stored.data, day: stored.day, stale: false };
        }
      }

      // 2) Consulta a la API y persistencia (solo si respondio bien).
      if (!resolved) {
        const overview = await getSubscriptionOverview({
          accountUuid,
          clientId: env.oauthClientId!,
          clientSecret: decryptToken(env.oauthClientCipher!),
        });
        if (overview.ok) {
          await writeSnapshot("ACCOUNT", accountUuid, day, overview);
          resolved = { overview, day, stale: false };
        } else {
          // 3) API degradada: ultimo snapshot guardado si existe.
          const fallback = await readLatestSnapshot<SubscriptionOverview>("ACCOUNT", accountUuid);
          resolved = fallback
            ? { overview: fallback.data, day: fallback.day, stale: true }
            : { overview, day, stale: false };
        }
      }

      byAccount.set(accountUuid, resolved);
    }

    rows.push({
      environmentId: env.id,
      tenantName: env.tenant.name,
      environmentName: env.name,
      configured: true,
      overview: resolved.overview,
      day: resolved.day,
      stale: resolved.stale,
    });
  }

  return NextResponse.json({ rows, generatedAt: new Date().toISOString() });
}
