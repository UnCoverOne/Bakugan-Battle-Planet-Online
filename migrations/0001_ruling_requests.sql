CREATE TABLE IF NOT EXISTS ruling_requests (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT,
  question TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered', 'published', 'withdrawn')),
  answer TEXT,
  administrator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);

CREATE INDEX IF NOT EXISTS ruling_requests_user_submitted_idx
  ON ruling_requests (user_id, submitted_at);

CREATE INDEX IF NOT EXISTS ruling_requests_status_submitted_idx
  ON ruling_requests (status, submitted_at);
