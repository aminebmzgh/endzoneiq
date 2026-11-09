import { describe, expect, it } from "vitest";
import { ERROR_COPY } from "@/components/error-copy";
import { DOC_IDS, DOC_PATHS, fill, LEGAL_CONTENT } from "@/content/legal";
import { routing } from "@/i18n/routing";

const shape = (locale: (typeof routing.locales)[number]) =>
  DOC_IDS.map((id) =>
    LEGAL_CONTENT[locale].docs[id].sections.map((s) =>
      s.body.map((b) => (Array.isArray(b) ? b.length : "p")),
    ),
  );

const allText = (locale: (typeof routing.locales)[number]) =>
  DOC_IDS.flatMap((id) => {
    const d = LEGAL_CONTENT[locale].docs[id];
    return [d.title, d.description, ...d.sections.flatMap((s) => [s.heading, ...s.body.flat()])];
  });

/** Internal pages the documents may link to. */
const ROUTES = new Set([...Object.values(DOC_PATHS), "/record", "/pricing", "/account", "/teams"]);

describe("legal and about pages", () => {
  it.each(routing.locales.filter((l) => l !== "en"))(
    "%s has the same documents, sections and lists as en",
    (locale) => {
      expect(shape(locale)).toEqual(shape("en"));
    },
  );

  it.each(routing.locales)("%s fills every placeholder", (locale) => {
    for (const text of allText(locale)) {
      expect(fill(text, locale)).not.toMatch(/\{\w+\}/);
    }
  });

  it.each(routing.locales)("%s links only to pages that exist", (locale) => {
    for (const text of allText(locale)) {
      for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (href.startsWith("/")) expect(ROUTES, href).toContain(href);
        else expect(href).toMatch(/^(https:\/\/|mailto:|\{)/);
      }
    }
  });

  it.each(routing.locales)("%s states the non-affiliation and 'not betting advice'", (locale) => {
    const terms = LEGAL_CONTENT[locale].docs.terms.sections.flatMap((s) => s.body.flat()).join(" ");
    expect(terms).toMatch(/NFL/);
    expect(terms.toLowerCase()).toMatch(/betting|pari|apuestas/);
  });

  it("every locale has error-page copy", () => {
    expect(Object.keys(ERROR_COPY).sort()).toEqual([...routing.locales].sort());
  });
});
