// Cliente de la Dynatrace Grail Resource Store API (lookup tables / archivos
// tabulares almacenados en el tenant) + un mini-cliente de la Grail Query API
// (DQL) para listar y descargar, ya que esas dos operaciones NO tienen endpoint
// REST propio y solo se pueden hacer con DQL.
//
// Auth: Bearer platform token (el mismo que usa la Document API de dashboards).
// Base apps: https://<envId>.apps.dynatrace.com
//   - Resource Store: /platform/storage/resource-store/v1
//   - Query (DQL):    /platform/storage/query/v1
//
// Permisos del Platform token / IAM policy:
//   storage:files:write   -> subir (upload) y probar parseo (test-pattern)
//   storage:files:delete  -> borrar
//   storage:files:read    -> lectura de metadatos de archivos
//   storage:buckets:read (+ storage:system:read) -> ejecutar DQL para listar/bajar
//
// Ref: https://docs.dynatrace.com/docs/platform/grail/lookup-data

const TIMEOUT_MS = 30_000;

// Deriva la base "apps" (https://<envId>.apps.dynatrace.com) del entorno.
// Espeja la logica de buildDocumentsBase: solo SaaS (envId) o URL .live derivable.
export function buildAppsHost(env: { envId: string | null; url: string }): string {
  if (env.envId) {
    return `https://${env.envId}.apps.dynatrace.com`;
  }
  if (env.url.includes(".live.dynatrace.com")) {
    return env.url.replace(".live.dynatrace.com", ".apps.dynatrace.com").replace(/\/+$/, "");
  }
  throw new Error(
    "La gestion de lookups requiere un entorno SaaS con ID (no se pudo derivar la URL de la Platform API)."
  );
}

function resourceStoreBase(appsHost: string): string {
  return `${appsHost}/platform/storage/resource-store/v1`;
}

function queryBase(appsHost: string): string {
  return `${appsHost}/platform/storage/query/v1`;
}

// ---------------------------------------------------------------------------
// Test de acceso: valida el token contra la Query API (que es la que usan las
// operaciones de listado/descarga). Un simple fetch acotado sirve de ping.
// ---------------------------------------------------------------------------
export interface TestResult {
  ok: boolean;
  status: number | null;
  message: string;
}

export async function testResourceStoreAccess(appsHost: string, token: string): Promise<TestResult> {
  let res: Response;
  try {
    res = await fetch(`${queryBase(appsHost)}/query:execute`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query: "fetch dt.system.files | limit 1" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: null, message: `No se pudo conectar: ${(error as Error).message}` };
  }
  if (res.ok) return { ok: true, status: res.status, message: "Conexion OK con la Resource Store / Query API." };

  const byStatus: Record<number, string> = {
    401: "Token de Platform invalido o expirado (401).",
    403: "El token no tiene los permisos requeridos (storage:buckets:read + storage:files:read) (403).",
    404: "URL de Platform incorrecta (404). Verifica que el entorno sea SaaS.",
  };
  return {
    ok: false,
    status: res.status,
    message: byStatus[res.status] ?? `La verificacion fallo con HTTP ${res.status}.`,
  };
}

// ---------------------------------------------------------------------------
// Sonda granular de permisos: prueba LECTURA (query API) y ESCRITURA (test-pattern
// de la Resource Store, que NO persiste nada) por separado, para que la UI diga
// exactamente que permiso falta. En un Platform token el permiso efectivo es la
// interseccion de los scopes del token y las policies del usuario vinculado; que
// la lectura ande no garantiza la escritura.
// ---------------------------------------------------------------------------
export interface PermissionProbe {
  read: boolean; // storage:buckets:read (ejecutar DQL / listar-descargar)
  write: boolean; // storage:files:write (subir)
  readMessage: string;
  writeMessage: string;
}

