CREATE TABLE `app_meta` (
	`key` varchar(64) NOT NULL,
	`value` varchar(255) NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `app_meta_key` PRIMARY KEY(`key`)
);
