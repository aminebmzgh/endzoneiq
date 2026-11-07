import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

export const SITE_NAME = "EndzoneIQ";

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/**
 * Canonical + hreflang alternates for a localized path ("" for the home page,
 * "/record", "/game/<slug>"...). x-default points at English.
 */
export function alternates(locale: string, path: string): Metadata["alternates"] {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((l) => [l, `/${l}${path}`])),
      "x-default": `/${routing.defaultLocale}${path}`,
    },
  };
}

/** Title, description, canonical/hreflang and Open Graph for one localized page. */
export function pageMetadata(opts: {
  locale: string;
  path: string;
  title: string;
  description: string;
  /** Use the title as-is (no " | EndzoneIQ" suffix). */
  absoluteTitle?: boolean;
}): Metadata {
  const { locale, path, title, description } = opts;
  return {
    title: opts.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: alternates(locale, path),
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url: `/${locale}${path}`,
      locale: { en: "en_US", fr: "fr_FR", es: "es_ES" }[locale] ?? "en_US",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** Serialize JSON-LD safely inside a <script> tag. */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
