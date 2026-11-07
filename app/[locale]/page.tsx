import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";

export default function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");

  const principles = [t("principle1"), t("principle2"), t("principle3")];

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">{t("tagline")}</h1>
      <p className="mt-6 text-lg text-pretty text-muted-foreground">{t("comingSoon")}</p>
      <ul className="mt-10 space-y-4">
        {principles.map((p) => (
          <li key={p} className="flex items-start gap-3">
            <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
