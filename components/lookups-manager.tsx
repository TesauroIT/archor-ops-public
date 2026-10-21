"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Trash2, Upload, Eye, FileText, UploadCloud, Copy, X, Server, Database, HardDriveUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormSection } from "@/components/ui/form-section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";

export interface LookupEnvOption {
  id: string;
  label: string;
  hasPlatformToken: boolean;
}

interface LookupFile {
  filePath: string;
  displayName?: string | null;
  description?: string | null;
  records?: number | null;
  sizeBytes?: number | null;
  updatedAt?: string | null;
}

// Formatea bytes de forma legible (o "—" si no viene).
function fmtBytes(n?: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// DQL para consumir un archivo almacenado en Grail.
function loadDql(path: string): string {
  return `load "${path}"`;
}

const ACCEPT = ".csv,.jsonl,.json,.xml,.txt,.tsv";
const MAX_BYTES = 100 * 1024 * 1024; // limite de Dynatrace: 100 MB
const EDITABLE_MAX = 1 * 1024 * 1024; // hasta 1 MB se carga al textarea editable
const SAMPLE_BYTES = 256 * 1024; // muestra para el preview (test-pattern)

function fmtMB(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Nombre de campo DPL válido: sin espacios ni símbolos, no empieza con dígito.
function sanitizeField(name: string, i: number): string {
  const s = name
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1");
  return s || `column_${i + 1}`;
}

// Detecta el separador más probable contando ocurrencias en la primera línea.
function detectSeparator(line: string): string {
  let best = ",";
  let bestCount = 0;
  for (const c of [",", ";", "\t", "|"]) {
    const n = line.split(c).length - 1;
    if (n > bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

// La primera fila parece encabezado si ningún token es numérico.
function looksLikeHeader(line: string, sep: string): boolean {
  const toks = line.split(sep).map((t) => t.trim()).filter((t) => t !== "");
  return toks.length > 0 && toks.every((t) => Number.isNaN(Number(t)));
}

// Literal del separador para el patrón DPL (tab se escapa).
function dplSepLiteral(sep: string): string {
  return sep === "\t" ? "'\\t'" : `'${sep}'`;
}

// Patrón DPL base: un LD por columna, unidos por el separador. Si hay encabezado
// usa esos nombres; si no, genera column_1..N.
function buildDplPattern(
  firstLine: string,
  sep: string,
  hasHeader: boolean
): { pattern: string; fields: string[] } {
  const toks = firstLine.split(sep);
  const fields = toks.map((t, i) => (hasHeader ? sanitizeField(t, i) : `column_${i + 1}`));
  const pattern = fields.map((f) => `LD:${f}`).join(` ${dplSepLiteral(sep)} `);
  return { pattern, fields };
}

export function LookupsManager({ environments }: { environments: LookupEnvOption[] }) {
  const { dict, f } = useI18n();
  const t = dict.lookups;

  const SEPARATORS = [
    { label: t.separators.comma, value: "," },
    { label: t.separators.semicolon, value: ";" },
    { label: t.separators.tab, value: "\t" },
    { label: t.separators.pipe, value: "|" },
  ];

  async function copyText(text: string, label = "DQL") {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(f(t.copySuccess, { label }));
    } catch {
      toast.error(t.copyFailed);
    }
  }

  const [envId, setEnvId] = useState<string>("");
  const [files, setFiles] = useState<LookupFile[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Formulario de subida.
  const [filePath, setFilePath] = useState("/lookups/");
  const [parsePattern, setParsePattern] = useState("");
  const [lookupField, setLookupField] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [file, setFile] = useState<File | null>(null); // archivo crudo (para stream de grandes)
  const [content, setContent] = useState(""); // texto editable (solo archivos chicos)
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Para autogenerar el patrón DPL a partir del archivo.
  const [firstLine, setFirstLine] = useState<string | null>(null);
  const [separator, setSeparator] = useState<string>(",");
  const [hasHeader, setHasHeader] = useState<boolean>(true);
  const [isJson, setIsJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{ recordCount?: number; rows: Record<string, unknown>[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEnv = environments.find((e) => e.id === envId);

  async function refreshList(id = envId) {
    if (!id) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/environments/${id}/lookups`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t.listFailed);
      setFiles(data.files ?? []);
    } catch (e) {
      toast.error((e as Error).message);
      setFiles([]);
    } finally {
      setLoadingList(false);
    }
  }

  const onSelectEnv = (id: string | null) => {
    if (!id) return;
    setEnvId(id);
    setFiles([]);
    setPreview(null);
    void refreshList(id);
  };

  // Toma un archivo soltado/elegido. NO carga el contenido completo en memoria si
  // es grande: guarda el File (para subirlo como stream) y solo lee un preview.
  // Rechaza archivos que superen el límite de Dynatrace (100 MB).
  async function handleFile(fObj: File) {
    if (fObj.size > MAX_BYTES) {
      toast.error(f(t.fileTooBigError, { size: fmtMB(fObj.size) }));
      return;
    }

    setFile(fObj);
    setFileName(fObj.name);
    // Solo materializamos el texto en el estado para archivos chicos (editables).
    // Los grandes se suben directo desde el File, sin string en memoria.
    setContent(fObj.size <= EDITABLE_MAX ? await fObj.text() : "");

    const base = fObj.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!filePath.trim() || filePath.trim() === "/lookups/") {
      setFilePath(`/lookups/${base}`);
    }
    if (!displayName.trim()) setDisplayName(fObj.name.replace(/\.[^.]+$/, ""));

    // Leemos solo la primera línea (aun para archivos grandes) para autogenerar
    // el patrón DPL: un LD por columna + el separador detectado.
    const head = (await fObj.slice(0, 64 * 1024).text()).split(/\r?\n/)[0] ?? "";
    setFirstLine(head);

    const ext = fObj.name.split(".").pop()?.toLowerCase();
    if (ext === "json" || ext === "jsonl") {
      setIsJson(true);
      setParsePattern("JSON:json");
      return;
    }
    setIsJson(false);
    if (head) {
      const sep = detectSeparator(head);
      const header = looksLikeHeader(head, sep);
      setSeparator(sep);
      setHasHeader(header);
      const { pattern, fields } = buildDplPattern(head, sep, header);
      setParsePattern(pattern);
      setLookupField(fields[0] ?? "");
    }
  }

  // Regenera el patrón DPL desde la primera línea con el separador/encabezado
  // actuales (o los que se pasen). Se usa en el botón y al cambiar los controles.
  function regeneratePattern(sep = separator, header = hasHeader) {
    if (!firstLine) return;
    const { pattern, fields } = buildDplPattern(firstLine, sep, header);
    setParsePattern(pattern);
    if (!lookupField.trim() && fields[0]) setLookupField(fields[0]);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) void handleFile(droppedFile);
  }

  function clearFile() {
    setFile(null);
    setContent("");
    setFileName(null);
    setPreview(null);
    setFirstLine(null);
    setIsJson(false);
  }

  // Cuántas filas saltar: 1 si la primera es encabezado (y no es JSON).
  const skippedRecords = !isJson && hasHeader ? 1 : 0;

  // El blob a subir: si el usuario editó el texto (archivo chico) usamos ese;
  // si no, el File crudo (stream, sin materializar el string).
  function payloadBlob(): Blob | null {
    if (content) return new Blob([content], { type: "text/plain" });
    return file;
  }

  function requestJson() {
    return JSON.stringify({
      filePath: filePath.trim(),
      parsePattern: parsePattern.trim(),
      lookupField: lookupField.trim(),
      displayName: displayName.trim() || undefined,
      description: description.trim() || undefined,
      overwrite,
      ...(skippedRecords > 0 ? { skippedRecords } : {}),
    });
  }

  async function onPreview() {
    if (!envId) return;
    // Para el preview mandamos solo una MUESTRA (no todo el archivo).
    const src = payloadBlob();
    if (!src) return;
    const sample = content ? src : src.slice(0, SAMPLE_BYTES);

    setBusy(true);
    setPreview(null);
    try {
      const form = new FormData();
      form.append("content", sample, "sample");
      form.append(
        "request",
        JSON.stringify({
          parsePattern: parsePattern.trim(),
          lookupField: lookupField.trim(),
          ...(skippedRecords > 0 ? { skippedRecords } : {}),
        })
      );
      const res = await fetch(`/api/environments/${envId}/lookups/test-pattern`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : t.previewFailed);
      setPreview({ recordCount: data.recordCount, rows: data.preview ?? [] });
      toast.success(f(t.previewSuccess, { count: data.recordCount ?? data.preview?.length ?? 0 }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    if (!envId) return;
    const src = payloadBlob();
    if (!src) return;

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", src, fileName ?? "lookup");
      form.append("request", requestJson());
      const res = await fetch(`/api/environments/${envId}/lookups/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : t.uploadFailed);
      toast.success(
        f(t.uploadSuccess, {
          path: data.filePath,
          records: data.recordCount != null ? ` (${f(t.recordsCount, { count: data.recordCount })})` : "",
          dql: loadDql(data.filePath),
        })
      );
      clearFile();
      void refreshList();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const path = deleteTarget;
    if (!envId || !path) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/environments/${envId}/lookups/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: path }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : t.deleteFailed);
      toast.success(f(t.deleteSuccess, { path }));
      setDeleteTarget(null);
      void refreshList();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function downloadUrl(path: string, format: "json" | "csv") {
    return `/api/environments/${envId}/lookups/content?path=${encodeURIComponent(path)}&format=${format}`;
  }

  const hasData = !!file || content.trim().length > 0;
  const bigFile = !!file && file.size > EDITABLE_MAX;
  const canSubmit =
    !!envId && hasData && filePath.startsWith("/lookups/") && filePath.length > "/lookups/".length && !!parsePattern.trim() && !!lookupField.trim();

  return (
    <div className="space-y-6">
      {/* Selector de entorno */}
      <FormSection
        accent="slate"
        icon={<Server />}
        title={t.environmentSectionTitle}
        description={t.environmentSectionDesc}
      >
        <Select value={envId} onValueChange={onSelectEnv}>
          <SelectTrigger className="max-w-md">
            <SelectValue placeholder={t.chooseEnvironment} />
          </SelectTrigger>
          <SelectContent>
            {environments.map((e) => (
              <SelectItem key={e.id} value={e.id} disabled={!e.hasPlatformToken}>
                {e.label}
                {!e.hasPlatformToken ? t.noPlatformToken : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedEnv && !selectedEnv.hasPlatformToken && (
          <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t.noPlatformTokenWarning}
          </p>
        )}
      </FormSection>

      {envId && (
        <>
          {/* Listado */}
          <FormSection
            accent="blue"
            icon={<Database />}
            title={t.grailFilesSectionTitle}
            description={
              <>
                {t.grailFilesSectionDesc.split("load").map((part: string, idx: number) => (
                  <span key={idx}>
                    {part}
                    {idx === 0 && (
                      <code className="rounded bg-blue-500/10 px-1 font-mono text-blue-600 dark:text-blue-400">
                        load &quot;/lookups/…&quot;
                      </code>
                    )}
                  </span>
                ))}
              </>
            }
            action={
              <Button variant="outline" size="sm" onClick={() => void refreshList()} disabled={loadingList}>
                {loadingList ? t.updating : t.update}
              </Button>
            }
          >
            <div>
              {files.length === 0 ? (
                <p className="rounded-md border border-dashed bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
                  {loadingList ? t.loading : t.noFiles}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-blue-500/5 hover:bg-blue-500/5">
                      <TableHead>{t.colPathDql}</TableHead>
                      <TableHead>{t.colRecords}</TableHead>
                      <TableHead>{t.colSize}</TableHead>
                      <TableHead className="text-right">{t.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((fObj) => (
                      <TableRow key={fObj.filePath}>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2 font-mono">
                            <FileText className="size-3.5 text-muted-foreground" />
                            {fObj.filePath}
                          </div>
                          {fObj.displayName && <div className="text-muted-foreground">{fObj.displayName}</div>}
                          <button
                            type="button"
                            onClick={() => void copyText(loadDql(fObj.filePath))}
                            className="mt-1 flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 font-mono text-[11px] text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
                            title={t.copyTooltip}
                          >
                            <Copy className="size-3" /> {loadDql(fObj.filePath)}
                          </button>
                        </TableCell>
                        <TableCell>{fObj.records ?? "—"}</TableCell>
                        <TableCell>{fmtBytes(fObj.sizeBytes)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <a href={downloadUrl(fObj.filePath, "json")} title={t.downloadJson}>
                              <Button variant="ghost" size="sm">
                                <Download className="size-4" /> JSON
                              </Button>
                            </a>
                            <a href={downloadUrl(fObj.filePath, "csv")} title={t.downloadCsv}>
                              <Button variant="ghost" size="sm">
                                <Download className="size-4" /> CSV
                              </Button>
                            </a>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              title={t.deleteTooltip}
                              onClick={() => setDeleteTarget(fObj.filePath)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </FormSection>

          {/* Subida */}
          <FormSection
            accent="violet"
            icon={<HardDriveUpload />}
            title={t.uploadSectionTitle}
            description={t.uploadSectionDesc}
          >
            <div className="space-y-4">
              {/* Drag & drop */}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-label={t.uploadSectionTitle}
                onChange={(e) => {
                  const selectFile = e.target.files?.[0];
                  if (selectFile) void handleFile(selectFile);
                  e.target.value = "";
                }}
              />
              {!fileName ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                    dragOver
                      ? "border-violet-500 bg-violet-500/10"
                      : "border-violet-500/40 bg-violet-500/[0.03] hover:border-violet-500/70 hover:bg-violet-500/5"
                  }`}
                >
                  <UploadCloud className="size-8 text-violet-500" />
                  <p className="text-sm font-medium">{t.dragDropText}</p>
                  <p className="text-xs text-muted-foreground">{t.acceptedFormats}</p>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="size-4 text-violet-500" />
                    <span className="font-medium">{fileName}</span>
                    <Badge variant="secondary">{file ? fmtMB(file.size) : `${content.length.toLocaleString()} chars`}</Badge>
                    {bigFile && <Badge variant="outline">{t.streamUploadLabel}</Badge>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearFile} title={t.removeFileTooltip}>
                    <X className="size-4" />
                  </Button>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="filePath">{t.filePathLabel}</Label>
                  <Input
                    id="filePath"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    placeholder="/lookups/http_status_codes"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lookupField">{t.lookupFieldLabel}</Label>
                  <Input
                    id="lookupField"
                    value={lookupField}
                    onChange={(e) => setLookupField(e.target.value)}
                    placeholder="code"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="parsePattern">{t.parsePatternLabel}</Label>
                    <Badge variant="outline" className="font-normal text-muted-foreground">
                      {t.autoGeneratedBadge}
                    </Badge>
                  </div>
                  <Input
                    id="parsePattern"
                    value={parsePattern}
                    onChange={(e) => setParsePattern(e.target.value)}
                    placeholder='LD:code &quot;,&quot; LD:description   (o "JSON:json" para JSONL)'
                    className="font-mono"
                  />
                  {/* Controles de auto-generación (para archivos delimitados) */}
                  {firstLine && !isJson && (
                    <div className="flex flex-wrap items-center gap-3 rounded-md bg-violet-500/5 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{t.separatorLabel}</span>
                        <Select
                          value={separator}
                          onValueChange={(v) => {
                            if (!v) return;
                            setSeparator(v);
                            regeneratePattern(v, hasHeader);
                          }}
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEPARATORS.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={hasHeader}
                          onChange={(e) => {
                            setHasHeader(e.target.checked);
                            regeneratePattern(separator, e.target.checked);
                          }}
                        />
                        {t.firstRowHeader}
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => regeneratePattern()}
                      >
                        {t.regeneratePatternBtn}
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {t.patternDescription}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="displayName">{t.displayNameLabel}</Label>
                  <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">{t.descriptionLabel}</Label>
                  <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>

              {/* Contenido: editable solo para archivos chicos. Los grandes no se
                  cargan en memoria — se suben directo desde el File. */}
              {fileName && !bigFile && (
                <div className="space-y-1.5">
                  <Label htmlFor="content">{t.loadedContentLabel}</Label>
                  <textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t.loadedContentLabel}
                    rows={6}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              )}
              {bigFile && (
                <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  {f(t.bigFileWarning, { size: file ? fmtMB(file.size) : "" })}
                </p>
              )}

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                {t.overwriteCheckbox}
              </label>

              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void onPreview()} disabled={busy || !canSubmit}>
                  <Eye className="size-4" /> {t.testParseBtn}
                </Button>
                <Button onClick={() => void onUpload()} disabled={busy || !canSubmit}>
                  <Upload className="size-4" /> {t.uploadBtn}
                </Button>
              </div>

              {preview && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Badge className="border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      {f(t.recordsCount, { count: preview.recordCount ?? preview.rows.length })}
                    </Badge>
                    <span className="text-sm text-muted-foreground">{t.previewHeader}</span>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(preview.rows.slice(0, 20), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </FormSection>
        </>
      )}

      {/* Confirmación de borrado (temática, reemplaza el confirm() nativo) */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.deleteTitle}</DialogTitle>
            <DialogDescription>
              {deleteTarget ? f(t.deleteConfirm, { path: deleteTarget }) : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t.deleteCancel}</DialogClose>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              <Trash2 className="size-4" /> {deleting ? t.deletingBtn : t.deleteConfirmBtn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
