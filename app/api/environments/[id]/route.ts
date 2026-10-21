import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { maskToken, decryptToken, encryptToken } from "@/lib/crypto";
import { listCommits } from "@/lib/server/gitRunner";
import { envLocationSchema, resolveLocation } from "@/lib/envUrl";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const environment = await prisma.environment.findUnique({
    where: { id },
    include: { jobs: { orderBy: { createdAt: "desc" }, take: 20 }, tenant: true },
  });
  if (!environment) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const commits = await listCommits(environment.localPath);

  return NextResponse.json({
    ...environment,
    tokenCipher: undefined,
    platformTokenCipher: undefined,
    oauthClientCipher: undefined,
    tokenMasked: maskToken(decryptToken(environment.tokenCipher)),
    hasPlatformToken: !!environment.platformTokenCipher,
    platformTokenMasked: environment.platformTokenCipher
      ? maskToken(decryptToken(environment.platformTokenCipher))
      : null,
    hasIam: !!(environment.accountUuid && environment.oauthClientId && environment.oauthClientCipher),
    commits,
  });
}

const updateEnvironmentSchema = z
  .object({
    name: z.string().min(1),
    // token opcional: si viene vacio/ausente, se conserva el actual
    token: z.string().optional(),
    platformToken: z.string().optional(),
    accountUuid: z.string().optional(),
    oauthClientId: z.string().optional(),
    oauthClientSecret: z.string().optional(),
  })
  .and(envLocationSchema);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const body = await request.json();
  const parsed = updateEnvironmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, token, platformToken, accountUuid, oauthClientId, oauthClientSecret } = parsed.data;
  const { url, envId } = resolveLocation(parsed.data);

  const environment = await prisma.environment.update({
    where: { id },
    data: {
      name,
      url,
      envId,
      ...(token && token.trim() ? { tokenCipher: encryptToken(token.trim()) } : {}),
      ...(platformToken && platformToken.trim()
        ? { platformTokenCipher: encryptToken(platformToken.trim()) }
        : {}),
      // accountUuid / oauthClientId: cadena vacia limpia el valor; undefined lo conserva.
      ...(accountUuid !== undefined
        ? { accountUuid: accountUuid.trim() ? normalizeAccountUuid(accountUuid) : null }
        : {}),
      ...(oauthClientId !== undefined ? { oauthClientId: oauthClientId.trim() || null } : {}),
      ...(oauthClientSecret && oauthClientSecret.trim()
        ? { oauthClientCipher: encryptToken(oauthClientSecret.trim()) }
        : {}),
    },
  });

  await logActivity({
    type: "ENVIRONMENT",
    title: "Entorno actualizado",
    message: `Se actualizaron los datos del entorno ${environment.name}.`,
    environmentId: environment.id,
    triggeredBy,
  });

  return NextResponse.json({
    ...environment,
    tokenCipher: undefined,
    platformTokenCipher: undefined,
    oauthClientCipher: undefined,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const existing = await prisma.environment.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  await prisma.environment.delete({ where: { id } });
  await logActivity({
    type: "ENVIRONMENT",
    title: "Entorno eliminado",
    message: `Se eliminó el entorno ${existing.name}.`,
    environmentId: existing.id,
    triggeredBy,
  });
  return NextResponse.json({ ok: true });
}
