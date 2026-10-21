"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  SortHead,
  nextSort,
  sortRows,
  type SortState,
  type Sorters,
} from "@/components/ui/sort-head";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv";
import type { AccountUserFull, UsersReport } from "@/lib/server/dynatraceUsers";

interface UsersMeta {
  source: "db" | "api";
  day: string;
  capturedAt: string;
  warning?: string;
}

interface UsersResponse {
  report: UsersReport;
  meta: UsersMeta;
}

// Mismas ventanas que calcula el servidor (lib/server/dynatraceUsers.ts).
const WINDOWS = ["7", "30", "90"] as const;

type SortKey = "user" | "email" | "domain" | "groups" | "status" | "created" | "lastLogin" | "logins";

// Valor por el que ordena cada columna. null = "sin dato", y esos van siempre
// al final sin importar la direccion.
const SORTERS: Sorters<AccountUserFull, SortKey> = {
  user: (u) => [u.name, u.surname].filter(Boolean).join(" ").toLowerCase() || null,
  email: (u) => u.email.toLowerCase(),
  domain: (u) => u.domain || null,
  groups: (u) => u.groups.length,
  status: (u) => u.userStatus,
  created: (u) => (u.createdAt ? new Date(u.createdAt).getTime() : null),
  lastLogin: (u) => (u.lastSuccessfulLogin ? new Date(u.lastSuccessfulLogin).getTime() : null),
  logins: (u) => u.successfulLoginCounter,
};

// Al cambiar de columna, el primer clic ordena en la direccion que mas suele
// interesar: descendente en numeros y fechas (lo mas alto / mas reciente
// primero), ascendente en texto (alfabetico).
const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  "groups",
  "created",
  "lastLogin",
  "logins",
]);

function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null) return "—";
  return value.toLocaleString("es-AR", { maximumFractionDigits: digits });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-AR");
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-AR");
}

function statusVariant(status: string | null): "default" | "secondary" | "outline" {
  const upper = status?.toUpperCase();
  if (upper === "ACTIVE") return "default";
  if (upper === "PENDING") return "secondary";
  return "outline";
}

