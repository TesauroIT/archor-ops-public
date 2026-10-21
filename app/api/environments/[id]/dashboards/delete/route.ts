import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { trashDocuments } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Mueve los dashboards seleccionados a la papelera (recuperable 30 dias).
// Requiere que el Platform token tenga el scope document:documents:delete.
const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const result = await getDocsContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { base, token } = result.ctx;
  const res = await trashDocuments(base, token, parsed.data.ids, { adminAccess: true });
  if (!res.ok) {
    const hint =
      res.status === 403
        ? " (el Platform token necesita el scope document:documents:delete)"
        : "";
    return NextResponse.json({ error: `${res.message ?? "Fallo el borrado."}${hint}` }, { status: res.status || 502 });
  }
  const ok = res.results.filter((r) => r.code < 300).length;
  await logActivity({
    type: "DASHBOARD",
    title: "Dashboards enviados a papelera",
    message: `Se movieron ${ok} dashboard(s) a la papelera del entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results: res.results, ok, failed: res.results.length - ok });
}
