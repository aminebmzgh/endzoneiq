import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotFoundContent } from "@/components/not-found-content";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NotFound");
  return { title: t("metaTitle"), robots: { index: false } };
}

/** Shown when a localized page calls notFound() (unknown game, team or week). */
export default async function NotFound() {
  const t = await getTranslations("NotFound");
  return (
    <NotFoundContent
      code={t("code")}
      title={t("title")}
      body={t("body")}
      links={[
        { href: "/", label: t("home") },
        { href: "/record", label: t("record") },
        { href: "/teams", label: t("teams") },
      ]}
    />
  );
}
