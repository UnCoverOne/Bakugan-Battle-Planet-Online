import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const matches = sqliteTable("matches", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  previousStateJson: text("previous_state_json"),
  updatedAt: integer("updated_at").notNull(),
});

export const matchEvents = sqliteTable("match_events", {
  code: text("code").notNull(),
  sequence: integer("sequence").notNull(),
  commandId: text("command_id").notNull(),
  eventType: text("event_type").notNull(),
  actorId: text("actor_id").notNull(),
  visibility: text("visibility").notNull(),
  visibleTo: text("visible_to"),
  payloadJson: text("payload_json").notNull(),
  engineVersion: text("engine_version").notNull(),
  rulesVersion: text("rules_version").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.code, table.sequence] }),
  index("match_events_command_idx").on(table.code, table.commandId),
  index("match_events_type_sequence_idx").on(table.code, table.eventType, table.sequence),
]);

export const matchCommands = sqliteTable("match_commands", {
  code: text("code").notNull(),
  commandId: text("command_id").notNull(),
  actorId: text("actor_id").notNull(),
  expectedVersion: integer("expected_version").notNull(),
  resultVersion: integer("result_version").notNull(),
  requestHash: text("request_hash").notNull(),
  eventSequenceStart: integer("event_sequence_start").notNull(),
  eventSequenceEnd: integer("event_sequence_end").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.code, table.commandId] }),
  index("match_commands_result_version_idx").on(table.code, table.resultVersion),
]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  recoveryCodeHash: text("recovery_code_hash"),
  recoveryCodeSalt: text("recovery_code_salt"),
  recoveryCodeIterations: integer("recovery_code_iterations"),
  displayName: text("display_name").notNull(),
  faction: text("faction").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

export const userData = sqliteTable("user_data", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  dataJson: text("data_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userDataEntities = sqliteTable("user_data_entities", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  revision: integer("revision").notNull().default(0),
  dataJson: text("data_json"),
  deletedAt: text("deleted_at"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.entityType, table.entityId] }),
  index("user_data_entities_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const userMatchHistory = sqliteTable("user_match_history", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  dataJson: text("data_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.eventId] }),
  index("user_match_history_user_occurred_idx").on(table.userId, table.occurredAt),
]);

export const matchSeatAccounts = sqliteTable("match_seat_accounts", {
  code: text("code").notNull(),
  playerId: text("player_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.code, table.playerId] }),
  index("match_seat_accounts_user_idx").on(table.userId, table.createdAt),
]);

export const matchReplays = sqliteTable("match_replays", {
  replayId: text("replay_id").primaryKey(),
  matchCode: text("match_code").notNull(),
  archiveJson: text("archive_json").notNull(),
  finalStateHash: text("final_state_hash").notNull(),
  engineVersion: text("engine_version").notNull(),
  rulesVersion: text("rules_version").notNull(),
  catalogueVersion: text("catalogue_version").notNull(),
  completedAt: integer("completed_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("match_replays_completed_idx").on(table.completedAt)]);

export const matchReplayParticipants = sqliteTable("match_replay_participants", {
  replayId: text("replay_id").notNull().references(() => matchReplays.replayId, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  playerId: text("player_id").notNull(),
  summaryJson: text("summary_json").notNull(),
  occurredAt: text("occurred_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.replayId, table.userId] }),
  index("match_replay_participant_recent_idx").on(table.userId, table.occurredAt),
]);

export const matchStatEvents = sqliteTable("match_stat_events", {
  replayId: text("replay_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  result: text("result").notNull(),
  mode: text("mode").notNull(),
  occurredAt: text("occurred_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.replayId, table.userId] }),
  index("match_stat_events_user_idx").on(table.userId, table.occurredAt),
]);

export const accountMatchStats = sqliteTable("account_match_stats", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  matchesPlayed: integer("matches_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  trainingMatches: integer("training_matches").notNull().default(0),
  casualMatches: integer("casual_matches").notNull().default(0),
  rankedMatches: integer("ranked_matches").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const rankedRatings = sqliteTable("ranked_ratings", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  bp: integer("bp").notNull().default(1000),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  lastAchievedAt: integer("last_achieved_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("ranked_ratings_leaderboard_idx").on(table.bp, table.wins, table.lastAchievedAt),
]);

export const rankedSeries = sqliteTable("ranked_series", {
  seriesId: text("series_id").primaryKey(),
  rulesetVersion: integer("ruleset_version").notNull(),
  playerOneUserId: text("player_one_user_id").notNull(),
  playerTwoUserId: text("player_two_user_id").notNull(),
  winnerUserId: text("winner_user_id"),
  loserUserId: text("loser_user_id"),
  score: text("score").notNull().default(""),
  transfer: integer("transfer"),
  settlementToken: text("settlement_token"),
  settledAt: integer("settled_at"),
  createdAt: integer("created_at").notNull(),
});

export const rankedRatingEvents = sqliteTable("ranked_rating_events", {
  seriesId: text("series_id").primaryKey(),
  winnerUserId: text("winner_user_id").notNull(),
  loserUserId: text("loser_user_id").notNull(),
  winnerBefore: integer("winner_before").notNull(),
  loserBefore: integer("loser_before").notNull(),
  transfer: integer("transfer").notNull(),
  winnerAfter: integer("winner_after").notNull(),
  loserAfter: integer("loser_after").notNull(),
  settledAt: integer("settled_at").notNull(),
}, (table) => [
  index("ranked_rating_events_winner_idx").on(table.winnerUserId, table.settledAt),
  index("ranked_rating_events_loser_idx").on(table.loserUserId, table.settledAt),
]);

export const accountRoles = sqliteTable("account_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  assignedBy: text("assigned_by"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.role] }),
  index("account_roles_role_idx").on(table.role),
]);

export const accountBans = sqliteTable("account_bans", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason").notNull().default(""),
  bannedBy: text("banned_by"),
  bannedAt: integer("banned_at").notNull(),
});

export const adminResources = sqliteTable("admin_resources", {
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  dataJson: text("data_json").notNull(),
  enabled: integer("enabled").notNull().default(1),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.resourceType, table.resourceId] }),
  index("admin_resources_type_enabled_idx").on(table.resourceType, table.enabled),
]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: integer("window_start").notNull(),
  count: integer("count").notNull().default(1),
}, (table) => [
  primaryKey({ columns: [table.key, table.windowStart] }),
]);

export const rulingRequests = sqliteTable("ruling_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  cardId: text("card_id"),
  question: text("question").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  status: text("status").notNull().default("pending"),
  answer: text("answer"),
  administratorId: text("administrator_id").references(() => users.id, { onDelete: "set null" }),
  submittedAt: integer("submitted_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  publishedAt: integer("published_at"),
}, (table) => [
  index("ruling_requests_user_submitted_idx").on(table.userId, table.submittedAt),
  index("ruling_requests_status_submitted_idx").on(table.status, table.submittedAt),
]);

export const rumEvents = sqliteTable("rum_events", {
  id: text("id").primaryKey(),
  route: text("route").notNull(),
  metric: text("metric").notNull(),
  value: real("value").notNull(),
  device: text("device").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("rum_events_metric_created_idx").on(table.metric, table.createdAt),
  index("rum_events_route_created_idx").on(table.route, table.createdAt),
]);
