"use client";

import { useLocale, useTranslations } from "next-intl";
import { Suspense, useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

const selectClass = "h-9 rounded-md border border-border bg-background px-2";

function Options() {
  const t = useTranslations("Locale");
  return routing.locales.map((l) => (
    <option key={l} value={l}>
      {t(l)}
    </option>
  ));
}

function Switcher() {
  const t = useTranslations("Locale");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="text-sm">
      <span className="sr-only">{t("label")}</span>
      <select
        className={selectClass}
        value={locale}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value as Locale;
          startTransition(() => router.replace(pathname, { locale: next }));
        }}
      >
        <Options />
      </select>
    </label>
  );
}

/** Same look while the pathname (known only at request time on dynamic routes) streams in. */
function Placeholder() {
  const t = useTranslations("Locale");
  const locale = useLocale();
  return (
    <label className="text-sm">
      <span className="sr-only">{t("label")}</span>
      <select className={selectClass} value={locale} disabled onChange={() => {}}>
        <Options />
      </select>
    </label>
  );
}

export function LocaleSwitcher() {
  return (
    <Suspense fallback={<Placeholder />}>
      <Switcher />
    </Suspense>
  );
}
