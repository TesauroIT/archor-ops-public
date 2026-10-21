import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { encryptToken } from "@/lib/crypto";
import { ensureRepo } from "@/lib/server/gitRunner";
import { envLocationSchema, resolveLocation } from "@/lib/envUrl";
import { normalizeAccountUuid } from "@/lib/server/dynatraceAccount";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

const createEnvironmentSchema = z
  .object({
    tenantId: z.string().min(1),
    name: z.string().min(1),
    token: z.string().min(1),
    platformToken: z.string().optional(),
    accountUuid: z.string().optional(),
    oauthClientId: z.string().optional(),
    oauthClientSecret: z.string().optional(),
  })
  .and(envLocationSchema);

export async function POST(request: Request) {
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const body = await request.json();
  const parsed = createEnvironmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tenantId, name, token, platformToken, accountUuid, oauthClientId, oauthClientSecret } =
    parsed.data;
  const { url, envId } = resolveLocation(parsed.data);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });

  const slug = slugify(name);
  const dataDir = process.env.DATA_DIR ?? "./data";
  const localPath = path.resolve(dataDir, tenant.slug, slug);

  const environment = await prisma.environment.create({
    data: {
      name,
      slug,
      url,
      envId,
      tokenCipher: encryptToken(token),
      platformTokenCipher:
        platformToken && platformToken.trim() ? encryptToken(platformToken.trim()) : null,
      accountUuid: accountUuid?.trim() ? normalizeAccountUuid(accountUuid) : null,
      oauthClientId: oauthClientId?.trim() || null,
      oauthClientCipher:
        oauthClientSecret && oauthClientSecret.trim()
          ? encryptToken(oauthClientSecret.trim())
          : null,
      localPath,
      tenantId,
    },
  });

  await ensureRepo(localPath);
  await logActivity({
    type: "ENVIRONMENT",
    title: "Entorno creado",
    message: `Se creó el entorno ${name} en el tenant ${tenant.name}.`,
    environmentId: environment.id,
    triggeredBy,
  });

  return NextResponse.json(environment, { status: 201 });
}
