ALTER TABLE `users` ADD `recovery_code_hash` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_code_salt` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_code_iterations` integer;
