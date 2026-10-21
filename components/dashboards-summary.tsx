"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/context";

interface Dashboard {
  id: string;
  name: string;
  version: string | number;
  owner: string;
  ownerEmail?: string | null;
  isPrivate?: boolean;
}

interface OwnerSummary {
  owner: string;
  count: number;
  email?: string | null;
}

function short(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function ver(v: string | number): number {
  return typeof v === "number" ? v : Number(v) || 0;
}

// Tarjeta-estadistica compacta.
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

export function DashboardsSummary({
  dashboards,
  owners,
}: {
  dashboards: Dashboard[];
  owners: OwnerSummary[];
}) {
  const { dict, f } = useI18n();
  const t = dict.dashboards;

  const total = dashboards.length;
  const publicos = dashboards.filter((d) => d.isPrivate === false).length;
  const privados = total - publicos;
  const untitled = dashboards.filter((d) => /untitled|sin t[ií]tulo/i.test(d.name)).length;

  const versions = dashboards.map((d) => ver(d.version));
  const maxVer = versions.length ? Math.max(...versions) : 0;
  const avgVer = versions.length
    ? Math.round((versions.reduce((a, b) => a + b, 0) / versions.length) * 10) / 10
    : 0;

  // Ranking: mas versiones = mas editados (proxy de "mas trabajado/vivo").
  const topVersions = [...dashboards].sort((a, b) => ver(b.version) - ver(a.version)).slice(0, 8);

  const topOwners = owners.slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.summaryTitle}</CardTitle>
        <CardDescription>
          {f(t.summaryDescription, { total })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={t.statTotal} value={total} />
          <Stat label={t.statPublic} value={publicos} hint={t.statPublicHint} />
          <Stat label={t.statPrivate} value={privados} hint={t.statPrivateHint} />
          <Stat label={t.statUntitled} value={untitled} hint={t.statUntitledHint} />
          <Stat label={t.statMaxVer} value={maxVer} />
          <Stat label={t.statAvgVer} value={avgVer} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Ranking por versiones */}
          <div>
            <p className="mb-2 text-sm font-medium">{t.mostEdited}</p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colDashboard}</TableHead>
                    <TableHead className="text-right">{t.colVersions}</TableHead>
                    <TableHead>{t.colOwner}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topVersions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="max-w-[16rem] truncate" title={d.name}>
                        {d.name}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Badge variant="secondary">{ver(d.version)}</Badge>
                      </TableCell>
                      <TableCell
                        className="max-w-[12rem] truncate text-xs"
                        title={d.ownerEmail ?? d.owner}
                      >
                        {d.ownerEmail ?? short(d.owner)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Top owners */}
          <div>
            <p className="mb-2 text-sm font-medium">{t.topOwners}</p>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colOwner}</TableHead>
                    <TableHead className="text-right">{t.colDashboardsCount}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topOwners.map((o) => (
                    <TableRow key={o.owner}>
                      <TableCell
                        className="max-w-[18rem] truncate text-xs"
                        title={o.email ?? o.owner}
                      >
                        {o.email ?? short(o.owner)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Badge variant="secondary">{o.count}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
