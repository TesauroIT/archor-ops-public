import { z } from "zod";
import { normalizeEnvId, buildSaasUrl } from "@/lib/dynatrace";

// Esquema compartido por crear/editar entornos: el usuario elige entre
// modo "saas" (solo ingresa el ID del entorno y armamos la URL) o
// "custom" (URL completa, para Managed / dominios propios).
export const envLocationSchema = z
  .object({
    mode: z.enum(["saas", "custom"]).default("saas"),
    envId: z.string().optional(),
    url: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "saas") {
      const id = normalizeEnvId(data.envId ?? "");
      if (!id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ingresa el ID del entorno (ej. abc12345).",
          path: ["envId"],
        });
      }
    } else {
      const raw = (data.url ?? "").trim();
      const parsed = z.string().url().safeParse(raw);
      if (!parsed.success || !/^https?:\/\//i.test(raw)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Ingresa una URL valida (https://...).",
          path: ["url"],
        });
      }
    }
  });

export type EnvLocationInput = z.infer<typeof envLocationSchema>;

export interface ResolvedLocation {
  url: string;
  envId: string | null;
}

// Resuelve la URL final + el ID crudo a partir del input validado.
export function resolveLocation(input: EnvLocationInput): ResolvedLocation {
  if (input.mode === "saas") {
    const id = normalizeEnvId(input.envId ?? "");
    return { url: buildSaasUrl(id), envId: id };
  }
  return { url: (input.url ?? "").trim().replace(/\/+$/, ""), envId: null };
}
