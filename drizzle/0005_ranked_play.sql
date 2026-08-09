CREATE TABLE `ranked_ratings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`bp` integer DEFAULT 1000 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`last_achieved_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ranked_ratings_leaderboard_idx` ON `ranked_ratings` (`bp`,`wins`,`last_achieved_at`);--> statement-breakpoint
CREATE TABLE `ranked_series` (
	`series_id` text PRIMARY KEY NOT NULL,
	`ruleset_version` integer NOT NULL,
	`player_one_user_id` text NOT NULL,
	`player_two_user_id` text NOT NULL,
	`winner_user_id` text,
	`loser_user_id` text,
	`score` text DEFAULT '' NOT NULL,
	`transfer` integer,
	`settlement_token` text,
	`settled_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ranked_rating_events` (
	`series_id` text PRIMARY KEY NOT NULL,
	`winner_user_id` text NOT NULL,
	`loser_user_id` text NOT NULL,
	`winner_before` integer NOT NULL,
	`loser_before` integer NOT NULL,
	`transfer` integer NOT NULL,
	`winner_after` integer NOT NULL,
	`loser_after` integer NOT NULL,
	`settled_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ranked_rating_events_winner_idx` ON `ranked_rating_events` (`winner_user_id`,`settled_at`);--> statement-breakpoint
CREATE INDEX `ranked_rating_events_loser_idx` ON `ranked_rating_events` (`loser_user_id`,`settled_at`);
