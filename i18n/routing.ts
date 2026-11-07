import { defineRouting } from "next-intl/routing";

export const locales = ["en", "fr", "es"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  // Always prefix (/en, /fr, /es) so every page has one canonical localized URL.
  localePrefix: "always",
  // Detect from Accept-Language on first visit, then remember via cookie.
  localeDetection: true,
});
