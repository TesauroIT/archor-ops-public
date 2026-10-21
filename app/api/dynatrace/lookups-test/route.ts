import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { buildAppsHost, probePermissions } from "@/lib/server/dynatraceResourceStore";
import { envLocationSchema, resolveLocation } from "@/lib/envUrl";

// Valida el Platform token contra la Resource Store / Query API (lookups).
//  1) { environmentId }                    -> usa el token guardado
//  2) { platformToken } + envId|url        -> antes de guardar
const schema = z.union([
  z.object({ environmentId: z.string().min(1) }),
  z.object({ platformToken: z.string().min(1) }).and(envLocationSchema),
]);

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let appsHost: string;
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
      appsHost = buildAppsHost(env);
      token = decryptToken(env.platformTokenCipher);
    } else {
      const { url, envId } = resolveLocation(parsed.data);
      appsHost = buildAppsHost({ envId, url });
      token = parsed.data.platformToken;
    }
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 200 });
  }

  const probe = await probePermissions(appsHost, token);
  const ok = probe.read && probe.write;
  return NextResponse.json({
    ok,
    read: probe.read,
    write: probe.write,
    message: ok
      ? "Permisos OK: lectura y escritura habilitadas."
      : `${probe.readMessage} ${probe.writeMessage}`,
  });
}
