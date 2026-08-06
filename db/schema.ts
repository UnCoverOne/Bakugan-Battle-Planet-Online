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
