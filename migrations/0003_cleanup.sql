-- Applied by scheduled maintenance after the schema migration. Keeping these
-- statements versioned makes retention explicit and reproducible.
DELETE FROM sessions WHERE expires_at < unixepoch('now') * 1000;
DELETE FROM rate_limits WHERE window_start < (unixepoch('now') * 1000) - 86400000;
-- Match retention runs in scheduled maintenance after the replay schema exists.
