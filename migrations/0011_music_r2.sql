-- Audio objects now live in the private MUSIC_BUCKET R2 binding. Existing
-- databases are upgraded atomically by ensureMusicStorageSchema because a
-- Cloudflare Git deployment can publish the Worker before Wrangler records
-- this migration. Keeping this historical migration as an idempotent marker
-- prevents a later migration run from deleting tracks uploaded after that
-- compatibility guard has already completed.
SELECT 1;
