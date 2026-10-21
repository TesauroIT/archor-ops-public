"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import JSZip from "jszip";
import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  Globe,
  Lock,
  LockOpen,
  Share2,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardsSummary } from "@/components/dashboards-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export interface EnvOption {
  id: string;
  label: string;
  hasPlatformToken: boolean;
  dtEnvId: string | null; // id SaaS de Dynatrace (ej. "abc12345"), para armar el link al dashboard
}

// URL del dashboard en la app de Dynatrace. Requiere el id SaaS del entorno.
function dashboardUrl(dtEnvId: string | null | undefined, docId: string): string | null {
  if (!dtEnvId) return null;
  return `https://${dtEnvId}.apps.dynatrace.com/ui/apps/dynatrace.dashboards/dashboard/${encodeURIComponent(docId)}`;
}

// Extrae cantidad de tiles y titulos del JSON de un dashboard.
function parseTiles(jsonText: string): { tileCount: number; tileTitles: string[] } {
  try {
    const j = JSON.parse(jsonText);
    const tiles = j?.tiles && typeof j.tiles === "object" ? Object.values(j.tiles) : [];
    const titles = tiles
      .map((t) => (t as { title?: unknown })?.title)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    return { tileCount: tiles.length, tileTitles: titles };
  } catch {
    return { tileCount: 0, tileTitles: [] };
  }
}

type SortKey = "name" | "owner" | "ia" | "versions" | "edad" | "id";

interface SavedAnalysis {
  verdict: string;
  reason: string;
  tileCount: number;
  tileTitles: string[];
  contentChars: number;
  versions: number;
  model: string;
  analyzedAt: string;
}

interface Dashboard {
  id: string;
  name: string;
  type: string;
  version: string | number;
  owner: string;
  ownerEmail?: string | null;
  isPrivate?: boolean;
  createdTime?: string | null;
  lastModifiedTime?: string | null;
  lastAccessedTime?: string | null;
}

// Dias transcurridos desde una fecha ISO hasta hoy. null si no hay fecha.
function daysSince(iso?: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : new Date(t).toLocaleDateString("es-AR");
}

interface OwnerSummary {
  owner: string;
  count: number;
  email?: string | null;
}

interface AccountUser {
  uid: string;
  email: string;
}

interface ActionResult {
  id: string;
  ok: boolean;
  status: number;
  message?: string;
}

