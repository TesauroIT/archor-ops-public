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
import type { GroupRow } from "@/lib/server/dynatraceGroups";
import type { UsersReport } from "@/lib/server/dynatraceUsers";

interface UsersResponse {
  report: UsersReport;
  meta: { source: "db" | "api"; day: string; capturedAt: string; warning?: string };
}

type SortKey =
  | "name"
  | "members"
  | "people"
  | "service"
  | "permissions"
  | "scopes"
  | "owner"
  | "created";

const SORTERS: Sorters<GroupRow, SortKey> = {
  name: (g) => g.name.toLowerCase(),
  members: (g) => g.members,
  people: (g) => g.people,
  service: (g) => g.serviceAccounts,
  permissions: (g) => g.permissions,
  scopes: (g) => g.scopeTypes.join(",") || null,
  owner: (g) => g.owner,
  created: (g) => (g.createdAt ? new Date(g.createdAt).getTime() : null),
};

const NUMERIC_KEYS: ReadonlySet<SortKey> = new Set<SortKey>([
  "members",
  "people",
  "service",
  "permissions",
  "created",
]);

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("es-AR");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-AR");
}

export function GroupsPanel({
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
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "members", dir: "desc" });

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

  const groups = data?.report.groups;

  const filtered = useMemo(() => {
    if (!groups?.rows) return [];
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? groups.rows.filter((g) =>
          [g.name, g.description ?? "", g.owner, g.scopeTypes.join(" "), g.permissionNames.join(" ")]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        )
      : groups.rows;
    return sortRows(rows, SORTERS, sort, (g) => g.name);
  }, [groups, query, sort]);

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

  if (!data || !groups) return null;

  if (!groups.ok) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="flex items-start gap-2 text-sm text-amber-600">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {f(t.groupsUnavailable, { message: groups.error ?? t.unknownError })}
          </p>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" />
            {t.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const meta = data.meta;

  function ownerLabel(owner: string): string {
    if (owner === "SAML") return t.gOwnerSaml;
    if (owner === "ALL_USERS") return t.gOwnerAll;
    return t.gOwnerLocal;
  }

  function handleDownload() {
    const rows: (string | number | null)[][] = [
      [
        t.gColName,
        t.gColUsers,
        t.gColPeople,
        t.gColService,
        t.gColPerms,
        t.gColScopes,
        t.gColOwner,
        t.gColCreated,
        t.gColPermNames,
      ],
      ...filtered.map((g) => [
        g.name,
        g.members,
        g.people,
        g.serviceAccounts,
        g.permissions,
        g.scopeTypes.join(", "),
        g.owner,
        g.createdAt,
        g.permissionNames.join(", "),
      ]),
    ];
    downloadCsv(csvFilename("grupos", environmentName, meta.day), toCsv(rows));
  }

  const sortHead = (key: SortKey, label: string, align?: "right") => (
    <SortHead
      sortKey={key}
      label={label}
      title={f(t.sortBy, { col: label })}
      align={align}
      current={sort}
      onSort={(k) => setSort((c) => nextSort(c, k, NUMERIC_KEYS))}
    />
  );

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

      {!groups.permissionsOk && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>{t.gPermsPartial}</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.gTotal}</CardTitle>
            <CardDescription>{t.gTotalDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatNumber(groups.total)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.gNoPerms}</CardTitle>
            <CardDescription>{t.gNoPermsDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatNumber(groups.withoutPermissions)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.gEmpty}</CardTitle>
            <CardDescription>{t.gEmptyDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{formatNumber(groups.empty)}</p>
            {groups.withPermissionsNoMembers > 0 && (
              <p className="text-xs text-amber-600">
                {formatNumber(groups.withPermissionsNoMembers)} con permisos
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t.gService}</CardTitle>
            <CardDescription>{t.gServiceDesc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-2xl font-semibold">{formatNumber(groups.serviceAccounts)}</p>
            {groups.onlyServiceAccounts > 0 && (
              <p className="text-xs text-muted-foreground">
                {formatNumber(groups.onlyServiceAccounts)} grupo(s) solo con servicio
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>{t.groupsTitle}</CardTitle>
              <CardDescription>{t.groupsDesc}</CardDescription>
            </div>
            <div className="flex w-full max-w-md items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.gSearch}
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
                {sortHead("name", t.gColName)}
                {sortHead("members", t.gColUsers, "right")}
                {sortHead("people", t.gColPeople, "right")}
                {sortHead("service", t.gColService, "right")}
                {sortHead("permissions", t.gColPerms, "right")}
                {sortHead("scopes", t.gColScopes)}
                {sortHead("owner", t.gColOwner)}
                {sortHead("created", t.gColCreated)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((g) => (
                <TableRow key={g.uuid}>
                  <TableCell className="font-medium">
                    <div title={g.description ?? undefined}>{g.name}</div>
                    {g.federatedValues.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {f(t.gFederated, { values: g.federatedValues.join(", ") })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatNumber(g.members)}</TableCell>
                  <TableCell className="text-right">{formatNumber(g.people)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {g.serviceAccounts > 0 ? formatNumber(g.serviceAccounts) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {g.permissions === 0 ? (
                      <span className="text-muted-foreground">{t.gNoPermsRow}</span>
                    ) : (
                      // Los nombres completos van en el title: un grupo llega
                      // a 37 permisos y no entran en la celda.
                      <span title={g.permissionNames.join("\n")}>{formatNumber(g.permissions)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {g.scopeTypes.join(", ") || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.owner === "LOCAL" ? "outline" : "secondary"}>
                      {ownerLabel(g.owner)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(g.createdAt)}</TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    {groups.total === 0 ? t.gNoGroups : t.gNoMatches}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            {f(t.showingOf, { shown: filtered.length, total: groups.total })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
