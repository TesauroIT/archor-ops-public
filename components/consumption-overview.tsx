"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SubscriptionOverview } from "@/lib/server/dynatraceSubscription";

interface OverviewRow {
  environmentId: string;
  tenantName: string;
  environmentName: string;
  configured: boolean;
  overview: SubscriptionOverview | null;
  day?: string; // dia del snapshot servido
  stale?: boolean; // true si son datos viejos (la API fallo hoy)
}

interface OverviewResponse {
  rows: OverviewRow[];
  generatedAt: string;
}

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

// Semaforo del forecast (mismo criterio que la planilla DPS):
// - verde: 90-100 % del presupuesto (consumo alineado al contrato)
// - ambar: > 100 % (proyecta pasarse del presupuesto)
// - rojo:  < 90 % (subconsumo: se paga capacidad que no se usa)
function forecastCellClass(pct: number | null | undefined): string {
  if (pct == null) return "";
  if (pct > 100) return "bg-amber-400/80 text-amber-950 dark:bg-amber-500/80";
  if (pct >= 90) return "bg-green-500/80 text-green-950 dark:bg-green-600/80";
  return "bg-destructive/80 text-white";
}

export function ConsumptionOverview() {
  const { dict, f } = useI18n();
  const t = dict.consumption;
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchOverview = useCallback(async (refresh: boolean): Promise<OverviewResponse> => {
    const res = await fetch(`/api/consumption${refresh ? "?refresh=1" : ""}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error ?? t.errorFetch);
    return body as OverviewResponse;
  }, [t.errorFetch]);

  useEffect(() => {
    let cancelled = false;
    fetchOverview(false)
      .then((result) => {
        if (!cancelled) {
          setData(result);
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
  }, [fetchOverview]);

  function refresh() {
    setLoading(true);
    setError(null);
    fetchOverview(true)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t.loadingOverview}
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

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            {f(t.dataAt, { generatedAt: new Date(data.generatedAt).toLocaleString("es-AR") })}
          </p>
          <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            {t.refresh}
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.client}</TableHead>
              <TableHead>{t.environment}</TableHead>
              <TableHead className="text-right">{t.used}</TableHead>
              <TableHead className="text-right">{t.total}</TableHead>
              <TableHead className="text-right">{t.usage}</TableHead>
              <TableHead>{t.contractStart}</TableHead>
              <TableHead>{t.contractEnd}</TableHead>
              <TableHead className="text-right">{t.forecast}</TableHead>
              <TableHead>{t.forecastBudgetExhausted}</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.environmentId}>
                <TableCell className="font-medium">{row.tenantName}</TableCell>
                <TableCell>
                  <Link
                    href={`/environments/${row.environmentId}/consumption`}
                    className="hover:underline"
                  >
                    {row.environmentName}
                  </Link>
                  {row.stale && (
                    <span className="ml-2 text-xs text-amber-600" title={t.stale.replace("{day}", row.day ?? "")}>
                      {f(t.stale, { day: row.day ?? "" })}
                    </span>
                  )}
                </TableCell>
                {!row.configured ? (
                  <TableCell colSpan={7} className="text-xs text-muted-foreground">
                    {t.missingCreds}
                  </TableCell>
                ) : !row.overview?.ok ? (
                  <TableCell colSpan={7} className="text-xs text-destructive">
                    {row.overview?.error ?? t.subscriptionError}
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right">
                      {formatMoney(row.overview.used, row.overview.currencyCode)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(row.overview.total, row.overview.currencyCode)}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.overview.usagePct != null
                        ? `${formatNumber(row.overview.usagePct, 2)} %`
                        : "—"}
                    </TableCell>
                    <TableCell>{formatDate(row.overview.startTime)}</TableCell>
                    <TableCell>{formatDate(row.overview.endTime)}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${forecastCellClass(row.overview.forecastPct)}`}
                      title={
                        row.overview.forecastSource === "linear"
                          ? t.forecastLinear
                          : t.forecastDynatrace
                      }
                    >
                      {row.overview.forecastPct != null
                        ? `${formatNumber(row.overview.forecastPct, 2)} %`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.overview.forecastPct != null && row.overview.forecastPct < 100
                        ? "Forecast menor al presupuesto"
                        : formatDate(row.overview.forecastBudgetDate)}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right">
                  <Link
                    href={`/environments/${row.environmentId}/consumption`}
                    title={dict.envUsers.viewTitle}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    <Eye className="size-3.5" />
                    {dict.envUsers.view}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {data.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">
                  {t.noEnvs}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
