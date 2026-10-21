// Cliente de la Dynatrace Platform Document Service API (gestion de dashboards).
// Los dashboards de la plataforma nueva son "documents" de type "dashboard".
// Auth: Bearer platform token. Base: https://<envId>.apps.dynatrace.com/platform/document/v1
// Ver public/apidashboards.yaml.

const TIMEOUT_MS = 20_000;

export interface DashboardDoc {
  id: string;
  name: string;
  type: string;
  version: string;
  owner: string; // SSO id (no email)
  isPrivate?: boolean;
  isReshareable?: boolean;
  createdTime?: string | null; // ISO — cuando se creo
  lastModifiedTime?: string | null; // ISO — ultima modificacion
  lastAccessedTime?: string | null; // ISO — ultima vez abierto (por el usuario del token)
}

// Shape crudo de la Document API para leer los timestamps anidados.
interface RawDoc extends DashboardDoc {
  modificationInfo?: { createdTime?: string; lastModifiedTime?: string };
  userContext?: { lastAccessedTime?: string | null };
}

// Construye la base de la Document API. Requiere el ID SaaS del entorno.
// Para SaaS: https://<envId>.apps.dynatrace.com. Para custom/managed no hay
// una convencion unica, asi que v1 solo soporta SaaS (envId presente).
export function buildDocumentsBase(env: { envId: string | null; url: string }): string {
  if (env.envId) {
    return `https://${env.envId}.apps.dynatrace.com/platform/document/v1`;
  }
  // Fallback: intentar derivar de una URL .live. -> .apps.
  if (env.url.includes(".live.dynatrace.com")) {
    const appsHost = env.url.replace(".live.dynatrace.com", ".apps.dynatrace.com").replace(/\/+$/, "");
    return `${appsHost}/platform/document/v1`;
  }
  throw new Error(
    "La gestion de dashboards requiere un entorno SaaS con ID (no se pudo derivar la URL de la Platform API)."
  );
}

async function dtFetch(
  base: string,
  token: string,
  pathAndQuery: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${base}${pathAndQuery}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export interface TestResult {
  ok: boolean;
  status: number | null;
  message: string;
}

// Verifica el token de Platform contra la Document API.
export async function testDocumentsAccess(base: string, token: string): Promise<TestResult> {
  let res: Response;
  try {
    res = await dtFetch(base, token, "/documents?page-size=1");
  } catch (error) {
    return { ok: false, status: null, message: `No se pudo conectar: ${(error as Error).message}` };
  }
  if (res.ok) return { ok: true, status: res.status, message: "Conexion OK con la Document API." };

  const byStatus: Record<number, string> = {
    401: "Token de Platform invalido o expirado (401).",
    403: "El token no tiene los scopes requeridos (document:documents:read, y admin para gestionar de otros) (403).",
    404: "URL de Platform incorrecta (404). Verifica que el entorno sea SaaS.",
  };
  return {
    ok: false,
    status: res.status,
    message: byStatus[res.status] ?? `La verificacion fallo con HTTP ${res.status}.`,
  };
}

// Lista todos los dashboards (type='dashboard'), siguiendo la paginacion.
// adminAccess=true permite ver dashboards de otros usuarios (requiere scope admin).
export async function listDashboards(
  base: string,
  token: string,
  opts: { adminAccess?: boolean } = {}
): Promise<DashboardDoc[]> {
  const admin = opts.adminAccess ? "&admin-access=true" : "";
  const filter = encodeURIComponent("type='dashboard'");
  // Pedimos el campo extra de ultimo acceso (modificationInfo viene por defecto).
  const addFields = `&add-fields=${encodeURIComponent("userContext.lastAccessedTime")}`;
  const docs: DashboardDoc[] = [];
  let pageKey: string | null = null;
  let guard = 0;

  do {
    const pageParam = pageKey ? `&page-key=${encodeURIComponent(pageKey)}` : "";
    const res = await dtFetch(
      base,
      token,
      `/documents?filter=${filter}&page-size=100${admin}${addFields}${pageParam}`
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} al listar dashboards. ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      documents: RawDoc[];
      nextPageKey?: string;
    };
    // Aplanamos los timestamps anidados a campos de primer nivel.
    for (const doc of data.documents ?? []) {
      docs.push({
        ...doc,
        createdTime: doc.modificationInfo?.createdTime ?? null,
        lastModifiedTime: doc.modificationInfo?.lastModifiedTime ?? null,
        lastAccessedTime: doc.userContext?.lastAccessedTime ?? null,
      });
    }
    pageKey = data.nextPageKey ?? null;
    guard += 1;
  } while (pageKey && guard < 100);

  return docs;
}

export interface TransferResult {
  id: string;
  ok: boolean;
  status: number;
  message?: string;
}

