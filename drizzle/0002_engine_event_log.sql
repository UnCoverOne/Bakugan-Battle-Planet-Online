CREATE TABLE `match_events` (
  `code` text NOT NULL,
  `sequence` integer NOT NULL,
  `command_id` text NOT NULL,
  `event_type` text NOT NULL,
  `actor_id` text NOT NULL,
  `visibility` text NOT NULL,
  `visible_to` text,
  `payload_json` text NOT NULL,
  `engine_version` text NOT NULL,
  `rules_version` text NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`code`, `sequence`)
);
--> statement-breakpoint
CREATE INDEX `match_events_command_idx` ON `match_events` (`code`, `command_id`);
--> statement-breakpoint
CREATE INDEX `match_events_type_sequence_idx` ON `match_events` (`code`, `event_type`, `sequence`);
--> statement-breakpoint
CREATE TABLE `match_commands` (
  `code` text NOT NULL,
  `command_id` text NOT NULL,
  `actor_id` text NOT NULL,
  `expected_version` integer NOT NULL,
  `result_version` integer NOT NULL,
  `request_hash` text NOT NULL,
  `event_sequence_start` integer NOT NULL,
  `event_sequence_end` integer NOT NULL,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`code`, `command_id`)
);
--> statement-breakpoint
CREATE INDEX `match_commands_result_version_idx` ON `match_commands` (`code`, `result_version`);
