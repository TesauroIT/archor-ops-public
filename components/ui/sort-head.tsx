"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export type SortDir = "asc" | "desc";
export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

// Extractor del valor por el que ordena cada columna. null significa "sin
// dato" y esas filas van siempre al final (ver sortRows).
export type Sorters<T, K extends string> = Record<K, (row: T) => string | number | null>;

// Cabecera clickeable. Se define fuera de los paneles a proposito: declarada
// dentro de un componente, React la trataria como un tipo nuevo en cada
// render y remontaria el boton, que pierde el foco justo al hacer clic.
export function SortHead<K extends string>({
  sortKey,
  label,
  title,
  align,
  current,
  onSort,
}: {
  sortKey: K;
  label: string;
  title: string;
  align?: "right";
  current: SortState<K>;
  onSort: (key: K) => void;
}) {
  const active = current.key === sortKey;
  const Icon = !active ? ChevronsUpDown : current.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={active ? (current.dir === "asc" ? "ascending" : "descending") : "none"}
      className={align === "right" ? "text-right" : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title}
        className={`inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none ${
          active ? "font-medium text-foreground" : ""
        }`}
      >
        {label}
        <Icon className={`size-3 ${active ? "" : "opacity-40"}`} />
      </button>
    </TableHead>
  );
}

// Ordena sin mutar. Los nulos quedan al final en ambas direcciones: "sin
// dato" no es un extremo y no deberia encabezar el listado al ordenar
// ascendente. `tiebreak` desempata para que el orden sea estable.
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sorters: Sorters<T, K>,
  sort: SortState<K>,
  tiebreak: (row: T) => string
): T[] {
  const pick = sorters[sort.key];
  return [...rows].sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (va == null && vb == null) return tiebreak(a).localeCompare(tiebreak(b), "es");
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "es");
    return (sort.dir === "asc" ? cmp : -cmp) || tiebreak(a).localeCompare(tiebreak(b), "es");
  });
}

// Al cambiar de columna, el primer clic ordena en la direccion que mas suele
// interesar: descendente en numeros y fechas, ascendente en texto.
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
  numericKeys: ReadonlySet<K>
): SortState<K> {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: numericKeys.has(key) ? "desc" : "asc" };
}
