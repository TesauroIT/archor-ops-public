import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
// archiver v8 es ESM y expone clases por formato (sin factory ni `create`).
import { ZipArchive } from "archiver";

// Acceso al filesystem de la carpeta de un entorno, siempre acotado a su
// localPath (proteccion contra path traversal). El .git se excluye de las
// vistas para no ensuciar el arbol; el historial se ve en la seccion Git.

const HIDDEN_FROM_TREE = new Set([".git"]);
const MAX_TEXT_BYTES = 512 * 1024; // 512 KB tope para previsualizar archivos

// Resuelve `rel` dentro de `root` y verifica que no se escape del root.
export function safeResolve(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("Ruta fuera del entorno.");
  }
  return target;
}

export interface DirEntry {
  name: string;
  type: "dir" | "file";
  size: number;
  /** Para carpetas: cantidad de archivos que contiene (recursivo). */
  fileCount?: number;
}

// Cuenta archivos y bytes recursivamente (excluye .git).
async function walkCount(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let dirents: fs.Dirent[];
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const dirent of dirents) {
    if (HIDDEN_FROM_TREE.has(dirent.name)) continue;
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      const sub = await walkCount(full);
      files += sub.files;
      bytes += sub.bytes;
    } else if (dirent.isFile()) {
      files += 1;
      try {
        bytes += (await fsp.stat(full)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return { files, bytes };
}

export interface Listing {
  type: "dir";
  path: string;
  entries: DirEntry[];
}

export interface FileContent {
  type: "file";
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content: string;
}

export type BrowseResult = Listing | FileContent;

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 1024);
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export async function browse(root: string, rel: string): Promise<BrowseResult> {
  const target = safeResolve(root, rel);
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(target);
  } catch {
    throw new Error("No existe la ruta.");
  }

  if (stat.isDirectory()) {
    const dirents = await fsp.readdir(target, { withFileTypes: true });
    const entries: DirEntry[] = [];
    for (const dirent of dirents) {
      if (HIDDEN_FROM_TREE.has(dirent.name)) continue;
      const full = path.join(target, dirent.name);
      if (dirent.isDirectory()) {
        const { files } = await walkCount(full);
        entries.push({ name: dirent.name, type: "dir", size: 0, fileCount: files });
      } else {
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          size = 0;
        }
        entries.push({ name: dirent.name, type: "file", size });
      }
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { type: "dir", path: rel, entries };
  }

  const buffer = await fsp.readFile(target);
  const binary = looksBinary(buffer);
  const truncated = buffer.length > MAX_TEXT_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_TEXT_BYTES) : buffer;
  return {
    type: "file",
    path: rel,
    size: buffer.length,
    truncated,
    binary,
    content: binary ? "" : slice.toString("utf8"),
  };
}

export interface BackupStats {
  totalFiles: number;
  totalBytes: number;
  byTopFolder: { name: string; files: number; bytes: number }[];
  exists: boolean;
}