export function UsersPanel({
  environmentId,
  environmentName,
}: {
  environmentId: string;
  environmentName?: string;
}) {
  const { dict, f } = useI18n();
  const t = dict.envUsers;
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({
    key: "lastLogin",
    dir: "desc",
  });

  function toggleSort(key: SortKey) {
    setSort((current) => nextSort(current, key, NUMERIC_KEYS));
  }

  const fetchReport = useCallback(
    async (refresh: boolean): Promise<UsersResponse> => {
      const res = await fetch(
        `/api/environments/${environmentId}/users${refresh ? "?refresh=1" : ""}`
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? t.errorFetch);
      return body as UsersResponse;
    },
    [environmentId, t.errorFetch]
  );

  useEffect(() => {
    let cancelled = false;
    fetchReport(false)
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
  }, [fetchReport]);

  function refresh() {
    setLoading(true);
    setError(null);
    fetchReport(true)
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  const report = data?.report;

  // Orden por defecto: ultimo login descendente, que deja arriba a quien esta
  // usando la plataforma. Los nulos (nunca entro, sin fecha de alta) van
  // siempre al final, en las dos direcciones: son "sin dato", no un extremo.
  const filtered = useMemo(() => {
    if (!report) return [];
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? report.users.filter((u) =>
          [u.email, u.name ?? "", u.surname ?? "", u.domain, u.groups.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : report.users;

    return sortRows(rows, SORTERS, sort, (u) => u.email);
  }, [report, query, sort]);

  if (loading && !data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t.loading}
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

  if (!data || !report) return null;

  const meta = data.meta;
  const active = report.byStatus.ACTIVE ?? 0;
  const pending = report.byStatus.PENDING ?? 0;

  const sortHead = (key: SortKey, label: string, align?: "right") => (
    <SortHead
      sortKey={key}
      label={label}
      title={f(t.sortBy, { col: label })}
      align={align}
      current={sort}
      onSort={toggleSort}
    />
  );

  // Exporta lo que esta a la vista: mismas columnas y mismo orden que la
  // tabla, y filtrado por el buscador. Las fechas van en ISO crudo (no
  // localizadas) para que no haya ambiguedad dia/mes al abrir el archivo, y
  // los contadores de login se separan en dos columnas porque en la tabla se
  // muestran juntos.
  function handleDownload() {
    const rows: (string | number | null)[][] = [
      [
        t.colUser,
        t.colEmail,
        t.colDomain,
        t.colGroupCount,
        t.colGroups,
        t.colStatus,
        t.colCreated,
        t.colLastLogin,
        t.colLogins,
        t.colFailedLogins,
      ],
      ...filtered.map((u) => [
        [u.name, u.surname].filter(Boolean).join(" "),
        u.email,
        u.domain,
        u.groups.length,
        // Separados por ", " dentro de una sola celda: el campo va
        // entrecomillado, asi que las comas no rompen el CSV.
        u.groups.join(", "),
        u.userStatus,
        u.createdAt,
        u.lastSuccessfulLogin,
        u.successfulLoginCounter ?? 0,
        u.failedLoginCounter ?? 0,
      ]),
    ];
    downloadCsv(csvFilename("usuarios", environmentName, meta.day), toCsv(rows));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {f(t.dataFor, { day: meta.day })}
          {meta.source === "db" ? t.fromDb : t.fromApi}
          {f(t.capturedAt, { capturedAt: new Date(meta.capturedAt).toLocaleString("es-AR") })}
        </p>
        <Button variant="outline" size="sm" disabled={loading} onClick={refresh}>
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {t.refresh}
        </Button>
      </div>

      {meta.warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{meta.warning}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.totalTitle}</CardTitle>
            <CardDescription>{t.totalDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{formatNumber(report.total)}</p>
            <p className="text-xs text-muted-foreground">
              {f(t.statusLine, { active, pending })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.newTitle}</CardTitle>
            <CardDescription>{t.newDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{formatNumber(report.newUsers["7"])}</p>
            {WINDOWS.map((days) => (
              <p key={days} className="text-xs text-muted-foreground">
                {f(t.newWindow, { count: report.newUsers[days] ?? 0, days })}
              </p>
            ))}
            {report.withoutCreatedAt > 0 && (
              <p className="text-xs text-amber-600">
                {f(t.noCreatedAt, { count: report.withoutCreatedAt })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.activityTitle}</CardTitle>
            <CardDescription>{t.activityDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">
              {formatNumber(report.activity.loggedIn["7"])}
            </p>
            {WINDOWS.map((days) => (
              <p key={days} className="text-xs text-muted-foreground">
                {f(t.activeWindow, { count: report.activity.loggedIn[days] ?? 0, days })}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              {f(t.neverLoggedIn, { count: report.activity.neverLoggedIn })}
            </p>
            {report.activity.lastLoginAt && (
              <p className="text-xs text-muted-foreground">
                {f(t.lastLogin, { date: formatDateTime(report.activity.lastLoginAt) })}
              </p>
            )}
            {report.activity.totalFailedLogins > 0 && (
              <p className="text-xs text-muted-foreground">
                {f(t.failedLogins, {
                  failed: formatNumber(report.activity.totalFailedLogins),
                  users: report.activity.usersWithFailedLogins,
                })}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.domainsTitle}</CardTitle>
            <CardDescription>{t.domainsDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{formatNumber(report.domains.length)}</p>
            <p className="text-xs text-muted-foreground">
              {f(t.domainsSummary, {
                shared: report.sharedDomains,
                single: report.singleUserDomains,
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.domainsTitle}</CardTitle>
          <CardDescription>
            {f(t.domainsSummary, {
              shared: report.sharedDomains,
              single: report.singleUserDomains,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.domain}</TableHead>
                <TableHead className="text-right">{t.usersCount}</TableHead>
                <TableHead className="text-right">{t.share}</TableHead>
                <TableHead className="text-right">{t.domainActive}</TableHead>
                <TableHead className="text-right">{f(t.domainRecent, { days: 7 })}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.domains.map((d) => (
                <TableRow key={d.domain}>
                  <TableCell className="font-medium">
                    {d.domain || "—"}
                    {d.shared && (
                      <Badge variant="secondary" className="ml-2">
                        {t.sharedBadge}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(d.count)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatNumber(d.pct, 1)} %
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(d.active)}</TableCell>
                  <TableCell className="text-right">{formatNumber(d.loggedInRecently)}</TableCell>
                </TableRow>
              ))}
              {report.domains.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    {t.noUsers}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>{t.listTitle}</CardTitle>
              <CardDescription>
                {f(t.listDesc, { total: report.total })}
                {report.groups.ok ? (
                  <>
                    {" "}
                    {f(t.groupsSummary, {
                      total: report.groups.total,
                      empty: report.groups.empty,
                      without: report.groups.usersWithoutGroup,
                    })}
                  </>
                ) : (
                  <span className="text-amber-600">
                    {" "}
                    {f(t.groupsUnavailable, { message: report.groups.error ?? t.unknownError })}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex w-full max-w-md items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.search}
                  className="pl-8"
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={filtered.length === 0}
                title={t.downloadTitle}
              >
                <Download className="size-3.5" />
                {t.download}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                {sortHead("user", t.colUser)}
                {sortHead("email", t.colEmail)}
                {sortHead("domain", t.colDomain)}
                {sortHead("groups", t.colGroups)}
                {sortHead("status", t.colStatus)}
                {sortHead("created", t.colCreated)}
                {sortHead("lastLogin", t.colLastLogin)}
                {sortHead("logins", t.colLogins, "right")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.uid}>
                  <TableCell className="font-medium">
                    {[u.name, u.surname].filter(Boolean).join(" ") || "—"}
                  </TableCell>
                  <TableCell className="text-xs">{u.email}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{u.domain}</TableCell>
                  <TableCell className="text-xs">
                    {!report.groups.ok ? (
                      <span className="text-muted-foreground">—</span>
                    ) : u.groups.length === 0 ? (
                      <span className="text-muted-foreground">{t.noGroup}</span>
                    ) : (
                      // La lista completa va en el title: con hasta 65 grupos
                      // por usuario, renderizarla entera rompe la fila.
                      <div className="flex items-center gap-1.5" title={u.groups.join("\n")}>
                        <Badge variant="secondary">{u.groups.length}</Badge>
                        <span className="max-w-[14rem] truncate text-muted-foreground">
                          {u.groups.join(", ")}
                        </span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(u.userStatus)}>{u.userStatus ?? "?"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(u.createdAt)}</TableCell>
                  <TableCell className="text-xs">
                    {u.lastSuccessfulLogin ? formatDateTime(u.lastSuccessfulLogin) : t.never}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {formatNumber(u.successfulLoginCounter)}
                    {(u.failedLoginCounter ?? 0) > 0 && (
                      <span className="ml-1 text-muted-foreground">
                        / {formatNumber(u.failedLoginCounter)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    {report.total === 0 ? t.noUsers : t.noMatches}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            {f(t.showingOf, { shown: filtered.length, total: report.total })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
