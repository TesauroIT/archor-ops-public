import { NextResponse } from "next/server";
import { z } from "zod";
import { getLookupContext } from "@/lib/server/lookupContext";
import { uploadLookup, type LookupUploadRequest } from "@/lib/server/dynatraceResourceStore";
import { logActivity } from "@/lib/server/activity";
import { auth } from "@/lib/auth";

// Sube un archivo de lookup al Resource Store. Requiere storage:files:write.
// Recibe multipart/form-data: part "file" (el archivo, streameado) + part
// "request" (JSON con los parametros). Asi no materializamos el archivo como
// string en memoria: un archivo de 100 MB se pasa como stream.
export const runtime = "nodejs";

const MAX_BYTES = 100 * 1024 * 1024; // limite de Dynatrace: 100 MB

const schema = z.object({
  filePath: z
    .string()
    .min(1)
    .regex(/^\/lookups\/.+/, "La ruta debe empezar con /lookups/."),
  parsePattern: z.string().min(1, "Falta el patron DPL (parsePattern)."),
  lookupField: z.string().min(1, "Falta el campo identificador (lookupField)."),
  displayName: z.string().optional(),
  description: z.string().optional(),
  autoFlatten: z.boolean().optional(),
  overwrite: z.boolean().optional(),
  skippedRecords: z.number().int().min(0).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const triggeredBy = session?.user?.email ?? "unknown";

  const result = await getLookupContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba multipart/form-data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "Falta el archivo (part 'file')." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `El archivo supera el limite de 100 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).` },
      { status: 413 }
    );
  }

  let rawReq: unknown;
  try {
    rawReq = JSON.parse(String(form.get("request") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "El part 'request' no es JSON valido." }, { status: 400 });
  }
  const parsed = schema.safeParse(rawReq);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const req: LookupUploadRequest = parsed.data;
  // Pasamos el Blob directo (stream), sin convertirlo a string.
  const res = await uploadLookup(result.ctx.appsHost, result.ctx.token, file, req);
  if (!res.ok) {
    const hint = res.status === 403 ? " (el Platform token necesita storage:files:write)" : "";
    return NextResponse.json({ error: `${res.message}${hint}` }, { status: res.status || 502 });
  }

  await logActivity({
    type: "LOOKUP",
    title: "Lookup subido",
    message: `Se subio el lookup ${req.filePath}${
      res.recordCount != null ? ` (${res.recordCount} registros)` : ""
    } al entorno ${id}.`,
    environmentId: id,
    triggeredBy,
  });
  return NextResponse.json({ ok: true, recordCount: res.recordCount, filePath: req.filePath });
}
