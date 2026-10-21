"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Activity, Gauge, LayoutDashboard, Database, HelpCircle, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export function NavLinks() {
  const pathname = usePathname();
  const { dict } = useI18n();

  const links = [
    { href: "/", label: dict.nav.clientes, icon: Home },
    { href: "/dashboards", label: dict.nav.dashboards, icon: LayoutDashboard },
    { href: "/lookups", label: dict.nav.lookups, icon: Database },
    { href: "/consumption", label: dict.nav.consumo, icon: Gauge },
    { href: "/activity", label: dict.nav.actividad, icon: Activity },
    { href: "/settings", label: dict.nav.configuracion, icon: Settings },
    { href: "/help", label: dict.nav.ayuda, icon: HelpCircle },
  ];

  return (
    <nav className="space-y-1">
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
