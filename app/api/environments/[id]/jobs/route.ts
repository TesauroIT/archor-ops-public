import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { normalizeConfigTypes } from "@/lib/server/promote";
import { logActivity } from "@/lib/server/activity";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobs = await prisma.job.findMany({
    where: { environmentId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(jobs);
}

const createJobSchema = z.object({
  type: z.enum(["DEPLOY", "BACKUP"]),
  dryRun: z.boolean().optional().default(false),
  // Deploy cross-tenant: entorno origen cuyo backup se despliega en este destino.
  sourceEnvironmentId: z.string().optional(),
  // Tipos de config a incluir; ausente/vacio = todo.
  configTypes: z.array(z.string()).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const body = await request.json();
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const environment = await prisma.environment.findUnique({ where: { id } });
  if (!environment) return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });

  if (environment.status === "RUNNING") {
    return NextResponse.json(
      { error: "Ya hay un job en ejecucion para este entorno." },
      { status: 409 }
    );
  }

  const isDeploy = parsed.data.type === "DEPLOY";
  const dryRun = isDeploy ? parsed.data.dryRun : false;
  const sourceEnvironmentId = isDeploy ? parsed.data.sourceEnvironmentId ?? null : null;
  const configTypesNorm = isDeploy ? normalizeConfigTypes(parsed.data.configTypes) : null;

  // Validar que el entorno origen exista.
  if (sourceEnvironmentId) {
    const source = await prisma.environment.findUnique({ where: { id: sourceEnvironmentId } });
    if (!source) {
      return NextResponse.json({ error: "Entorno origen no encontrado." }, { status: 404 });
    }
  }

  // Gating: un deploy REAL cross-tenant requiere un dry-run exitoso previo para
  // la misma combinacion origen -> destino + seleccion de tipos.
  if (isDeploy && sourceEnvironmentId && !dryRun) {
    const priorDryRun = await prisma.job.findFirst({
      where: {
        environmentId: id,
        type: "DEPLOY",
        dryRun: true,
        status: "SUCCESS",
        sourceEnvironmentId,
        configTypes: configTypesNorm,
      },
      orderBy: { createdAt: "desc" },
    });
    if (!priorDryRun) {
      return NextResponse.json(
        {
          error:
            "Antes de un deploy real, corre un dry-run exitoso para esta misma combinacion origen -> destino y seleccion de tipos.",
        },
        { status: 409 }
      );
    }
  }

  const job = await prisma.job.create({
    data: {
      type: parsed.data.type,
      dryRun,
      sourceEnvironmentId,
      configTypes: configTypesNorm,
      environmentId: id,
      triggeredBy,
    },
  });

  await logActivity({
    type: "JOB",
    title: parsed.data.type === "DEPLOY" ? (dryRun ? "Deploy dry-run iniciado" : "Deploy iniciado") : "Backup iniciado",
    message: `Se inició ${parsed.data.type === "DEPLOY" ? (dryRun ? "un dry-run" : "un deploy") : "un backup"} para el entorno ${environment.name}.`,
    environmentId: id,
    triggeredBy,
  });

  return NextResponse.json(job, { status: 201 });
}
