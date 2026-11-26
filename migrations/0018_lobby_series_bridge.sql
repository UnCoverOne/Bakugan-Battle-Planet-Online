PRAGMA foreign_keys = ON;

-- Engine room codes are private per-series storage/transport keys. The lobby
-- invitation code never changes and is never reused as a match event key.
CREATE TABLE IF NOT EXISTS lobby_series_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  lobby_id TEXT NOT NULL REFERENCES lobby_sessions(id),
  match_code TEXT NOT NULL UNIQUE,
  start_command_id TEXT NOT NULL,
  host_member_id TEXT NOT NULL REFERENCES lobby_memberships(id),
  host_identity_key TEXT NOT NULL,
  expected_lobby_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('initializing', 'active', 'completed')),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  final_version INTEGER,
  UNIQUE (lobby_id, start_command_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS lobby_one_active_series
  ON lobby_series_bindings(lobby_id) WHERE status IN ('initializing', 'active');
CREATE TABLE IF NOT EXISTS lobby_series_seats (
  series_id TEXT NOT NULL REFERENCES lobby_series_bindings(id),
  membership_id TEXT NOT NULL REFERENCES lobby_memberships(id),
  player_id TEXT NOT NULL,
  PRIMARY KEY (series_id, membership_id),
  UNIQUE (series_id, player_id)
);
CREATE TABLE IF NOT EXISTS lobby_series_departures (
  series_id TEXT NOT NULL REFERENCES lobby_series_bindings(id),
  membership_id TEXT NOT NULL REFERENCES lobby_memberships(id),
  reason TEXT NOT NULL CHECK (reason IN ('left', 'expired')),
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (series_id, membership_id),
  FOREIGN KEY (series_id, membership_id) REFERENCES lobby_series_seats(series_id, membership_id)
);

CREATE TRIGGER IF NOT EXISTS lobby_series_bind_seat_guard
BEFORE INSERT ON lobby_series_seats
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_series_bindings b
    JOIN lobby_memberships m ON m.lobby_id = b.lobby_id
    JOIN match_seats s ON s.code = b.match_code AND s.player_id = NEW.player_id
    WHERE b.id = NEW.series_id AND b.status = 'initializing'
      AND m.id = NEW.membership_id AND m.left_at IS NULL
      AND m.expires_at > b.created_at
      AND EXISTS (SELECT 1 FROM matches g, json_each(g.state_json, '$.players') p
        WHERE g.code = b.match_code AND json_extract(p.value, '$.id') = NEW.player_id)
  ) THEN RAISE(ABORT, 'LOBBY_SERIES_INVALID_SEAT') END;
END;

-- The activation update is the last statement of the engine initialization
-- batch. If any assertion fails, D1 rolls back engine events and seats too.
CREATE TRIGGER IF NOT EXISTS lobby_series_activate_guard
BEFORE UPDATE OF status ON lobby_series_bindings
WHEN OLD.status = 'initializing' AND NEW.status = 'active'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions l JOIN lobby_memberships h ON h.lobby_id = l.id
    JOIN matches g ON g.code = NEW.match_code
    WHERE l.id = NEW.lobby_id AND l.closed_at IS NULL AND l.current_series_id IS NULL
      AND l.mode IN ('casual', 'ranked') AND l.version = NEW.expected_lobby_version
      AND h.id = NEW.host_member_id AND h.identity_key = NEW.host_identity_key AND h.left_at IS NULL
      AND h.sequence = (SELECT MIN(sequence) FROM lobby_memberships WHERE lobby_id = l.id AND left_at IS NULL)
      AND json_extract(g.state_json, '$.id') = NEW.id
      AND json_extract(g.state_json, '$.format') = json_extract(l.configuration_json, '$.structure')
      AND json_array_length(g.state_json, '$.players') = 2
      AND NEW.match_code <> l.code
      AND (SELECT COUNT(*) FROM lobby_memberships WHERE lobby_id = l.id AND left_at IS NULL
        AND expires_at > NEW.created_at AND last_seen_at > NEW.created_at - 30000) = 2
      AND (SELECT COUNT(*) FROM lobby_series_seats WHERE series_id = NEW.id) = 2
      AND (SELECT COUNT(*) FROM match_seats WHERE code = NEW.match_code) = 2
  ) THEN RAISE(ABORT, 'LOBBY_SERIES_START_CONFLICT') END;
END;

CREATE TRIGGER IF NOT EXISTS lobby_series_activate
AFTER UPDATE OF status ON lobby_series_bindings
WHEN OLD.status = 'initializing' AND NEW.status = 'active'
BEGIN
  UPDATE lobby_sessions SET current_series_id = NEW.id, version = version + 1 WHERE id = NEW.lobby_id;
END;

-- Record completion only after a persisted terminal result and after the
-- server has archived/settled it. Release pending departures in the same write.
CREATE TRIGGER IF NOT EXISTS lobby_series_complete_guard
BEFORE UPDATE OF status ON lobby_series_bindings
WHEN OLD.status = 'active' AND NEW.status = 'completed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions l JOIN matches g ON g.code = NEW.match_code
    WHERE l.id = NEW.lobby_id AND l.current_series_id = NEW.id
      AND json_extract(g.state_json, '$.id') = NEW.id
      AND json_extract(g.state_json, '$.version') = NEW.final_version
      AND json_extract(g.state_json, '$.phase') = 'result'
      AND EXISTS (SELECT 1 FROM json_each(g.state_json, '$.series') score
        WHERE score.key = json_extract(g.state_json, '$.winner')
          AND score.value >= CASE json_extract(g.state_json, '$.format') WHEN 'bo3' THEN 2 ELSE 1 END)
  ) THEN RAISE(ABORT, 'LOBBY_SERIES_NOT_COMPLETE') END;
END;

CREATE TRIGGER IF NOT EXISTS lobby_series_complete
AFTER UPDATE OF status ON lobby_series_bindings
WHEN OLD.status = 'active' AND NEW.status = 'completed'
BEGIN
  UPDATE lobby_sessions SET current_series_id = NULL, previous_series_id = NEW.id, version = version + 1
    WHERE id = NEW.lobby_id AND current_series_id = NEW.id;
  UPDATE lobby_memberships SET left_at = NEW.completed_at,
    departure_reason = (SELECT reason FROM lobby_series_departures d WHERE d.series_id = NEW.id AND d.membership_id = lobby_memberships.id)
    WHERE left_at IS NULL AND id IN (SELECT membership_id FROM lobby_series_departures WHERE series_id = NEW.id);
  -- Revoke controller credentials without removing historical account/seat
  -- associations. The archive is keyed by this immutable engine series ID.
  UPDATE match_seats SET capability_hash = lower(hex(randomblob(32))), capability_version = capability_version + 1,
    controller_id = NULL WHERE code = NEW.match_code;
  UPDATE match_presence SET connected = 0 WHERE code = NEW.match_code;
END;
