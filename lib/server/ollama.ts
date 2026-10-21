// Cliente minimo para un modelo local via Ollama. Se llama desde el servidor
// (no desde el browser) para evitar CORS; como la app suele correr en local,
// llega a http://localhost:11434 sin problema.

const TIMEOUT_MS = 180_000; // los modelos locales pueden tardar (carga + inferencia)

export interface AnalyzeItem {
  name: string;
  versions: number;
  tileCount?: number;
  tileTitles?: string[];
  contentChars?: number; // tamaño del contenido (proxy de cuanto DQL/logica tiene)
  isPrivate?: boolean;
  ownerEmail?: string | null;
}

export interface Verdict {
  id?: number; // indice #N que le pasamos, para emparejar sin depender del nombre
  name?: string;
  veredicto: "conservar" | "revisar" | "eliminar" | string;
  razon: string;
}

// Plantilla del prompt por defecto. El placeholder {dashboards} se reemplaza por
// la lista formateada de dashboards. Se exporta para que la pantalla de
// Configuracion pueda mostrarla / resetear a este valor.
export const DEFAULT_DASHBOARD_PROMPT = `Sos un experto en observabilidad que ayuda a hacer limpieza de dashboards de Dynatrace.
Te paso una lista de dashboards con metadata. Se CONSERVADOR: solo se borra lo que es claramente basura.

Clasifica CADA uno en "conservar", "revisar" o "eliminar" siguiendo estas REGLAS DURAS (en orden de prioridad):
1. Si el nombre esta vacio, es "Untitled", "Sin titulo" o similar -> "eliminar". Esto es lo UNICO que se elimina sin dudar.
2. Si el nombre contiene "copy", "copia", "clone" o "(1)" (es copia de otro) -> "revisar".
3. Si tiene mas de 2 tiles Y muchos caracteres (caracteres > 2000) -> NUNCA "eliminar"; como mucho "revisar". Tiene contenido/DQL real aunque parezca descartable.
4. El resto valioso (varios tiles con titulos significativos, publico, muy editado) -> "conservar".
5. Ante cualquier duda -> "revisar", NO "eliminar".

Campos:
- "tiles" = cantidad de paneles. "caracteres" = tamaño del contenido (mas caracteres = mas DQL/logica real).
- "titulos_de_tiles" = de que trata cada panel. "versiones" = cuantas veces se edito (muchas = vivo).

Cada dashboard tiene un identificador "#N". Devolve el MISMO "id" numerico N para emparejar.
Devolve SOLO un objeto JSON con esta forma exacta, un item por cada dashboard de entrada:
{"items":[{"id":<numero N>,"veredicto":"conservar|revisar|eliminar","razon":"<motivo corto en español que mencione nombre/tiles/caracteres>"}]}

Dashboards:
{dashboards}`;

export async function analyzeDashboards(
  ollamaUrl: string,
  model: string,
  items: AnalyzeItem[],
  promptTemplate?: string | null
): Promise<{ ok: true; verdicts: Verdict[]; raw?: string } | { ok: false; error: string }> {
  const base = ollamaUrl.replace(/\/+$/, "");

  const lista = items
    .map((d, i) => {
      const titulos = d.tileTitles && d.tileTitles.length ? d.tileTitles.slice(0, 10).join(", ") : "(sin titulos)";
      return `#${i + 1} nombre="${d.name}" versiones=${d.versions} tiles=${
        d.tileCount ?? "?"
      } caracteres=${d.contentChars ?? "?"} titulos_de_tiles=[${titulos}] publico=${
        d.isPrivate === false ? "si" : "no"
      } owner=${d.ownerEmail ?? "?"}`;
    })
    .join("\n");

  // Si hay plantilla configurada la usamos; si trae {dashboards} inyectamos ahi
  // la lista, si no la anexamos al final (tolerante a plantillas sin placeholder).
  const template = promptTemplate?.trim() ? promptTemplate : DEFAULT_DASHBOARD_PROMPT;
  const prompt = template.includes("{dashboards}")
    ? template.replaceAll("{dashboards}", lista)
    : `${template}\n\nDashboards:\n${lista}`;

  let res: Response;
  try {
    res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false, format: "json" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const e = error as Error;
    return {
      ok: false,
      error: `No se pudo conectar a Ollama en ${base}. ¿Está corriendo? (${e.message})`,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 404
        ? ` — ¿existe el modelo "${model}"? Probá 'ollama pull ${model}'.`
        : "";
    return { ok: false, error: `Ollama respondió HTTP ${res.status}${hint}. ${body.slice(0, 200)}` };
  }

  const data = (await res.json().catch(() => ({}))) as { response?: string };
  const raw = data.response ?? "";
  try {
    const parsed = JSON.parse(raw) as { items?: Verdict[]; dashboards?: Verdict[] } | Verdict[];
    const verdicts = Array.isArray(parsed) ? parsed : parsed.items ?? parsed.dashboards ?? [];
    return { ok: true, verdicts };
  } catch {
    // el modelo no devolvio JSON parseable: devolvemos el texto crudo para mostrarlo.
    return { ok: true, verdicts: [], raw };
  }
}
