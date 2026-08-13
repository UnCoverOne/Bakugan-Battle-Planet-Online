PRAGMA foreign_keys = ON;

ALTER TABLE match_seats ADD COLUMN capability_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE match_seats ADD COLUMN controller_id TEXT;
ALTER TABLE match_seats ADD COLUMN claimed_at INTEGER;

CREATE INDEX IF NOT EXISTS match_seats_controller_idx
  ON match_seats(code, player_id, capability_version, controller_id);
