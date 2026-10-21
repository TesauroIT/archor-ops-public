import { NextResponse } from "next/server";
import { z } from "zod";
import { getLookupContext } from "@/lib/server/lookupContext";
import { testPattern, type LookupUploadRequest } from "@/lib/server/dynatraceResourceStore";

// Previsualiza el parseo de un lookup SIN persistir. Requiere storage:files:write.
// Recibe multipart/form-data: part "content" (una MUESTRA del archivo, el cliente
// manda solo un slice) + part "request" (JSON con parsePattern/lookupField).
export const runtime = "nodejs";

const MAX_SAMPLE_BYTES = 5 * 1024 * 1024; // la muestra nunca deberia ser grande

const schema = z.object({
  parsePattern: z.string().min(1, "Falta el patron DPL (parsePattern)."),
  lookupField: z.string().min(1, "Falta el campo identificador (lookupField)."),
  skippedRecords: z.number().int().min(0).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const content = form.get("content");
  if (!(content instanceof Blob) || content.size === 0) {
    return NextResponse.json({ error: "Falta la muestra (part 'content')." }, { status: 400 });
  }
  if (content.size > MAX_SAMPLE_BYTES) {
    return NextResponse.json({ error: "La muestra para el preview es demasiado grande." }, { status: 413 });
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

  // filePath no aplica a test-pattern; el cliente lo ignora igual.
  const req = { ...parsed.data, filePath: "/lookups/preview" } as LookupUploadRequest;
  const res = await testPattern(result.ctx.appsHost, result.ctx.token, content, req);
  if (!res.ok) {
    const hint = res.status === 403 ? " (el Platform token necesita storage:files:write)" : "";
    return NextResponse.json({ error: `${res.message}${hint}` }, { status: res.status || 502 });
  }
  return NextResponse.json({ recordCount: res.recordCount, preview: res.preview });
}
