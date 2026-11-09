import type { Locale } from "@/i18n/routing";
import { LEGAL, MODEL_CARD_URL } from "@/lib/site/legal";
import en from "./en";
import es from "./es";
import fr from "./fr";
import type { DocId, LegalContent } from "./types";

export { DOC_IDS, type Block, type DocId, type LegalDoc } from "./types";

export const LEGAL_CONTENT: Record<Locale, LegalContent> = { en, fr, es };

/** Public path of each document (also used by the footer and the sitemap). */
export const DOC_PATHS: Record<DocId, string> = {
  about: "/about",
  terms: "/terms",
  privacy: "/privacy",
  cookies: "/cookies",
  "responsible-gaming": "/responsible-gaming",
};

/** Fills {placeholders}. Unknown names stay visible so a typo is caught by the test. */
export function fill(text: string, locale: Locale): string {
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${LEGAL.updated}T00:00:00Z`),
  );
  const values: Record<string, string> = {
    operator: LEGAL.operator,
    address: LEGAL.address,
    email: LEGAL.email,
    law: LEGAL.law,
    modelCard: MODEL_CARD_URL,
    updated,
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
}
