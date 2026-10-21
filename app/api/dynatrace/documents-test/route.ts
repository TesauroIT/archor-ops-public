import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { buildDocumentsBase, testDocumentsAccess } from "@/lib/server/dynatraceDocuments";
import { envLocationSchema, resolveLocation } from "@/lib/envUrl";

// Valida el Platform token contra la Document API (dashboards). Dos formas:
//  1) { environmentId }                       -> usa el token guardado
//  2) { mode, envId|url, platformToken }      -> antes de guardar
const schema = z.union([
  z.object({ environmentId: z.string().min(1) }),
  z.object({ platformToken: z.string().min(1) }).and(envLocationSchema),
]);

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let base: string;
  let token: string;

  try {
    if ("environmentId" in parsed.data) {
      const env = await prisma.environment.findUnique({ where: { id: parsed.data.environmentId } });
      if (!env) return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });
      if (!env.platformTokenCipher) {
        return NextResponse.json(
          { ok: false, message: "Este entorno no tiene un Platform token guardado todavia." },
          { status: 200 }
        );
      }
      base = buildDocumentsBase(env);
      token = decryptToken(env.platformTokenCipher);
    } else {
      const { url, envId } = resolveLocation(parsed.data);
      base = buildDocumentsBase({ envId, url });
      token = parsed.data.platformToken;
    }
  } catch (e) {
    // buildDocumentsBase falla si no es SaaS/no puede derivar la URL de Platform.
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 200 });
  }

  const result = await testDocumentsAccess(base, token);
  return NextResponse.json(result);
}
