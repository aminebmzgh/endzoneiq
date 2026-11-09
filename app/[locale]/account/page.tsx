import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Suspense } from "react";
import {
  DeleteAccountForm,
  ManageBillingButton,
  PreferencesForm,
  SignOutButton,
} from "@/components/account/account-actions";
import { AlertsPanel } from "@/components/account/alerts-panel";
import { Link } from "@/components/locale-link";
import { TEAMS } from "@/db/seed/reference-data";
import type { Locale } from "@/i18n/routing";
import { getAccount } from "@/lib/account";
import { getViewer, isAdmin } from "@/lib/authz";

type Props = PageProps<"/[locale]/account">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return { title: t("accountTitle"), robots: { index: false } };
}

/** Per-user content: rendered at request time from the session cookie. */
async function AccountContent({
  locale,
  searchParams,
}: {
  locale: Locale;
  searchParams: Props["searchParams"];
}) {
  const viewer = await getViewer(await headers());
  if (!viewer) redirect(`/${locale}/signin`);
  const [account, sp, t] = await Promise.all([
    getAccount(viewer),
    searchParams,
    getTranslations({ locale, namespace: "Account" }),
  ]);
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(iso));
  const sub = account.subscription;
  const sortedTeams = [...TEAMS].sort((a, b) => a.abbr.localeCompare(b.abbr));
  const status =
    !sub || account.plan === "free"
      ? null
      : sub.status === "past_due"
        ? t("pastDue")
        : sub.currentPeriodEnd
          ? sub.status === "trialing"
            ? t("trialEnds", { date: date(sub.currentPeriodEnd) })
            : sub.cancelAtPeriodEnd
              ? t("ends", { date: date(sub.currentPeriodEnd) })
              : t("renews", { date: date(sub.currentPeriodEnd) })
          : null;

  return (
    <div className="space-y-6">
      {sp.checkout === "success" && (
        <p role="status" className="rounded-lg border border-accent/40 bg-accent/10 p-4">
          {t("checkoutSuccess")}
        </p>
      )}
      <p className="text-muted-foreground">{t("signedInAs", { email: viewer.email })}</p>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm text-muted-foreground">{t("plan")}</h2>
        <p className="mt-1 text-2xl font-bold">
          {isAdmin(viewer) ? t("adminAccess") : account.plan === "pro" ? t("pro") : t("free")}
        </p>
        {status && <p className="mt-1 text-sm text-muted-foreground">{status}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          {account.plan === "free" && !isAdmin(viewer) && (
            <Link
              href="/pricing"
              prefetch={false}
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground"
            >
              {t("upgrade")}
            </Link>
          )}
          {account.hasBillingAccount && (
            <ManageBillingButton locale={locale} label={t("manage")} error={t("error")} />
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold">{t("preferences")}</h2>
        <PreferencesForm
          initial={{ locale: account.locale, favoriteTeam: account.favoriteTeam }}
          teams={sortedTeams.map((x) => ({ abbr: x.abbr, name: `${x.city} ${x.name}` }))}
          labels={{
            language: t("language"),
            favoriteTeam: t("favoriteTeam"),
            none: t("none"),
            save: t("save"),
            saved: t("saved"),
            error: t("error"),
            languages: { en: "English", fr: "Français", es: "Español" },
          }}
        />
      </section>

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold">{t("alertsHeading")}</h2>
        <AlertsPanel
          locale={locale}
          teams={sortedTeams.map((x) => ({ abbr: x.abbr, name: x.name }))}
          labels={{
            push: t("push"),
            braveHint: t("braveHint"),
            testPush: t("testPush"),
            testSent: t("testSent"),
            pushOn: t("pushOn"),
            enablePush: t("enablePush"),
            disablePush: t("disablePush"),
            pushUnsupported: t("pushUnsupported"),
            pushDenied: t("pushDenied"),
            pickChange: t("pickChange"),
            pickChangeEmail: t("pickChangeEmail"),
            weekly: t("weekly"),
            teams: t("teams"),
            proOnly: t("proOnly"),
            save: t("saveAlerts"),
            saved: t("saved"),
            error: t("error"),
          }}
        />
      </section>

      <SignOutButton locale={locale} label={t("signOut")} />

      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-2 font-semibold">{t("dataHeading")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          {t("dataBody")}{" "}
          <Link href="/privacy" prefetch={false} className="underline underline-offset-4">
            {t("privacyLink")}
          </Link>
        </p>
        <a
          href="/api/account/export"
          download
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t("exportData")}
        </a>
      </section>

      <section className="rounded-lg border border-danger/40 bg-card p-5">
        <h2 className="mb-2 font-semibold">{t("deleteHeading")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("deleteBody")}</p>
        <DeleteAccountForm
          locale={locale}
          email={viewer.email}
          labels={{
            confirm: t("deleteConfirm"),
            button: t("deleteButton"),
            error: t("deleteError"),
          }}
        />
      </section>
    </div>
  );
}

export default async function AccountPage({ params, searchParams }: Props) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Account" });
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10">
      <h1 className="mb-4 text-3xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={<div aria-busy="true" className="h-40 rounded-lg border border-border bg-card" />}
      >
        <AccountContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
