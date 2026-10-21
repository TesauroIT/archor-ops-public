import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { browse } from "@/lib/server/files";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const rel = searchParams.get("path") ?? "";

  const environment = await prisma.environment.findUnique({ where: { id } });
  if (!environment) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  try {
    const result = await browse(environment.localPath, rel);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
