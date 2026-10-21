// Cliente de la Dynatrace Account Management API para resolver SSO id -> email.
// Flujo OAuth client_credentials contra sso.dynatrace.com, luego listado de
// usuarios de la cuenta en api.dynatrace.com.
//
// Requiere un OAuth client de cuenta (client id dt0s02..., secret) con el
// permiso account-idm-read, y el account UUID.

const SSO_TOKEN_URL = "https://sso.dynatrace.com/sso/oauth2/token";
const ACCOUNT_API_BASE = "https://api.dynatrace.com";
const TIMEOUT_MS = 20_000;

// El OAuth client de cuenta muestra un "Dynatrace URN" tipo
// urn:dtaccount:<uuid>. La Account API necesita el <uuid> pelado en la ruta,
// y el token OAuth el URN completo. Aceptamos cualquiera de los dos.
export function normalizeAccountUuid(input: string): string {
  return input.trim().replace(/^urn:dtaccount:/i, "").trim();
}

export interface AccountUser {
  uid: string;
  email: string;
}

export interface AccountCreds {
  accountUuid: string;
  clientId: string;
  clientSecret: string;
}

// Pide un token OAuth para la Account API con el scope indicado. Cada
// funcionalidad pide solo el scope que necesita: asi, si al OAuth client le
// falta un permiso, falla solo esa seccion y no todas.
export async function getAccessToken(
  creds: AccountCreds,
  scope = "account-idm-read"
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope,
    resource: `urn:dtaccount:${creds.accountUuid}`,
  });

  const res = await fetch(SSO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth token fallo (HTTP ${res.status}). ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("OAuth token: respuesta sin access_token.");
  return data.access_token;
}

// Lista los usuarios de la cuenta. La API pagina; seguimos si hace falta.
export async function listAccountUsers(creds: AccountCreds): Promise<AccountUser[]> {
  const token = await getAccessToken(creds);
  const res = await fetch(
    `${ACCOUNT_API_BASE}/iam/v1/accounts/${encodeURIComponent(creds.accountUuid)}/users`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Listado de usuarios fallo (HTTP ${res.status}). ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    items?: { uid?: string; email?: string }[];
    users?: { uid?: string; email?: string }[];
  };
  const rows = data.items ?? data.users ?? [];
  return rows
    .filter((u): u is { uid: string; email: string } => !!u.uid && !!u.email)
    .map((u) => ({ uid: u.uid, email: u.email }));
}

export interface AccountUserDetail {
  uid: string;
  email: string;
  userStatus: string | null;
  lastSuccessfulLogin: string | null;
}

// Version detallada del listado de usuarios: incluye estado y ultimo login,
// para las metricas de usuarios del panel de consumo.
export async function listAccountUsersDetailed(creds: AccountCreds): Promise<AccountUserDetail[]> {
  const token = await getAccessToken(creds);
  const res = await fetch(
    `${ACCOUNT_API_BASE}/iam/v1/accounts/${encodeURIComponent(creds.accountUuid)}/users`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Listado de usuarios fallo (HTTP ${res.status}). ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    items?: {
      uid?: string;
      email?: string;
      userStatus?: string;
      userLoginMetadata?: { lastSuccessfulLogin?: string };
    }[];
  };
  return (data.items ?? [])
    .filter((u): u is NonNullable<typeof u> & { uid: string; email: string } => !!u.uid && !!u.email)
    .map((u) => ({
      uid: u.uid,
      email: u.email,
      userStatus: u.userStatus ?? null,
      lastSuccessfulLogin: u.userLoginMetadata?.lastSuccessfulLogin ?? null,
    }));
}

export interface ResolvedUsers {
  ok: boolean;
  users: AccountUser[];
  byUid: Record<string, string>; // uid -> email
  error?: string;
}

// Resuelve el mapa uid->email de forma tolerante a fallos: si algo falla,
// devuelve ok:false con el error, sin romper la vista de dashboards.
export async function resolveUsers(creds: AccountCreds): Promise<ResolvedUsers> {
  try {
    const users = await listAccountUsers(creds);
    const byUid: Record<string, string> = {};
    for (const u of users) byUid[u.uid] = u.email;
    return { ok: true, users, byUid };
  } catch (error) {
    return { ok: false, users: [], byUid: {}, error: (error as Error).message };
  }
}
