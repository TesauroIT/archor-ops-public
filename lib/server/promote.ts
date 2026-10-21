import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TOKEN_ENV_VAR } from "@/lib/server/monacoRunner";

// Promocion / deploy cross-tenant: toma el backup de un entorno origen
// (carpeta project/) y lo despliega en un entorno destino, generando un
// manifest que apunta al destino. Opcionalmente filtra por tipos de config
// (subcarpetas de project/). Ver specs/design.md.

const PROJECT_DIR = "project";

// Lista los tipos de config disponibles en el backup (subcarpetas de project/).
export async function listConfigTypes(sourceLocalPath: string): Promise<string[]> {
  const projectPath = path.join(sourceLocalPath, PROJECT_DIR);
  if (!fs.existsSync(projectPath)) return [];
  const dirents = await fsp.readdir(projectPath, { withFileTypes: true });
  return dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

// Manifest que referencia el project/ local y apunta al entorno destino.
// El token se resuelve por variable de entorno (TOKEN_ENV_VAR) en runtime.
function buildTargetManifest(targetUrl: string): string {
  return [
    'manifestVersion: "1.0"',
    "projects:",
    `- name: ${PROJECT_DIR}`,
    "environmentGroups:",
    "- name: default",
    "  environments:",
    "  - name: target",
    "    url:",
    `      value: ${targetUrl}`,
    "    auth:",
    "      token:",
    "        type: environment",
    `        name: ${TOKEN_ENV_VAR}`,
    "",
  ].join("\n");
}

export interface PreparedDeploy {
  cwd: string;
  manifestName: string;
  cleanup: () => Promise<void>;
}

// Prepara el directorio de trabajo para el deploy:
// - Sin filtro (configTypes null/vacio): escribe un manifest temporal dentro de
//   la carpeta origen y despliega desde ahi (evita copiar miles de archivos).
// - Con filtro: crea un directorio temporal con project/<tipo> solo para los
//   tipos elegidos + el manifest, y despliega desde ahi.
export async function prepareDeploy(
  sourceLocalPath: string,
  targetUrl: string,
  configTypes: string[] | null
): Promise<PreparedDeploy> {
  const manifestBody = buildTargetManifest(targetUrl);

  if (!configTypes || configTypes.length === 0) {
    const manifestName = `.deploy-${randomUUID()}.yaml`;
    const manifestPath = path.join(sourceLocalPath, manifestName);
    await fsp.writeFile(manifestPath, manifestBody, "utf8");
    return {
      cwd: sourceLocalPath,
      manifestName,
      cleanup: async () => {
        await fsp.rm(manifestPath, { force: true });
      },
    };
  }

  const dataDir = process.env.DATA_DIR ?? "./data";
  const tmpRoot = path.resolve(dataDir, ".tmp", randomUUID());
  const tmpProject = path.join(tmpRoot, PROJECT_DIR);
  await fsp.mkdir(tmpProject, { recursive: true });

  const sourceProject = path.join(sourceLocalPath, PROJECT_DIR);
  for (const type of configTypes) {
    const from = path.join(sourceProject, type);
    const to = path.join(tmpProject, type);
    if (fs.existsSync(from)) {
      await fsp.cp(from, to, { recursive: true });
    }
  }

  const manifestName = "deploy-manifest.yaml";
  await fsp.writeFile(path.join(tmpRoot, manifestName), manifestBody, "utf8");

  return {
    cwd: tmpRoot,
    manifestName,
    cleanup: async () => {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    },
  };
}

// Normaliza la seleccion de tipos a un string JSON estable (ordenado) para
// comparar dry-runs con deploys reales en el gating.
export function normalizeConfigTypes(types: string[] | null | undefined): string | null {
  if (!types || types.length === 0) return null;
  return JSON.stringify([...types].sort((a, b) => a.localeCompare(b)));
}
