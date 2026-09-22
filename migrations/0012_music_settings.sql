CREATE TABLE IF NOT EXISTS music_settings (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  lead_in_fade_ms INTEGER NOT NULL DEFAULT 2500,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT
);

INSERT OR IGNORE INTO music_settings (
  id,
  lead_in_fade_ms,
  revision,
  updated_at
) VALUES (1, 2500, 1, 0);