// Transfiere el owner de un dashboard. El owner previo pierde acceso.
export async function transferOwner(
  base: string,
  token: string,
  id: string,
  newOwnerId: string,
  opts: { adminAccess?: boolean; sendNotification?: boolean } = {}
): Promise<TransferResult> {
  const params = new URLSearchParams();
  if (opts.adminAccess) params.set("admin-access", "true");
  if (opts.sendNotification) params.set("send-notification", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";

  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents/${encodeURIComponent(id)}:transfer-owner${qs}`, {
      method: "POST",
      body: JSON.stringify({ newOwnerId }),
    });
  } catch (error) {
    return { id, ok: false, status: 0, message: (error as Error).message };
  }

  if (res.status === 204) return { id, ok: true, status: 204 };
  const body = await res.text().catch(() => "");
  return { id, ok: false, status: res.status, message: body.slice(0, 300) || `HTTP ${res.status}` };
}

export interface ShareResult {
  id: string;
  ok: boolean;
  status: number;
  message?: string;
}

// Otorga un direct-share (read | read-write) a una lista de SSO ids (usuarios/grupos).
// Si ya existe un share de ese tipo (409), agrega los recipients al share existente.
export async function grantDirectShare(
  base: string,
  token: string,
  documentId: string,
  access: "read" | "read-write",
  recipients: { id: string; type: "user" | "group" }[],
  opts: { adminAccess?: boolean } = {}
): Promise<ShareResult> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";

  let res: Response;
  try {
    res = await dtFetch(base, token, `/direct-shares${admin}`, {
      method: "POST",
      body: JSON.stringify({ documentId, access, recipients }),
    });
  } catch (error) {
    return { id: documentId, ok: false, status: 0, message: (error as Error).message };
  }

  if (res.status === 201) return { id: documentId, ok: true, status: 201 };

  // Ya existe un share de ese tipo: buscarlo y agregar recipients.
  if (res.status === 409) {
    try {
      const filter = encodeURIComponent(`documentId='${documentId}'`);
      const listRes = await dtFetch(base, token, `/direct-shares?filter=${filter}${opts.adminAccess ? "&admin-access=true" : ""}`);
      if (listRes.ok) {
        const data = (await listRes.json()) as {
          directShares?: { id: string; access: string[] }[];
        };
        const wantWrite = access === "read-write";
        const existing = (data.directShares ?? []).find((s) =>
          wantWrite ? s.access.includes("write") : !s.access.includes("write")
        );
        if (existing) {
          const addRes = await dtFetch(
            base,
            token,
            `/direct-shares/${encodeURIComponent(existing.id)}/recipients/add`,
            { method: "POST", body: JSON.stringify({ recipients }) }
          );
          if (addRes.ok) return { id: documentId, ok: true, status: addRes.status };
          const b = await addRes.text().catch(() => "");
          return { id: documentId, ok: false, status: addRes.status, message: b.slice(0, 300) };
        }
      }
    } catch {
      /* cae al retorno de error de abajo */
    }
  }

  const body = await res.text().catch(() => "");
  return {
    id: documentId,
    ok: false,
    status: res.status,
    message: body.slice(0, 300) || `HTTP ${res.status}`,
  };
}

// ---------------------------------------------------------------------------
// Document Locking: bloquea/desbloquea un dashboard para que otros no lo editen.
// ---------------------------------------------------------------------------
export interface LockDetails {
  isLocked: boolean;
  isLockedByAnotherUser: boolean;
  lockedBy?: string;
  documentVersion: number;
}

export async function inspectLock(
  base: string,
  token: string,
  id: string,
  opts: { adminAccess?: boolean } = {}
): Promise<{ ok: true; details: LockDetails } | { ok: false; status: number; message: string }> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";
  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents/${encodeURIComponent(id)}:inspect-lock${admin}`);
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: body.slice(0, 200) || `HTTP ${res.status}` };
  }
  const details = (await res.json()) as LockDetails;
  return { ok: true, details };
}

export interface LockResult {
  id: string;
  ok: boolean;
  status: number;
  message?: string;
  lockedUntil?: string;
}

// Bloquea: primero inspecciona para obtener la version, luego adquiere el lock.
export async function lockDocument(
  base: string,
  token: string,
  id: string,
  durationSeconds = 600,
  opts: { adminAccess?: boolean } = {}
): Promise<LockResult> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";
  const inspected = await inspectLock(base, token, id, opts);
  if (!inspected.ok) return { id, ok: false, status: inspected.status, message: inspected.message };

  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents/${encodeURIComponent(id)}:acquire-lock${admin}`, {
      method: "POST",
      body: JSON.stringify({
        documentVersion: inspected.details.documentVersion,
        lockDurationInSeconds: durationSeconds,
      }),
    });
  } catch (error) {
    return { id, ok: false, status: 0, message: (error as Error).message };
  }

  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as { lockedUntil?: string };
    return { id, ok: true, status: res.status, lockedUntil: data.lockedUntil };
  }
  const body = await res.text().catch(() => "");
  return { id, ok: false, status: res.status, message: body.slice(0, 200) || `HTTP ${res.status}` };
}

export async function unlockDocument(
  base: string,
  token: string,
  id: string,
  opts: { adminAccess?: boolean } = {}
): Promise<LockResult> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";
  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents/${encodeURIComponent(id)}:release-lock${admin}`, {
      method: "POST",
    });
  } catch (error) {
    return { id, ok: false, status: 0, message: (error as Error).message };
  }
  if (res.ok) return { id, ok: true, status: res.status };
  const body = await res.text().catch(() => "");
  return { id, ok: false, status: res.status, message: body.slice(0, 200) || `HTTP ${res.status}` };
}

