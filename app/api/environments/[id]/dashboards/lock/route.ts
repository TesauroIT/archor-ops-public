import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { lockDocument, unlockDocument } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Bloquea o desbloquea los dashboards seleccionados. El lock es del usuario del
// token (max 5 documentos, hasta 15 min). El desbloqueo solo lo puede hacer
// quien tiene el lock.
const schema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  action: z.enum(["lock", "unlock"]),
  durationMinutes: z.number().int().min(1).max(15).optional(),
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

  const { ids, action, durationMinutes } = parsed.data;
  const { base, token } = result.ctx;
  const durationSeconds = (durationMinutes ?? 10) * 60;

  const results = [];
  for (const dashId of ids) {
    results.push(
      action === "lock"
        ? await lockDocument(base, token, dashId, durationSeconds, { adminAccess: true })
        : await unlockDocument(base, token, dashId, { adminAccess: true })
    );
  }

  const ok = results.filter((r) => r.ok).length;
  await logActivity({
    type: "DASHBOARD",
    title: action === "lock" ? "Dashboards bloqueados" : "Dashboards desbloqueados",
    message: `${ok} dashboard(s) ${action === "lock" ? "bloqueados" : "desbloqueados"} en el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results, ok, failed: results.length - ok });
}
