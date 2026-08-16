-- Applied by scheduled maintenance after the schema migration. Keeping these
-- statements versioned makes retention explicit and reproducible.
DELETE FROM sessions WHERE expires_at < unixepoch('now') * 1000;
DELETE FROM rate_limits WHERE window_start < (unixepoch('now') * 1000) - 86400000;
-- Pending lazy replays still depend on the canonical engine history. Preserve
-- those matches until a participant first watches the replay and archive_json
-- is replaced by the compiled frozen replay (or the visible record is pruned).
DELETE FROM match_snapshots
WHERE created_at < (unixepoch('now') * 1000) - 2592000000
  AND code NOT IN (
    SELECT match_code FROM match_replays
    WHERE json_extract(archive_json, '$.kind') = 'pending-engine-history'
  );
DELETE FROM matches
WHERE updated_at < (unixepoch('now') * 1000) - 2592000000
  AND code NOT IN (
    SELECT match_code FROM match_replays
    WHERE json_extract(archive_json, '$.kind') = 'pending-engine-history'
  );
