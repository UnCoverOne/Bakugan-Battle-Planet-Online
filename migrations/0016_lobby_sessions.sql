-- Authoritative lobby membership, independent of match snapshots and browser routes.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lobby_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('training', 'casual', 'ranked')),
  configuration_json TEXT NOT NULL CHECK (json_valid(configuration_json)),
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  current_series_id TEXT,
  previous_series_id TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS lobby_memberships (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  lobby_id TEXT NOT NULL REFERENCES lobby_sessions(id),
  identity_key TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  left_at INTEGER,
  departure_reason TEXT CHECK (departure_reason IN ('left', 'expired')),
  CHECK (expires_at = last_seen_at + 3600000),
  CHECK ((left_at IS NULL) = (departure_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS lobby_one_active_membership
  ON lobby_memberships(identity_key) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS lobby_active_members
  ON lobby_memberships(lobby_id, sequence) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS lobby_membership_expiry
  ON lobby_memberships(expires_at) WHERE left_at IS NULL;

-- The first remaining human member is the host. Bots never occupy memberships.
CREATE TRIGGER IF NOT EXISTS lobby_membership_admission
BEFORE INSERT ON lobby_memberships
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions WHERE id = NEW.lobby_id AND closed_at IS NULL AND current_series_id IS NULL
  ) THEN RAISE(ABORT, 'LOBBY_NOT_JOINABLE') END;
  SELECT CASE WHEN (SELECT mode FROM lobby_sessions WHERE id = NEW.lobby_id) = 'ranked'
    AND substr(NEW.identity_key, 1, 8) <> 'account:' THEN RAISE(ABORT, 'LOBBY_ACCOUNT_REQUIRED') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM lobby_memberships WHERE lobby_id = NEW.lobby_id AND left_at IS NULL)
    >= (SELECT CASE mode WHEN 'training' THEN 1 ELSE 2 END FROM lobby_sessions WHERE id = NEW.lobby_id)
    THEN RAISE(ABORT, 'LOBBY_FULL') END;
END;

CREATE TRIGGER IF NOT EXISTS lobby_membership_joined
AFTER INSERT ON lobby_memberships
BEGIN
  UPDATE lobby_sessions SET version = version + 1 WHERE id = NEW.lobby_id;
END;

CREATE TRIGGER IF NOT EXISTS lobby_membership_departed
AFTER UPDATE OF left_at ON lobby_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE lobby_sessions SET version = version + 1,
    closed_at = CASE WHEN NOT EXISTS (
      SELECT 1 FROM lobby_memberships WHERE lobby_id = NEW.lobby_id AND left_at IS NULL
    ) THEN NEW.left_at ELSE closed_at END
    WHERE id = NEW.lobby_id;
END;
