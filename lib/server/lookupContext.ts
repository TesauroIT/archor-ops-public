import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";
import { buildAppsHost } from "@/lib/server/dynatraceResourceStore";

// Contexto para las operaciones de lookups (Resource Store + Query API).
// Reutiliza el Platform token del entorno (el mismo de los dashboards), asi que
// para que estas operaciones funcionen ese token debe incluir ademas los
// permisos storage:files:* y storage:buckets:read.
export interface LookupContext {
  appsHost: string;
  token: string;
  environmentName: string;
}

export async function getLookupContext(
  environmentId: string
): Promise<{ ctx: LookupContext } | { error: string; status: number }> {
  const environment = await prisma.environment.findUnique({ where: { id: environmentId } });
  if (!environment) return { error: "Environment no encontrado.", status: 404 };

  if (!environment.platformTokenCipher) {
    return {
      error:
        "Este entorno no tiene un Platform token configurado. Editalo y agregalo para gestionar lookups.",
      status: 400,
    };
  }

  let appsHost: string;
  try {
    appsHost = buildAppsHost(environment);
  } catch (e) {
    return { error: (e as Error).message, status: 400 };
  }

  return {
    ctx: {
      appsHost,
      token: decryptToken(environment.platformTokenCipher),
      environmentName: environment.name,
    },
  };
}
