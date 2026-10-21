import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listConfigTypes } from "@/lib/server/promote";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const environment = await prisma.environment.findUnique({ where: { id } });
  if (!environment) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const types = await listConfigTypes(environment.localPath);
  return NextResponse.json({ types });
}
