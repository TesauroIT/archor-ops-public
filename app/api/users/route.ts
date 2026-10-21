import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

export async function GET() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(users);
}

const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function POST(request: Request) {
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Ya existe un usuario con ese email." }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, role: "ADMIN" },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  await logActivity({
    type: "USER",
    title: "Usuario creado",
    message: `Se creó el usuario ${email}.`,
    triggeredBy,
  });
  return NextResponse.json(user, { status: 201 });
}
