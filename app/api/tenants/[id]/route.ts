import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { environments: true },
  });
  if (!tenant) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(tenant);
}

const updateTenantSchema = z.object({
  name: z.string().min(1),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = updateTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name } = parsed.data;
  const tenant = await prisma.tenant.update({
    where: { id },
    data: { name, slug: slugify(name) },
  });
  await logActivity({
    type: "TENANT",
    title: "Tenant actualizado",
    message: `Se actualizó el tenant ${tenant.name}.`,
    triggeredBy,
  });
  return NextResponse.json(tenant);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const existing = await prisma.tenant.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  await prisma.tenant.delete({ where: { id } });
  await logActivity({
    type: "TENANT",
    title: "Tenant eliminado",
    message: `Se eliminó el tenant ${existing.name}.`,
    triggeredBy,
  });
  return NextResponse.json({ ok: true });
}
