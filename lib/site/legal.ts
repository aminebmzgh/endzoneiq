/**
 * Who runs EndzoneIQ, as stated in the legal pages. One place to change it.
 *
 * TODO(launch): the operator's identity is not decided yet (docs/launch.md). Until it is,
 * the pages show the bracketed placeholders below.
 */
export const LEGAL = {
  /** Legal name of the operator (the GDPR data controller). */
  operator: "[Operator name]",
  /** Postal address of the operator. */
  address: "[Postal address]",
  /** Contact for privacy requests and everything else. */
  email: "hello@endzoneiq.com",
  /** Governing law and courts, e.g. "the laws of France". */
  law: "[governing law]",
  /** Date the documents last changed in substance (ISO). */
  updated: "2026-11-09",
} as const;

export const MODEL_CARD_URL =
  "https://github.com/aminebmzgh/endzoneiq/blob/main/docs/model-card.md";
export const BACKTEST_URL = "https://github.com/aminebmzgh/endzoneiq/blob/main/docs/backtest.md";
