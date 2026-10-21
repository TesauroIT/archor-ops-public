import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/server/activity";

const schema = z.object({
  path: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { path } = parsed.data;
  const title = path === "/" ? "Página abierta" : `Ruta abierta: ${path}`;

  await logActivity({
    type: "NAVIGATION",
    title,
    message: `${triggeredBy} abrió la ruta ${path}.`,
    triggeredBy,
  });

  return NextResponse.json({ ok: true });
}
