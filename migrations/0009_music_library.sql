CREATE TABLE IF NOT EXISTS music_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  categories_json TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 10,
  loop INTEGER NOT NULL DEFAULT 0,
  gain_db REAL NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS music_tracks_enabled_idx ON music_tracks(enabled, updated_at);
CREATE TABLE IF NOT EXISTS music_track_chunks (
  track_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (track_id, chunk_index),
  FOREIGN KEY (track_id) REFERENCES music_tracks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS music_track_chunks_track_idx ON music_track_chunks(track_id, chunk_index);
