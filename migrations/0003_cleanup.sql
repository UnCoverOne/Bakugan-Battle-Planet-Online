-- Applied by scheduled maintenance after the schema migration. Keeping these
-- statements versioned makes retention explicit and reproducible.
DELETE FROM sessions WHERE expires_at < unixepoch('now') * 1000;
DELETE FROM rate_limits WHERE window_start < (unixepoch('now') * 1000) - 86400000;
DELETE FROM match_snapshots WHERE created_at < (unixepoch('now') * 1000) - 2592000000;
DELETE FROM matches WHERE updated_at < (unixepoch('now') * 1000) - 2592000000;
