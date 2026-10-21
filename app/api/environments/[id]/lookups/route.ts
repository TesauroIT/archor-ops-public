import { NextResponse } from "next/server";
import { getLookupContext } from "@/lib/server/lookupContext";
import { listLookupFiles } from "@/lib/server/dynatraceResourceStore";

// Lista los archivos de lookup del entorno (via DQL: fetch dt.system.files).
// Opcional ?prefix=/lookups/ para acotar la ruta.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLookupContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const prefix = new URL(request.url).searchParams.get("prefix") ?? "/lookups/";
  const res = await listLookupFiles(result.ctx.appsHost, result.ctx.token, prefix);
  if (!res.ok) {
    const hint =
      res.status === 403
        ? " (el Platform token necesita storage:buckets:read + storage:files:read para ejecutar DQL)"
        : "";
    return NextResponse.json({ error: `${res.message}${hint}` }, { status: res.status || 502 });
  }
  return NextResponse.json({ files: res.files, total: res.files.length });
}
