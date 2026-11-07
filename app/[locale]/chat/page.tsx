import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChatApp } from "@/components/chat/chat-app";
import type { Locale } from "@/i18n/routing";
import { pageMetadata } from "@/lib/site/seo";

const TOOLS = [
  "get_week_games",
  "get_game_detail",
  "get_team_stats",
  "get_player_info",
  "get_injuries",
  "get_pick_history",
  "get_track_record",
] as const;

export async function generateMetadata({ params }: PageProps<"/[locale]/chat">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Meta" });
  return pageMetadata({
    locale,
    path: "/chat",
    title: t("chatTitle"),
    description: t("chatDescription"),
  });
}

/** Static shell; the conversation lives in the browser and /api/chat. */
export default async function ChatPage({ params }: PageProps<"/[locale]/chat">) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Chat" });
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:py-10">
      <header className="mb-6 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="mt-2 text-muted-foreground">{t("intro")}</p>
      </header>
      <ChatApp
        locale={locale}
        labels={{
          signIn: t("signIn"),
          signInButton: t("signInButton"),
          placeholder: t("placeholder"),
          send: t("send"),
          stop: t("stop"),
          newChat: t("newChat"),
          history: t("history"),
          remaining: t.raw("remaining") as string,
          limitFree: t("limitFree"),
          limitPro: t("limitPro"),
          notConfigured: t("notConfigured"),
          error: t("error"),
          you: t("you"),
          assistant: t("assistant"),
          disclaimer: t("disclaimer"),
          examplesTitle: t("examplesTitle"),
          examples: [t("example1"), t("example2"), t("example3")],
          tools: Object.fromEntries(TOOLS.map((name) => [name, t(`tools.${name}`)])),
        }}
      />
    </div>
  );
}
