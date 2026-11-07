CREATE TABLE `chat_messages` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`thread_id` varchar(36) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`role` enum('user','assistant') NOT NULL,
	`content` text NOT NULL,
	`tokens` int NOT NULL DEFAULT 0,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`title` varchar(120) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_threads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_thread_id_chat_threads_id_fk` FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_threads` ADD CONSTRAINT `chat_threads_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_messages_thread_idx` ON `chat_messages` (`thread_id`,`id`);--> statement-breakpoint
CREATE INDEX `chat_messages_user_day_idx` ON `chat_messages` (`user_id`,`role`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_threads_user_idx` ON `chat_threads` (`user_id`,`updated_at`);