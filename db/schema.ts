import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const matches = sqliteTable("matches", {
  code: text("code").primaryKey(),
  stateJson: text("state_json").notNull(),
  previousStateJson: text("previous_state_json"),
  updatedAt: integer("updated_at").notNull(),
});

