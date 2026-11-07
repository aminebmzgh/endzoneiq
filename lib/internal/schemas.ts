import { z } from "zod";
import { gameStatuses, gameTypes, pipelineRunStatuses, seasonPhases } from "@/db/schema";

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
