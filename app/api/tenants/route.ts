import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

export async function GET() {
  const tenants = await prisma.tenant.findMany({
    include: { environments: { select: { id: true, name: true, slug: true, status: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(tenants);
}

const createTenantSchema = z.object({
  name: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";
  const body = await request.json();
  const parsed = createTenantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name } = parsed.data;
  const slug = slugify(name);

  const tenant = await prisma.tenant.create({ data: { name, slug } });
  await logActivity({
    type: "TENANT",
    title: "Tenant creado",
    message: `Se creó el tenant ${name}.`,
    triggeredBy,
  });
  return NextResponse.json(tenant, { status: 201 });
}
