"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/context";
import { setLocale } from "@/lib/i18n/actions";

export function LanguageSwitcher() {
  const { locale } = useI18n();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onChange(next: string | null) {
    if (!next || next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      // Re-render de server components (layout y paginas) con el nuevo dict.
      router.refresh();
    });
  }

  return (
    <Select value={locale} onValueChange={onChange} disabled={isPending}>
      <SelectTrigger size="sm" className="w-full">
        <Languages className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LOCALES.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {LOCALE_NAMES[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
