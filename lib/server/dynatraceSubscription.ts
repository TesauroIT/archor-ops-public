// Cliente de la Dynatrace Platform Subscription API (Account Management API):
// presupuesto, consumo y costo por entorno, forecast y usuarios de la cuenta.
//
// Requiere el mismo OAuth client de cuenta que IAM, con los scopes:
//  - account-uac-read (subscripciones, uso, costo, forecast)
//  - account-idm-read (usuarios)
// Cada seccion es tolerante a fallos: si falta un scope o un endpoint no esta
// disponible, esa seccion vuelve con error y el resto del panel se muestra.

import {
  getAccessToken,
  listAccountUsersDetailed,
  type AccountCreds,
} from "@/lib/server/dynatraceAccount";

const ACCOUNT_API_BASE = "https://api.dynatrace.com";
const TIMEOUT_MS = 30_000;
const UAC_SCOPE = "account-uac-read";
const ACTIVE_LOGIN_WINDOW_DAYS = 30;

// La Account API tiene rate limit agresivo (HTTP 429): reintentamos con
// backoff respetando Retry-After si viene.
async function apiGet<T>(token: string, path: string, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ACCOUNT_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 15_000)));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Account API ${path.split("?")[0]} fallo (HTTP ${res.status}). ${text.slice(0, 200)}`
      );
    }
    return (await res.json()) as T;
  }
}

// La API espera fechas ISO sin milisegundos (2021-05-01T15:11:00Z).
function toApiTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface SubscriptionSummaryDto {
  uuid: string;
  name?: string;
  type?: string;
  subType?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
}

interface SubscriptionDetailDto extends SubscriptionSummaryDto {
  budget?: { total?: number; used?: number; currencyCode?: string };
  currentPeriod?: { startTime?: string; endTime?: string; daysRemaining?: number };
  capabilities?: { key?: string; name?: string }[];
}

interface UsageEnvDto {
  data?: {
    environmentId?: string;
    usage?: {
      capabilityKey?: string;
      capabilityName?: string;
      value?: number;
      unitMeasure?: string;
    }[];
  }[];
  lastModifiedTime?: string;
}

interface CostEnvDto {
  data?: {
    environmentId?: string;
    cost?: {
      capabilityKey?: string;
      capabilityName?: string;
      value?: number;
      currencyCode?: string;
    }[];
  }[];
  lastModifiedTime?: string;
  nextPageKey?: string;
}

interface ForecastDto {
  forecastMedian?: number;
  forecastLower?: number;
  forecastUpper?: number;
  budget?: number;
  forecastBudgetPct?: number;
  forecastBudgetDate?: string;
  forecastCreatedAt?: string;
}

export interface CapabilityRow {
  key: string;
  name: string;
  usageValue: number | null;
  usageUnit: string | null;
  costValue: number | null;
  costCurrency: string | null;
}

export interface ConsumptionSummary {
  subscription: {
    ok: boolean;
    error?: string;
    name?: string;
    type?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    periodStart?: string;
    periodEnd?: string;
    daysRemaining?: number | null;
    budgetTotal?: number | null;
    budgetUsed?: number | null;
    budgetPct?: number | null;
    currencyCode?: string | null;
  };
  forecast: {
    ok: boolean;
    error?: string;
    source?: "api" | "linear";
    median?: number | null;
    lower?: number | null;
    upper?: number | null;
    budgetPct?: number | null;
    budgetExhaustionDate?: string | null;
  };
  capabilities: {
    ok: boolean;
    error?: string;
    scope: "environment" | "account";
    rows: CapabilityRow[];
    totalCost: number | null;
    currencyCode: string | null;
    lastModifiedTime: string | null;
  };
  users: {
    ok: boolean;
    error?: string;
    total?: number;
    active?: number;
    recentlyActive?: number;
    recentWindowDays?: number;
  };
}

// Suma entradas de uso/costo por capability (la API puede devolver buckets).
function mergeRows(
  usage: NonNullable<NonNullable<UsageEnvDto["data"]>[number]["usage"]>,
  cost: NonNullable<NonNullable<CostEnvDto["data"]>[number]["cost"]>
): CapabilityRow[] {
  const byKey = new Map<string, CapabilityRow>();

  for (const entry of usage) {
    if (!entry.capabilityKey) continue;
    const row = byKey.get(entry.capabilityKey) ?? {
      key: entry.capabilityKey,
      name: entry.capabilityName ?? entry.capabilityKey,
      usageValue: null,
      usageUnit: null,
      costValue: null,
      costCurrency: null,
    };
    row.usageValue = (row.usageValue ?? 0) + (entry.value ?? 0);
    row.usageUnit = entry.unitMeasure ?? row.usageUnit;
    byKey.set(entry.capabilityKey, row);
  }

  for (const entry of cost) {
    if (!entry.capabilityKey) continue;
    const row = byKey.get(entry.capabilityKey) ?? {
      key: entry.capabilityKey,
      name: entry.capabilityName ?? entry.capabilityKey,
      usageValue: null,
      usageUnit: null,
      costValue: null,
      costCurrency: null,
    };
    row.costValue = (row.costValue ?? 0) + (entry.value ?? 0);
    row.costCurrency = entry.currencyCode ?? row.costCurrency;
    byKey.set(entry.capabilityKey, row);
  }

  return Array.from(byKey.values()).sort((a, b) => (b.costValue ?? 0) - (a.costValue ?? 0));
}

// Trae todas las paginas del costo por entorno (v3 pagina con nextPageKey).
// Tope de paginas como salvaguarda: si la API repitiera el pageKey no
// quedariamos en un loop infinito contra una API con rate limit.
const MAX_COST_PAGES = 25;

async function fetchAllCostPages(token: string, basePath: string): Promise<CostEnvDto> {
  const merged: CostEnvDto = { data: [] };
  let pageKey: string | undefined;
  let pages = 0;

  do {
    const path = pageKey ? `${basePath}&page-key=${encodeURIComponent(pageKey)}` : basePath;
    const page = await apiGet<CostEnvDto>(token, path);
    merged.data!.push(...(page.data ?? []));
    merged.lastModifiedTime = page.lastModifiedTime ?? merged.lastModifiedTime;
    const next = page.nextPageKey ?? undefined;
    pageKey = next === pageKey ? undefined : next;
    pages += 1;
  } while (pageKey && pages < MAX_COST_PAGES);

  return merged;
}

export async function getConsumptionSummary(
  creds: AccountCreds,
  environmentId: string | null
): Promise<ConsumptionSummary> {
  const summary: ConsumptionSummary = {
    subscription: { ok: false },
    forecast: { ok: false },
    capabilities: {
      ok: false,
      scope: environmentId ? "environment" : "account",
      rows: [],
      totalCost: null,
      currencyCode: null,
      lastModifiedTime: null,
    },
    users: { ok: false },
  };

  // --- Subscripcion, uso y costo (scope account-uac-read) ---
  try {
    const token = await getAccessToken(creds, UAC_SCOPE);
    const account = encodeURIComponent(creds.accountUuid);

    const list = await apiGet<{ data?: SubscriptionSummaryDto[] }>(
      token,
      `/sub/v2/accounts/${account}/subscriptions`
    );
    const subscriptions = list.data ?? [];
    const active =
      subscriptions.find((s) => s.status?.toUpperCase() === "ACTIVE") ?? subscriptions[0];
    if (!active?.uuid) throw new Error("La cuenta no tiene subscripciones visibles.");

    const detail = await apiGet<SubscriptionDetailDto>(
      token,
      `/sub/v2/accounts/${account}/subscriptions/${encodeURIComponent(active.uuid)}`
    );

    const budgetTotal = detail.budget?.total ?? null;
    const budgetUsed = detail.budget?.used ?? null;
    summary.subscription = {
      ok: true,
      name: detail.name ?? active.name,
      type: [detail.type, detail.subType].filter(Boolean).join(" / "),
      status: detail.status ?? active.status,
      startTime: detail.startTime,
      endTime: detail.endTime,
      periodStart: detail.currentPeriod?.startTime,
      periodEnd: detail.currentPeriod?.endTime,
      daysRemaining: detail.currentPeriod?.daysRemaining ?? null,
      budgetTotal,
      budgetUsed,
      budgetPct:
        budgetTotal && budgetTotal > 0 && budgetUsed != null
          ? (budgetUsed / budgetTotal) * 100
          : null,
      currencyCode: detail.budget?.currencyCode ?? null,
    };

    // Ventana de consulta: el periodo actual (hasta ahora, no hasta el futuro).
    const periodStart = detail.currentPeriod?.startTime ?? detail.startTime;
    const periodEnd = detail.currentPeriod?.endTime ?? detail.endTime;
    if (periodStart) {
      const start = new Date(periodStart);
      const now = new Date();
      const end = periodEnd && new Date(periodEnd) < now ? new Date(periodEnd) : now;
      const envFilter = environmentId
        ? `&environmentIds=${encodeURIComponent(environmentId)}`
        : "";
      const range = `startTime=${encodeURIComponent(toApiTime(start))}&endTime=${encodeURIComponent(toApiTime(end))}`;

      try {
        // En serie (no en paralelo) para no disparar el rate limit de la API.
        const usage = await apiGet<UsageEnvDto>(
          token,
          `/sub/v2/accounts/${account}/subscriptions/${encodeURIComponent(active.uuid)}/environments/usage?${range}${envFilter}`
        );
        const cost = await fetchAllCostPages(
          token,
          `/sub/v3/accounts/${account}/subscriptions/${encodeURIComponent(active.uuid)}/environments/cost?${range}${envFilter}`
        );

        const usageEntries = (usage.data ?? []).flatMap((d) => d.usage ?? []);
        const costEntries = (cost.data ?? []).flatMap((d) => d.cost ?? []);
        const rows = mergeRows(usageEntries, costEntries);
        const totalCost = rows.reduce((acc, r) => acc + (r.costValue ?? 0), 0);

        summary.capabilities = {
          ok: true,
          scope: environmentId ? "environment" : "account",
          rows,
          totalCost,
          currencyCode:
            rows.find((r) => r.costCurrency)?.costCurrency ??
            summary.subscription.currencyCode ??
            null,
          lastModifiedTime: usage.lastModifiedTime ?? cost.lastModifiedTime ?? null,
        };
      } catch (error) {
        summary.capabilities.error = (error as Error).message;
      }
    } else {
      summary.capabilities.error = "La subscripcion no informa periodo actual.";
    }

    // Forecast oficial; si no esta disponible, proyeccion lineal del budget.
    try {
      const forecast = await apiGet<ForecastDto>(
        token,
        `/sub/v2/accounts/${account}/subscriptions/forecast`
      );
      summary.forecast = {
        ok: true,
        source: "api",
        median: forecast.forecastMedian ?? null,
        lower: forecast.forecastLower ?? null,
        upper: forecast.forecastUpper ?? null,
        budgetPct: forecast.forecastBudgetPct ?? null,
        budgetExhaustionDate: forecast.forecastBudgetDate ?? null,
      };
    } catch (error) {
      const linear = linearForecast(detail);
      if (linear) {
        summary.forecast = { ok: true, source: "linear", ...linear };
      } else {
        summary.forecast = { ok: false, error: (error as Error).message };
      }
    }
  } catch (error) {
    summary.subscription = { ok: false, error: (error as Error).message };
    summary.capabilities.error ??= summary.subscription.error;
    summary.forecast.error ??= summary.subscription.error;
  }

  // --- Usuarios (scope account-idm-read) ---
  try {
    const users = await listAccountUsersDetailed(creds);
    const cutoff = Date.now() - ACTIVE_LOGIN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    summary.users = {
      ok: true,
      total: users.length,
      active: users.filter((u) => u.userStatus?.toUpperCase() === "ACTIVE").length,
      recentlyActive: users.filter(
        (u) => u.lastSuccessfulLogin && new Date(u.lastSuccessfulLogin).getTime() >= cutoff
      ).length,
      recentWindowDays: ACTIVE_LOGIN_WINDOW_DAYS,
    };
  } catch (error) {
    summary.users = { ok: false, error: (error as Error).message };
  }

  return summary;
}

// Resumen liviano de la subscripcion de una cuenta, para la vista general DPS
// (una fila por cliente). Solo subscripcion + forecast, sin uso/costo/usuarios.
export interface SubscriptionOverview {
  ok: boolean;
  error?: string;
  name?: string;
  status?: string;
  used?: number | null;
  total?: number | null;
  usagePct?: number | null;
  currencyCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  daysRemaining?: number | null;
  forecastPct?: number | null;
  forecastValue?: number | null;
  forecastSource?: "api" | "linear";
  forecastBudgetDate?: string | null;
}

export async function getSubscriptionOverview(creds: AccountCreds): Promise<SubscriptionOverview> {
  try {
    const token = await getAccessToken(creds, UAC_SCOPE);
    const account = encodeURIComponent(creds.accountUuid);

    const list = await apiGet<{ data?: SubscriptionSummaryDto[] }>(
      token,
      `/sub/v2/accounts/${account}/subscriptions`
    );
    const subscriptions = list.data ?? [];
    const active =
      subscriptions.find((s) => s.status?.toUpperCase() === "ACTIVE") ?? subscriptions[0];
    if (!active?.uuid) throw new Error("La cuenta no tiene subscripciones visibles.");

    const detail = await apiGet<SubscriptionDetailDto>(
      token,
      `/sub/v2/accounts/${account}/subscriptions/${encodeURIComponent(active.uuid)}`
    );

    const used = detail.budget?.used ?? null;
    const total = detail.budget?.total ?? null;

    let forecastPct: number | null = null;
    let forecastValue: number | null = null;
    let forecastSource: "api" | "linear" | undefined;
    let forecastBudgetDate: string | null = null;
    try {
      const forecast = await apiGet<ForecastDto>(
        token,
        `/sub/v2/accounts/${account}/subscriptions/forecast`
      );
      forecastPct = forecast.forecastBudgetPct ?? null;
      forecastValue = forecast.forecastMedian ?? null;
      forecastBudgetDate = forecast.forecastBudgetDate ?? null;
      forecastSource = "api";
    } catch {
      const linear = linearForecast(detail);
      if (linear) {
        forecastPct = linear.budgetPct;
        forecastValue = linear.median;
        forecastBudgetDate = linear.budgetExhaustionDate;
        forecastSource = "linear";
      }
    }

    return {
      ok: true,
      name: detail.name ?? active.name,
      status: detail.status ?? active.status,
      used,
      total,
      usagePct: used != null && total && total > 0 ? (used / total) * 100 : null,
      currencyCode: detail.budget?.currencyCode ?? null,
      startTime: detail.startTime ?? null,
      endTime: detail.endTime ?? null,
      daysRemaining: detail.currentPeriod?.daysRemaining ?? null,
      forecastPct,
      forecastValue,
      forecastSource,
      forecastBudgetDate,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// Proyeccion lineal sobre el periodo actual: consumido / dias transcurridos *
// dias totales. Fallback cuando el endpoint de forecast no esta disponible.
function linearForecast(detail: SubscriptionDetailDto): {
  median: number;
  lower: null;
  upper: null;
  budgetPct: number | null;
  budgetExhaustionDate: string | null;
} | null {
  const total = detail.budget?.total;
  const used = detail.budget?.used;
  const start = detail.currentPeriod?.startTime ?? detail.startTime;
  const end = detail.currentPeriod?.endTime ?? detail.endTime;
  if (used == null || !start || !end) return null;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const elapsedMs = Date.now() - startMs;
  if (!(elapsedMs > 0) || !(endMs > startMs)) return null;

  const projected = (used / elapsedMs) * (endMs - startMs);
  const budgetPct = total && total > 0 ? (projected / total) * 100 : null;

  // Fecha estimada de agotamiento del budget si el ritmo se mantiene.
  let exhaustion: string | null = null;
  if (total && total > 0 && used > 0 && used < total) {
    const msToExhaust = (total / used) * elapsedMs;
    exhaustion = new Date(startMs + msToExhaust).toISOString();
  }

  return { median: projected, lower: null, upper: null, budgetPct, budgetExhaustionDate: exhaustion };
}
