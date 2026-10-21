"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useI18n } from "@/lib/i18n/context";

export interface ConfigTypeStat {
  name: string;
  files: number;
  bytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

const TOP_N = 12;

export function TopConfigsCard({ stats }: { stats: ConfigTypeStat[] }) {
  const { dict, f } = useI18n();
  const t = dict.topConfigsCard;
  const [showAll, setShowAll] = useState(false);

  if (stats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.title}</CardTitle>
          <CardDescription>{t.descriptionEmpty}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t.noBackup}
          </p>
        </CardContent>
      </Card>
    );
  }

  const top = stats.slice(0, TOP_N);
  const maxFiles = Math.max(...top.map((s) => s.files), 1);
  const rows = showAll ? stats : stats.slice(0, TOP_N);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>
          {f(t.descriptionStats, { count: stats.length })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Grafico de barras horizontales (top N por cantidad de archivos) */}
        <div className="space-y-1.5">
          {top.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="w-56 shrink-0 truncate text-xs" title={s.name}>
                {s.name}
              </span>
              <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${(s.files / maxFiles) * 100}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums">{s.files}</span>
            </div>
          ))}
        </div>

        {/* Tabla completa (todos los tipos), scrollable */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{t.detailTitle}</span>
            {stats.length > TOP_N && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? t.showTop : f(t.showAll, { count: stats.length })}
              </Button>
            )}
          </div>
          <ScrollArea className={showAll ? "h-80 rounded-md border" : "rounded-md border"}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colType}</TableHead>
                  <TableHead className="text-right">{t.colFiles}</TableHead>
                  <TableHead className="text-right">{t.colSize}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-mono text-xs">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.files}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatBytes(s.bytes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
