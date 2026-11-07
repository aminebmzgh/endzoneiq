import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="border-t border-border text-sm text-muted-foreground">
      <div className="mx-auto w-full max-w-5xl space-y-1 px-4 py-6">
        <p>{t("entertainment")}</p>
        <p>{t("disclaimer")}</p>
      </div>
    </footer>
  );
}
