import { NextResponse } from "next/server";
import { getDocsContext } from "@/lib/server/docsContext";
import { listDashboards } from "@/lib/server/dynatraceDocuments";
import { resolveUsers } from "@/lib/server/dynatraceAccount";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getDocsContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  try {
    const dashboards = await listDashboards(result.ctx.base, result.ctx.token, {
      adminAccess: true,
    });

    // Resolver SSO id -> email si hay credenciales IAM (tolerante a fallos).
    let byUid: Record<string, string> = {};
    let users: { uid: string; email: string }[] = [];
    let iamError: string | null = null;
    if (result.ctx.iam) {
      const resolved = await resolveUsers(result.ctx.iam);
      if (resolved.ok) {
        byUid = resolved.byUid;
        users = resolved.users;
      } else {
        iamError = resolved.error ?? "No se pudieron resolver los correos.";
      }
    }

    const enriched = dashboards.map((d) => ({ ...d, ownerEmail: byUid[d.owner] ?? null }));

    // Resumen por owner (con email si esta disponible).
    const byOwner = new Map<string, number>();
    for (const d of dashboards) byOwner.set(d.owner, (byOwner.get(d.owner) ?? 0) + 1);
    const owners = Array.from(byOwner.entries())
      .map(([owner, count]) => ({ owner, count, email: byUid[owner] ?? null }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      dashboards: enriched,
      owners,
      users, // para el selector de nuevo owner por correo
      total: dashboards.length,
      iamConfigured: !!result.ctx.iam,
      iamError,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
