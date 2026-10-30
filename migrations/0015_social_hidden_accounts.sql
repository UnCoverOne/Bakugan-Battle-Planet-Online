CREATE TABLE IF NOT EXISTS social_hidden_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);
