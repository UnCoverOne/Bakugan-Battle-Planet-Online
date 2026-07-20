CREATE TABLE IF NOT EXISTS match_seats (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, player_id),
  FOREIGN KEY (code) REFERENCES matches(code) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits(window_start);

CREATE TABLE IF NOT EXISTS match_snapshots (
  code TEXT NOT NULL,
  version INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, version),
  FOREIGN KEY (code) REFERENCES matches(code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_snapshots_created_idx ON match_snapshots(created_at);
