PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_data_entities (
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'settings', 'preferences', 'deck', 'draft')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  data_json TEXT,
  deleted_at TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_data_entities_user_updated_idx
  ON user_data_entities(user_id, updated_at);

CREATE TABLE IF NOT EXISTS user_match_history (
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, event_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_match_history_user_occurred_idx
  ON user_match_history(user_id, occurred_at DESC);
