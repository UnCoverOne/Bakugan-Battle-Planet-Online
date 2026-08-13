PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS social_relationships (
  user_low TEXT NOT NULL,
  user_high TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high),
  CHECK (requested_by = user_low OR requested_by = user_high),
  FOREIGN KEY (user_low) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_high) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS social_relationships_low_status_idx
  ON social_relationships(user_low, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS social_relationships_high_status_idx
  ON social_relationships(user_high, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS lobby_invitations (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER,
  CHECK (inviter_user_id <> recipient_user_id),
  FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS lobby_invitations_pending_pair_idx
  ON lobby_invitations(lobby_code, inviter_user_id, recipient_user_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS lobby_invitations_recipient_idx
  ON lobby_invitations(recipient_user_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS lobby_invitations_expiry_idx
  ON lobby_invitations(status, expires_at);

CREATE TABLE IF NOT EXISTS social_preferences (
  user_id TEXT PRIMARY KEY,
  presence_visibility TEXT NOT NULL DEFAULT 'online' CHECK (presence_visibility IN ('online', 'friends', 'offline')),
  allow_lobby_invites INTEGER NOT NULL DEFAULT 1 CHECK (allow_lobby_invites IN (0, 1)),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
