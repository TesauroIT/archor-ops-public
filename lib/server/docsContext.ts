import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { buildDocumentsBase } from "@/lib/server/dynatraceDocuments";
import type { AccountCreds } from "@/lib/server/dynatraceAccount";

export interface DocsContext {
  base: string;
  token: string;
  environmentName: string;
  iam: AccountCreds | null; // credenciales para resolver SSO id -> email (si estan configuradas)
}

// Carga el entorno, valida que tenga Platform token y arma la base de la
// Document API. Devuelve un error legible si falta configuracion.
export async function getDocsContext(
  environmentId: string
): Promise<{ ctx: DocsContext } | { error: string; status: number }> {
  const environment = await prisma.environment.findUnique({ where: { id: environmentId } });
  if (!environment) return { error: "Environment no encontrado.", status: 404 };

  if (!environment.platformTokenCipher) {
    return {
      error:
        "Este entorno no tiene un Platform token configurado. Editalo y agregalo para gestionar dashboards.",
      status: 400,
    };
  }

  let base: string;
  try {
    base = buildDocumentsBase(environment);
  } catch (e) {
    return { error: (e as Error).message, status: 400 };
  }

  const iam: AccountCreds | null =
    environment.accountUuid && environment.oauthClientId && environment.oauthClientCipher
      ? {
          accountUuid: environment.accountUuid,
          clientId: environment.oauthClientId,
          clientSecret: decryptToken(environment.oauthClientCipher),
        }
      : null;

  return {
    ctx: {
      base,
      token: decryptToken(environment.platformTokenCipher),
      environmentName: environment.name,
      iam,
    },
  };
}
