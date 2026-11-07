import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/components/locale-link";
import type { Locale } from "@/i18n/routing";
import { AccountButton } from "./account-button";
import { LocaleSwitcher } from "./locale-switcher";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  const t = useTranslations("Nav");
  const tl = useTranslations("Locale");
  const tt = useTranslations("Theme");
  const locale = useLocale() as Locale;
  const items = [
    { href: "/", label: t("thisWeek") },
    { href: "/record", label: t("record") },
    { href: "/teams", label: t("teams") },
    { href: "/pricing", label: t("pricing") },
  ] as const;
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
        <Link href="/" prefetch={false} className="shrink-0 text-lg font-bold tracking-tight">
          Endzone<span className="text-accent">IQ</span>
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher label={tl("label")} locale={locale} />
          <ThemeToggle label={tt("toggle")} />
          <AccountButton locale={locale} labels={{ signIn: t("signIn"), account: t("account") }} />
        </div>
      </div>
      <nav aria-label={t("label")} className="mx-auto w-full max-w-5xl overflow-x-auto px-4">
        <ul className="flex gap-5 text-sm">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                prefetch={false}
                className="inline-block border-b-2 border-transparent py-2 text-muted-foreground hover:border-accent hover:text-foreground"
              >
                {i.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
