// archiver v8 es ESM y no publica tipos. Declaramos solo lo que usamos.
declare module "archiver" {
  import { Transform } from "node:stream";

  interface ArchiverOptions {
    zlib?: { level?: number };
  }

  interface GlobOptions {
    cwd?: string;
    dot?: boolean;
    ignore?: string[];
  }

  export class Archiver extends Transform {
    glob(pattern: string, options?: GlobOptions): this;
    finalize(): Promise<void>;
    append(source: unknown, data?: Record<string, unknown>): this;
  }

  export class ZipArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class TarArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }

  export class JsonArchive extends Archiver {
    constructor(options?: ArchiverOptions);
  }
}
