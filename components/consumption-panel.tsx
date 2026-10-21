"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ConsumptionSummary } from "@/lib/server/dynatraceSubscription";

interface ConsumptionMeta {
  source: "db" | "api";
  day: string;
  capturedAt: string;
  warning?: string;
}

interface ConsumptionResponse {
  summary: ConsumptionSummary;
  meta: ConsumptionMeta;
}

const WARN_PCT = 80;

function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return value.toLocaleString("es-AR", { maximumFractionDigits: digits });
}

function formatMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "—";
  return `${formatNumber(value)}${currency ? ` ${currency}` : ""}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-AR");
}

// Barra de progreso simple con color segun cercania al limite.
function BudgetBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 100);
  const color = pct >= 100 ? "bg-destructive" : pct >= WARN_PCT ? "bg-amber-500" : "bg-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function SectionError({ message, fallback = "Error" }: { message?: string; fallback?: string }) {
  return (
    <p className="text-xs text-destructive" title={message}>
      {fallback}: {message ?? fallback}
    </p>
  );
}

export function ConsumptionPanel({ environmentId }: { environmentId: string }) {
  const { dict, f } = useI18n();
  const t = dict.consumption;
  const [data, setData] = useState<ConsumptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(
    async (refresh: boolean): Promise<ConsumptionResponse> => {
      const res = await fetch(
        `/api/environments/${environmentId}/consumption${refresh ? "?refresh=1" : ""}`
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? t.errorFetch);
      }
      return body as ConsumptionResponse;
    },
    [environmentId, t.errorFetch]
  );

  useEffect(() => {
    let cancelled = false;
    fetchSummary(false)
      .then((summary) => {
        if (!cancelled) {
          setData(summary);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchSummary]);

  function refresh() {
    setLoading(true);
    setError(null);
    fetchSummary(true)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t.loadingPanel}
      </p>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" />
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { subscription, forecast, capabilities, users } = data.summary;
  const meta = data.meta;
  // Base del % por capacidad: el consumo total de la subscripcion (lo usado
  // del presupuesto), no el costo del entorno.
  const pctBase = subscription.budgetUsed ?? capabilities.totalCost;
  const nearLimit =
    (subscription.budgetPct != null && subscription.budgetPct >= WARN_PCT) ||
    (forecast.budgetPct != null && forecast.budgetPct >= 100);

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">
        {f(t.dataFor, { day: meta.day })}
        {meta.source === "db" ? t.fromDb : t.fromApi}
        {f(t.capturedAt, { capturedAt: new Date(meta.capturedAt).toLocaleString("es-AR") })}
      </p>

      {meta.warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{meta.warning}</span>
        </div>
      )}

      {nearLimit && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            {subscription.budgetPct != null && subscription.budgetPct >= 100
              ? "El consumo ya superó el presupuesto de la subscripción."
              : subscription.budgetPct != null && subscription.budgetPct >= WARN_PCT
                ? `El consumo está al ${formatNumber(subscription.budgetPct, 1)} % del presupuesto.`
                : "El forecast proyecta superar el presupuesto antes del fin del período."}
          </span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.budget}</CardTitle>
            <CardDescription>{t.budgetDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {subscription.ok ? (
              <>
                <p className="text-2xl font-semibold">
                  {formatMoney(subscription.budgetUsed, subscription.currencyCode)}
                </p>
                <p className="text-xs text-muted-foreground">
                  de {formatMoney(subscription.budgetTotal, subscription.currencyCode)}
                  {subscription.budgetPct != null &&
                    ` (${formatNumber(subscription.budgetPct, 1)} %)`}
                </p>
                {subscription.budgetPct != null && <BudgetBar pct={subscription.budgetPct} />}
              </>
            ) : (
              <SectionError message={subscription.error} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.forecastTitle}</CardTitle>
            <CardDescription>
              {forecast.source === "linear" ? t.forecastLinear : t.forecastDynatrace}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {forecast.ok ? (
              <>
                <p className="text-2xl font-semibold">
                  {formatMoney(forecast.median, subscription.currencyCode)}
                </p>
                {forecast.lower != null && forecast.upper != null && (
                  <p className="text-xs text-muted-foreground">
                    rango {formatNumber(forecast.lower)} – {formatNumber(forecast.upper)}
                  </p>
                )}
                {forecast.budgetPct != null && (
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(forecast.budgetPct, 1)} % del presupuesto
                  </p>
                )}
                {forecast.budgetExhaustionDate && (
                  <p className="text-xs font-medium text-amber-600">
                    Presupuesto agotado el {formatDate(forecast.budgetExhaustionDate)}
                  </p>
                )}
              </>
            ) : (
              <SectionError message={forecast.error} fallback={t.unavailable.replace("{message}", t.unknownError)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.subscription}</CardTitle>
            <CardDescription>{subscription.name ?? "—"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {subscription.ok ? (
              <>
                <p>
                  <Badge variant={subscription.status === "ACTIVE" ? "default" : "secondary"}>
                    {subscription.status ?? "?"}
                  </Badge>
                  {subscription.type && (
                    <span className="ml-2 text-xs text-muted-foreground">{subscription.type}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Período: {formatDate(subscription.periodStart)} –{" "}
                  {formatDate(subscription.periodEnd)}
                </p>
                {subscription.daysRemaining != null && (
                  <p className="text-xs text-muted-foreground">
                    Quedan {subscription.daysRemaining} día(s) del período.
                  </p>
                )}
              </>
            ) : (
              <SectionError message={subscription.error} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.users}</CardTitle>
            <CardDescription>{t.account}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {users.ok ? (
              <>
                <p className="text-2xl font-semibold">{users.total}</p>
                <p className="text-xs text-muted-foreground">
                  {users.active} activo(s) · {users.recentlyActive} con login en los últimos {users.recentWindowDays} días
                </p>
              </>
            ) : (
              <SectionError message={users.error} fallback={t.unavailable.replace("{message}", t.unknownError)} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{t.capabilitiesTitle}</CardTitle>
              <CardDescription>
                {capabilities.scope === "environment"
                  ? t.capabilitiesDescEnvironment
                  : t.capabilitiesDescAccount}
                {capabilities.lastModifiedTime &&
                  f(t.lastModified, { date: new Date(capabilities.lastModifiedTime).toLocaleString("es-AR") })}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => {
                refresh();
                toast.info(t.refreshing);
              }}
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
              {t.update}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {capabilities.ok ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.capacity}</TableHead>
                  <TableHead className="text-right">{t.consumption}</TableHead>
                  <TableHead>{t.unit}</TableHead>
                  <TableHead className="text-right">{t.cost}</TableHead>
                  <TableHead className="text-right">{t.pctOfTotal}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {capabilities.rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.usageValue)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.usageUnit ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(row.costValue, row.costCurrency)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {pctBase && row.costValue != null
                        ? `${formatNumber((row.costValue / pctBase) * 100, 1)} %`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {capabilities.rows.length > 0 && (
                  <TableRow>
                    <TableCell className="font-semibold">{t.totalRow}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-semibold">
                      {formatMoney(capabilities.totalCost, capabilities.currencyCode)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {pctBase && capabilities.totalCost != null
                        ? `${formatNumber((capabilities.totalCost / pctBase) * 100, 1)} %`
                        : ""}
                    </TableCell>
                  </TableRow>
                )}
                {capabilities.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      {t.noData}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <SectionError message={capabilities.error} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
