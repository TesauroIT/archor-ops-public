// Configuracion de idiomas de la app. El locale se guarda en una cookie y se
// detecta inicialmente por el Accept-Language del navegador (ver server.ts).

export const LOCALES = ["es", "en", "pt", "de", "zh", "ja"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "es";

// Nombre de cada idioma en su propio idioma, para el selector.
export const LOCALE_NAMES: Record<Locale, string> = {
  es: "Español",
  en: "English",
  pt: "Português",
  de: "Deutsch",
  zh: "中文",
  ja: "日本語",
};

// Valor del atributo lang del <html> por locale.
export const HTML_LANG: Record<Locale, string> = {
  es: "es",
  en: "en",
  pt: "pt",
  de: "de",
  zh: "zh-Hans",
  ja: "ja",
};

export const LOCALE_COOKIE = "archon_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

// Reemplaza {placeholders} en una plantilla de traduccion.
export function interpolate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`
  );
}
