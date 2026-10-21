import { NextResponse } from "next/server";
import { getDocsContext } from "@/lib/server/docsContext";
import { downloadContent } from "@/lib/server/dynatraceDocuments";

// Devuelve el JSON de UN dashboard. Lo usa el backup con progreso (uno por uno)
// y la vista de estructura.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> }
) {
  const { id, docId } = await params;
  const result = await getDocsContext(id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const dl = await downloadContent(result.ctx.base, result.ctx.token, docId, { adminAccess: true });
  if (!dl.ok) {
    return NextResponse.json({ error: dl.message }, { status: dl.status || 502 });
  }
  // Se devuelve el contenido crudo tal cual (normalmente application/json).
  return new Response(dl.content, {
    headers: { "Content-Type": dl.contentType, "Cache-Control": "no-store" },
  });
}
