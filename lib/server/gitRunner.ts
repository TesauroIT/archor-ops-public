import fs from "node:fs/promises";
import path from "node:path";
import { simpleGit } from "simple-git";

// Cada Environment tiene su propia carpeta = su propio repo Git local.
// Nunca se configura un remoto: esto es solo historial/versionado local,
// nada sale del disco del servidor (ver specs/design.md, seccion 5).

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureRepo(localPath: string): Promise<void> {
  await fs.mkdir(localPath, { recursive: true });

  // Los logs de Monaco (.logs/) no son configuracion: no deben entrar en los
  // commits de backup. Se asegura tambien en repos ya existentes.
  const gitignorePath = path.join(localPath, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    await fs.writeFile(gitignorePath, ".logs/\n", "utf8");
  }

  const gitDir = path.join(localPath, ".git");
  if (await pathExists(gitDir)) return;

  const git = simpleGit(localPath);
  await git.init();
  // Config local al repo (no global) para que los commits funcionen sin
  // depender de que el servidor tenga `git config --global` configurado.
  await git.addConfig("user.name", "Archon Ops Bot", false, "local");
  await git.addConfig("user.email", "archon-ops@local", false, "local");
}

export async function commitAll(localPath: string, message: string): Promise<string | null> {
  const git = simpleGit(localPath);
  await git.add(["-A"]);

  const status = await git.status();
  if (status.staged.length === 0 && status.files.length === 0) {
    return null; // nada que versionar, evita commits vacios
  }

  const result = await git.commit(message);
  return result.commit || null;
}

export interface CommitLogEntry {
  hash: string;
  date: string;
  message: string;
}

export async function listCommits(localPath: string, limit = 50): Promise<CommitLogEntry[]> {
  if (!(await pathExists(path.join(localPath, ".git")))) return [];

  const git = simpleGit(localPath);
  try {
    const log = await git.log({ maxCount: limit });
    return log.all.map((entry) => ({
      hash: entry.hash,
      date: entry.date,
      message: entry.message,
    }));
  } catch {
    return []; // repo recien inicializado, todavia sin commits
  }
}

export async function diffCommit(localPath: string, hash: string): Promise<string> {
  const git = simpleGit(localPath);
  return git.show([hash]);
}

// Recorta el historial del repo a los ultimos `keep` commits (retencion de
// backups). El historial es siempre lineal (solo commitAll sobre una rama),
// asi que se crea una nueva raiz con el arbol del commit mas viejo a conservar
// y se re-aplican los commits posteriores encima. Devuelve cuantos commits
// se eliminaron (0 si no hacia falta podar).
export async function pruneHistory(localPath: string, keep: number): Promise<number> {
  if (keep < 1) return 0;
  if (!(await pathExists(path.join(localPath, ".git")))) return 0;

  const git = simpleGit(localPath);
  const log = await git.log().catch(() => null);
  if (!log || log.total <= keep) return 0;

  const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  const oldestKept = log.all[keep - 1].hash; // log viene de mas nuevo a mas viejo
  const removed = log.total - keep;
  const tempBranch = "__prune_temp";

  try {
    // Nueva raiz huerfana con el mismo arbol que el commit mas viejo a conservar.
    await git.raw(["checkout", "--orphan", tempBranch, oldestKept]);
    await git.raw(["commit", "-m", `${log.all[keep - 1].message} (historial truncado)`, "--no-verify"]);
    // Re-aplica los commits posteriores a oldestKept sobre la nueva raiz.
    await git.raw(["rebase", "--onto", tempBranch, oldestKept, branch]);
    await git.raw(["branch", "-D", tempBranch]);
  } catch (error) {
    // Restaurar el repo a la rama original; el historial viejo sigue intacto.
    await git.raw(["rebase", "--abort"]).catch(() => undefined);
    await git.raw(["checkout", "-f", branch]).catch(() => undefined);
    await git.raw(["branch", "-D", tempBranch]).catch(() => undefined);
    throw error;
  }

  // Limpieza best-effort: si gc falla (p.ej. archivos bloqueados en Windows)
  // la poda logica ya se hizo igual.
  await git.raw(["reflog", "expire", "--expire=now", "--all"]).catch(() => undefined);
  await git.raw(["gc", "--prune=now"]).catch(() => undefined);

  return removed;
}
