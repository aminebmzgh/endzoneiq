import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignInForm } from "@/components/auth/sign-in-form";
import type { Locale } from "@/i18n/routing";
import { pageMetadata } from "@/lib/site/seo";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/signin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return {
    ...pageMetadata({
      locale,
      path: "/signin",
      title: t("signInTitle"),
      description: t("signInDescription"),
    }),
    robots: { index: false },
  };
}

/** Static page; the form talks to /api/auth in the browser. Returns to the account page. */
export default async function SignInPage({ params }: PageProps<"/[locale]/signin">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Auth" });
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
      <p className="mt-2 mb-6 text-muted-foreground">{t("intro")}</p>
      <SignInForm
        locale={locale}
        callbackPath={`/${locale}/account`}
        labels={{
          email: t("email"),
          emailPlaceholder: t("emailPlaceholder"),
          send: t("send"),
          sending: t("sending"),
          sent: t.raw("sent") as string,
          or: t("or"),
          google: t("google"),
          error: t("error"),
          notConfigured: t("notConfigured"),
        }}
      />
      <p className="mt-6 text-xs text-muted-foreground">{t("terms")}</p>
    </div>
  );
}
