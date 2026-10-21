import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { downloadContent, createDocument } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Copia los dashboards seleccionados del entorno [id] (origen) a otro entorno
// (destino): baja el JSON del origen y crea un documento nuevo en el destino.
const schema = z.object({
  targetEnvironmentId: z.string().min(1),
  items: z
    .array(z.object({ id: z.string().min(1), name: z.string().optional(), type: z.string().optional() }))
    .min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { targetEnvironmentId, items } = parsed.data;

  if (targetEnvironmentId === id) {
    return NextResponse.json({ error: "El destino debe ser un entorno distinto." }, { status: 400 });
  }

  const source = await getDocsContext(id);
  if ("error" in source) return NextResponse.json({ error: source.error }, { status: source.status });
  const target = await getDocsContext(targetEnvironmentId);
  if ("error" in target) {
    return NextResponse.json(
      { error: `Destino: ${target.error}` },
      { status: target.status }
    );
  }

  const results: { id: string; ok: boolean; status: number; message?: string; newId?: string }[] = [];
  for (const item of items) {
    const dl = await downloadContent(source.ctx.base, source.ctx.token, item.id, { adminAccess: true });
    if (!dl.ok) {
      results.push({ id: item.id, ok: false, status: dl.status, message: `Bajar: ${dl.message}` });
      continue;
    }
    const created = await createDocument(target.ctx.base, target.ctx.token, {
      name: item.name ?? "Untitled dashboard",
      type: item.type ?? "dashboard",
      content: dl.content,
      contentType: dl.contentType,
    });
    if (created.ok) {
      results.push({ id: item.id, ok: true, status: 201, newId: created.id });
    } else {
      results.push({ id: item.id, ok: false, status: created.status, message: `Crear: ${created.message}` });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  await logActivity({
    type: "DASHBOARD",
    title: "Dashboards copiados",
    message: `Se copiaron ${ok} dashboard(s) desde el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results, ok, failed: results.length - ok });
}
