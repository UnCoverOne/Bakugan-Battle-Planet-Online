PRAGMA foreign_keys = ON;

CREATE TABLE lobby_chat_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  lobby_id TEXT NOT NULL REFERENCES lobby_sessions(id),
  membership_id TEXT REFERENCES lobby_memberships(id),
  kind TEXT NOT NULL CHECK(kind IN ('chat','system')),
  author TEXT NOT NULL,
  message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 240),
  created_at INTEGER NOT NULL,
  command_id TEXT,
  event_key TEXT,
  CHECK((kind='chat' AND membership_id IS NOT NULL AND command_id IS NOT NULL AND event_key IS NULL)
    OR (kind='system' AND command_id IS NULL))
);
CREATE INDEX lobby_chat_history ON lobby_chat_messages(lobby_id,sequence);
CREATE UNIQUE INDEX lobby_chat_command ON lobby_chat_messages(membership_id,command_id) WHERE command_id IS NOT NULL;
CREATE UNIQUE INDEX lobby_chat_event ON lobby_chat_messages(lobby_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX lobby_chat_rate ON lobby_chat_messages(membership_id,created_at) WHERE kind='chat';

CREATE TABLE lobby_chat_cursors (
  membership_id TEXT PRIMARY KEY NOT NULL REFERENCES lobby_memberships(id),
  visible_from INTEGER NOT NULL,
  read_through INTEGER NOT NULL,
  connected INTEGER NOT NULL DEFAULT 1 CHECK(connected IN (0,1)),
  observed_at INTEGER NOT NULL
);
CREATE VIEW lobby_chat_member_names AS
SELECT m.id,m.lobby_id,substr(COALESCE(NULLIF(trim(u.display_name),''),'Brawler ' ||
  (SELECT COUNT(*) FROM lobby_memberships p WHERE p.lobby_id=m.lobby_id AND p.sequence<=m.sequence)),1,80) AS name
FROM lobby_memberships m LEFT JOIN users u ON m.identity_key='account:' || u.id;

-- Existing managed memberships, if any, start at the migration boundary.
INSERT INTO lobby_chat_cursors(membership_id,visible_from,read_through,observed_at)
SELECT id,1,0,last_seen_at FROM lobby_memberships WHERE left_at IS NULL;

CREATE TRIGGER lobby_chat_joined AFTER INSERT ON lobby_memberships
BEGIN
  INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at)
  SELECT NEW.lobby_id,NEW.id,'system','System',
    CASE WHEN (SELECT COUNT(*) FROM lobby_memberships WHERE lobby_id=NEW.lobby_id)=1 THEN
      CASE (SELECT mode FROM lobby_sessions WHERE id=NEW.lobby_id) WHEN 'training' THEN 'Training lobby created.' ELSE 'Lobby created.' END
    ELSE name || ' joined the lobby.' END,NEW.joined_at
  FROM lobby_chat_member_names WHERE id=NEW.id;
  INSERT INTO lobby_chat_cursors(membership_id,visible_from,read_through,observed_at)
  SELECT NEW.id,sequence,sequence-1,NEW.joined_at FROM lobby_chat_messages
    WHERE lobby_id=NEW.lobby_id ORDER BY sequence DESC LIMIT 1;
END;

CREATE TRIGGER lobby_chat_left AFTER UPDATE OF left_at ON lobby_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at)
  SELECT NEW.lobby_id,NEW.id,'system','System',name ||
    CASE NEW.departure_reason WHEN 'expired' THEN ' left after one hour unreachable.' ELSE ' left the lobby.' END,NEW.left_at
  FROM lobby_chat_member_names WHERE id=NEW.id;
END;

-- A disconnected observation is recorded once, not once per polling browser.
CREATE TRIGGER lobby_chat_presence_changed AFTER UPDATE OF connected ON lobby_chat_cursors
WHEN OLD.connected<>NEW.connected
BEGIN
  INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at)
  SELECT m.lobby_id,m.id,'system','System',n.name ||
    CASE NEW.connected WHEN 1 THEN ' reconnected.' ELSE ' disconnected.' END,NEW.observed_at
  FROM lobby_memberships m JOIN lobby_chat_member_names n ON n.id=m.id
  WHERE m.id=NEW.membership_id AND m.left_at IS NULL;
END;
CREATE TRIGGER lobby_chat_reconnected AFTER UPDATE OF last_seen_at ON lobby_memberships
WHEN NEW.left_at IS NULL AND NEW.last_seen_at>OLD.last_seen_at
BEGIN
  UPDATE lobby_chat_cursors SET connected=1,observed_at=NEW.last_seen_at
    WHERE membership_id=NEW.id AND connected=0;
END;

CREATE TRIGGER lobby_chat_settings AFTER UPDATE OF configuration_json ON lobby_sessions
WHEN OLD.configuration_json<>NEW.configuration_json
BEGIN
  INSERT INTO lobby_chat_messages(lobby_id,kind,author,message,created_at)
  VALUES(NEW.id,'system','System','Match settings changed.',(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)));
