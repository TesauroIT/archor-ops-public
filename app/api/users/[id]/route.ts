import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

const updateUserSchema = z.object({
  password: z.string().min(8),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  await logActivity({
    type: "USER",
    title: "Contraseña actualizada",
    message: `Se cambió la contraseña de ${user.email}.`,
    triggeredBy,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (user.email === triggeredBy) {
    return NextResponse.json(
      { error: "No puedes eliminar tu propio usuario." },
      { status: 400 }
    );
  }

  const total = await prisma.user.count();
  if (total <= 1) {
    return NextResponse.json(
      { error: "No se puede eliminar el último usuario." },
      { status: 400 }
    );
  }

  await prisma.user.delete({ where: { id } });
  await logActivity({
    type: "USER",
    title: "Usuario eliminado",
    message: `Se eliminó el usuario ${user.email}.`,
    triggeredBy,
  });
  return NextResponse.json({ ok: true });
}
