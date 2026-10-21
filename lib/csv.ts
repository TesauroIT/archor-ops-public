// Exportacion a CSV para las tablas de la UI.
//
// Decisiones de formato, pensadas para que el archivo abra bien en Excel en
// es-AR (que es donde terminan estos listados):
//  - separador ";": Excel usa el separador de lista del sistema, que en
//    español es ";". Con "," el archivo abriria en una sola columna.
//  - BOM UTF-8: sin el, Excel interpreta el archivo como ANSI y rompe los
//    acentos y las ñ.
//  - CRLF: fin de linea estandar de RFC 4180.
// Las fechas se exportan en ISO (no localizadas) para que no haya ambiguedad
// dia/mes y para que ordenen bien como texto.

const DELIMITER = ";";
const EOL = "\r\n";
const BOM = "﻿";

// Entrecomilla siempre: es valido en RFC 4180 y evita tener que decidir campo
// por campo si contiene separador, comillas o saltos de linea.
function cell(value: string | number | null | undefined): string {
  if (value == null) return '""';
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return BOM + rows.map((row) => row.map(cell).join(DELIMITER)).join(EOL) + EOL;
}

// Dispara la descarga en el navegador. El object URL se libera despues de que
// el click haya sido procesado.
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Nombre de archivo seguro: sin caracteres que Windows rechaza ni espacios.
export function csvFilename(...parts: (string | null | undefined)[]): string {
  const slug = parts
    .filter((p): p is string => !!p && p.trim() !== "")
    .join("-")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "export"}.csv`;
}
