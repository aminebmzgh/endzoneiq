import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import type { Locale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/reset-password">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return { title: t("resetTitle"), robots: { index: false } };
}

/** Static page; the token is read from the URL in the browser. */
export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Auth" });
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{t("resetHeading")}</h1>
      <ResetPasswordForm
        locale={locale}
        labels={{
          newPassword: t("newPassword"),
          confirmPassword: t("confirmPassword"),
          passwordHint: t("passwordHint"),
          mismatch: t("mismatch"),
          tooShort: t("tooShort"),
          savePassword: t("savePassword"),
          saving: t("saving"),
          resetDone: t("resetDone"),
          invalidLink: t("invalidLink"),
          signInButton: t("signInButton"),
          error: t("error"),
        }}
      />
    </div>
  );
}
