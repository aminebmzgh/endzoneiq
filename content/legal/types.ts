/**
 * Long-form pages (legal, about). Kept out of messages/*.json because they are documents,
 * not UI strings; tests/legal-content.test.ts checks every locale has the same documents
 * and sections.
 *
 * Inline markup in paragraphs: [text](href) links ("/..." is locale-prefixed), **bold**,
 * and {placeholders} filled from lib/site/legal.ts (operator, email, address, law,
 * authority, updated). A list is written as an array of strings.
 */
export const DOC_IDS = ["about", "terms", "privacy", "cookies", "responsible-gaming"] as const;
export type DocId = (typeof DOC_IDS)[number];

export type Block = string | string[];

export interface LegalDoc {
  title: string;
  /** Meta description and the intro line under the title. */
  description: string;
  sections: { heading: string; body: Block[] }[];
}

export interface LegalContent {
  /** "Last updated {date}" */
  updated: string;
  /** Section heading of the table of contents. */
  contents: string;
  docs: Record<DocId, LegalDoc>;
}
