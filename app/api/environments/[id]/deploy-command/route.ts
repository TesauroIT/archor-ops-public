import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getInvocation, TOKEN_ENV_VAR } from "@/lib/server/monacoRunner";

// Devuelve el comando de Monaco que ejecutaria un deploy hacia este entorno
// (destino), para mostrarlo en el dialogo de confirmacion y que el operador
// pueda copiarlo y ejecutarlo por su cuenta si prefiere. No expone secretos:
// el token siempre va por variable de entorno, nunca en la linea de comando.
//
// ?source=<environmentId>  -> promote: el backup de otro entorno (origen).
// sin source               -> self-deploy: el manifest del propio entorno.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = await prisma.environment.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Environment no encontrado." }, { status: 404 });

  const sourceId = request.nextUrl.searchParams.get("source");
  let cwd = target.localPath;
  if (sourceId) {
    const source = await prisma.environment.findUnique({ where: { id: sourceId } });
    if (!source) {
      return NextResponse.json({ error: "Entorno origen no encontrado." }, { status: 404 });
    }
    cwd = source.localPath;
  }

  // Para DEPLOY la linea de comando no depende del token ni de la URL (van en
  // el manifest / variable de entorno), asi que el target real no importa aca.
  const invocation = getInvocation("DEPLOY", {
    url: target.url,
    decryptedToken: "",
    localPath: cwd,
    environmentName: target.name,
  });

  return NextResponse.json({
    commandLine: invocation.commandLine,
    cwd,
    tokenEnvVar: TOKEN_ENV_VAR,
    targetUrl: target.url,
    isPromote: !!sourceId,
  });
}
