CREATE TABLE `account_roles` (
  `user_id` text NOT NULL,
  `role` text NOT NULL,
  `assigned_by` text,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`user_id`, `role`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_roles_role_idx` ON `account_roles` (`role`);
--> statement-breakpoint
CREATE TABLE `account_bans` (
  `user_id` text PRIMARY KEY NOT NULL,
  `reason` text DEFAULT '' NOT NULL,
  `banned_by` text,
  `banned_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `admin_resources` (
  `resource_type` text NOT NULL,
  `resource_id` text NOT NULL,
  `data_json` text NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `updated_by` text,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`resource_type`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `admin_resources_type_enabled_idx` ON `admin_resources` (`resource_type`, `enabled`);
