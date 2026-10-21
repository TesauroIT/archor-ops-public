import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { setDocumentPublic } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Hace publicos (o privados) los dashboards seleccionados. Publico = legible por
// todos en el entorno de inmediato (isPrivate=false). Necesita la version de
// cada documento (optimistic locking).
const schema = z.object({
  // version puede venir como number (asi la devuelve la Document API) o string.
  items: z
    .array(z.object({ id: z.string().min(1), version: z.union([z.string(), z.number()]) }))
    .min(1),
  public: z.boolean(),
});

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

  const { items, public: makePublic } = parsed.data;
  const { base, token } = result.ctx;

  const results = [];
  for (const item of items) {
    results.push(
      await setDocumentPublic(base, token, item.id, String(item.version), makePublic, {
        adminAccess: true,
      })
    );
  }

  const ok = results.filter((r) => r.ok).length;
  await logActivity({
    type: "DASHBOARD",
    title: makePublic ? "Dashboards públicos" : "Dashboards privados",
    message: `${ok} dashboard(s) ${makePublic ? "publicados" : "privados"} en el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results, ok, failed: results.length - ok });
}
