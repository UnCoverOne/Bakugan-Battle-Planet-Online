CREATE TABLE IF NOT EXISTS social_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL,
 body TEXT NOT NULL CONSTRAINT social_messages_body_length CHECK(length(body) BETWEEN 1 AND 2000),
 created_at INTEGER NOT NULL,
 read_at INTEGER,
 CONSTRAINT social_messages_distinct_accounts CHECK(sender_id <> recipient_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_messages_sender_client_idx ON social_messages(sender_id,client_id);
CREATE INDEX IF NOT EXISTS social_messages_sender_peer_idx ON social_messages(sender_id,recipient_id,id DESC);
CREATE INDEX IF NOT EXISTS social_messages_recipient_peer_idx ON social_messages(recipient_id,sender_id,id DESC);
CREATE INDEX IF NOT EXISTS social_messages_unread_idx ON social_messages(recipient_id,sender_id,id) WHERE read_at IS NULL;
CREATE TABLE IF NOT EXISTS social_message_blocks (
 blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(blocker_id,blocked_id),
 CONSTRAINT social_message_blocks_distinct_accounts CHECK(blocker_id <> blocked_id)
);
CREATE INDEX IF NOT EXISTS social_message_blocks_reverse_idx ON social_message_blocks(blocked_id,blocker_id);
