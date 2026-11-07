"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect } from "react";

/**
 * Rewrites every server-rendered <time data-local> (US Eastern in the cached HTML)
 * to the visitor's own time zone, once per page, after hydration. One component for
 * the whole page instead of one per kickoff keeps the home page's main thread light.
 */
function Rewriter() {
  const pathname = usePathname();
  useEffect(() => {
    const formats = new Map<string, Intl.DateTimeFormat>();
    for (const el of document.querySelectorAll<HTMLTimeElement>("time[data-local]")) {
      const locale = el.dataset.locale ?? "en";
      const withDate = el.dataset.local === "datetime";
      const key = `${locale}|${withDate}`;
      let fmt = formats.get(key);
      if (!fmt) {
        fmt = new Intl.DateTimeFormat(locale, {
          ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        });
        formats.set(key, fmt);
      }
      const text = fmt.format(new Date(el.dateTime));
      if (el.textContent !== text) el.textContent = text;
    }
  }, [pathname]);
  return null;
}

export function LocalTimes() {
  return (
    <Suspense fallback={null}>
      <Rewriter />
    </Suspense>
  );
}
