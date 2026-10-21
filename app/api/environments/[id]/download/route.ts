import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { zipDirectory } from "@/lib/server/files";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const environment = await prisma.environment.findUnique({
    where: { id },
    include: { tenant: true },
  });
  if (!environment) {
    return new Response(JSON.stringify({ error: "No encontrado." }), { status: 404 });
  }

  if (!fs.existsSync(environment.localPath)) {
    return new Response(JSON.stringify({ error: "La carpeta del entorno aun no existe." }), {
      status: 404,
    });
  }

  const filename = `${slugify(environment.tenant.name)}-${environment.slug}-backup.zip`;
  const nodeStream = zipDirectory(environment.localPath);

  // Adaptar el Readable de Node a un ReadableStream web para la Response.
  const webStream = new ReadableStream({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy();
    },
  });

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
