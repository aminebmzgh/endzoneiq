import { z } from "zod";
import {
  confidenceTiers,
  explanationSources,
  gameStatuses,
  gameTypes,
  pipelineRunStatuses,
  seasonPhases,
} from "@/db/schema";

export const MAX_GAMES_PER_REQUEST = 500;

const abbr = z.string().regex(/^[A-Z]{2,3}$/, "team abbreviation, e.g. KC");
const score = z.number().int().min(0).max(200).nullable();

export const gameInput = z
  .object({
    id: z.string().regex(/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/, "nflverse game_id"),
    season: z.number().int().min(1990).max(2100),
    week: z.number().int().min(1).max(25),
    gameType: z.enum(gameTypes),
    homeTeam: abbr,
    awayTeam: abbr,
    stadiumId: z.string().min(1).max(8).nullable(),
    neutralSite: z.boolean(),
    kickoffAt: z.iso.datetime({ offset: false }),
    status: z.enum(gameStatuses),
    homeScore: score,
    awayScore: score,
    overtime: z.boolean(),
  })
  .refine((g) => g.homeTeam !== g.awayTeam, { message: "home and away teams must differ" })
  .refine((g) => g.status !== "final" || (g.homeScore !== null && g.awayScore !== null), {
    message: "final games need both scores",
  });

export type GameInput = z.infer<typeof gameInput>;

export const seasonInput = z.object({
  year: z.number().int().min(1990).max(2100),
  currentWeek: z.number().int().min(0).max(25),
  phase: z.enum(seasonPhases),
});

export const ingestGamesBody = z
  .object({
    games: z.array(gameInput).max(MAX_GAMES_PER_REQUEST),
    seasons: z.array(seasonInput).max(50).default([]),
  })
  .refine((b) => new Set(b.games.map((g) => g.id)).size === b.games.length, {
    message: "duplicate game ids in payload",
  });

export const pipelineRunBody = z.object({
  id: z.string().min(1).max(96),
  job: z.string().min(1).max(64),
  status: z.enum(pipelineRunStatuses),
  startedAt: z.iso.datetime({ offset: false }).optional(),
  finishedAt: z.iso.datetime({ offset: false }).optional(),
  error: z.string().max(10_000).optional(),
  runUrl: z.url().max(255).optional(),
});

export const modelVersionBody = z.object({
  /** Content-addressed name from the pipeline, e.g. "lgbm-v1-a2b1f4972c". */
  name: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,63}$/, "lowercase name, e.g. lgbm-v1-abc123"),
  trainedAt: z.iso.datetime({ offset: false }),
  metrics: z.record(z.string(), z.unknown()),
  /** Where the model files live (a GitHub Release). Never stored in MySQL. */
  artifactUrl: z.url().max(512).nullable().optional(),
  /** Make this the version used for new picks (exactly one version is active). */
  activate: z.boolean().default(false),
});

// --- Picks (spec 8 + 10.1) ---------------------------------------------------

export const MAX_PICKS_PER_REQUEST = 64;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const sentence = (maxWords: number, maxChars: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maxChars)
    .refine((s) => words(s) <= maxWords, { message: `at most ${maxWords} words` });

/** Same rules as the pipeline's pydantic Explanation, enforced again here. */
export const explanationInput = z.object({
  headline: z.string().trim().min(1).max(160),
  reasons: z.array(sentence(20, 200)).length(3),
  matchupNotes: z.array(sentence(40, 300)).min(1).max(3),
  source: z.enum(explanationSources),
});

export const pickInput = z.object({
  gameId: z.string().regex(/^\d{4}_\d{2}_[A-Z]{2,3}_[A-Z]{2,3}$/),
  /** Calibrated P(home team wins); the site derives the winner from it. */
  homeWinProb: z.number().min(0).max(1),
  tier: z.enum(confidenceTiers),
  /** Projected home margin in points. */
  predMargin: z.number().min(-100).max(100),
  predTotal: z.number().min(0).max(200),
  features: z.record(z.string(), z.number().nullable()),
  shap: z.record(z.string(), z.unknown()),
  changeReason: z.string().trim().min(1).max(255).optional(),
  explanations: z.object({ en: explanationInput, fr: explanationInput, es: explanationInput }),
});
export type PickInput = z.infer<typeof pickInput>;

export const ingestPicksBody = z.object({
  modelVersion: modelVersionBody.shape.name,
  picks: z.array(pickInput).min(1).max(MAX_PICKS_PER_REQUEST),
});
