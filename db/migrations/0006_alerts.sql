CREATE TABLE `alert_prefs` (
	`user_id` varchar(64) NOT NULL,
	`notify_pick_change` boolean NOT NULL DEFAULT true,
	`notify_pick_change_email` boolean NOT NULL DEFAULT false,
	`notify_weekly` boolean NOT NULL DEFAULT false,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_prefs_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `alert_teams` (
	`user_id` varchar(64) NOT NULL,
	`team_id` smallint NOT NULL,
	CONSTRAINT `alert_teams_user_id_team_id_pk` PRIMARY KEY(`user_id`,`team_id`)
);
--> statement-breakpoint
CREATE TABLE `notification_queue` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64),
	`to_email` varchar(255),
	`channel` enum('push','email') NOT NULL,
	`dedupe_key` varchar(191) NOT NULL,
	`payload_json` json NOT NULL,
	`status` enum('queued','sent','failed','skipped') NOT NULL DEFAULT 'queued',
	`attempts` tinyint NOT NULL DEFAULT 0,
	`last_error` varchar(255),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`sent_at` datetime,
	CONSTRAINT `notification_queue_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_queue_dedupe_key_unique` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`endpoint` varchar(768) NOT NULL,
	`keys_json` json NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `push_subscriptions_endpoint_unique` UNIQUE(`endpoint`)
);
--> statement-breakpoint
ALTER TABLE `alert_prefs` ADD CONSTRAINT `alert_prefs_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_teams` ADD CONSTRAINT `alert_teams_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `alert_teams` ADD CONSTRAINT `alert_teams_team_id_teams_id_fk` FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notification_queue` ADD CONSTRAINT `notification_queue_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD CONSTRAINT `push_subscriptions_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notification_queue_status_idx` ON `notification_queue` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);