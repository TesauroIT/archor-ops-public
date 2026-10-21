"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function RouteActivityLogger() {
  const pathname = usePathname();
  const lastPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPathRef.current) return;
    lastPathRef.current = pathname;

    void fetch("/api/activity/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
