import path from "node:path";
import { spawn } from "node:child_process";
import { sanitizeLogOutput } from "@/lib/crypto";

// Referencia de la CLI real de Monaco:
// https://docs.dynatrace.com/docs/deliver/configuration-as-code/monaco/configuration
// https://github.com/Dynatrace/dynatrace-configuration-as-code
//
// Nota importante sobre `--token`: Monaco espera el NOMBRE de una variable de
// entorno que contiene el token, no el token en si. Por eso pasamos el nombre
// (TOKEN_ENV_VAR) como valor de `--token` y el token real va en el entorno del
// proceso hijo. Esto tambien evita que el secreto aparezca en la linea de
// comando / en `ps`.

export const TOKEN_ENV_VAR = "MONACO_ENV_TOKEN";

export type JobType = "DEPLOY" | "BACKUP";

export interface RunnerTarget {
  url: string;
  decryptedToken: string;
  localPath: string;
  environmentName: string;
}

export interface RunResult {
  exitCode: number | null;
  timedOut: boolean;
}

export type OnOutput = (chunk: string) => void;

export interface Invocation {
  binPath: string;
  args: string[];
  /** Linea de comando legible para mostrar en la UI (sin el token real). */
  commandLine: string;
}

function buildDeployArgs(dryRun: boolean, manifestName: string): string[] {
  // Deploy usa un manifest presente en el directorio de trabajo.
  const args = ["deploy", manifestName, "--verbose"];
  if (dryRun) args.push("--dry-run");
  return args;
}

function buildDownloadArgs(target: RunnerTarget): string[] {
  return [
    "download",
    "--url",
    target.url,
    "--token",
    TOKEN_ENV_VAR,
    "--output-folder",
    ".",
    "--force",
  ];
}

export function getInvocation(
  type: JobType,
  target: RunnerTarget,
  opts: { dryRun?: boolean; manifestName?: string } = {}
): Invocation {
  const binPath = process.env.MONACO_BIN_PATH ?? "monaco";
  const args =
    type === "DEPLOY"
      ? buildDeployArgs(opts.dryRun ?? false, opts.manifestName ?? "manifest.yaml")
      : buildDownloadArgs(target);
  const displayBin = path.basename(binPath).replace(/\.exe$/i, "");
  const commandLine = [displayBin, ...args]
    .map((part) => (part.includes(" ") ? `"${part}"` : part))
    .join(" ");
  return { binPath, args, commandLine };
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min: un deploy/download grande puede tardar

export function runInvocation(
  invocation: Invocation,
  cwd: string,
  decryptedToken: string,
  onOutput: OnOutput,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.binPath, invocation.args, {
      cwd,
      env: { ...process.env, [TOKEN_ENV_VAR]: decryptedToken },
      shell: false,
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ exitCode: null, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      onOutput(sanitizeLogOutput(data.toString("utf8")));
    });
    child.stderr.on("data", (data: Buffer) => {
      onOutput(sanitizeLogOutput(data.toString("utf8")));
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut: false });
    });
  });
}
