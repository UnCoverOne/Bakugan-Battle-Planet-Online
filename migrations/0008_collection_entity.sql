PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS user_data_entities_collection (
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('profile', 'settings', 'preferences', 'collection', 'deck', 'draft')),
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  data_json TEXT,
  deleted_at TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entity_type, entity_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO user_data_entities_collection
  (user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at)
SELECT user_id, entity_type, entity_id, revision, data_json, deleted_at, updated_at
FROM user_data_entities;

DROP TABLE user_data_entities;
ALTER TABLE user_data_entities_collection RENAME TO user_data_entities;

CREATE INDEX IF NOT EXISTS user_data_entities_user_updated_idx
  ON user_data_entities(user_id, updated_at);

PRAGMA foreign_keys = ON;
