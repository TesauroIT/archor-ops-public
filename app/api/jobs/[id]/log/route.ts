import { prisma } from "@/lib/prisma";

// Descarga el log completo de un job como archivo de texto (el visor de la UI
// muestra solo el tramo final para no congelar el navegador con logs grandes).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await prisma.job.findUnique({
    where: { id },
    select: { output: true, type: true, createdAt: true },
  });
  if (!job) return new Response("Job no encontrado.", { status: 404 });

  const stamp = job.createdAt.toISOString().replace(/[:.]/g, "-");
  const filename = `${job.type.toLowerCase()}-${stamp}-${id.slice(0, 8)}.log`;

  return new Response(job.output || "(sin salida)", {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
