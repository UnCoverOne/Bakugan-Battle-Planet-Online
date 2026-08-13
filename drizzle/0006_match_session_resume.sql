ALTER TABLE `match_seats` ADD `capability_version` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `match_seats` ADD `controller_id` text;
--> statement-breakpoint
ALTER TABLE `match_seats` ADD `claimed_at` integer;
--> statement-breakpoint
CREATE INDEX `match_seats_controller_idx` ON `match_seats` (`code`,`player_id`,`capability_version`,`controller_id`);
