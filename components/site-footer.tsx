import { useTranslations } from "next-intl";
import { Link } from "@/components/locale-link";
import { CookieSettingsButton } from "@/components/telemetry";
import { DOC_PATHS } from "@/content/legal";

export function SiteFooter() {
  const t = useTranslations("Footer");
  const links = [
    { href: DOC_PATHS.about, label: t("about") },
    { href: DOC_PATHS.terms, label: t("terms") },
    { href: DOC_PATHS.privacy, label: t("privacy") },
    { href: DOC_PATHS.cookies, label: t("cookies") },
    { href: DOC_PATHS["responsible-gaming"], label: t("responsibleGaming") },
  ];
  return (
    <footer className="border-t border-border text-sm text-muted-foreground">
      <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-6">
        <nav aria-label={t("links")}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  prefetch={false}
                  className="hover:text-foreground hover:underline"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton label={t("cookieSettings")} />
            </li>
          </ul>
        </nav>
        <div className="space-y-1">
          <p>{t("entertainment")}</p>
          <p>{t("disclaimer")}</p>
          <p>{t("data")}</p>
        </div>
      </div>
    </footer>
  );
}
