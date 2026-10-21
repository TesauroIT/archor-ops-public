import { NextResponse } from "next/server";
import { getLookupContext } from "@/lib/server/lookupContext";
import { downloadLookup } from "@/lib/server/dynatraceResourceStore";

// Descarga (baja) el contenido de un lookup via DQL: load "<path>".
// Query params: ?path=/lookups/xyz  &format=json|csv  (default json).
// Requiere storage:buckets:read + permisos de lectura para ejecutar DQL.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLookupContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (!path) {
    return NextResponse.json({ error: "Falta el parametro ?path=/lookups/..." }, { status: 400 });
  }

  const res = await downloadLookup(result.ctx.appsHost, result.ctx.token, path);
  if (!res.ok) {
    const hint =
      res.status === 403
        ? " (el Platform token necesita storage:buckets:read para ejecutar DQL)"
        : "";
    return NextResponse.json({ error: `${res.message}${hint}` }, { status: res.status || 502 });
  }

  const baseName = path.split("/").filter(Boolean).pop() || "lookup";

  if (format === "csv") {
    const csv = toCsv(res.records);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseName}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(JSON.stringify(res.records, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${baseName}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

// Serializa registros a CSV. Toma las columnas de la union de claves de todos
// los registros para no perder campos dispersos.
function toCsv(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";
  const cols = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const escape = (v: unknown): string => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(",");
  const rows = records.map((r) => cols.map((c) => escape(r[c])).join(","));
  return [header, ...rows].join("\n");
}
