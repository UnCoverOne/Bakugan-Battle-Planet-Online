import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const matches = sqliteTable("matches", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  previousStateJson: text("previous_state_json"),
  updatedAt: integer("updated_at").notNull(),
});

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
