/**
 * EndzoneIQ database schema (spec Section 9), MariaDB 11.8 via Drizzle.
 *
 * Conventions: utf8mb4, every DATETIME is UTC (the pool sets timezone "Z"),
 * JSON columns use `jsonText` (MariaDB stores JSON as LONGTEXT and returns strings).
 * Migrations are backward-compatible: add first, remove later.
 *
 * User-facing tables (auth, profiles, subscriptions, chat, alerts, push,
 * notification_queue) arrive with the phases that use them (5–7), because the
 * auth library creates the `user` table they reference.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  customType,
  datetime,
  double,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** JSON column that works on MariaDB, where JSON is LONGTEXT and comes back as a string. */
export const jsonText = <T>(name: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "json",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => (typeof value === "string" ? (JSON.parse(value) as T) : (value as T)),
  })(name);

const utcDatetime = (name: string) => datetime(name, { mode: "date" });
const createdAt = () =>
  utcDatetime("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`);
/** TIMESTAMP so MariaDB maintains it (ON UPDATE): it only moves when a row really changes. */
const updatedAt = () =>
  timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow();

// ---------------------------------------------------------------------------
// Phase 0 placeholder. Unused since Phase 1; dropped in a later migration
// (add first, remove later).
export const appMeta = mysqlTable("app_meta", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: varchar("value", { length: 255 }).notNull(),
  updatedAt: utcDatetime("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Reference data (seeded by migration 0002_seed_teams_stadiums)

export const conferences = ["AFC", "NFC"] as const;
export const divisions = ["East", "North", "South", "West"] as const;

export const teams = mysqlTable("teams", {
  /** Stable ids 1–32 assigned by the seed, alphabetical by abbreviation. */
  id: smallint("id").primaryKey(),
  /** Current franchise abbreviation (nflverse style: LA, LAC, LV, WAS...). */
  abbr: varchar("abbr", { length: 3 }).notNull().unique(),
  name: varchar("name", { length: 40 }).notNull(),
  city: varchar("city", { length: 40 }).notNull(),
  conference: mysqlEnum("conference", conferences).notNull(),
  division: mysqlEnum("division", divisions).notNull(),
  primaryColor: char("primary_color", { length: 7 }).notNull(),
  secondaryColor: char("secondary_color", { length: 7 }).notNull(),
});

export const roofTypes = ["outdoors", "dome", "retractable"] as const;
export const surfaces = ["grass", "turf"] as const;

export const stadiums = mysqlTable("stadiums", {
  /** nflverse stadium id, e.g. "KAN00", "LON02". */
  id: varchar("id", { length: 8 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  /** Primary tenant; null for international/neutral venues. */
  teamId: smallint("team_id").references(() => teams.id),
  lat: double("lat").notNull(),
  lon: double("lon").notNull(),
  roofType: mysqlEnum("roof_type", roofTypes).notNull(),
  surface: mysqlEnum("surface", surfaces).notNull(),
  altitudeM: smallint("altitude_m").notNull(),
  /** IANA timezone, used for travel/time-zone features and local kickoff display. */
  timezone: varchar("timezone", { length: 40 }).notNull(),
  /** False for venues no longer used as a team's home (Georgia Dome, Qualcomm...). */
  isActive: boolean("is_active").notNull().default(true),
});

// ---------------------------------------------------------------------------
// Schedule

export const seasonPhases = ["preseason", "regular", "postseason", "offseason"] as const;

export const seasons = mysqlTable("seasons", {
  year: smallint("year").primaryKey(),
  currentWeek: tinyint("current_week").notNull(),
  phase: mysqlEnum("phase", seasonPhases).notNull(),
  updatedAt: updatedAt(),
});

export const gameTypes = ["REG", "WC", "DIV", "CON", "SB"] as const;
export const gameStatuses = ["scheduled", "in_progress", "final", "postponed", "canceled"] as const;

export const games = mysqlTable(
  "games",
  {
    /** nflverse game_id, e.g. "2024_01_BAL_KC". The natural key for idempotent upserts. */
    id: varchar("id", { length: 20 }).primaryKey(),
    season: smallint("season").notNull(),
    week: tinyint("week").notNull(),
    gameType: mysqlEnum("game_type", gameTypes).notNull(),
    homeTeamId: smallint("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: smallint("away_team_id")
      .notNull()
      .references(() => teams.id),
    stadiumId: varchar("stadium_id", { length: 8 }).references(() => stadiums.id),
    neutralSite: boolean("neutral_site").notNull().default(false),
    kickoffAt: utcDatetime("kickoff_at").notNull(),
    status: mysqlEnum("status", gameStatuses).notNull().default("scheduled"),
    homeScore: smallint("home_score"),
    awayScore: smallint("away_score"),
    overtime: boolean("overtime").notNull().default(false),
    /** URL slug, e.g. "bal-at-kc-2024-week-1". */
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("games_season_week_idx").on(t.season, t.week),
    index("games_kickoff_idx").on(t.kickoffAt),
    index("games_home_team_idx").on(t.homeTeamId, t.season),
    index("games_away_team_idx").on(t.awayTeamId, t.season),
  ],
);

// ---------------------------------------------------------------------------
// Players, injuries, weather, odds (ingest endpoints arrive in Phase 2/7)

export const players = mysqlTable(
  "players",
  {
    id: int("id").autoincrement().primaryKey(),
    gsisId: varchar("gsis_id", { length: 16 }).notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    position: varchar("position", { length: 8 }).notNull(),
    teamId: smallint("team_id").references(() => teams.id),
    /** Roster status from nflverse (ACT, RES, INA...). */
    status: varchar("status", { length: 16 }),
    updatedAt: updatedAt(),
  },
  (t) => [index("players_team_idx").on(t.teamId)],
);

export const injuryStatuses = ["out", "doubtful", "questionable", "probable", "active"] as const;
export const injurySources = ["nflverse", "admin"] as const;

export const injuries = mysqlTable(
  "injuries",
  {
    id: int("id").autoincrement().primaryKey(),
    playerId: int("player_id")
      .notNull()
      .references(() => players.id),
    gameId: varchar("game_id", { length: 20 })
      .notNull()
      .references(() => games.id),
    reportStatus: mysqlEnum("report_status", injuryStatuses).notNull(),
    source: mysqlEnum("source", injurySources).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("injuries_player_game_source_uq").on(t.playerId, t.gameId, t.source),
    index("injuries_game_idx").on(t.gameId),
  ],
);

export const weather = mysqlTable("weather", {
  gameId: varchar("game_id", { length: 20 })
    .primaryKey()
    .references(() => games.id),
  tempC: double("temp_c"),
  windKph: double("wind_kph"),
  precipMm: double("precip_mm"),
  condition: varchar("condition", { length: 32 }),
  fetchedAt: utcDatetime("fetched_at").notNull(),
});

export const odds = mysqlTable(
  "odds",
  {
    gameId: varchar("game_id", { length: 20 })
      .notNull()
      .references(() => games.id),
    source: varchar("source", { length: 32 }).notNull(),
    spreadHome: double("spread_home"),
    total: double("total"),
    moneylineHome: int("moneyline_home"),
    moneylineAway: int("moneyline_away"),
    fetchedAt: utcDatetime("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.source] })],
);

/** Aggregated team stats only. Raw play-by-play never goes into MySQL. */
export const teamWeekStats = mysqlTable(
  "team_week_stats",
  {
    teamId: smallint("team_id")
      .notNull()
      .references(() => teams.id),
    season: smallint("season").notNull(),
    week: tinyint("week").notNull(),
    elo: double("elo"),
    offEpa: double("off_epa"),
    defEpa: double("def_epa"),
    offPassEpa: double("off_pass_epa"),
    offRunEpa: double("off_run_epa"),
    defPassEpa: double("def_pass_epa"),
    defRunEpa: double("def_run_epa"),
    offEpaRank: tinyint("off_epa_rank"),
    defEpaRank: tinyint("def_epa_rank"),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.season, t.week] }),
    index("tws_season_week_idx").on(t.season, t.week),
  ],
);

// ---------------------------------------------------------------------------
// Model and picks (filled from Phase 2/3)

export const modelVersions = mysqlTable("model_versions", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  trainedAt: utcDatetime("trained_at").notNull(),
  metricsJson: jsonText<Record<string, unknown>>("metrics_json").notNull(),
  artifactUrl: varchar("artifact_url", { length: 512 }),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: createdAt(),
});

export const confidenceTiers = ["lean", "solid", "strong"] as const;

/**
 * Append-only. A new prediction is a new row (version_no + 1) and the previous
 * row's is_current flips 1 -> 0; nothing else may ever change, and rows are never
 * deleted. Enforced by triggers (db/triggers.ts) where MariaDB allows them, and by
 * the picks repository either way. content_hash = SHA-256(content + prev_hash)
 * forms a public hash chain.
 */
export const picks = mysqlTable(
  "picks",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    gameId: varchar("game_id", { length: 20 })
      .notNull()
      .references(() => games.id),
    modelVersionId: int("model_version_id")
      .notNull()
      .references(() => modelVersions.id),
    versionNo: smallint("version_no").notNull(),
    publishedAt: utcDatetime("published_at").notNull(),
    winnerTeamId: smallint("winner_team_id")
      .notNull()
      .references(() => teams.id),
    /** Probability that winner_team_id wins (always >= 0.5), rounded to 4 decimals. */
    winProb: double("win_prob").notNull(),
    confidenceTier: mysqlEnum("confidence_tier", confidenceTiers).notNull(),
    /** Projected HOME margin in points (positive = home team wins by that much). */
    predSpread: double("pred_spread").notNull(),
    predTotal: double("pred_total").notNull(),
    featuresJson: jsonText<Record<string, unknown>>("features_json").notNull(),
    shapJson: jsonText<Record<string, unknown>>("shap_json").notNull(),
    changeReason: varchar("change_reason", { length: 255 }),
    isCurrent: boolean("is_current").notNull(),
    contentHash: char("content_hash", { length: 64 }).notNull().unique(),
    prevHash: char("prev_hash", { length: 64 }),
  },
  (t) => [
    uniqueIndex("picks_game_version_uq").on(t.gameId, t.versionNo),
    index("picks_game_current_idx").on(t.gameId, t.isCurrent),
    index("picks_published_idx").on(t.publishedAt),
  ],
);

export const locales = ["en", "fr", "es"] as const;
export const explanationSources = ["claude", "template"] as const;

export const explanations = mysqlTable(
  "explanations",
  {
    pickId: bigint("pick_id", { mode: "number", unsigned: true })
      .notNull()
      .references(() => picks.id),
    locale: mysqlEnum("locale", locales).notNull(),
    headline: varchar("headline", { length: 200 }).notNull(),
    reasonsJson: jsonText<string[]>("reasons_json").notNull(),
    matchupNotesJson: jsonText<string[]>("matchup_notes_json").notNull(),
    generatedAt: utcDatetime("generated_at").notNull(),
    /** "claude" when written by the model, "template" for the SHAP-template fallback. */
    source: mysqlEnum("source", explanationSources).notNull().default("template"),
  },
  (t) => [primaryKey({ columns: [t.pickId, t.locale] })],
);

export const totalResults = ["over", "under", "push"] as const;

export const pickResults = mysqlTable("pick_results", {
  pickId: bigint("pick_id", { mode: "number", unsigned: true })
    .primaryKey()
    .references(() => picks.id),
  correctWinner: boolean("correct_winner").notNull(),
  coveredSpread: boolean("covered_spread"),
  totalResult: mysqlEnum("total_result", totalResults),
  gradedAt: utcDatetime("graded_at").notNull(),
});

// ---------------------------------------------------------------------------
// Operations

export const pipelineRunStatuses = ["running", "success", "failure", "cancelled"] as const;

export const pipelineRuns = mysqlTable(
  "pipeline_runs",
  {
    /** Chosen by the pipeline: "<github run id>-<attempt>-<job>". */
    id: varchar("id", { length: 96 }).primaryKey(),
    job: varchar("job", { length: 64 }).notNull(),
    startedAt: utcDatetime("started_at").notNull(),
    finishedAt: utcDatetime("finished_at"),
    status: mysqlEnum("status", pipelineRunStatuses).notNull(),
    error: text("error"),
    runUrl: varchar("run_url", { length: 255 }),
  },
  (t) => [index("pipeline_runs_job_started_idx").on(t.job, t.startedAt)],
);

export const ingestLog = mysqlTable(
  "ingest_log",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    endpoint: varchar("endpoint", { length: 64 }).notNull(),
    status: smallint("status").notNull(),
    rows: int("rows").notNull().default(0),
    durationMs: int("duration_ms").notNull(),
    error: varchar("error", { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index("ingest_log_created_idx").on(t.createdAt)],
);

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    actor: varchar("actor", { length: 128 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    entity: varchar("entity", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    payload: jsonText<Record<string, unknown>>("payload"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

// ---------------------------------------------------------------------------
// Auth (Phase 5). Better Auth's core tables: the property names are Better Auth's
// field names (the Drizzle adapter maps them); columns are snake_case like the rest.
// Ids are strings generated by Better Auth.

const authDate = (name: string) => datetime(name, { mode: "date", fsp: 3 });

export const user = mysqlTable("user", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: varchar("image", { length: 1024 }),
  createdAt: authDate("created_at").notNull(),
  updatedAt: authDate("updated_at").notNull(),
});

export const session = mysqlTable(
  "session",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    expiresAt: authDate("expires_at").notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    createdAt: authDate("created_at").notNull(),
    updatedAt: authDate("updated_at").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId), index("session_expires_idx").on(t.expiresAt)],
);

export const account = mysqlTable(
  "account",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    accountId: varchar("account_id", { length: 255 }).notNull(),
    providerId: varchar("provider_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: authDate("access_token_expires_at"),
    refreshTokenExpiresAt: authDate("refresh_token_expires_at"),
    scope: varchar("scope", { length: 1024 }),
    password: varchar("password", { length: 255 }),
    createdAt: authDate("created_at").notNull(),
    updatedAt: authDate("updated_at").notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = mysqlTable(
  "verification",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    value: text("value").notNull(),
    expiresAt: authDate("expires_at").notNull(),
    createdAt: authDate("created_at").notNull(),
    updatedAt: authDate("updated_at").notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Profiles and billing (Phase 5)

export const roles = ["user", "admin"] as const;
export const plans = ["free", "pro"] as const;

export const profiles = mysqlTable("profiles", {
  userId: varchar("user_id", { length: 64 })
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", roles).notNull().default("user"),
  locale: mysqlEnum("locale", locales).notNull().default("en"),
  favoriteTeamId: smallint("favorite_team_id").references(() => teams.id),
  /** Derived from `subscriptions` by the Stripe webhook; never set from the client. */
  plan: mysqlEnum("plan", plans).notNull().default("free"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 64 }).unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const subscriptions = mysqlTable(
  "subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 64 }).notNull().unique(),
    /** Stripe status: trialing, active, past_due, canceled, unpaid, incomplete... */
    status: varchar("status", { length: 32 }).notNull(),
    priceId: varchar("price_id", { length: 64 }),
    currentPeriodEnd: utcDatetime("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /** `created` of the Stripe event that last wrote this row: older events are ignored. */
    eventCreatedAt: utcDatetime("event_created_at").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
);

/** Every Stripe webhook event processed, so a redelivered event is a no-op. */
export const stripeEvents = mysqlTable("stripe_events", {
  id: varchar("id", { length: 255 }).primaryKey(),
  type: varchar("type", { length: 64 }).notNull(),
  processedAt: createdAt(),
});

// ---------------------------------------------------------------------------
// AI assistant (Phase 6). Threads belong to one user; only they can read them
// (lib/authz.ts ownsResource). Questions per day are counted from chat_messages.

export const chatThreads = mysqlTable(
  "chat_threads",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("chat_threads_user_idx").on(t.userId, t.updatedAt)],
);

export const chatRoles = ["user", "assistant"] as const;

export const chatMessages = mysqlTable(
  "chat_messages",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    threadId: varchar("thread_id", { length: 36 })
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: mysqlEnum("role", chatRoles).notNull(),
    content: text("content").notNull(),
    /** Input + output tokens of the answer (assistant rows); 0 for questions. */
    tokens: int("tokens").notNull().default(0),
    createdAt: utcDatetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("chat_messages_thread_idx").on(t.threadId, t.id),
    index("chat_messages_user_day_idx").on(t.userId, t.role, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Alerts and notifications (Phase 7)

export const alertPrefs = mysqlTable("alert_prefs", {
  userId: varchar("user_id", { length: 64 })
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Push notification when a pick changes (Pro). */
  notifyPickChange: boolean("notify_pick_change").notNull().default(true),
  /** Email when a pick changes (Pro). */
  notifyPickChangeEmail: boolean("notify_pick_change_email").notNull().default(false),
  /** Weekly picks email (everyone). */
  notifyWeekly: boolean("notify_weekly").notNull().default(false),
  updatedAt: updatedAt(),
});

/** Teams a user follows for pick-change alerts. None = every game. */
export const alertTeams = mysqlTable(
  "alert_teams",
  {
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: smallint("team_id")
      .notNull()
      .references(() => teams.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
);

export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 64 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: varchar("endpoint", { length: 768 }).notNull().unique(),
    keysJson: jsonText<{ p256dh: string; auth: string }>("keys_json").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

export const notificationChannels = ["push", "email"] as const;
/** queued -> sending (claimed by one worker) -> sent | failed (after 5 attempts) | skipped. */
export const notificationStatuses = ["queued", "sending", "sent", "failed", "skipped"] as const;

export const notificationQueue = mysqlTable(
  "notification_queue",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 64 }).references(() => user.id, { onDelete: "cascade" }),
    /** For emails to people without an account row (admin alerts). */
    toEmail: varchar("to_email", { length: 255 }),
    channel: mysqlEnum("channel", notificationChannels).notNull(),
    /** What happened, e.g. "pick:123:<user>:push": the same alert is never queued twice. */
    dedupeKey: varchar("dedupe_key", { length: 191 }).notNull().unique(),
    payloadJson: jsonText<Record<string, unknown>>("payload_json").notNull(),
    status: mysqlEnum("status", notificationStatuses).notNull().default("queued"),
    attempts: tinyint("attempts").notNull().default(0),
    lastError: varchar("last_error", { length: 255 }),
    createdAt: createdAt(),
    sentAt: utcDatetime("sent_at"),
  },
  (t) => [index("notification_queue_status_idx").on(t.status, t.id)],
);
