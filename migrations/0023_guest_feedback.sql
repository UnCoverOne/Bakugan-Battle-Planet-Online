-- Feedback & Reports accepts guests without creating synthetic user accounts.
-- Copy the original table without changing IDs, historical URLs, review states,
-- timestamps, or the account-deletion cascade for signed-in submissions.
-- submission_reviews uses (kind, submission_id), not an FK to feedback_reports.
CREATE TABLE feedback_reports_next (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('suggestion', 'bug', 'issue')),
  card_id TEXT,
  message TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'closed')),
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO feedback_reports_next (id, user_id, kind, card_id, message, source_url, status, submitted_at, updated_at)
SELECT id, user_id, kind, card_id, message, source_url, status, submitted_at, updated_at FROM feedback_reports;

DROP TABLE feedback_reports;
ALTER TABLE feedback_reports_next RENAME TO feedback_reports;

CREATE INDEX feedback_reports_user_submitted_idx
  ON feedback_reports (user_id, submitted_at);
CREATE INDEX feedback_reports_status_submitted_idx
  ON feedback_reports (status, submitted_at);