export async function probePermissions(appsHost: string, token: string): Promise<PermissionProbe> {
  const probe: PermissionProbe = { read: false, write: false, readMessage: "", writeMessage: "" };

  // 1) Lectura: ping a la Query API.
  try {
    const r = await fetch(`${queryBase(appsHost)}/query:execute`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: "fetch dt.system.files | limit 1" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    probe.read = r.ok;
    probe.readMessage = r.ok
      ? "Lectura OK (storage:buckets:read)."
      : r.status === 403
        ? "Sin permiso de lectura (falta storage:buckets:read / storage:files:read)."
        : `Lectura fallo con HTTP ${r.status}.`;
  } catch (e) {
    probe.readMessage = `Lectura: no se pudo conectar (${(e as Error).message}).`;
  }

  // 2) Escritura: test-pattern (preview, no persiste). 403 => falta el permiso.
  try {
    const form = buildTestPatternForm("probe", { parsePattern: "LD:probe", lookupField: "probe" });
    const r = await postMultipart(`${resourceStoreBase(appsHost)}/files/tabular/lookup:test-pattern`, token, form);
    // Si el permiso esta, el test-pattern responde 2xx (o 400 por patron/datos),
    // pero NUNCA 403. Un 403 es la señal inequivoca de permiso faltante.
    probe.write = r.status !== 403;
    probe.writeMessage = r.status === 403
      ? "Sin permiso de escritura (falta storage:files:write en ESTE token)."
      : "Escritura OK (storage:files:write).";
  } catch (e) {
    probe.writeMessage = `Escritura: no se pudo conectar (${(e as Error).message}).`;
  }

  return probe;
}

// ---------------------------------------------------------------------------
// Ejecutor de DQL: query:execute puede responder de inmediato (SUCCEEDED) o
// devolver un requestToken para hacer polling en query:poll hasta que termine.
// ---------------------------------------------------------------------------
interface DqlRecords {
  records: Record<string, unknown>[];
}

interface QueryEnvelope {
  state?: string; // NOT_STARTED | RUNNING | SUCCEEDED | ...
  result?: DqlRecords;
  requestToken?: string;
}

export async function runDql(
  appsHost: string,
  token: string,
  query: string
): Promise<{ ok: true; records: Record<string, unknown>[] } | { ok: false; status: number; message: string }> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let res: Response;
  try {
    res = await fetch(`${queryBase(appsHost)}/query:execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, requestTimeoutMilliseconds: TIMEOUT_MS, fetchTimeoutSeconds: 60 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: body.slice(0, 300) || `HTTP ${res.status}` };
  }

  let env = (await res.json().catch(() => ({}))) as QueryEnvelope;

  // Polling: mientras no haya terminado y tengamos token, consultamos query:poll.
  let guard = 0;
  while (env.state && env.state !== "SUCCEEDED" && env.requestToken && guard < 30) {
    await new Promise((r) => setTimeout(r, 1_000));
    let pollRes: Response;
    try {
      pollRes = await fetch(
        `${queryBase(appsHost)}/query:poll?request-token=${encodeURIComponent(env.requestToken)}`,
        { headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
      );
    } catch (error) {
      return { ok: false, status: 0, message: (error as Error).message };
    }
    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => "");
      return { ok: false, status: pollRes.status, message: body.slice(0, 300) || `HTTP ${pollRes.status}` };
    }
    env = (await pollRes.json().catch(() => ({}))) as QueryEnvelope;
    guard += 1;
  }

  return { ok: true, records: env.result?.records ?? [] };
}

// ---------------------------------------------------------------------------
// Listar archivos de lookup: fetch dt.system.files. Devolvemos los registros
// crudos (metadatos por archivo) filtrados por prefijo de ruta.
// ---------------------------------------------------------------------------
export interface LookupFile {
  filePath: string;
  displayName?: string | null;
  description?: string | null;
  records?: number | null;
  sizeBytes?: number | null;
  updatedAt?: string | null;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  // dt.system.files devuelve algunos numericos (records, size) como string.
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

export async function listLookupFiles(
  appsHost: string,
  token: string,
  pathPrefix = "/lookups/"
): Promise<{ ok: true; files: LookupFile[] } | { ok: false; status: number; message: string }> {
  // Los campos reales de dt.system.files: name (ruta completa), display_name,
  // description, records, size, modified.timestamp, lookup_field, etc.
  const dql = `fetch dt.system.files | filter startsWith(name, "${pathPrefix}") | sort name asc`;
  const result = await runDql(appsHost, token, dql);
  if (!result.ok) return result;

  const files: LookupFile[] = result.records.map((r) => ({
    filePath: str(r.name) ?? "",
    displayName: str(r.display_name),
    description: str(r.description),
    records: num(r.records),
    sizeBytes: num(r.size),
    updatedAt: str(r["modified.timestamp"]),
    raw: r,
  }));
  return { ok: true, files: files.filter((f) => f.filePath) };
}

// ---------------------------------------------------------------------------
// Descargar (bajar) el contenido de un lookup: load "<filePath>". Devuelve los
// registros; el caller decide si serializarlos como JSON o CSV.
// ---------------------------------------------------------------------------
export async function downloadLookup(
  appsHost: string,
  token: string,
  filePath: string
): Promise<{ ok: true; records: Record<string, unknown>[] } | { ok: false; status: number; message: string }> {
  // load "<path>" trae los registros almacenados en ese archivo tabular.
  const escaped = filePath.replace(/"/g, '\\"');
  return runDql(appsHost, token, `load "${escaped}"`);
}

// ---------------------------------------------------------------------------
// Parametros del request part del multipart (upload y test-pattern).
// ---------------------------------------------------------------------------
export interface LookupUploadRequest {
  parsePattern: string; // patron DPL para parsear el contenido subido
  lookupField: string; // campo identificador del registro (dedup)
  filePath: string; // ruta completa, ej. /lookups/http_status_codes
  displayName?: string;
  description?: string;
  autoFlatten?: boolean;
  overwrite?: boolean;
  skippedRecords?: number; // lineas de header a saltar
}

// El content puede venir como string (archivos chicos editados en la UI) o como
// Blob/File (streaming de archivos grandes, sin materializar el string en memoria).
function contentBlob(content: string | Blob): Blob {
  return content instanceof Blob ? content : new Blob([content], { type: "text/plain" });
}

// Arma el multipart/form-data con los dos parts: content (archivo) y request (JSON).
function buildUploadForm(content: string | Blob, req: LookupUploadRequest, fileName = "content"): FormData {
  const form = new FormData();
  form.append("content", contentBlob(content), fileName);
  form.append("request", new Blob([JSON.stringify(req)], { type: "application/json" }));
  return form;
}

// Igual que buildUploadForm pero para test-pattern, cuyo request part es un
// subconjunto (sin filePath ni campos de upload).
function buildTestPatternForm(content: string | Blob, req: Record<string, unknown>): FormData {
  const form = new FormData();
  form.append("content", contentBlob(content), "content");
  form.append("request", new Blob([JSON.stringify(req)], { type: "application/json" }));
  return form;
}

async function postMultipart(
  url: string,
  token: string,
  form: FormData,
  timeoutMs: number = TIMEOUT_MS
): Promise<{ ok: boolean; status: number; body: string }> {
  // No seteamos Content-Type a mano: fetch pone el boundary del multipart.
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

// Timeout mas largo para uploads (archivos de hasta 100 MB).
const UPLOAD_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Test-pattern: previsualiza el parseo SIN persistir. Devuelve el conteo de
// registros y una muestra (hasta 100).
// ---------------------------------------------------------------------------
export interface TestPatternResult {
  ok: boolean;
  status: number;
  message?: string;
  recordCount?: number;
  preview?: Record<string, unknown>[];
}

export async function testPattern(
  appsHost: string,
  token: string,
  content: string | Blob,
  req: LookupUploadRequest
): Promise<TestPatternResult> {
  const url = `${resourceStoreBase(appsHost)}/files/tabular/lookup:test-pattern`;
  // El request part de test-pattern NO acepta filePath ni los campos exclusivos
  // del upload (displayName/description/overwrite); solo describen el parseo.
  const testReq = {
    parsePattern: req.parsePattern,
    lookupField: req.lookupField,
    ...(req.autoFlatten != null ? { autoFlatten: req.autoFlatten } : {}),
    ...(req.skippedRecords != null ? { skippedRecords: req.skippedRecords } : {}),
  };
  let out: { ok: boolean; status: number; body: string };
  try {
    out = await postMultipart(url, token, buildTestPatternForm(content, testReq));
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (!out.ok) {
    return { ok: false, status: out.status, message: out.body.slice(0, 400) || `HTTP ${out.status}` };
  }
  // La respuesta real trae numberOfRecords + records (muestra parseada).
  const data = JSON.parse(out.body || "{}") as {
    numberOfRecords?: number;
    records?: Record<string, unknown>[];
  };
  return {
    ok: true,
    status: out.status,
    recordCount: data.numberOfRecords ?? data.records?.length,
    preview: data.records ?? [],
  };
}

// ---------------------------------------------------------------------------
// Upload: persiste el archivo tabular en el Resource Store.
// ---------------------------------------------------------------------------
export interface UploadResult {
  ok: boolean;
  status: number;
  message?: string;
  recordCount?: number;
}

export async function uploadLookup(
  appsHost: string,
  token: string,
  content: string | Blob,
  req: LookupUploadRequest
): Promise<UploadResult> {
  const url = `${resourceStoreBase(appsHost)}/files/tabular/lookup:upload`;
  let out: { ok: boolean; status: number; body: string };
  try {
    out = await postMultipart(url, token, buildUploadForm(content, req), UPLOAD_TIMEOUT_MS);
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (!out.ok) {
    return { ok: false, status: out.status, message: out.body.slice(0, 400) || `HTTP ${out.status}` };
  }
  // La respuesta del upload trae: records, fileSize, uploadedBytes, patternMatches,
  // skippedRecords, discardedDuplicates.
  const data = JSON.parse(out.body || "{}") as { records?: number };
  return { ok: true, status: out.status, recordCount: data.records };
}

// ---------------------------------------------------------------------------
// Delete: borra UN archivo por su filePath. El body es singular { filePath }.
// ---------------------------------------------------------------------------
export interface DeleteResult {
  ok: boolean;
  status: number;
  message?: string;
}

export async function deleteLookup(
  appsHost: string,
  token: string,
  filePath: string
): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetch(`${resourceStoreBase(appsHost)}/files:delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ filePath }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (res.ok) return { ok: true, status: res.status };
  const body = await res.text().catch(() => "");
  return { ok: false, status: res.status, message: body.slice(0, 300) || `HTTP ${res.status}` };
}
