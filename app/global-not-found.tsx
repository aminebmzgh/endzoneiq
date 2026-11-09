import type { Metadata } from "next";
import Link from "next/link";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import fr from "@/messages/fr.json";
import "./globals.css";

/**
 * 404 for URLs that match no route at all (e.g. /en/wp-login.php). Served directly,
 * without a layout, so it can't know the locale: it says it in all three languages.
 * notFound() inside a localized page renders app/[locale]/not-found.tsx instead.
 */
export const metadata: Metadata = {
  title: "404 | EndzoneIQ",
  robots: { index: false },
};

const LOCALES = [
  { code: "en", m: en.NotFound },
  { code: "fr", m: fr.NotFound },
  { code: "es", m: es.NotFound },
] as const;

export default function GlobalNotFound() {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:py-24">
          <Link href="/en" className="text-lg font-bold tracking-tight">
            Endzone<span className="text-accent">IQ</span>
          </Link>
          <p className="mt-10 font-mono text-sm text-accent">404</p>
          <div className="mt-2 space-y-8">
            {LOCALES.map(({ code, m }) => (
              <section key={code} lang={code}>
                <h1 className="text-2xl font-bold tracking-tight text-balance">{m.title}</h1>
                <p className="mt-2 text-muted-foreground">
                  <Link href={`/${code}`} className="text-accent underline underline-offset-4">
                    {m.home}
                  </Link>
                  {" · "}
                  <Link href={`/${code}/record`} className="underline underline-offset-4">
                    {m.record}
                  </Link>
                </p>
              </section>
            ))}
          </div>
        </div>
      </body>
    </html>
  );
}
