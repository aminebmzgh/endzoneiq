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

type S = [
  id: string,
  name: string,
  team: string | null,
  lat: number,
  lon: number,
  roof: StadiumSeed["roofType"],
  surface: StadiumSeed["surface"],
  altitudeM: number,
  timezone: string,
  active: boolean,
];

const NY = "America/New_York";
const CHI = "America/Chicago";
const LAX = "America/Los_Angeles";

const STADIUM_ROWS: S[] = [
  ["ATL00", "Georgia Dome", "ATL", 33.7577, -84.4008, "dome", "turf", 300, NY, false],
  [
    "ATL97",
    "Mercedes-Benz Stadium",
    "ATL",
    33.7554,
    -84.4008,
    "retractable",
    "turf",
    300,
    NY,
    true,
  ],
  ["BAL00", "M&T Bank Stadium", "BAL", 39.278, -76.6227, "outdoors", "grass", 10, NY, true],
  ["BOS00", "Gillette Stadium", "NE", 42.0909, -71.2643, "outdoors", "turf", 80, NY, true],
  ["BUF00", "Highmark Stadium", "BUF", 42.7766, -78.7848, "outdoors", "grass", 190, NY, true],
  [
    "BUF01",
    "Rogers Centre",
    "BUF",
    43.6414,
    -79.3894,
    "retractable",
    "turf",
    90,
    "America/Toronto",
    false,
  ],
  ["CAR00", "Bank of America Stadium", "CAR", 35.2258, -80.8528, "outdoors", "turf", 230, NY, true],
  ["CHI98", "Soldier Field", "CHI", 41.8623, -87.6167, "outdoors", "grass", 180, CHI, true],
  ["CIN00", "Paycor Stadium", "CIN", 39.0954, -84.516, "outdoors", "turf", 150, NY, true],
  ["CLE00", "Huntington Bank Field", "CLE", 41.5061, -81.6995, "outdoors", "grass", 180, NY, true],
  ["DAL00", "AT&T Stadium", "DAL", 32.7473, -97.0945, "retractable", "turf", 180, CHI, true],
  [
    "DEN00",
    "Empower Field at Mile High",
    "DEN",
    39.7439,
    -105.0201,
    "outdoors",
    "grass",
    1609,
    "America/Denver",
    true,
  ],
  ["DET00", "Ford Field", "DET", 42.34, -83.0456, "dome", "turf", 180, "America/Detroit", true],
  [
    "FRA00",
    "Deutsche Bank Park",
    null,
    50.0686,
    8.6455,
    "outdoors",
    "grass",
    110,
    "Europe/Berlin",
    true,
  ],
  [
    "GER00",
    "Allianz Arena",
    null,
    48.2188,
    11.6247,
    "outdoors",
    "grass",
    520,
    "Europe/Berlin",
    true,
  ],
  ["GNB00", "Lambeau Field", "GB", 44.5013, -88.0622, "outdoors", "grass", 195, CHI, true],
  ["HOU00", "NRG Stadium", "HOU", 29.6847, -95.4107, "retractable", "turf", 15, CHI, true],
  [
    "IND00",
    "Lucas Oil Stadium",
    "IND",
    39.7601,
    -86.1639,
    "retractable",
    "turf",
    218,
    "America/Indiana/Indianapolis",
    true,
  ],
  ["JAX00", "EverBank Stadium", "JAX", 30.3239, -81.6373, "outdoors", "grass", 5, NY, true],
  [
    "KAN00",
    "GEHA Field at Arrowhead Stadium",
    "KC",
    39.0489,
    -94.4839,
    "outdoors",
    "grass",
    265,
    CHI,
    true,
  ],
  ["LAX01", "SoFi Stadium", "LA", 33.9535, -118.3392, "dome", "turf", 30, LAX, true],
  [
    "LAX97",
    "Dignity Health Sports Park",
    "LAC",
    33.8644,
    -118.2611,
    "outdoors",
    "grass",
    10,
    LAX,
    false,
  ],
  [
    "LAX99",
    "Los Angeles Memorial Coliseum",
    "LA",
    34.0141,
    -118.2879,
    "outdoors",
    "grass",
    50,
    LAX,
    false,
  ],
  [
    "LON00",
    "Wembley Stadium",
    null,
    51.556,
    -0.2796,
    "outdoors",
    "grass",
    50,
    "Europe/London",
    true,
  ],
  [
    "LON01",
    "Twickenham Stadium",
    null,
    51.456,
    -0.3415,
    "outdoors",
    "grass",
    10,
    "Europe/London",
    false,
  ],
  [
    "LON02",
    "Tottenham Hotspur Stadium",
    null,
    51.6043,
    -0.0664,
    "outdoors",
    "grass",
    30,
    "Europe/London",
    true,
  ],
  [
    "MAD01",
    "Santiago Bernabéu",
    null,
    40.4531,
    -3.6883,
    "retractable",
    "grass",
    660,
    "Europe/Madrid",
    true,
  ],
  [
    "MEL00",
    "Melbourne Cricket Ground",
    null,
    -37.82,
    144.9834,
    "outdoors",
    "grass",
    20,
    "Australia/Melbourne",
    true,
  ],
  [
    "MEX00",
    "Estadio Banorte",
    null,
    19.3029,
    -99.1505,
    "outdoors",
    "grass",
    2200,
    "America/Mexico_City",
    true,
  ],
  ["MIA00", "Hard Rock Stadium", "MIA", 25.958, -80.2389, "outdoors", "grass", 3, NY, true],
  [
    "MIN00",
    "Hubert H. Humphrey Metrodome",
    "MIN",
    44.9738,
    -93.2581,
    "dome",
    "turf",
    255,
    CHI,
    false,
  ],
  ["MIN01", "U.S. Bank Stadium", "MIN", 44.9737, -93.2577, "dome", "turf", 255, CHI, true],
  [
    "MIN98",
    "Huntington Bank Stadium",
    "MIN",
    44.9765,
    -93.2246,
    "outdoors",
    "turf",
    255,
    CHI,
    false,
  ],
  [
    "MUN01",
    "Allianz Arena",
    null,
    48.2188,
    11.6247,
    "outdoors",
    "grass",
    520,
    "Europe/Berlin",
    true,
  ],
  ["NAS00", "Nissan Stadium", "TEN", 36.1665, -86.7713, "outdoors", "turf", 130, CHI, true],
  ["NOR00", "Caesars Superdome", "NO", 29.9511, -90.0812, "dome", "turf", 2, CHI, true],
  ["NYC01", "MetLife Stadium", "NYG", 40.8135, -74.0745, "outdoors", "turf", 5, NY, true],
  ["OAK00", "Oakland Coliseum", "LV", 37.7516, -122.2005, "outdoors", "grass", 10, LAX, false],
  [
    "PAR00",
    "Stade de France",
    null,
    48.9245,
    2.3602,
    "outdoors",
    "grass",
    40,
    "Europe/Paris",
    true,
  ],
  ["PHI00", "Lincoln Financial Field", "PHI", 39.9008, -75.1675, "outdoors", "grass", 10, NY, true],
  [
    "PHO00",
    "State Farm Stadium",
    "ARI",
    33.5276,
    -112.2626,
    "retractable",
    "grass",
    330,
    "America/Phoenix",
    true,
  ],
  ["PIT00", "Acrisure Stadium", "PIT", 40.4468, -80.0158, "outdoors", "grass", 220, NY, true],
  [
    "RIO00",
    "Maracanã Stadium",
    null,
    -22.9122,
    -43.2302,
    "outdoors",
    "grass",
    10,
    "America/Sao_Paulo",
    true,
  ],
  [
    "SAO00",
    "Neo Química Arena",
    null,
    -23.5453,
    -46.4742,
    "outdoors",
    "grass",
    760,
    "America/Sao_Paulo",
    true,
  ],
  ["SDG00", "Qualcomm Stadium", "LAC", 32.7831, -117.1196, "outdoors", "grass", 20, LAX, false],
  ["SEA00", "Lumen Field", "SEA", 47.5952, -122.3316, "outdoors", "turf", 5, LAX, true],
  ["SFO00", "Candlestick Park", "SF", 37.7136, -122.3863, "outdoors", "grass", 5, LAX, false],
  ["SFO01", "Levi's Stadium", "SF", 37.4033, -121.9694, "outdoors", "grass", 5, LAX, true],
  ["STL00", "Edward Jones Dome", "LA", 38.6328, -90.1885, "dome", "turf", 140, CHI, false],
  ["TAM00", "Raymond James Stadium", "TB", 27.9759, -82.5033, "outdoors", "grass", 10, NY, true],
  ["VEG00", "Allegiant Stadium", "LV", 36.0909, -115.1833, "dome", "grass", 620, LAX, true],
  ["WAS00", "Northwest Stadium", "WAS", 38.9078, -76.8645, "outdoors", "grass", 60, NY, true],
];

export const STADIUMS: StadiumSeed[] = STADIUM_ROWS.map(
  ([id, name, team, lat, lon, roofType, surface, altitudeM, timezone, isActive]) => ({
    id,
    name,
    team,
    lat,
    lon,
    roofType,
    surface,
    altitudeM,
    timezone,
    isActive,
  }),
);

/** Relocated franchises: nflverse uses the old abbreviation for older seasons. */
export const LEGACY_ABBR: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };
