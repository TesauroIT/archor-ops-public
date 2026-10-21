import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { transferOwner } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

const transferSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  newOwnerId: z.string().min(1),
  sendNotification: z.boolean().optional().default(false),
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
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, newOwnerId, sendNotification } = parsed.data;
  const { base, token } = result.ctx;

  // Secuencial para no golpear rate limits del tenant.
  const results = [];
  for (const dashId of ids) {
    results.push(
      await transferOwner(base, token, dashId, newOwnerId, {
        adminAccess: true,
        sendNotification,
      })
    );
  }

  const ok = results.filter((r) => r.ok).length;
  await logActivity({
    type: "DASHBOARD",
    title: "Propiedad de dashboards transferida",
    message: `${ok} dashboard(s) transferidos en el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results, ok, failed: results.length - ok });
}
