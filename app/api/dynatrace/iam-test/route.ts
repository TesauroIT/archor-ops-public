import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { normalizeAccountUuid, resolveUsers } from "@/lib/server/dynatraceAccount";

// Valida las credenciales del OAuth client de cuenta (IAM) haciendo el flujo
// real: pide un token OAuth y lista usuarios. Devuelve cuantos usuarios ve.
//
// Acepta:
//  - { environmentId }                          -> usa lo guardado (secret cifrado)
//  - { environmentId, ...overrides }            -> guardado + campos que se estan editando
//  - { accountUuid, oauthClientId, oauthClientSecret } -> antes de guardar (create)
const schema = z.object({
  environmentId: z.string().optional(),
  accountUuid: z.string().optional(),
  oauthClientId: z.string().optional(),
  oauthClientSecret: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Base: lo guardado en el entorno (si viene environmentId).
  let accountUuid: string | null = null;
  let clientId: string | null = null;
  let clientSecret: string | null = null;

  if (input.environmentId) {
    const env = await prisma.environment.findUnique({ where: { id: input.environmentId } });
    if (!env) return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });
    accountUuid = env.accountUuid;
    clientId = env.oauthClientId;
    clientSecret = env.oauthClientCipher ? decryptToken(env.oauthClientCipher) : null;
  }

  // Overrides: lo que se este editando en el form pisa lo guardado.
  if (input.accountUuid?.trim()) accountUuid = normalizeAccountUuid(input.accountUuid);
  if (input.oauthClientId?.trim()) clientId = input.oauthClientId.trim();
  if (input.oauthClientSecret?.trim()) clientSecret = input.oauthClientSecret.trim();

  if (!accountUuid || !clientId || !clientSecret) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Faltan datos del OAuth: se necesitan Client ID, Client Secret y Dynatrace URN. Completalos (o guarda el entorno con el secret).",
      },
      { status: 200 }
    );
  }

  const result = await resolveUsers({ accountUuid, clientId, clientSecret });
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      count: result.users.length,
      message: `OAuth OK. La cuenta ve ${result.users.length} usuario(s) con correo.`,
    });
  }
  return NextResponse.json({ ok: false, message: result.error ?? "No se pudo validar el OAuth." });
}
