"use client";

import { useEffect, useState } from "react";

const EASTERN = "America/New_York";

function format(iso: string, locale: string, timeZone?: string, withDate = true): string {
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

/**
 * Kickoff in the visitor's own time zone. The server (and the cached HTML) render
 * US Eastern time, the NFL's reference zone; the browser swaps in local time.
 */
export function LocalTime({
  iso,
  locale,
  withDate = true,
  className,
}: {
  iso: string;
  locale: string;
  withDate?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(() => format(iso, locale, EASTERN, withDate));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only time zone
    setText(format(iso, locale, undefined, withDate));
  }, [iso, locale, withDate]);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}
