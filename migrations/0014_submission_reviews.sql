-- Unified moderation overlay: original ruling and feedback records remain intact.
CREATE TABLE IF NOT EXISTS submission_reviews (
  kind TEXT NOT NULL CHECK (kind IN ('question', 'suggestion', 'bug', 'issue')),
  submission_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_review', 'resolved', 'closed')),
  response TEXT NOT NULL DEFAULT '',
  administrator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (kind, submission_id)
);
CREATE INDEX IF NOT EXISTS submission_reviews_status_idx
  ON submission_reviews (status, updated_at);
