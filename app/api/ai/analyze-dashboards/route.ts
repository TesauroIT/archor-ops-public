import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeDashboards } from "@/lib/server/ollama";
import { getSettings } from "@/lib/server/settings";

// Analiza una tanda de dashboards con un modelo local (Ollama) y devuelve un
// veredicto por dashboard (conservar / revisar / eliminar). La URL, el modelo y
// el prompt salen de la Configuracion (AppSettings); el body puede overridearlos.
const schema = z.object({
  ollamaUrl: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        name: z.string(),
        versions: z.number(),
        tileCount: z.number().optional(),
        tileTitles: z.array(z.string()).optional(),
        contentChars: z.number().optional(),
        isPrivate: z.boolean().optional(),
        ownerEmail: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(50),
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const settings = await getSettings();
  const ollamaUrl = parsed.data.ollamaUrl ?? settings.ollamaUrl;
  const model = parsed.data.model ?? settings.ollamaModel;
  const { items } = parsed.data;
  const result = await analyzeDashboards(ollamaUrl, model, items, settings.dashboardPrompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ verdicts: result.verdicts, raw: result.raw ?? null });
}