END;
CREATE TRIGGER lobby_chat_preparation AFTER UPDATE OF preparation_json ON lobby_sessions
WHEN OLD.preparation_json<>NEW.preparation_json AND NEW.current_series_id IS NULL AND OLD.current_series_id IS NULL
BEGIN
  INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at)
  SELECT NEW.id,m.id,'system','System',n.name ||
    CASE WHEN json_extract(p.value,'$.ready')=1 THEN ' is ready.' ELSE ' is no longer ready.' END,
    (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  FROM json_each(NEW.preparation_json,'$.members') p
  JOIN lobby_memberships m ON m.id=p.key AND m.left_at IS NULL
  JOIN lobby_chat_member_names n ON n.id=m.id
  WHERE COALESCE(json_extract(OLD.preparation_json,'$.members."' || p.key || '".ready'),0)<>COALESCE(json_extract(p.value,'$.ready'),0);

  -- Never copy deck names, IDs, cards or roster contents into the public stream.
  INSERT INTO lobby_chat_messages(lobby_id,membership_id,kind,author,message,created_at)
  SELECT NEW.id,m.id,'system','System',n.name || ' updated deck selection.',(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  FROM json_each(NEW.preparation_json,'$.members') p
  JOIN lobby_memberships m ON m.id=p.key AND m.left_at IS NULL
  JOIN lobby_chat_member_names n ON n.id=m.id
  WHERE COALESCE(json_extract(OLD.preparation_json,'$.members."' || p.key || '".decks'),'[]')<>COALESCE(json_extract(p.value,'$.decks'),'[]');

  INSERT INTO lobby_chat_messages(lobby_id,kind,author,message,created_at)
  SELECT NEW.id,'system','System',
    CASE WHEN json_type(NEW.preparation_json,'$.aiDeck')='object' THEN 'Mira Nova selected a deck.' ELSE 'No compatible AI deck available.' END,
    (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  WHERE NEW.mode='training' AND COALESCE(json_extract(OLD.preparation_json,'$.aiDeck'),'null')<>COALESCE(json_extract(NEW.preparation_json,'$.aiDeck'),'null');
END;

CREATE TRIGGER lobby_chat_series_started AFTER UPDATE OF current_series_id ON lobby_sessions
WHEN OLD.current_series_id IS NULL AND NEW.current_series_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO lobby_chat_messages(lobby_id,kind,author,message,created_at,event_key)
  VALUES(NEW.id,'system','System','Series started.',(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),'series:' || NEW.current_series_id || ':start');
END;
CREATE TRIGGER lobby_chat_series_ended AFTER UPDATE OF current_series_id ON lobby_sessions
WHEN OLD.current_series_id IS NOT NULL AND NEW.current_series_id IS NULL
BEGIN
  INSERT OR IGNORE INTO lobby_chat_messages(lobby_id,kind,author,message,created_at,event_key)
  VALUES(NEW.id,'system','System',
    CASE WHEN EXISTS(SELECT 1 FROM lobby_training_series WHERE id=OLD.current_series_id AND status='abandoned') THEN 'Training series abandoned.'
      WHEN EXISTS(SELECT 1 FROM lobby_series_bindings b JOIN matches g ON g.code=b.match_code WHERE b.id=OLD.current_series_id AND json_extract(g.state_json,'$.stepLabel')='Series forfeited') THEN 'Series ended by forfeiture.'
      ELSE 'Series completed.' END,
    (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),'series:' || OLD.current_series_id || ':end');
END;

-- Only public lifecycle facts, never the engine event log or arbitrary client
-- message strings. Keys prevent duplicate intermission announcements.
CREATE TRIGGER lobby_chat_game_completed AFTER UPDATE OF state_json ON matches
WHEN json_extract(NEW.state_json,'$.phase')='result' AND json_extract(OLD.state_json,'$.phase')<>'result'
BEGIN
  INSERT OR IGNORE INTO lobby_chat_messages(lobby_id,kind,author,message,created_at,event_key)
  SELECT b.lobby_id,'system','System','Game ' || CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) || ' completed.',
    NEW.updated_at,'series:' || b.id || ':game:' || CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) || ':end'
  FROM lobby_series_bindings b WHERE b.match_code=NEW.code AND b.status='active'
    AND CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) BETWEEN 1 AND 3;
END;

CREATE TRIGGER lobby_chat_training_game_completed AFTER UPDATE OF state_json ON lobby_training_series
WHEN json_extract(NEW.state_json,'$.phase')='result' AND json_extract(OLD.state_json,'$.phase')<>'result'
BEGIN
  INSERT OR IGNORE INTO lobby_chat_messages(lobby_id,kind,author,message,created_at,event_key)
  SELECT NEW.lobby_id,'system','System','Game ' || CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) || ' completed.',
    (CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)),'series:' || NEW.id || ':game:' || CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) || ':end'
  WHERE CAST(json_extract(NEW.state_json,'$.gameNumber') AS INTEGER) BETWEEN 1 AND 3;
END;

CREATE TRIGGER lobby_chat_user_guard BEFORE INSERT ON lobby_chat_messages
WHEN NEW.kind='chat'
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lobby_memberships m JOIN lobby_sessions l ON l.id=m.lobby_id
    WHERE m.id=NEW.membership_id AND m.lobby_id=NEW.lobby_id AND m.left_at IS NULL
      AND m.expires_at>NEW.created_at AND l.closed_at IS NULL AND l.mode<>'training'
      AND NOT EXISTS(SELECT 1 FROM lobby_series_departures d WHERE d.series_id=l.current_series_id AND d.membership_id=m.id))
    THEN RAISE(ABORT,'LOBBY_CHAT_FORBIDDEN') END;
  SELECT CASE WHEN (SELECT COUNT(*) FROM lobby_chat_messages WHERE membership_id=NEW.membership_id
    AND kind='chat' AND created_at>NEW.created_at-60000)>=12 THEN RAISE(ABORT,'LOBBY_CHAT_RATE_LIMIT') END;
END;
