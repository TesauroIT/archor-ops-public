// Traduce los errores de validacion de Monaco CLI a explicaciones en
// lenguaje claro, para que el operador entienda que paso y como resolverlo
// sin tener que preguntar. Funciones puras, usables en cliente y servidor.

export interface MonacoErrorExplanation {
  title: string;
  description: string;
  fix: string;
  /** Tipo de config que conviene excluir del deploy mientras tanto. */
  excludeType?: string;
}

export interface MonacoErrorAnalysis {
  items: MonacoErrorExplanation[];
  /** Tipos sugeridos para excluir en el deploy por tipos (sin duplicados). */
  excludeTypes: string[];
}

// El id de config es "project:<schema>:<id>". En Settings 2.0 el schema tiene
// dos segmentos (builtin:os-services-monitoring); en config clasica uno solo
// (synthetic-monitor). Capturamos el schema completo (con "builtin:" si esta).
const SCHEMA = "((?:builtin:)?[a-z0-9][a-z0-9.\\-]*)";
const INSERT_AFTER_RE = new RegExp(
  `configuration 'project:${SCHEMA}:[^']*' insertAfter references '[^']*': different scopes`,
  "g"
);
const DUPLICATED_NAME_RE = new RegExp(
  `duplicated config name found: configurations project:${SCHEMA}:\\S+ and project:[^\\s]+ define the same 'name' "([^"]+)"`,
  "g"
);

export function explainMonacoErrors(output: string): MonacoErrorAnalysis {
  const items: MonacoErrorExplanation[] = [];
  const excludeTypes = new Set<string>();

  // 1) Settings ordenados con referencias de orden entre scopes distintos.
  const bySchema = new Map<string, number>();
  for (const match of output.matchAll(INSERT_AFTER_RE)) {
    const schema = match[1];
    bySchema.set(schema, (bySchema.get(schema) ?? 0) + 1);
  }
  for (const [schema, count] of bySchema) {
    excludeTypes.add(schema);
    items.push({
      title: `Reglas ordenadas con referencias cruzadas entre scopes — ${schema} (${count})`,
      description:
        "Este tipo de configuración son reglas que se evalúan en orden (como las reglas de un firewall), y ese orden solo vale dentro de un mismo scope (entorno, host group, etc.). " +
        "Al descargar el backup, Monaco generó referencias de orden que cruzan scopes distintos y no puede volver a aplicarlas. Es una limitación conocida de Monaco, no un error de este deploy.",
      fix:
        `Excluye el tipo "${schema}" del deploy (en "Desplegar este backup", desmarca "Todo el backup" y no selecciones ese tipo). ` +
        "Si necesitas migrar esas reglas, edita sus YAML en el backup quitando los parámetros 'insertAfter' y revisa el orden resultante.",
      excludeType: schema,
    });
  }

  // 2) Configuraciones duplicadas con el mismo nombre en el tenant origen.
  // El mismo error puede aparecer dos veces en el log (stream de Monaco +
  // volcado de .logs), asi que deduplicamos por tipo+nombre.
  const seenDuplicates = new Set<string>();
  for (const match of output.matchAll(DUPLICATED_NAME_RE)) {
    const type = match[1];
    const name = match[2];
    const key = `${type}|${name}`;
    if (seenDuplicates.has(key)) continue;
    seenDuplicates.add(key);
    excludeTypes.add(type);
    items.push({
      title: `Dos configuraciones "${type}" con el mismo nombre`,
      description:
        `En el tenant de ORIGEN existen dos configuraciones de tipo "${type}" llamadas «${name}». ` +
        "Monaco identifica las configs por nombre para decidir si crea o actualiza: con dos homónimas no puede saber cuál es cuál y se detiene.",
      fix:
        "En Dynatrace (tenant origen), renombra o elimina una de las dos y vuelve a correr el Backup. " +
        `Mientras tanto puedes excluir el tipo "${type}" del deploy.`,
      excludeType: type,
    });
  }

  // 3) Problemas de autenticacion/permisos del token destino.
  if (items.length === 0 && /(HTTP 401|Unauthorized|missing scope|Forbidden|HTTP 403)/i.test(output)) {
    items.push({
      title: "Token sin permisos suficientes (401/403)",
      description:
        "El tenant destino rechazó las llamadas de Monaco: el token no es válido o le faltan permisos (scopes) para escribir configuración.",
      fix:
        "Revisa el token del entorno destino en su edición (Clientes → Editar): debe tener los scopes de escritura de configuración. Usa 'Probar' para validar la conexión.",
    });
  }

  // 4) Fallback: fallo de validacion sin patron conocido.
  if (items.length === 0 && /Validation failed/i.test(output)) {
    items.push({
      title: "La validación del backup encontró errores",
      description:
        "El dry-run valida el backup completo ANTES de tocar el entorno destino; encontró configuraciones que no puede aplicar tal cual. El detalle exacto está al final del log.",
      fix:
        "Revisa las líneas de error del log (o descarga el log completo). Suele resolverse excluyendo los tipos conflictivos en el deploy por tipos.",
    });
  }

  return { items, excludeTypes: [...excludeTypes] };
}
