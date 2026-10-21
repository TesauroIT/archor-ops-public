import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import { getUsersReport, type UsersReport } from "@/lib/server/dynatraceUsers";
import { emptyGroupsResult } from "@/lib/server/dynatraceGroups";
import {
  readSnapshot,
  readLatestSnapshot,
  writeSnapshot,
  todayKey,
} from "@/lib/server/dpsSnapshots";

// Padron de usuarios de la cuenta del entorno (Account Management API).
// Mismo esquema de persistencia que el consumo: una consulta por dia guardada
// como DpsSnapshot (kind USERS), `?refresh=1` fuerza una nueva. Ademas de
// evitar llamadas repetidas, el snapshot diario va dejando historial del
// padron para futuras tendencias de altas y actividad.

export interface UsersMeta {
  source: "db" | "api";
  day: string;
  capturedAt: string;
  warning?: string;
}

export interface UsersResponse {
  report: UsersReport;
  meta: UsersMeta;
}

// Los snapshots guardados antes de que existiera la pertenencia a grupos no
// traen `groups` (ni en el reporte ni en cada usuario). Se detectan para
// volver a consultar en vez de servir un objeto al que la UI le pediria
// .groups.length y reventaria.
function hasGroups(report: UsersReport | undefined): boolean {
  return (
    !!report?.groups &&
    Array.isArray(report.groups.rows) &&
    Array.isArray(report.users) &&
    report.users.every((u) => !!u.groups)
  );
}

// En el camino degradado (la API no responde y se sirve un snapshot viejo)
// conviene completar la forma en vez de descartarlo: es preferible mostrar el
// padron sin grupos que no mostrar nada.
function normalize(report: UsersReport): UsersReport {
  const { byEmail: _byEmail, ...base } = emptyGroupsResult();
  const defaults = { ...base, usersWithoutGroup: 0, maxPerUser: 0 };
  return {
    ...report,
    // Se completan los campos que falten en vez de confiar en la forma
    // guardada: un snapshot viejo puede traer `groups` pero sin `rows`.
    groups: {
      ...defaults,
      ...(report.groups ?? {}),
      rows: report.groups?.rows ?? [],
    },
    users: (report.users ?? []).map((u) => ({ ...u, groups: u.groups ?? [] })),
  };
}

const g = globalThis as typeof globalThis & {
  __usersInflight?: Map<string, Promise<UsersReport>>;
};

function inflight(): Map<string, Promise<UsersReport>> {
  if (!g.__usersInflight) g.__usersInflight = new Map();
  return g.__usersInflight;
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

  if (!refresh) {
    const stored = await readSnapshot<UsersReport>("USERS", id, day);
    if (stored && hasGroups(stored.data)) {
      return NextResponse.json({
        report: stored.data,
        meta: { source: "db", day, capturedAt: stored.createdAt.toISOString() },
      } satisfies UsersResponse);
    }
  }

  const flights = inflight();
  let promise = refresh ? undefined : flights.get(id);
  if (!promise) {
    promise = getUsersReport({
      accountUuid: normalizeAccountUuid(environment.accountUuid),
      clientId: environment.oauthClientId,
      clientSecret: decryptToken(environment.oauthClientCipher),
    }).finally(() => flights.delete(id));
    flights.set(id, promise);
  }

  try {
    const report = await promise;
    await writeSnapshot("USERS", id, day, report);
    return NextResponse.json({
      report,
      meta: { source: "api", day, capturedAt: new Date().toISOString() },
    } satisfies UsersResponse);
  } catch (error) {
    // API caida: se sirve el ultimo padron guardado, avisando de que dia es.
    const fallback = await readLatestSnapshot<UsersReport>("USERS", id);
    if (fallback) {
      return NextResponse.json({
        report: normalize(fallback.data),
        meta: {
          source: "db",
          day: fallback.day,
          capturedAt: fallback.createdAt.toISOString(),
          warning: `La consulta a Dynatrace falló; se muestran los datos guardados del ${fallback.day}. (${(error as Error).message})`,
        },
      } satisfies UsersResponse);
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
