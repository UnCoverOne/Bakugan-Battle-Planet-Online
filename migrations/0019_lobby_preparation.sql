PRAGMA foreign_keys = ON;

ALTER TABLE lobby_sessions ADD COLUMN preparation_json TEXT NOT NULL DEFAULT '{"members":{},"aiDeck":null,"ruleset":null}' CHECK (json_valid(preparation_json));

-- Any membership change invalidates prior consent. Preserve the remaining
-- snapshots; remove a departed member's private deck data.
CREATE TRIGGER lobby_preparation_joined AFTER INSERT ON lobby_memberships
BEGIN
  UPDATE lobby_sessions SET preparation_json = json_set(preparation_json, '$.members',
    json(COALESCE((SELECT json_group_object(key,json(json_set(value,'$.ready',json('false'))))
      FROM json_each(preparation_json,'$.members')), '{}')))
    WHERE id = NEW.lobby_id;
END;
CREATE TRIGGER lobby_preparation_departed AFTER UPDATE OF left_at ON lobby_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE lobby_sessions SET preparation_json = json_set(preparation_json, '$.members',
    json(COALESCE((SELECT json_group_object(key,json(json_set(value,'$.ready',json('false'))))
      FROM json_each(preparation_json,'$.members') WHERE key <> NEW.id), '{}')))
    WHERE id = NEW.lobby_id;
END;
CREATE TRIGGER lobby_preparation_identity_changed AFTER UPDATE OF identity_key ON lobby_memberships
WHEN OLD.identity_key <> NEW.identity_key
BEGIN
  UPDATE lobby_sessions SET version = version + 1,
    preparation_json = json_set(preparation_json,'$.members',
    json(COALESCE((SELECT json_group_object(key,json(json_set(value,'$.ready',json('false'))))
      FROM json_each(preparation_json,'$.members')), '{}'))) WHERE id=NEW.lobby_id;
END;
CREATE TRIGGER lobby_preparation_reconnected AFTER UPDATE OF last_seen_at ON lobby_memberships
WHEN NEW.last_seen_at - OLD.last_seen_at >= 30000 AND OLD.left_at IS NULL AND NEW.left_at IS NULL
BEGIN
  UPDATE lobby_sessions SET version=version+1,
    preparation_json=json_set(preparation_json,'$.members."' || NEW.id || '".ready',json('false'))
    WHERE id=NEW.lobby_id AND current_series_id IS NULL
      AND json_extract(preparation_json,'$.members."' || NEW.id || '".ready')=1;
END;
CREATE TRIGGER lobby_preparation_series_ended AFTER UPDATE OF current_series_id ON lobby_sessions
WHEN OLD.current_series_id IS NOT NULL AND NEW.current_series_id IS NULL
BEGIN
  UPDATE lobby_sessions SET preparation_json=json_set(preparation_json,'$.members',
    json(COALESCE((SELECT json_group_object(key,json(json_set(value,'$.ready',json('false'))))
      FROM json_each(preparation_json,'$.members')), '{}'))) WHERE id=NEW.id;
END;

-- Guard is in the same transaction as the event journal and seat credentials.
CREATE TRIGGER lobby_series_preparation_guard BEFORE UPDATE OF status ON lobby_series_bindings
WHEN OLD.status='initializing' AND NEW.status='active'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions l JOIN matches g ON g.code=NEW.match_code
    WHERE l.id=NEW.lobby_id AND
      NOT EXISTS (SELECT 1 FROM lobby_memberships m WHERE m.lobby_id=l.id AND m.left_at IS NULL
        AND (COALESCE(json_extract(l.preparation_json,'$.members."' || m.id || '".ready'),0)<>1
        OR COALESCE(json_array_length(l.preparation_json,'$.members."' || m.id || '".decks'),0)<>CASE l.mode WHEN 'ranked' THEN 3 ELSE 1 END))
      AND json_extract(g.state_json,'$.lobbyMode')=l.mode
      AND json_extract(g.state_json,'$.lobbyRulesFormat')=json_extract(l.configuration_json,'$.format')
      AND json_extract(g.state_json,'$.lobbyMeta')=json_extract(l.configuration_json,'$.meta')
      AND (l.mode<>'ranked' OR (
        json_extract(g.state_json,'$.ranked.stage')='ban'
        AND json_extract(g.state_json,'$.ranked.rulesetVersion')=json_extract(l.preparation_json,'$.ruleset.version')
        AND json_extract(g.state_json,'$.ranked.rulesetVersion')=COALESCE((SELECT json_extract(data_json,'$.version')
          FROM admin_resources WHERE resource_type='ranked-ruleset' AND resource_id='active'),1)))
  ) THEN RAISE(ABORT,'LOBBY_PREPARATION_CHANGED') END;
END;

-- Local Training has server-registered series identity but no online bot
-- controller. Checkpoints are private, noncompetitive client-owned state.
CREATE TABLE lobby_training_series (
  id TEXT PRIMARY KEY NOT NULL,
  lobby_id TEXT NOT NULL REFERENCES lobby_sessions(id),
  membership_id TEXT NOT NULL REFERENCES lobby_memberships(id),
  start_command_id TEXT NOT NULL,
  expected_lobby_version INTEGER NOT NULL,
  identity_key TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK(status IN ('active','completed','abandoned')),
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  UNIQUE(lobby_id,start_command_id)
);
CREATE UNIQUE INDEX lobby_one_training_series ON lobby_training_series(lobby_id) WHERE status='active';
CREATE TRIGGER lobby_training_start_guard BEFORE INSERT ON lobby_training_series
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions l JOIN lobby_memberships m ON m.lobby_id=l.id
    WHERE l.id=NEW.lobby_id AND l.mode='training' AND l.closed_at IS NULL AND l.current_series_id IS NULL
      AND l.version=NEW.expected_lobby_version AND m.id=NEW.membership_id AND m.identity_key=NEW.identity_key
      AND m.left_at IS NULL AND m.expires_at>NEW.created_at AND m.last_seen_at>NEW.created_at-30000
      AND json_extract(l.preparation_json,'$.members."' || m.id || '".ready')=1
      AND json_array_length(l.preparation_json,'$.members."' || m.id || '".decks')=1
      AND json_type(l.preparation_json,'$.aiDeck')='object'
      AND json_extract(NEW.state_json,'$.id')=NEW.id
      AND json_extract(NEW.state_json,'$.lobbyMode')='training'
      AND json_extract(NEW.state_json,'$.format')=json_extract(l.configuration_json,'$.structure')
  ) THEN RAISE(ABORT,'LOBBY_TRAINING_START_CONFLICT') END;
END;
CREATE TRIGGER lobby_training_started AFTER INSERT ON lobby_training_series
BEGIN
  UPDATE lobby_sessions SET current_series_id=NEW.id,version=version+1 WHERE id=NEW.lobby_id;
END;
CREATE TRIGGER lobby_training_ended AFTER UPDATE OF status ON lobby_training_series
WHEN OLD.status='active' AND NEW.status IN ('completed','abandoned')
BEGIN
  UPDATE lobby_sessions SET current_series_id=NULL,previous_series_id=NEW.id,version=version+1
    WHERE id=NEW.lobby_id AND current_series_id=NEW.id;
END;
CREATE TRIGGER lobby_training_departed AFTER UPDATE OF left_at ON lobby_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE lobby_training_series SET status='abandoned',ended_at=NEW.left_at
    WHERE membership_id=NEW.id AND status='active';
END;
