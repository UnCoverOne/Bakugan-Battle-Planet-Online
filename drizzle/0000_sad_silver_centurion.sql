CREATE TABLE `matches` (
	`code` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`previous_state_json` text,
	`updated_at` integer NOT NULL
);