function short(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// Muestra el correo si lo resolvimos; si no, el SSO id abreviado.
function ownerLabel(owner: string, email?: string | null): string {
  return email ?? short(owner);
}

export function DashboardsManager({ environments }: { environments: EnvOption[] }) {
  const { dict, f } = useI18n();
  const t = dict.dashboards;
  // El veredicto se guarda en español (viene del modelo); aca solo traducimos la
  // etiqueta mostrada. Si es un valor inesperado, se muestra tal cual.
  const verdictLabel = (v: string): string =>
    (t.verdicts as Record<string, string>)[v] ?? v;
  const [envId, setEnvId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [owners, setOwners] = useState<OwnerSummary[]>([]);
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [iamError, setIamError] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [transferOpen, setTransferOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyTargetId, setCopyTargetId] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("llama3.2:3b");
  const [aiWorking, setAiWorking] = useState(false);
  const [backupProgress, setBackupProgress] = useState<{
    current: number;
    total: number;
    failed: number;
  } | null>(null);
  const [aiVerdicts, setAiVerdicts] = useState<
    { name: string; veredicto: string; razon: string }[] | null
  >(null);
  const [aiRaw, setAiRaw] = useState<string | null>(null);
  const [aiProgress, setAiProgress] = useState<{ current: number; total: number; phase: string } | null>(null);
  const [analyses, setAnalyses] = useState<Record<string, SavedAnalysis>>({});
  const [newOwnerId, setNewOwnerId] = useState("");
  const [shareAccess, setShareAccess] = useState<"read" | "read-write">("read");
  const [shareRecipients, setShareRecipients] = useState("");
  const [working, setWorking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [results, setResults] = useState<ActionResult[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // A donde apunta el analisis (URL de Ollama y modelo) sale de Configuracion,
  // no de esta pantalla: lo levantamos una vez al montar. El prompt vive en el
  // server y no lo necesitamos aca.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!s) return;
        if (typeof s.ollamaUrl === "string") setOllamaUrl(s.ollamaUrl);
        if (typeof s.ollamaModel === "string") setOllamaModel(s.ollamaModel);
      })
      .catch(() => {
        /* si falla, quedan los defaults locales */
      });
  }, []);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const selectedEnv = environments.find((e) => e.id === envId);
  const q = search.trim().toLowerCase();
  const filtered = dashboards.filter((d) => {
    if (ownerFilter !== "ALL" && d.owner !== ownerFilter) return false;
    if (!q) return true;
    return (
      d.name.toLowerCase().includes(q) ||
      d.id.toLowerCase().includes(q) ||
      (d.ownerEmail ?? d.owner).toLowerCase().includes(q)
    );
  });

  // Orden segun el header clickeado. Los "sin dato" van siempre al final.
  const IA_RANK: Record<string, number> = { eliminar: 0, revisar: 1, conservar: 2 };
  const visible = sortKey
    ? [...filtered].sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        switch (sortKey) {
          case "name":
            return dir * a.name.localeCompare(b.name, "es");
          case "owner":
            return (
              dir *
              (a.ownerEmail ?? a.owner).localeCompare(b.ownerEmail ?? b.owner, "es")
            );
          case "id":
            return dir * a.id.localeCompare(b.id);
          case "versions":
            return dir * ((Number(a.version) || 0) - (Number(b.version) || 0));
          case "edad": {
            const ad = daysSince(a.lastModifiedTime);
            const bd = daysSince(b.lastModifiedTime);
            if (ad === null && bd === null) return 0;
            if (ad === null) return 1;
            if (bd === null) return -1;
            return dir * (ad - bd);
          }
          case "ia": {
            const ar = analyses[a.id] ? IA_RANK[analyses[a.id].verdict] ?? 3 : 4;
            const br = analyses[b.id] ? IA_RANK[analyses[b.id].verdict] ?? 3 : 4;
            return dir * (ar - br);
          }
          default:
            return 0;
        }
      })
    : filtered;
  const selectedList = [...selected];

  async function load(id: string) {
    setEnvId(id);
    setDashboards([]);
    setOwners([]);
    setUsers([]);
    setIamError(null);
    setSelected(new Set());
    setOwnerFilter("ALL");
    setSearch("");
    setResults(null);
    setError(null);
    setAnalyses({});
    if (!id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/environments/${id}/dashboards`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? t.loadError);
        return;
      }
      setDashboards(data.dashboards ?? []);
      setOwners(data.owners ?? []);
      setUsers(data.users ?? []);
      setIamError(data.iamError ?? null);
      // Cargar analisis de IA guardados (no bloquea la vista si falla).
      try {
        const aRes = await fetch(`/api/environments/${id}/dashboards/analysis`);
        if (aRes.ok) {
          const aData = await aRes.json();
          const map: Record<string, SavedAnalysis> = {};
          for (const a of aData.analyses ?? []) map[a.dashboardId] = a;
          setAnalyses(map);
        }
      } catch {
        /* ignorar */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const allSelected = visible.every((d) => prev.has(d.id));
      const next = new Set(prev);
      if (allSelected) visible.forEach((d) => next.delete(d.id));
      else visible.forEach((d) => next.add(d.id));
      return next;
    });
  }

  async function doTransfer() {
    if (!newOwnerId.trim()) {
      toast.error(t.transferError);
      return;
    }
    setWorking(true);
    setResults(null);
    try {
      const res = await fetch(`/api/environments/${envId}/dashboards/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedList, newOwnerId: newOwnerId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.transferFailed);
        return;
      }
      setResults(data.results);
      toast.success(f(t.transferSuccess, { ok: data.ok, failed: data.failed }));
      setTransferOpen(false);
      setNewOwnerId("");
      await load(envId); // refrescar owners
    } finally {
      setWorking(false);
    }
  }

  async function doShare() {
    const recipients = shareRecipients
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({ id, type: "user" as const }));
    if (recipients.length === 0) {
      toast.error(t.shareError);
      return;
    }
    setWorking(true);
    setResults(null);
    try {
      const res = await fetch(`/api/environments/${envId}/dashboards/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedList, access: shareAccess, recipients }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.shareFailed);
        return;
      }
      setResults(data.results);
      toast.success(f(t.shareSuccess, { ok: data.ok, failed: data.failed }));
      setShareOpen(false);
      setShareRecipients("");
    } finally {
      setWorking(false);
    }
  }

  // Hace publicos (o privados) los dashboards seleccionados: todos en el entorno
  // los ven de inmediato, sin tener que reclamar nada.
  async function doVisibility(makePublic: boolean) {
    setWorking(true);
    setResults(null);
    try {
      const items = dashboards
        .filter((d) => selected.has(d.id))
        .map((d) => ({ id: d.id, version: d.version }));
      const res = await fetch(`/api/environments/${envId}/dashboards/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, public: makePublic }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.visibilityFailed);
        return;
      }
      setResults(data.results);
      toast.success(
        f(t.visibilitySuccess, {
          action: makePublic ? t.makePublic : t.makePrivate,
          ok: data.ok,
          failed: data.failed,
        })
      );
      await load(envId); // refrescar versiones (cambian tras el update)
    } finally {
      setWorking(false);
    }
  }

  // Copia los dashboards seleccionados a otro entorno (crea documentos nuevos alla).
  async function doCopy() {
    if (!copyTargetId) {
      toast.error(t.copyError);
      return;
    }
    setWorking(true);
    setResults(null);
    try {
      const items = dashboards
        .filter((d) => selected.has(d.id))
        .map((d) => ({ id: d.id, name: d.name, type: d.type }));
      const res = await fetch(`/api/environments/${envId}/dashboards/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetEnvironmentId: copyTargetId, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.copyFailed);
        return;
      }
      setResults(data.results);
      toast.success(f(t.copySuccess, { ok: data.ok, failed: data.failed }));
      setCopyOpen(false);
    } finally {
      setWorking(false);
    }
  }

  // Mueve los dashboards seleccionados a la papelera (tras confirmar en el diálogo).
  async function performDelete() {
    setWorking(true);
    setResults(null);
    try {
      const res = await fetch(`/api/environments/${envId}/dashboards/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedList }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.deleteFailed);
        return;
      }
      setDeleteOpen(false);
      setResults(data.results);
      toast.success(f(t.deleteSuccess, { ok: data.ok, failed: data.failed }));
      await load(envId);
    } finally {
      setWorking(false);
    }
  }

  // Manda una tanda de dashboards (los visibles, hasta 60) a un modelo local
  // (Ollama) para que sugiera cuáles conservar / revisar / eliminar.
  // Analiza TODOS los dashboards seleccionados en tandas de 10: por cada tanda
  // baja el JSON (cuenta tiles + titulos), lo manda al modelo local y PERSISTE el
  // resultado por dashboard (por id). La barra de progreso abarca el total.
  async function doAnalyze() {
    const targets = dashboards.filter((d) => selected.has(d.id));
    if (targets.length === 0) {
      toast.error(t.analyzeSelect);
      return;
    }
    const BATCH = 10;
    setAiWorking(true);
    setAiVerdicts(null);
    setAiRaw(null);
    setAiProgress({ current: 0, total: targets.length, phase: t.analyzingProgressPhase });

    const allVerdicts: { name: string; veredicto: string; razon: string }[] = [];
    let done = 0;
    let lastRaw: string | null = null;
    const now = new Date().toISOString();

    try {
      for (let start = 0; start < targets.length; start += BATCH) {
        const batch = targets.slice(start, start + BATCH);

        // 1) Descargar contenido y parsear tiles de la tanda.
        const enriched: {
          dashboardId: string;
          name: string;
          versions: number;
          tileCount: number;
          tileTitles: string[];
          contentChars: number;
          isPrivate?: boolean;
          ownerEmail?: string | null;
        }[] = [];
        for (const d of batch) {
          let tileCount = 0;
          let tileTitles: string[] = [];
          let contentChars = 0;
          try {
            const cRes = await fetch(
              `/api/environments/${envId}/dashboards/${encodeURIComponent(d.id)}/content`
            );
            if (cRes.ok) {
              const text = await cRes.text();
              contentChars = text.length;
              const parsed = parseTiles(text);
              tileCount = parsed.tileCount;
              tileTitles = parsed.tileTitles;
            }
          } catch {
            /* si falla el contenido, seguimos con tiles=0 */
          }
          enriched.push({
            dashboardId: d.id,
            name: d.name,
            versions: typeof d.version === "number" ? d.version : Number(d.version) || 0,
            tileCount,
            tileTitles,
            contentChars,
            isPrivate: d.isPrivate,
            ownerEmail: d.ownerEmail ?? null,
          });
        }

        // 2) Analizar la tanda con el modelo local.
        let verdicts: { id?: number; veredicto: string; razon: string }[] = [];
        try {
          const res = await fetch("/api/ai/analyze-dashboards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ollamaUrl,
              model: ollamaModel,
              items: enriched.map((e) => ({
                name: e.name,
                versions: e.versions,
                tileCount: e.tileCount,
                tileTitles: e.tileTitles,
                contentChars: e.contentChars,
                isPrivate: e.isPrivate,
                ownerEmail: e.ownerEmail,
              })),
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(data?.error ?? t.analyzeFailed);
            return; // corta todo: si Ollama falla, no seguimos con las demas tandas.
          }
          verdicts = data.raw ? [] : data.verdicts ?? [];
          lastRaw = data.raw ?? null;
        } catch (e) {
          toast.error(f(t.analyzeError, { message: (e as Error).message }));
          return;
        }

        // 3) Emparejar por indice #N (nunca por nombre) y persistir la tanda.
        const byIndex = new Map<number, { veredicto: string; razon: string }>();
        verdicts.forEach((v, i) => {
          const idx = typeof v.id === "number" && v.id >= 1 ? v.id : i + 1;
          if (!byIndex.has(idx)) byIndex.set(idx, { veredicto: v.veredicto, razon: v.razon });
        });
        const toSave = enriched.map((e, i) => {
          const v = byIndex.get(i + 1);
          return {
            dashboardId: e.dashboardId,
            name: e.name,
            verdict: v?.veredicto ?? "revisar",
            reason: v?.razon ?? t.noVerdict,
            tileCount: e.tileCount,
            tileTitles: e.tileTitles,
            contentChars: e.contentChars,
            versions: e.versions,
          };
        });

        await fetch(`/api/environments/${envId}/dashboards/analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: ollamaModel, items: toSave }),
        });

        // Actualizar UI en vivo: tabla + resultados del dialogo + progreso.
        setAnalyses((prev) => {
          const next = { ...prev };
          for (const s of toSave) {
            next[s.dashboardId] = {
              verdict: s.verdict,
              reason: s.reason,
              tileCount: s.tileCount,
              tileTitles: s.tileTitles,
              contentChars: s.contentChars,
              versions: s.versions,
              model: ollamaModel,
              analyzedAt: now,
            };
          }
          return next;
        });
        for (const s of toSave) allVerdicts.push({ name: s.name, veredicto: s.verdict, razon: s.reason });
        setAiVerdicts([...allVerdicts]);

        done += batch.length;
        setAiProgress({ current: done, total: targets.length, phase: t.analyzingProgressPhase });
      }

      setAiRaw(allVerdicts.length === 0 ? lastRaw : null);
      toast.success(f(t.aiSuccess, { count: done }));
    } finally {
      setAiWorking(false);
      setAiProgress(null);
    }
  }

  // Bloquea / desbloquea los dashboards seleccionados.
  async function doLock(action: "lock" | "unlock") {
    setWorking(true);
    setResults(null);
    try {
      const res = await fetch(`/api/environments/${envId}/dashboards/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedList, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? t.lockFailed);
        return;
      }
      setResults(data.results);
      toast.success(
        f(t.lockSuccess, {
          action: action === "lock" ? t.lockAction : t.unlockAction,
          ok: data.ok,
          failed: data.failed,
        })
      );
    } finally {
      setWorking(false);
    }
  }

  // Descarga un ZIP con el JSON de cada dashboard seleccionado.
  // Backup con progreso: baja el JSON de cada dashboard uno por uno (mostrando
  // el avance) y arma el ZIP en el navegador con JSZip.
  async function doBackup() {
    const items = dashboards
      .filter((d) => selected.has(d.id))
      .map((d) => ({ id: d.id, name: d.name }));
    if (items.length === 0) return;

    setWorking(true);
    setBackupProgress({ current: 0, total: items.length, failed: 0 });
    try {
      const zip = new JSZip();
      const folder = zip.folder("dashboards")!;
      const manifest: { id: string; name: string; file?: string; ok: boolean; error?: string }[] = [];
      const usedNames = new Set<string>();
      let failed = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const res = await fetch(
            `/api/environments/${envId}/dashboards/${encodeURIComponent(item.id)}/content`
          );
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            failed++;
            manifest.push({ id: item.id, name: item.name, ok: false, error: data?.error ?? `HTTP ${res.status}` });
          } else {
            const content = await res.text();
            const slug = (item.name || "dashboard").replace(/[^a-zA-Z0-9-_]+/g, "-").slice(0, 60) || "dashboard";
            let fileName = `${slug}-${item.id.slice(0, 8)}.json`;
            let n = 1;
            while (usedNames.has(fileName)) fileName = `${slug}-${item.id.slice(0, 8)}-${n++}.json`;
            usedNames.add(fileName);
            folder.file(fileName, content);
            manifest.push({ id: item.id, name: item.name, file: `dashboards/${fileName}`, ok: true });
          }
        } catch (e) {
          failed++;
          manifest.push({ id: item.id, name: item.name, ok: false, error: (e as Error).message });
        }
        setBackupProgress({ current: i + 1, total: items.length, failed });
      }

      zip.file(
        "_manifest.json",
        JSON.stringify(
          { environment: selectedEnv?.label ?? envId, exportedAt: new Date().toISOString(), dashboards: manifest },
          null,
          2
        )
      );

      const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `${(selectedEnv?.dtEnvId ?? "dashboards")}-dashboards-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(f(t.backupSuccess, { ok: items.length - failed, failed }));
    } finally {
      setWorking(false);
      setBackupProgress(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>{t.environment}</Label>
          <Select value={envId} onValueChange={(v) => load(v ?? "")}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder={t.chooseEnvironment} />
            </SelectTrigger>
            <SelectContent>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id} disabled={!env.hasPlatformToken}>
                  {env.label}
                  {!env.hasPlatformToken ? ` (${t.noPlatformToken})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {envId && (
          <Button variant="outline" size="sm" onClick={() => load(envId)} disabled={loading}>
            {loading ? t.loading : t.reload}
          </Button>
        )}
      </div>

      {selectedEnv && !selectedEnv.hasPlatformToken && (
        <p className="text-sm text-destructive">
          {t.missingPlatformToken}
        </p>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {iamError && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {f(t.iamError, { error: iamError })}
        </div>
      )}

      {dashboards.length > 0 && <DashboardsSummary dashboards={dashboards} owners={owners} />}

      {dashboards.length > 0 && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t.search}</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-72"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.filterOwner}</Label>
              <Select value={ownerFilter} onValueChange={(v) => setOwnerFilter(v ?? "ALL")}>
                <SelectTrigger className="w-80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{f(t.allOwners, { count: dashboards.length })}</SelectItem>
                  {owners.map((o) => (
                    <SelectItem key={o.owner} value={o.owner}>
                      {ownerLabel(o.owner, o.email)} — {o.count} dashboard(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="pb-2 text-sm text-muted-foreground">{f(t.visibleCount, { count: visible.length })}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            {selected.size > 0 ? (
              <span className="text-sm font-medium">{f(t.selectedCount, { count: selected.size })}</span>
            ) : (
              <>
                <span className="text-sm text-muted-foreground">
                  {t.selectionHint}
                </span>
                <Button size="sm" variant="ghost" onClick={toggleAllVisible}>
                  {f(t.selectVisible, { count: visible.length })}
                </Button>
              </>
            )}
            <div className="mx-1 h-5 w-px bg-border" />

            <Button
              size="sm"
              disabled={working || selected.size === 0}
              onClick={() => {
                setAiVerdicts(null);
                setAiRaw(null);
                setAiOpen(true);
              }}
              title={t.aiDescription}
            >
              <Sparkles className="size-3.5" />
              {t.analyze}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working || selected.size === 0}
              onClick={() => {
                setResults(null);
                setShareOpen(true);
              }}
            >
              <Share2 className="size-3.5" />
              {t.share}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working || selected.size === 0}
              onClick={() => doVisibility(true)}
              title="Todos los usuarios del entorno podran verlo de inmediato (isPrivate=false)"
            >
              <Globe className="size-3.5" />
              {t.makePublic}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={working || selected.size === 0}
              onClick={doBackup}
            >
              <Download className="size-3.5" />
              {t.backup}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="sm" variant="outline" disabled={working || selected.size === 0}>
                    {t.moreActions}
                    <ChevronDown className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => {
                    setResults(null);
                    setTransferOpen(true);
                  }}
                >
                  <UserRound className="size-4" />
                  {t.changeOwner}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => doVisibility(false)}
                  title="Volver a privado (solo owner y usuarios con share explicito)"
                >
                  <EyeOff className="size-4" />
                  {t.makePrivate}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doLock("lock")}>
                  <Lock className="size-4" />
                  {t.lock}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => doLock("unlock")}>
                  <LockOpen className="size-4" />
                  {t.unlock}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setResults(null);
                    setCopyOpen(true);
                  }}
                >
                  <Copy className="size-4" />
                  {t.copy}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              disabled={working || selected.size === 0}
              onClick={() => {
                setResults(null);
                setDeleteOpen(true);
              }}
              title="Mover a la papelera (requiere scope document:documents:delete)"
            >
              <Trash2 className="size-3.5" />
              {t.delete}
            </Button>
          </div>

          {backupProgress && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {f(t.backupInProgress, { current: backupProgress.current, total: backupProgress.total })}
                  {backupProgress.failed > 0 && (
                    <span className="text-destructive">{f(t.withErrors, { failed: backupProgress.failed })}</span>
                  )}
                </span>
                <span className="text-muted-foreground">
                  {Math.round((backupProgress.current / backupProgress.total) * 100)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-200"
                  style={{
                    width: `${(backupProgress.current / backupProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {aiProgress && (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {f(t.analyzeProgress, { phase: aiProgress.phase, current: aiProgress.current, total: aiProgress.total })}
                </span>
                <span className="text-muted-foreground">
                  {Math.round((aiProgress.current / aiProgress.total) * 100)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-200"
                  style={{ width: `${(aiProgress.current / aiProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          <ScrollArea className="h-[28rem] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && visible.every((d) => selected.has(d.id))}
                      onChange={toggleAllVisible}
                      aria-label={f(t.selectVisible, { count: visible.length })}
                    />
                  </TableHead>
                  {(
                    [
                      ["name", t.name],
                      ["owner", t.owner],
                      ["ia", t.ia],
                      ["versions", t.versions],
                      ["edad", t.lastEdited],
                      ["id", t.id],
                    ] as [SortKey, string][]
                  ).map(([k, label]) => (
                    <TableHead key={k}>
                      <button
                        type="button"
                        onClick={() => toggleSort(k)}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        {label}
                        <span className="text-xs text-muted-foreground">
                          {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="w-10">{t.open}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((d) => {
                  const url = dashboardUrl(selectedEnv?.dtEnvId, d.id);
                  const an = analyses[d.id];
                  return (
                    <TableRow key={d.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggle(d.id)}
                          aria-label={f(t.selectItem, { name: d.name })}
                        />
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={d.name}>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {d.name}
                          </a>
                        ) : (
                          d.name
                        )}
                      </TableCell>
                      <TableCell className="text-xs" title={d.owner}>
                        {ownerLabel(d.owner, d.ownerEmail)}
                      </TableCell>
                      <TableCell>
                        {an ? (
                          <Badge
                            variant={
                              an.verdict === "eliminar"
                                ? "destructive"
                                : an.verdict === "conservar"
                                  ? "default"
                                  : "secondary"
                            }
                            title={`${an.reason}\n\n${an.tileCount} tiles · ${an.contentChars} chars · v${an.versions} · ${an.model}`}
                          >
                            {verdictLabel(an.verdict)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{d.version}</TableCell>
                      <TableCell
                        className="text-xs whitespace-nowrap"
                        title={`Creado: ${fmtDate(d.createdTime)}\nModificado: ${fmtDate(
                          d.lastModifiedTime
                        )}\nAbierto (usuario del token): ${fmtDate(d.lastAccessedTime)}`}
                      >
                        {(() => {
                           const dd = daysSince(d.lastModifiedTime);
                           if (dd === null) return <span className="text-muted-foreground">—</span>;
                           return (
                             <span className={dd > 180 ? "text-amber-600 dark:text-amber-400" : ""}>
                               {dd === 0 ? t.today : `${dd} d`}
                             </span>
                           );
                        })()}
                      </TableCell>
                      <TableCell className="font-mono text-xs" title={d.id}>
                        {short(d.id)}
                      </TableCell>
                      <TableCell>
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t.openTooltip}
                            className="inline-flex text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        </>
      )}

      {results && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.result}</CardTitle>
            <CardDescription>
              {f(t.resultsSummary, { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <div className="space-y-1 text-xs">
                {results.map((r) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <Badge variant={r.ok ? "default" : "destructive"}>{r.ok ? "OK" : "ERR"}</Badge>
                    <span className="font-mono">{short(r.id)}</span>
                    {!r.ok && <span className="text-destructive">{r.message}</span>}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Dialog: cambiar owner */}
      {/* Dialog: confirmar borrado (papelera) */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.common.delete}</DialogTitle>
            <DialogDescription>{f(t.deleteConfirm, { count: selected.size })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {dict.common.cancel}
            </Button>
            <Button variant="destructive" onClick={performDelete} disabled={working}>
              <Trash2 className="size-3.5" />
              {t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{f(t.transferTitle, { count: selected.size })}</DialogTitle>
            <DialogDescription>
              {t.transferDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {users.length > 0 ? (
              <>
                <Label>{t.newOwner}</Label>
                <Select value={newOwnerId} onValueChange={(v) => setNewOwnerId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.chooseUser} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.uid} value={u.uid}>
                        {u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <>
                <Label htmlFor="new-owner">{t.ssoId}</Label>
                <Input
                  id="new-owner"
                  value={newOwnerId}
                  onChange={(e) => setNewOwnerId(e.target.value)}
                  placeholder="441664f0-23c9-40ef-b344-18c02c23d789"
                />
                <p className="text-xs text-muted-foreground">
                  Configura el OAuth de cuenta (IAM) en el entorno para elegir por correo.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            <Button onClick={doTransfer} disabled={working}>
              {working ? t.transferring : f(t.transferButton, { count: selected.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: compartir */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{f(t.shareTitle, { count: selected.size })}</DialogTitle>
            <DialogDescription>
              {t.shareDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>{t.access}</Label>
              <Select
                value={shareAccess}
                onValueChange={(v) => setShareAccess((v as "read" | "read-write") ?? "read")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">{t.readOnly}</SelectItem>
                  <SelectItem value="read-write">{t.readWrite}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {users.length > 0 && (
              <div className="space-y-1">
                <Label>{t.chooseUser}</Label>
                <Select
                  value=""
                  onValueChange={(val) => {
                    if (!val) return;
                    setShareRecipients((prev) => {
                      const trimmed = prev.trim();
                      if (!trimmed) return val;
                      const list = trimmed.split(/[\s,]+/).map((s) => s.trim());
                      if (list.includes(val)) return prev;
                      return `${trimmed}, ${val}`;
                    });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t.chooseUser} />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.uid} value={u.uid}>
                        {u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="recipients">{t.recipients}</Label>
              <textarea
                id="recipients"
                className="min-h-20 w-full rounded-md border bg-transparent p-2 text-sm"
                value={shareRecipients}
                onChange={(e) => setShareRecipients(e.target.value)}
                placeholder="id1, id2, ..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={doShare} disabled={working}>
              {working ? t.sharing : f(t.shareButton, { count: selected.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: copiar a otro entorno */}
      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{f(t.copyTitle, { count: selected.size })}</DialogTitle>
            <DialogDescription>
              {t.copyDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>{t.destinationEnv}</Label>
            <Select value={copyTargetId} onValueChange={(v) => setCopyTargetId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t.chooseDestination} />
              </SelectTrigger>
              <SelectContent>
                {environments
                  .filter((e) => e.id !== envId)
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id} disabled={!e.hasPlatformToken}>
                      {e.label}
                      {!e.hasPlatformToken ? ` (${t.noPlatformToken})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t.destinationRequiresToken}
            </p>
          </div>
          <DialogFooter>
            <Button onClick={doCopy} disabled={working || !copyTargetId}>
              {working ? t.copying : f(t.copyButton, { count: selected.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: analizar con IA local (Ollama) */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.aiTitle}</DialogTitle>
            <DialogDescription>
              {f(t.aiDescription, { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          {/* A donde apunta y con que modelo se configura en Ajustes; aca solo
              se muestra para dar contexto antes de correr el analisis. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3 text-xs">
            <span>
              <span className="text-muted-foreground">{t.ollamaUrl}: </span>
              <span className="font-mono">{ollamaUrl}</span>
            </span>
            <span>
              <span className="text-muted-foreground">{t.ollamaModel}: </span>
              <span className="font-mono">{ollamaModel}</span>
            </span>
            <a href="/settings" className="ml-auto text-primary hover:underline">
              {t.aiConfigLink}
            </a>
          </div>
          <div className="space-y-2">
            <Button onClick={doAnalyze} disabled={aiWorking}>
              {aiWorking ? t.analyzing : f(t.analyzeButton, { count: selected.size })}
            </Button>
            {aiProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">
                    {f(t.analyzeProgress, { phase: aiProgress.phase, current: aiProgress.current, total: aiProgress.total })}
                  </span>
                  <span className="text-muted-foreground">
                    {Math.round((aiProgress.current / aiProgress.total) * 100)}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{ width: `${(aiProgress.current / aiProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {aiVerdicts && aiVerdicts.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.dashboardCol}</TableHead>
                    <TableHead>{t.verdict}</TableHead>
                    <TableHead>{t.reason}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aiVerdicts.map((v, i) => (
                    <TableRow key={i}>
                      <TableCell className="max-w-[14rem] truncate" title={v.name}>
                        {v.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            v.veredicto === "eliminar"
                              ? "destructive"
                              : v.veredicto === "conservar"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {verdictLabel(v.veredicto)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{v.razon}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {aiVerdicts && aiVerdicts.length === 0 && aiRaw && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t.rawResponse}
              </p>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 text-xs whitespace-pre-wrap">
                {aiRaw}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
