PRAGMA foreign_keys=ON;
-- Legacy invites remain historical records. A managed invite is tied to
-- the specific host membership, never merely a reusable room code.
ALTER TABLE lobby_invitations ADD COLUMN managed_lobby_id TEXT REFERENCES lobby_sessions(id);
ALTER TABLE lobby_invitations ADD COLUMN inviter_membership_id TEXT REFERENCES lobby_memberships(id);
ALTER TABLE lobby_invitations ADD COLUMN accepted_membership_id TEXT REFERENCES lobby_memberships(id);
CREATE INDEX lobby_invite_managed_room ON lobby_invitations(managed_lobby_id,status);
CREATE TRIGGER lobby_managed_invitation_host_guard BEFORE INSERT ON lobby_invitations
WHEN NEW.managed_lobby_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM lobby_sessions l JOIN lobby_memberships m ON m.lobby_id=l.id
    WHERE l.id=NEW.managed_lobby_id AND l.code=NEW.lobby_code AND l.closed_at IS NULL
      AND l.current_series_id IS NULL AND l.mode<>'training' AND m.id=NEW.inviter_membership_id
      AND m.identity_key='account:'||NEW.inviter_user_id AND m.left_at IS NULL AND m.expires_at>NEW.created_at
      AND m.sequence=(SELECT MIN(sequence) FROM lobby_memberships WHERE lobby_id=l.id AND left_at IS NULL)
      AND (SELECT COUNT(*) FROM lobby_memberships WHERE lobby_id=l.id AND left_at IS NULL)=1
  ) THEN RAISE(ABORT,'LOBBY_INVITE_UNAVAILABLE') END;
END;
CREATE TRIGGER lobby_managed_invitation_departure AFTER UPDATE OF left_at ON lobby_memberships
WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE lobby_invitations SET status='cancelled',responded_at=NEW.left_at
    WHERE inviter_membership_id=NEW.id AND status='pending';
END;
CREATE TRIGGER lobby_managed_invitation_start AFTER UPDATE OF current_series_id ON lobby_sessions
WHEN OLD.current_series_id IS NULL AND NEW.current_series_id IS NOT NULL
BEGIN
  UPDATE lobby_invitations SET status='cancelled',responded_at=CAST(strftime('%s','now') AS INTEGER)*1000
    WHERE managed_lobby_id=NEW.id AND status='pending';
END;
-- Deletion is explicit account destruction, not a way to bypass settlement.
-- Guard the same transaction that removes user data; expired online members
-- must finish their departure settlement first.
CREATE TRIGGER lobby_account_delete_guard BEFORE DELETE ON users
WHEN EXISTS(SELECT 1 FROM lobby_memberships WHERE identity_key='account:'||OLD.id AND left_at IS NULL)
BEGIN
  SELECT RAISE(ABORT,'LOBBY_ACCOUNT_ACTIVE');
END;
CREATE TRIGGER lobby_account_admission_guard BEFORE INSERT ON lobby_memberships
WHEN substr(NEW.identity_key,1,8)='account:' AND NOT EXISTS(SELECT 1 FROM users WHERE id=substr(NEW.identity_key,9))
BEGIN
  SELECT RAISE(ABORT,'LOBBY_ACCOUNT_MISSING');
END;
CREATE TRIGGER lobby_account_adoption_guard BEFORE UPDATE OF identity_key ON lobby_memberships
WHEN substr(NEW.identity_key,1,8)='account:' AND NOT EXISTS(SELECT 1 FROM users WHERE id=substr(NEW.identity_key,9))
BEGIN
  SELECT RAISE(ABORT,'LOBBY_ACCOUNT_MISSING');
END;
