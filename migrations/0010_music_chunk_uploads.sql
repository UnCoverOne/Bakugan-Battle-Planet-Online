CREATE TABLE IF NOT EXISTS music_uploads (
  id TEXT PRIMARY KEY NOT NULL,
  administrator_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS music_uploads_created_idx ON music_uploads(created_at);
CREATE TABLE IF NOT EXISTS music_upload_chunks (
  upload_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (upload_id, chunk_index),
  FOREIGN KEY (upload_id) REFERENCES music_uploads(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS music_upload_chunks_upload_idx ON music_upload_chunks(upload_id, chunk_index);
