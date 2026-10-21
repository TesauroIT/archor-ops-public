"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Folder, FileText, ArrowLeft, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";

interface DirEntry {
  name: string;
  type: "dir" | "file";
  size: number;
  fileCount?: number;
}

type BrowseResult =
  | { type: "dir"; path: string; entries: DirEntry[] }
  | { type: "file"; path: string; size: number; truncated: boolean; binary: boolean; content: string };

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

function parentOf(rel: string): string {
  if (!rel) return "";
  const parts = rel.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function FileBrowser({ environmentId }: { environmentId: string }) {
  const { dict, f } = useI18n();
  const t = dict.fileBrowser;
  const [rel, setRel] = useState("");
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/environments/${environmentId}/files?path=${encodeURIComponent(target)}`
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "No se pudo leer.");
          return;
        }
        setResult(data);
        setRel(target);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [environmentId]
  );

  useEffect(() => {
    let active = true;
    setTimeout(() => {
      if (active) {
        load("");
      }
    }, 0);
    return () => {
      active = false;
    };
  }, [load]);

  const crumbs = rel.split("/").filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button className="text-muted-foreground hover:underline" onClick={() => load("")}>
            {t.root}
          </button>
          {crumbs.map((crumb, i) => {
            const partial = crumbs.slice(0, i + 1).join("/");
            return (
              <span key={partial} className="flex items-center gap-1">
                <span className="text-muted-foreground">/</span>
                <button className="hover:underline" onClick={() => load(partial)}>
                  {crumb}
                </button>
              </span>
            );
          })}
        </div>
        <a href={`/api/environments/${environmentId}/download`}>
          <Button variant="outline" size="sm">
            <Download className="mr-1" /> {t.downloadZip}
          </Button>
        </a>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">{t.loading}</p>}

      {result?.type === "dir" && (
        <div className="rounded-md border">
          {rel && (
            <button
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-sm hover:bg-muted"
              onClick={() => load(parentOf(rel))}
            >
              <ArrowLeft className="size-4" /> ..
            </button>
          )}
          {result.entries.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t.emptyFolder}
            </p>
          )}
          {result.entries.map((entry) => (
            <button
              key={entry.name}
              className="flex w-full items-center justify-between border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
              onClick={() => load(rel ? `${rel}/${entry.name}` : entry.name)}
            >
              <span className="flex items-center gap-2">
                {entry.type === "dir" ? (
                  <Folder className="size-4 text-muted-foreground" />
                ) : (
                  <FileText className="size-4 text-muted-foreground" />
                )}
                {entry.name}
              </span>
              {entry.type === "file" ? (
                <span className="text-xs text-muted-foreground">{formatBytes(entry.size)}</span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {entry.fileCount === 1 ? t.fileCountSingle : f(t.filesCount, { count: entry.fileCount ?? 0 })}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {result?.type === "file" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(result.size)}</span>
            {result.truncated && <span>· mostrando los primeros 512 KB</span>}
            <a
              href={`/api/environments/${environmentId}/download`}
              className="ml-auto underline"
            >
              {t.downloadAll}
            </a>
          </div>
          {result.binary ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {t.binaryFile}
            </p>
          ) : (
            <ScrollArea className="h-80 rounded-md border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap font-mono text-xs">{result.content}</pre>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
