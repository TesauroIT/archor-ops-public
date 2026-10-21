import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { testConnection } from "@/lib/dynatrace";
import { envLocationSchema, resolveLocation } from "@/lib/envUrl";

// Dos formas de uso:
// 1) { environmentId }            -> prueba un entorno ya guardado (usa su token cifrado)
// 2) { mode, envId|url, token }   -> prueba antes de guardar (token en claro en el body)
const testSchema = z.union([
  z.object({ environmentId: z.string().min(1) }),
  z.object({ token: z.string().min(1) }).and(envLocationSchema),
]);

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let url: string;
  let token: string;

  if ("environmentId" in parsed.data) {
    const environment = await prisma.environment.findUnique({
      where: { id: parsed.data.environmentId },
    });
    if (!environment) {
      return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });
    }
    url = environment.url;
    token = decryptToken(environment.tokenCipher);
  } else {
    const resolved = resolveLocation(parsed.data);
    url = resolved.url;
    token = parsed.data.token;
  }

  const result = await testConnection(url, token);
  return NextResponse.json({ ...result, url });
}
