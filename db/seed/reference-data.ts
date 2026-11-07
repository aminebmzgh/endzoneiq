/**
 * Reference data seeded by a migration (see scripts/gen-seed-migration.ts).
 * Team names and abbreviations are plain text; colors drive neutral badges.
 * No logos or official imagery, ever.
 *
 * Stadium ids are nflverse `stadium_id`s, so schedule rows map straight onto them.
 * Roof and surface are curated here (nflverse's per-game values are noisy).
 * Coordinates are stadium centers (about 100 m precision), used for weather lookups.
 */
import type { conferences, divisions, roofTypes, surfaces } from "../schema";
import stadiumsJson from "./stadiums.json";
import teamsJson from "./teams.json";

export interface TeamSeed {
  id: number;
  abbr: string;
  name: string;
  city: string;
  conference: (typeof conferences)[number];
  division: (typeof divisions)[number];
  primaryColor: string;
  secondaryColor: string;
}

export interface StadiumSeed {
  id: string;
  name: string;
  team: string | null;
  lat: number;
  lon: number;
  roofType: (typeof roofTypes)[number];
  surface: (typeof surfaces)[number];
  altitudeM: number;
  timezone: string;
  isActive: boolean;
}

/** Ids are 1-based alphabetical by abbreviation and must never change. Also read by the pipeline. */
export const TEAMS: TeamSeed[] = teamsJson as TeamSeed[];

/** Single source of truth, also read by the Python pipeline (travel/time-zone features). */
export const STADIUMS: StadiumSeed[] = stadiumsJson as StadiumSeed[];

/** Relocated franchises: nflverse uses the old abbreviation for older seasons. */
export const LEGACY_ABBR: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };
