import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocsContext } from "@/lib/server/docsContext";
import { grantDirectShare } from "@/lib/server/dynatraceDocuments";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

const shareSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  access: z.enum(["read", "read-write"]),
  recipients: z
    .array(z.object({ id: z.string().min(1), type: z.enum(["user", "group"]) }))
    .min(1),
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
  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { ids, access, recipients } = parsed.data;
  const { base, token } = result.ctx;

  const results = [];
  for (const dashId of ids) {
    results.push(await grantDirectShare(base, token, dashId, access, recipients, { adminAccess: true }));
  }

  const ok = results.filter((r) => r.ok).length;
  await logActivity({
    type: "DASHBOARD",
    title: "Dashboards compartidos",
    message: `${ok} dashboard(s) compartidos en el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ results, ok, failed: results.length - ok });
}
