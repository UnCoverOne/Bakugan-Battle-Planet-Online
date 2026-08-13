PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS match_seat_accounts (
  code TEXT NOT NULL,
  player_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (code, player_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_seat_accounts_user_idx
  ON match_seat_accounts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS match_replays (
  replay_id TEXT PRIMARY KEY NOT NULL,
  match_code TEXT NOT NULL,
  archive_json TEXT NOT NULL,
  final_state_hash TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  catalogue_version TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS match_replays_completed_idx
  ON match_replays(completed_at DESC);

CREATE TABLE IF NOT EXISTS match_replay_participants (
  replay_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (replay_id, user_id),
  FOREIGN KEY (replay_id) REFERENCES match_replays(replay_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_replay_participant_recent_idx
  ON match_replay_participants(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS match_stat_events (
  replay_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  result TEXT NOT NULL,
  mode TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (replay_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS match_stat_events_user_idx
  ON match_stat_events(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS account_match_stats (
  user_id TEXT PRIMARY KEY NOT NULL,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  training_matches INTEGER NOT NULL DEFAULT 0,
  casual_matches INTEGER NOT NULL DEFAULT 0,
  ranked_matches INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
