// Utilidades de dominio Dynatrace: armado de URL a partir del ID del entorno,
// scopes de token requeridos por Monaco, y prueba de conexion.
//
// Referencias:
// https://docs.dynatrace.com/docs/deliver/configuration-as-code/monaco/configuration
// https://docs.dynatrace.com/docs/manage/access-control/access-tokens

export const SAAS_SUFFIX = "live.dynatrace.com";

// A partir de un ID de entorno SaaS (ej. "abc12345") arma la URL estandar.
// Si el usuario pega una URL completa o un "id.live.dynatrace.com", extrae el ID.
export function normalizeEnvId(input: string): string {
  let value = input.trim();
  if (!value) return "";

  // Si viene una URL completa, quedarnos con el hostname.
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      // seguimos con el string tal cual
    }
  }

  // Si es un host tipo "abc12345.live.dynatrace.com", tomar la primera etiqueta.
  if (value.includes(".")) {
    value = value.split(".")[0];
  }

  return value;
}

export function buildSaasUrl(envId: string): string {
  return `https://${envId}.${SAAS_SUFFIX}`;
}

// Scopes que necesita el token de Dynatrace segun la operacion. Son los scopes
// nucleo; segun los tipos de configuracion que gestiones pueden requerirse mas.
export interface ScopeInfo {
  scope: string;
  description: string;
}

export const DOWNLOAD_SCOPES: ScopeInfo[] = [
  { scope: "ReadConfig", description: "Leer configuraciones (Config API v1/v2)" },
  { scope: "settings.read", description: "Leer objetos de Settings 2.0" },
];

export const DEPLOY_SCOPES: ScopeInfo[] = [
  { scope: "WriteConfig", description: "Escribir configuraciones (Config API v1/v2)" },
  { scope: "settings.write", description: "Escribir objetos de Settings 2.0" },
];

export interface TestConnectionResult {
  ok: boolean;
  status: number | null;
  message: string;
  clusterVersion?: string;
}

// Prueba de conexion contra el endpoint que Monaco consulta primero:
// GET {url}/api/v1/config/clusterversion. Permite distinguir URL mala,
// token invalido y falta de permisos ANTES de disparar un job completo.
export async function testConnection(
  url: string,
  token: string
): Promise<TestConnectionResult> {
  const base = url.replace(/\/+$/, "");
  const endpoint = `${base}/api/v1/config/clusterversion`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Api-Token ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: `No se pudo conectar a ${base}. Verifica la URL/ID del entorno y la conectividad de red. (${(error as Error).message})`,
    };
  }

  if (response.ok) {
    let clusterVersion: string | undefined;
    try {
      const data = (await response.json()) as { version?: string };
      clusterVersion = data.version;
    } catch {
      // respuesta sin JSON valido, no es critico
    }
    return {
      ok: true,
      status: response.status,
      message: clusterVersion
        ? `Conexion OK. Version del cluster: ${clusterVersion}.`
        : "Conexion OK.",
      clusterVersion,
    };
  }

  const messagesByStatus: Record<number, string> = {
    401: "Token invalido o expirado (401). Revisa el API token.",
    403: "El token es valido pero le falta el scope requerido, ej. ReadConfig (403).",
    404: "URL incorrecta o ID de entorno inexistente (404). No parece un entorno Dynatrace valido.",
  };

  return {
    ok: false,
    status: response.status,
    message:
      messagesByStatus[response.status] ??
      `La verificacion fallo con codigo HTTP ${response.status}.`,
  };
}