// ---------------------------------------------------------------------------
// Backup: descarga el contenido crudo (JSON) de un dashboard.
// ---------------------------------------------------------------------------
export async function downloadContent(
  base: string,
  token: string,
  id: string,
  opts: { adminAccess?: boolean } = {}
): Promise<{ ok: true; content: string; contentType: string } | { ok: false; status: number; message: string }> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";
  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents/${encodeURIComponent(id)}/content${admin}`);
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, message: body.slice(0, 200) || `HTTP ${res.status}` };
  }
  const content = await res.text();
  const contentType = res.headers.get("content-type") ?? "application/json";
  return { ok: true, content, contentType };
}

// ---------------------------------------------------------------------------
// Eliminar (mover a la papelera). Recuperable 30 dias. Bulk hasta 100 ids.
// ---------------------------------------------------------------------------
export async function trashDocuments(
  base: string,
  token: string,
  ids: string[],
  opts: { adminAccess?: boolean } = {}
): Promise<{ ok: boolean; status: number; results: { id: string; code: number }[]; message?: string }> {
  const admin = opts.adminAccess ? "?admin-access=true" : "";
  let res: Response;
  try {
    res = await dtFetch(base, token, `/documents:delete${admin}`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
  } catch (error) {
    return { ok: false, status: 0, results: [], message: (error as Error).message };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, results: [], message: body.slice(0, 300) || `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => ({}))) as { documents?: { id: string; code: number }[] };
  return { ok: true, status: res.status, results: data.documents ?? [] };
}

// ---------------------------------------------------------------------------
// Visibilidad: hace un dashboard PUBLICO (isPrivate=false) o privado de nuevo.
// Publico = todos los usuarios del entorno pueden LEERLO de inmediato, sin tener
// que reclamar nada (a diferencia del environment-share). Es lo que la gente
// espera al "compartir con el ambiente".
// Requiere optimistic-locking-version (la version actual del documento).
// ---------------------------------------------------------------------------
export interface VisibilityResult {
  id: string;
  ok: boolean;
  status: number;
  message?: string;
}

export async function setDocumentPublic(
  base: string,
  token: string,
  id: string,
  version: string,
  makePublic: boolean,
  opts: { adminAccess?: boolean } = {}
): Promise<VisibilityResult> {
  const qs = new URLSearchParams();
  qs.set("optimistic-locking-version", version);
  if (opts.adminAccess) qs.set("admin-access", "true");

  // multipart/form-data: NO seteamos Content-Type a mano (fetch pone el boundary).
  const form = new FormData();
  form.append("isPrivate", makePublic ? "false" : "true");

  let res: Response;
  try {
    res = await fetch(`${base}/documents/${encodeURIComponent(id)}?${qs.toString()}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { id, ok: false, status: 0, message: (error as Error).message };
  }
  if (res.ok) return { id, ok: true, status: res.status };
  const body = await res.text().catch(() => "");
  return { id, ok: false, status: res.status, message: body.slice(0, 300) || `HTTP ${res.status}` };
}

// ---------------------------------------------------------------------------
// Crear documento: usado para COPIAR un dashboard a otro entorno (se baja el
// contenido del origen y se crea un documento nuevo en el destino).
// ---------------------------------------------------------------------------
export async function createDocument(
  base: string,
  token: string,
  input: { name: string; type: string; content: string; contentType?: string }
): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> {
  const form = new FormData();
  form.append("name", input.name || "Untitled dashboard");
  form.append("type", input.type || "dashboard");
  form.append(
    "content",
    new Blob([input.content], { type: input.contentType || "application/json" }),
    "content.json"
  );

  let res: Response;
  try {
    res = await fetch(`${base}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, status: 0, message: (error as Error).message };
  }
  if (res.status === 201) {
    const data = (await res.json().catch(() => ({}))) as { id?: string; documentMetadata?: { id?: string } };
    return { ok: true, id: data.id ?? data.documentMetadata?.id ?? "" };
  }
  const body = await res.text().catch(() => "");
  return { ok: false, status: res.status, message: body.slice(0, 300) || `HTTP ${res.status}` };
}