// Recorre el arbol y agrega conteos por carpeta de primer nivel (proyecto/tipo).
export async function computeStats(root: string): Promise<BackupStats> {
  const base = path.resolve(root);
  if (!fs.existsSync(base)) {
    return { totalFiles: 0, totalBytes: 0, byTopFolder: [], exists: false };
  }

  const byTop = new Map<string, { files: number; bytes: number }>();
  let totalFiles = 0;
  let totalBytes = 0;

  async function walk(dir: string, topLabel: string | null) {
    const dirents = await fsp.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (HIDDEN_FROM_TREE.has(dirent.name)) continue;
      const full = path.join(dir, dirent.name);
      const label = topLabel ?? dirent.name;
      if (dirent.isDirectory()) {
        await walk(full, label);
      } else if (dirent.isFile()) {
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          size = 0;
        }
        totalFiles += 1;
        totalBytes += size;
        const key = topLabel ?? "(raiz)";
        const acc = byTop.get(key) ?? { files: 0, bytes: 0 };
        acc.files += 1;
        acc.bytes += size;
        byTop.set(key, acc);
      }
    }
  }

  await walk(base, null);

  const byTopFolder = Array.from(byTop.entries())
    .map(([name, v]) => ({ name, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.files - a.files);

  return { totalFiles, totalBytes, byTopFolder, exists: true };
}

export interface ConfigTypeStat {
  name: string;
  files: number;
  bytes: number;
}

// Conteo por tipo de config: cada subcarpeta de project/ es un tipo
// (application-web, builtinalerting.profile, ...). Ordenado desc por archivos.
export async function computeConfigTypeStats(root: string): Promise<ConfigTypeStat[]> {
  const projectPath = path.join(path.resolve(root), "project");
  if (!fs.existsSync(projectPath)) return [];

  let dirents: fs.Dirent[];
  try {
    dirents = await fsp.readdir(projectPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const stats: ConfigTypeStat[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const { files, bytes } = await walkCount(path.join(projectPath, dirent.name));
    stats.push({ name: dirent.name, files, bytes });
  }
  stats.sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  return stats;
}

export interface BackupSummary {
  stats: BackupStats;
  configTypes: ConfigTypeStat[];
}

// Recorre el arbol UNA sola vez y produce a la vez: totales, desglose por
// carpeta de primer nivel, y desglose por tipo de config (subcarpeta de
// project/). Evita 2-3 walks separados sobre miles de archivos.
export async function computeBackupSummary(root: string): Promise<BackupSummary> {
  const base = path.resolve(root);
  if (!fs.existsSync(base)) {
    return {
      stats: { totalFiles: 0, totalBytes: 0, byTopFolder: [], exists: false },
      configTypes: [],
    };
  }

  const byTop = new Map<string, { files: number; bytes: number }>();
  const byType = new Map<string, { files: number; bytes: number }>();
  let totalFiles = 0;
  let totalBytes = 0;

  async function walk(dir: string, topLabel: string | null, typeLabel: string | null) {
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (HIDDEN_FROM_TREE.has(dirent.name)) continue;
      const full = path.join(dir, dirent.name);
      const childTop = topLabel ?? dirent.name;
      // El tipo de config es la 1ra subcarpeta dentro de project/.
      const childType =
        topLabel === "project" && typeLabel === null ? dirent.name : typeLabel;

      if (dirent.isDirectory()) {
        await walk(full, childTop, childType);
      } else if (dirent.isFile()) {
        let size = 0;
        try {
          size = (await fsp.stat(full)).size;
        } catch {
          size = 0;
        }
        totalFiles += 1;
        totalBytes += size;

        const topKey = topLabel ?? "(raiz)";
        const topAcc = byTop.get(topKey) ?? { files: 0, bytes: 0 };
        topAcc.files += 1;
        topAcc.bytes += size;
        byTop.set(topKey, topAcc);

        if (typeLabel) {
          const typeAcc = byType.get(typeLabel) ?? { files: 0, bytes: 0 };
          typeAcc.files += 1;
          typeAcc.bytes += size;
          byType.set(typeLabel, typeAcc);
        }
      }
    }
  }

  await walk(base, null, null);

  const byTopFolder = Array.from(byTop.entries())
    .map(([name, v]) => ({ name, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.files - a.files);

  const configTypes = Array.from(byType.entries())
    .map(([name, v]) => ({ name, files: v.files, bytes: v.bytes }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  return {
    stats: { totalFiles, totalBytes, byTopFolder, exists: true },
    configTypes,
  };
}

// Crea un stream ZIP de toda la carpeta del entorno (sin .git).
export function zipDirectory(root: string): Readable {
  // level 6 (default): buen balance velocidad/tamano para backups grandes.
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.glob("**/*", { cwd: root, dot: true, ignore: [".git/**", ".git"] });
  archive.finalize();
  return archive;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}
