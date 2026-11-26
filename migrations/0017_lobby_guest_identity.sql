PRAGMA foreign_keys = ON;

-- Only the digest of the server-issued guest credential is stored.
CREATE TABLE IF NOT EXISTS lobby_guest_identities (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lobby_guest_expiry ON lobby_guest_identities(expires_at);

-- Stable command receipts prevent delayed admission retries from opening
-- a new room after an earlier membership has ended.
CREATE TABLE IF NOT EXISTS lobby_admission_receipts (
  identity_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  lobby_id TEXT NOT NULL REFERENCES lobby_sessions(id),
  membership_id TEXT NOT NULL REFERENCES lobby_memberships(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (identity_key, command_id)
);
