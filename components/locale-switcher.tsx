"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useTransition } from "react";
import { routing, type Locale } from "@/i18n/routing";

const selectClass = "h-9 rounded-md border border-border bg-background px-2";

/** Each language is named in its own language, so these don't need translating. */
const NAMES: Record<Locale, string> = { en: "English", fr: "Français", es: "Español" };

function Options() {
  return routing.locales.map((l) => (
    <option key={l} value={l} lang={l}>
      {NAMES[l]}
    </option>
  ));
}

/** Same path in another locale: /en/game/x -> /fr/game/x. */
export function swapLocale(pathname: string, next: Locale): string {
  const parts = pathname.split("/");
  if ((routing.locales as readonly string[]).includes(parts[1] ?? "")) parts[1] = next;
  else parts.splice(1, 0, next);
  return parts.join("/") || `/${next}`;
}

type Props = { label: string; locale: Locale };

function Switcher({ label, locale }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="text-sm">
      <span className="sr-only">{label}</span>
      <select
        className={selectClass}
        value={locale}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value as Locale;
          // Remember the choice for visits to "/" (read by the locale middleware).
          document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.replace(swapLocale(pathname, next)));
        }}
      >
        <Options />
      </select>
    </label>
  );
}

/** Same look while the pathname (known only at request time on dynamic routes) streams in. */
function Placeholder({ label, locale }: Props) {
  return (
    <label className="text-sm">
      <span className="sr-only">{label}</span>
      <select className={selectClass} value={locale} disabled onChange={() => {}}>
        <Options />
      </select>
    </label>
  );
}

/**
 * Plain `next/navigation` and server-translated props: no next-intl client runtime
 * or message catalog in the browser.
 */
export function LocaleSwitcher(props: Props) {
  return (
    <Suspense fallback={<Placeholder {...props} />}>
      <Switcher {...props} />
    </Suspense>
  );
}
