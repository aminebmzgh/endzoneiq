const EASTERN = "America/New_York";

export function formatKickoff(
  iso: string,
  locale: string,
  timeZone: string | undefined,
  withDate: boolean,
): string {
  return new Intl.DateTimeFormat(locale, {
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));
}

/**
 * A date/time in US Eastern time (the NFL's reference zone) in the cached HTML.
 * `LocalTimes` (one client component in the layout) rewrites every one of these to
 * the visitor's own time zone after hydration, instead of one client island each.
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
  return (
    <time
      dateTime={iso}
      data-local={withDate ? "datetime" : "time"}
      data-locale={locale}
      className={className}
      suppressHydrationWarning
    >
      {formatKickoff(iso, locale, EASTERN, withDate)}
    </time>
  );
}
