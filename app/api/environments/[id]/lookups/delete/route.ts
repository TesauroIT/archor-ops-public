import { NextResponse } from "next/server";
import { z } from "zod";
import { getLookupContext } from "@/lib/server/lookupContext";
import { deleteLookup } from "@/lib/server/dynatraceResourceStore";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Borra un archivo de lookup por su ruta. Requiere storage:files:delete.
const schema = z.object({ filePath: z.string().min(1).regex(/^\/lookups\/.+/) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const result = await getLookupContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const res = await deleteLookup(result.ctx.appsHost, result.ctx.token, parsed.data.filePath);
  if (!res.ok) {
    const hint = res.status === 403 ? " (el Platform token necesita storage:files:delete)" : "";
    return NextResponse.json({ error: `${res.message}${hint}` }, { status: res.status || 502 });
  }

  await logActivity({
    type: "LOOKUP",
    title: "Lookup borrado",
    message: `Se borro el lookup ${parsed.data.filePath} del entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ ok: true, filePath: parsed.data.filePath });
}
