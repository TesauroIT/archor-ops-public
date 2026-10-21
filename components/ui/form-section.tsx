import * as React from "react";
import { cn } from "@/lib/utils";

// Patron de seccion de formulario/panel. Un primitivo reusable para NO volver a
// armar divs sueltos "como caiga": cada seccion tiene un acento de color, un
// icono, titulo, descripcion opcional y un cuerpo. Documentado en specs/design.md.
//
// Uso:
//   <FormSection accent="blue" icon={<Server />} title="Monaco" description="...">
//     ...campos...
//   </FormSection>

export type SectionAccent = "blue" | "violet" | "amber" | "slate";

const ACCENTS: Record<SectionAccent, { bar: string; chip: string }> = {
  blue: { bar: "bg-blue-500", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  violet: { bar: "bg-violet-500", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  amber: { bar: "bg-amber-500", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  slate: { bar: "bg-slate-400", chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300" },
};

export function FormSection({
  accent = "slate",
  icon,
  title,
  description,
  action,
  children,
  className,
}: {
  accent?: SectionAccent;
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode; // slot a la derecha del header (ej. boton de validar)
  children: React.ReactNode;
  className?: string;
}) {
  const c = ACCENTS[accent];
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-4 pl-5 shadow-sm",
        className
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", c.bar)} aria-hidden />
      <header className="flex items-start gap-3">
        {icon && (
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-5",
              c.chip
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium leading-tight">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}
