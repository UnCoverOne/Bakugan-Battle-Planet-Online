CREATE TABLE IF NOT EXISTS social_lobby_events (
  id TEXT PRIMARY KEY,
  lobby_code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_lobby_events_room_created_idx ON social_lobby_events(lobby_code, created_at);
