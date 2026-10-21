import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Persistencia del analisis de IA por dashboard, para no perderlo al cerrar.
// GET  -> lista los analisis guardados del entorno.
// POST -> guarda (upsert) una tanda de analisis.

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await prisma.dashboardAnalysis.findMany({
    where: { environmentId: id },
    orderBy: { analyzedAt: "desc" },
  });
  const analyses = rows.map((r) => ({
    dashboardId: r.dashboardId,
    name: r.name,
    verdict: r.verdict,
    reason: r.reason,
    tileCount: r.tileCount,
    tileTitles: safeParse(r.tileTitles),
    contentChars: r.contentChars,
    versions: r.versions,
    model: r.model,
    analyzedAt: r.analyzedAt.toISOString(),
  }));
  return NextResponse.json({ analyses });
}

const saveSchema = z.object({
  model: z.string().default(""),
  items: z
    .array(
      z.object({
        dashboardId: z.string().min(1),
        name: z.string(),
        verdict: z.string(),
        reason: z.string(),
        tileCount: z.number().default(0),
        tileTitles: z.array(z.string()).default([]),
        contentChars: z.number().default(0),
        versions: z.number().default(0),
      })
    )
    .min(1),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { model, items } = parsed.data;

  for (const it of items) {
    const data = {
      name: it.name,
      verdict: it.verdict,
      reason: it.reason,
      tileCount: it.tileCount,
      tileTitles: JSON.stringify(it.tileTitles),
      contentChars: it.contentChars,
      versions: it.versions,
      model,
      analyzedAt: new Date(),
    };
    await prisma.dashboardAnalysis.upsert({
      where: { environmentId_dashboardId: { environmentId: id, dashboardId: it.dashboardId } },
      create: { environmentId: id, dashboardId: it.dashboardId, ...data },
      update: data,
    });
  }

  await logActivity({
    type: "DASHBOARD",
    title: "Análisis de dashboards guardado",
    message: `Se guardaron ${items.length} análisis de dashboards para el entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });

  return NextResponse.json({ ok: true, saved: items.length });
}

function safeParse(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
