-- Audio objects now live in the private MUSIC_BUCKET R2 binding. The existing
-- D1-backed library is intentionally discarded instead of migrated.
DELETE FROM music_upload_chunks;
DELETE FROM music_track_chunks;
DELETE FROM music_uploads;
DELETE FROM music_tracks;

DROP TABLE music_upload_chunks;
DROP TABLE music_track_chunks;

ALTER TABLE music_tracks ADD COLUMN object_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS music_tracks_object_key_idx
  ON music_tracks(object_key)
  WHERE object_key IS NOT NULL;
