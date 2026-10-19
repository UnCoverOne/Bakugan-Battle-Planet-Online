CREATE TABLE IF NOT EXISTS feedback_reports (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'bug', 'issue')),
  card_id TEXT,
  message TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'closed')),
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_reports_user_submitted_idx
  ON feedback_reports (user_id, submitted_at);

CREATE INDEX IF NOT EXISTS feedback_reports_status_submitted_idx
  ON feedback_reports (status, submitted_at);
