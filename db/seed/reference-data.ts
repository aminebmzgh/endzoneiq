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

type T = [string, string, string, TeamSeed["conference"], TeamSeed["division"], string, string];

// Alphabetical by abbreviation; ids are the 1-based position and must never change.
const TEAM_ROWS: T[] = [
  ["ARI", "Cardinals", "Arizona", "NFC", "West", "#97233F", "#000000"],
  ["ATL", "Falcons", "Atlanta", "NFC", "South", "#A71930", "#000000"],
  ["BAL", "Ravens", "Baltimore", "AFC", "North", "#241773", "#9E7C0C"],
  ["BUF", "Bills", "Buffalo", "AFC", "East", "#00338D", "#C60C30"],
  ["CAR", "Panthers", "Carolina", "NFC", "South", "#0085CA", "#101820"],
  ["CHI", "Bears", "Chicago", "NFC", "North", "#0B162A", "#C83803"],
  ["CIN", "Bengals", "Cincinnati", "AFC", "North", "#FB4F14", "#000000"],
  ["CLE", "Browns", "Cleveland", "AFC", "North", "#311D00", "#FF3C00"],
  ["DAL", "Cowboys", "Dallas", "NFC", "East", "#003594", "#869397"],
  ["DEN", "Broncos", "Denver", "AFC", "West", "#FB4F14", "#002244"],
  ["DET", "Lions", "Detroit", "NFC", "North", "#0076B6", "#B0B7BC"],
  ["GB", "Packers", "Green Bay", "NFC", "North", "#203731", "#FFB612"],
  ["HOU", "Texans", "Houston", "AFC", "South", "#03202F", "#A71930"],
  ["IND", "Colts", "Indianapolis", "AFC", "South", "#002C5F", "#A2AAAD"],
  ["JAX", "Jaguars", "Jacksonville", "AFC", "South", "#006778", "#D7A22A"],
  ["KC", "Chiefs", "Kansas City", "AFC", "West", "#E31837", "#FFB81C"],
  ["LA", "Rams", "Los Angeles", "NFC", "West", "#003594", "#FFA300"],
  ["LAC", "Chargers", "Los Angeles", "AFC", "West", "#0080C6", "#FFC20E"],
  ["LV", "Raiders", "Las Vegas", "AFC", "West", "#000000", "#A5ACAF"],
  ["MIA", "Dolphins", "Miami", "AFC", "East", "#008E97", "#FC4C02"],
  ["MIN", "Vikings", "Minnesota", "NFC", "North", "#4F2683", "#FFC62F"],
  ["NE", "Patriots", "New England", "AFC", "East", "#002244", "#C60C30"],
  ["NO", "Saints", "New Orleans", "NFC", "South", "#D3BC8D", "#101820"],
  ["NYG", "Giants", "New York", "NFC", "East", "#0B2265", "#A71930"],
  ["NYJ", "Jets", "New York", "AFC", "East", "#125740", "#000000"],
  ["PHI", "Eagles", "Philadelphia", "NFC", "East", "#004C54", "#A5ACAF"],
  ["PIT", "Steelers", "Pittsburgh", "AFC", "North", "#FFB612", "#101820"],
  ["SEA", "Seahawks", "Seattle", "NFC", "West", "#002244", "#69BE28"],
  ["SF", "49ers", "San Francisco", "NFC", "West", "#AA0000", "#B3995D"],
  ["TB", "Buccaneers", "Tampa Bay", "NFC", "South", "#D50A0A", "#34302B"],
  ["TEN", "Titans", "Tennessee", "AFC", "South", "#0C2340", "#4B92DB"],
  ["WAS", "Commanders", "Washington", "NFC", "East", "#5A1414", "#FFB612"],
];

export const TEAMS: TeamSeed[] = TEAM_ROWS.map(
  ([abbr, name, city, conference, division, primaryColor, secondaryColor], i) => ({
    id: i + 1,
    abbr,
    name,
    city,
    conference,
    division,
    primaryColor,
    secondaryColor,
  }),
);

/** Single source of truth, also read by the Python pipeline (travel/time-zone features). */
export const STADIUMS: StadiumSeed[] = stadiumsJson as StadiumSeed[];

/** Relocated franchises: nflverse uses the old abbreviation for older seasons. */
export const LEGACY_ABBR: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };
