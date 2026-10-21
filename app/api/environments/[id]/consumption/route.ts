import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import {
  getConsumptionSummary,
  type ConsumptionSummary,
} from "@/lib/server/dynatraceSubscription";
import {
  readSnapshot,
  readLatestSnapshot,
  writeSnapshot,
  todayKey,
} from "@/lib/server/dpsSnapshots";

// Consumo y licenciamiento del entorno via Account Management API.
// Usa las credenciales OAuth de cuenta guardadas en el entorno (las mismas de
// IAM), que ademas del scope account-idm-read necesitan account-uac-read.
//
// La API entrega datos por dia, asi que el resultado se persiste como
// DpsSnapshot: el primer acceso del dia consulta a Dynatrace y guarda; los
// siguientes salen de la base. `?refresh=1` fuerza una consulta nueva.
// Un mapa de promesas en vuelo deduplica consultas concurrentes.

export interface ConsumptionMeta {
  source: "db" | "api";
  day: string;
  capturedAt: string;
  warning?: string;
}

export interface ConsumptionResponse {
  summary: ConsumptionSummary;
  meta: ConsumptionMeta;
}

const g = globalThis as typeof globalThis & {
  __consumptionInflight?: Map<string, Promise<ConsumptionSummary>>;
};

function inflight(): Map<string, Promise<ConsumptionSummary>> {
  if (!g.__consumptionInflight) g.__consumptionInflight = new Map();
  return g.__consumptionInflight;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const environment = await prisma.environment.findUnique({ where: { id } });
  if (!environment) {
    return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });
  }

  if (!environment.accountUuid || !environment.oauthClientId || !environment.oauthClientCipher) {
    return NextResponse.json(
      {
        error:
          "El entorno no tiene credenciales de cuenta (OAuth). Configura Dynatrace URN, Client ID y Client Secret en la edición del entorno.",
      },
      { status: 400 }
    );
  }

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const day = todayKey();

  // 1) Snapshot de hoy en la base: se sirve sin llamar a Dynatrace.
  if (!refresh) {
    const stored = await readSnapshot<ConsumptionSummary>("ENVIRONMENT", id, day);
    if (stored) {
      return NextResponse.json({
        summary: stored.data,
        meta: { source: "db", day, capturedAt: stored.createdAt.toISOString() },
      } satisfies ConsumptionResponse);
    }
  }

  // 2) Consulta a la API (deduplicando concurrentes) y persistencia.
  const flights = inflight();
  let promise = refresh ? undefined : flights.get(id);
  if (!promise) {
    promise = getConsumptionSummary(
      {
        accountUuid: normalizeAccountUuid(environment.accountUuid),
        clientId: environment.oauthClientId,
        clientSecret: decryptToken(environment.oauthClientCipher),
      },
      environment.envId
    ).finally(() => flights.delete(id));
    flights.set(id, promise);
  }

  try {
    const summary = await promise;

    // Solo se persiste un dia "sano": si fallo la subscripcion no se cachea,
    // para que el proximo acceso reintente.
    if (summary.subscription.ok) {
      await writeSnapshot("ENVIRONMENT", id, day, summary);
      return NextResponse.json({
        summary,
        meta: { source: "api", day, capturedAt: new Date().toISOString() },
      } satisfies ConsumptionResponse);
    }

    // 3) API degradada: se sirve el ultimo snapshot guardado si existe.
    const fallback = await readLatestSnapshot<ConsumptionSummary>("ENVIRONMENT", id);
    if (fallback) {
      return NextResponse.json({
        summary: fallback.data,
        meta: {
          source: "db",
          day: fallback.day,
          capturedAt: fallback.createdAt.toISOString(),
          warning: `La consulta a Dynatrace falló; se muestran los datos guardados del ${fallback.day}. (${summary.subscription.error ?? "sin detalle"})`,
        },
      } satisfies ConsumptionResponse);
    }

    return NextResponse.json({
      summary,
      meta: { source: "api", day, capturedAt: new Date().toISOString() },
    } satisfies ConsumptionResponse);
  } catch (error) {
    const fallback = await readLatestSnapshot<ConsumptionSummary>("ENVIRONMENT", id);
    if (fallback) {
      return NextResponse.json({
        summary: fallback.data,
        meta: {
          source: "db",
          day: fallback.day,
          capturedAt: fallback.createdAt.toISOString(),
          warning: `La consulta a Dynatrace falló; se muestran los datos guardados del ${fallback.day}. (${(error as Error).message})`,
        },
      } satisfies ConsumptionResponse);
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
