"use client";

import { createContext, useContext } from "react";
import { interpolate, type Locale } from "./config";
import type { Dictionary } from "./dict/es";

interface I18nValue {
  locale: Locale;
  dict: Dictionary;
  /** Interpola {placeholders} en una plantilla del diccionario. */
  f: (template: string, vars: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: React.ReactNode;
}) {
  return (
    <I18nContext.Provider value={{ locale, dict, f: interpolate }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n debe usarse dentro de <I18nProvider>.");
  return value;
}
