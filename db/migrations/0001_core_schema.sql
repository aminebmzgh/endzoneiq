CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor` varchar(128) NOT NULL,
	`action` varchar(64) NOT NULL,
	`entity` varchar(64) NOT NULL,
	`entity_id` varchar(64),
	`payload` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `explanations` (
	`pick_id` bigint unsigned NOT NULL,
	`locale` enum('en','fr','es') NOT NULL,
	`headline` varchar(200) NOT NULL,
	`reasons_json` json NOT NULL,
	`matchup_notes_json` json NOT NULL,
	`generated_at` datetime NOT NULL,
	CONSTRAINT `explanations_pick_id_locale_pk` PRIMARY KEY(`pick_id`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` varchar(20) NOT NULL,
	`season` smallint NOT NULL,
	`week` tinyint NOT NULL,
	`game_type` enum('REG','WC','DIV','CON','SB') NOT NULL,
	`home_team_id` smallint NOT NULL,
	`away_team_id` smallint NOT NULL,
	`stadium_id` varchar(8),
	`neutral_site` boolean NOT NULL DEFAULT false,
	`kickoff_at` datetime NOT NULL,
	`status` enum('scheduled','in_progress','final','postponed','canceled') NOT NULL DEFAULT 'scheduled',
	`home_score` smallint,
	`away_score` smallint,
	`overtime` boolean NOT NULL DEFAULT false,
	`slug` varchar(64) NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `games_id` PRIMARY KEY(`id`),
	CONSTRAINT `games_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `ingest_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`endpoint` varchar(64) NOT NULL,
	`status` smallint NOT NULL,
	`rows` int NOT NULL DEFAULT 0,
	`duration_ms` int NOT NULL,
	`error` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `ingest_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `injuries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`player_id` int NOT NULL,
	`game_id` varchar(20) NOT NULL,
	`report_status` enum('out','doubtful','questionable','probable','active') NOT NULL,
	`source` enum('nflverse','admin') NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `injuries_id` PRIMARY KEY(`id`),
	CONSTRAINT `injuries_player_game_source_uq` UNIQUE(`player_id`,`game_id`,`source`)
);
--> statement-breakpoint
CREATE TABLE `model_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`trained_at` datetime NOT NULL,
	`metrics_json` json NOT NULL,
	`artifact_url` varchar(512),
	`is_active` boolean NOT NULL DEFAULT false,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `model_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_versions_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `odds` (
	`game_id` varchar(20) NOT NULL,
	`source` varchar(32) NOT NULL,
	`spread_home` double,
	`total` double,
	`moneyline_home` int,
	`moneyline_away` int,
	`fetched_at` datetime NOT NULL,
	CONSTRAINT `odds_game_id_source_pk` PRIMARY KEY(`game_id`,`source`)
);
--> statement-breakpoint
CREATE TABLE `pick_results` (
	`pick_id` bigint unsigned NOT NULL,
	`correct_winner` boolean NOT NULL,
	`covered_spread` boolean,
	`total_result` enum('over','under','push'),
	`graded_at` datetime NOT NULL,
	CONSTRAINT `pick_results_pick_id` PRIMARY KEY(`pick_id`)
);
--> statement-breakpoint
CREATE TABLE `picks` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`game_id` varchar(20) NOT NULL,
	`model_version_id` int NOT NULL,
	`version_no` smallint NOT NULL,
	`published_at` datetime NOT NULL,
	`winner_team_id` smallint NOT NULL,
	`win_prob` double NOT NULL,
	`confidence_tier` enum('lean','solid','strong') NOT NULL,
	`pred_spread` double NOT NULL,
	`pred_total` double NOT NULL,
	`features_json` json NOT NULL,
	`shap_json` json NOT NULL,
	`change_reason` varchar(255),
	`is_current` boolean NOT NULL,
	`content_hash` char(64) NOT NULL,
	`prev_hash` char(64),
	CONSTRAINT `picks_id` PRIMARY KEY(`id`),
	CONSTRAINT `picks_content_hash_unique` UNIQUE(`content_hash`),
	CONSTRAINT `picks_game_version_uq` UNIQUE(`game_id`,`version_no`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` varchar(96) NOT NULL,
	`job` varchar(64) NOT NULL,
	`started_at` datetime NOT NULL,
	`finished_at` datetime,
	`status` enum('running','success','failure','cancelled') NOT NULL,
	`error` text,
	`run_url` varchar(255),
	CONSTRAINT `pipeline_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gsis_id` varchar(16) NOT NULL,
	`name` varchar(80) NOT NULL,
	`position` varchar(8) NOT NULL,
	`team_id` smallint,
	`status` varchar(16),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `players_id` PRIMARY KEY(`id`),
	CONSTRAINT `players_gsis_id_unique` UNIQUE(`gsis_id`)
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`year` smallint NOT NULL,
	`current_week` tinyint NOT NULL,
	`phase` enum('preseason','regular','postseason','offseason') NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `seasons_year` PRIMARY KEY(`year`)
);
--> statement-breakpoint
CREATE TABLE `stadiums` (
	`id` varchar(8) NOT NULL,
	`name` varchar(80) NOT NULL,
	`team_id` smallint,
	`lat` double NOT NULL,
	`lon` double NOT NULL,
	`roof_type` enum('outdoors','dome','retractable') NOT NULL,
	`surface` enum('grass','turf') NOT NULL,
	`altitude_m` smallint NOT NULL,
	`timezone` varchar(40) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `stadiums_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `team_week_stats` (
	`team_id` smallint NOT NULL,
	`season` smallint NOT NULL,
	`week` tinyint NOT NULL,
	`elo` double,
	`off_epa` double,
	`def_epa` double,
	`off_pass_epa` double,
	`off_run_epa` double,
	`def_pass_epa` double,
	`def_run_epa` double,
	`off_epa_rank` tinyint,
	`def_epa_rank` tinyint,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `team_week_stats_team_id_season_week_pk` PRIMARY KEY(`team_id`,`season`,`week`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` smallint NOT NULL,
	`abbr` varchar(3) NOT NULL,
	`name` varchar(40) NOT NULL,
	`city` varchar(40) NOT NULL,
	`conference` enum('AFC','NFC') NOT NULL,
	`division` enum('East','North','South','West') NOT NULL,
	`primary_color` char(7) NOT NULL,
	`secondary_color` char(7) NOT NULL,
	CONSTRAINT `teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `teams_abbr_unique` UNIQUE(`abbr`)
);
--> statement-breakpoint
CREATE TABLE `weather` (
	`game_id` varchar(20) NOT NULL,
	`temp_c` double,
	`wind_kph` double,
	`precip_mm` double,
	`condition` varchar(32),
	`fetched_at` datetime NOT NULL,
	CONSTRAINT `weather_game_id` PRIMARY KEY(`game_id`)
);
--> statement-breakpoint
ALTER TABLE `explanations` ADD CONSTRAINT `explanations_pick_id_picks_id_fk` FOREIGN KEY (`pick_id`) REFERENCES `picks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `games` ADD CONSTRAINT `games_home_team_id_teams_id_fk` FOREIGN KEY (`home_team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `games` ADD CONSTRAINT `games_away_team_id_teams_id_fk` FOREIGN KEY (`away_team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `games` ADD CONSTRAINT `games_stadium_id_stadiums_id_fk` FOREIGN KEY (`stadium_id`) REFERENCES `stadiums`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `injuries` ADD CONSTRAINT `injuries_player_id_players_id_fk` FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `injuries` ADD CONSTRAINT `injuries_game_id_games_id_fk` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `odds` ADD CONSTRAINT `odds_game_id_games_id_fk` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `pick_results` ADD CONSTRAINT `pick_results_pick_id_picks_id_fk` FOREIGN KEY (`pick_id`) REFERENCES `picks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `picks` ADD CONSTRAINT `picks_game_id_games_id_fk` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `picks` ADD CONSTRAINT `picks_model_version_id_model_versions_id_fk` FOREIGN KEY (`model_version_id`) REFERENCES `model_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `picks` ADD CONSTRAINT `picks_winner_team_id_teams_id_fk` FOREIGN KEY (`winner_team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `players` ADD CONSTRAINT `players_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stadiums` ADD CONSTRAINT `stadiums_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `team_week_stats` ADD CONSTRAINT `team_week_stats_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `weather` ADD CONSTRAINT `weather_game_id_games_id_fk` FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `games_season_week_idx` ON `games` (`season`,`week`);--> statement-breakpoint
CREATE INDEX `games_kickoff_idx` ON `games` (`kickoff_at`);--> statement-breakpoint
CREATE INDEX `games_home_team_idx` ON `games` (`home_team_id`,`season`);--> statement-breakpoint
CREATE INDEX `games_away_team_idx` ON `games` (`away_team_id`,`season`);--> statement-breakpoint
CREATE INDEX `ingest_log_created_idx` ON `ingest_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `injuries_game_idx` ON `injuries` (`game_id`);--> statement-breakpoint
CREATE INDEX `picks_game_current_idx` ON `picks` (`game_id`,`is_current`);--> statement-breakpoint
CREATE INDEX `picks_published_idx` ON `picks` (`published_at`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_job_started_idx` ON `pipeline_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE INDEX `players_team_idx` ON `players` (`team_id`);--> statement-breakpoint
CREATE INDEX `tws_season_week_idx` ON `team_week_stats` (`season`,`week`);