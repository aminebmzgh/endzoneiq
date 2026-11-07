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

const LABELS = [
  "intro",
  "introSignUp",
  "email",
  "emailPlaceholder",
  "password",
  "passwordHint",
  "signInButton",
  "signingIn",
  "createAccount",
  "creating",
  "noAccount",
  "haveAccount",
  "forgot",
  "forgotIntro",
  "sendReset",
  "useLink",
  "send",
  "sending",
  "backToSignIn",
  "or",
  "google",
  "error",
  "invalidCredentials",
  "notVerified",
  "exists",
  "tooShort",
  "tooMany",
  "notConfigured",
] as const;
const TEMPLATES = ["resetSent", "signUpSent", "sent"] as const;

/** Static page; the form talks to /api/auth in the browser. Returns to the account page. */
export default async function SignInPage({ params }: PageProps<"/[locale]/signin">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Auth" });
  const labels = {
    ...Object.fromEntries(LABELS.map((k) => [k, t(k)])),
    ...Object.fromEntries(TEMPLATES.map((k) => [k, t.raw(k) as string])),
  } as Parameters<typeof SignInForm>[0]["labels"];
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="mb-2 text-3xl font-bold tracking-tight">{t("heading")}</h1>
      <SignInForm locale={locale} callbackPath={`/${locale}/account`} labels={labels} />
      <p className="mt-6 text-xs text-muted-foreground">{t("terms")}</p>
    </div>
  );
}
