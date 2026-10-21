import "server-only";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, isLocale, type Locale } from "./config";
import { getDictionary, type Dictionary } from "./dictionaries";

// Locale efectivo del request: cookie explicita del usuario, si no el mejor
// match del Accept-Language del navegador, si no el default.
export async function getLocale(): Promise<Locale> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookieLocale)) return cookieLocale;

  const acceptLanguage = (await headers()).get("accept-language");
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(",")) {
      const code = part.split(";")[0]?.trim().slice(0, 2).toLowerCase();
      if (isLocale(code)) return code;
    }
  }
  return DEFAULT_LOCALE;
}

// Atajo para server components: locale + diccionario ya resueltos.
export async function getServerI18n(): Promise<{ locale: Locale; dict: Dictionary }> {
  const locale = await getLocale();
  return { locale, dict: await getDictionary(locale) };
}

export { LOCALES };
