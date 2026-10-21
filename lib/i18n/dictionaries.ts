import type { Locale } from "./config";
import type { Dictionary } from "./dict/es";

// Carga perezosa del diccionario por locale. Los objetos son datos JSON planos
// (serializables), asi que pueden pasarse del server al provider client.
const loaders: Record<Locale, () => Promise<{ default: Dictionary }>> = {
  es: () => import("./dict/es"),
  en: () => import("./dict/en"),
  pt: () => import("./dict/pt"),
  de: () => import("./dict/de"),
  zh: () => import("./dict/zh"),
  ja: () => import("./dict/ja"),
};

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  const mod = await loaders[locale]();
  return mod.default;
}

export type { Dictionary };
