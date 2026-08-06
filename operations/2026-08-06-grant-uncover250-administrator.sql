-- One-time production operation.
--
-- This resolves the requested email address exactly once at execution time and
-- persists the authorization against the account's immutable users.id value.
-- Runtime authorization continues to use account_roles.user_id, never email.
--
-- The INSERT intentionally runs only when exactly one case-insensitive account
-- match exists. The final SELECT is a verification result for the operator.

CREATE TABLE IF NOT EXISTS account_roles (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  assigned_by TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS account_roles_role_idx
  ON account_roles(role);

INSERT OR IGNORE INTO account_roles (
  user_id,
  role,
  assigned_by,
  created_at
)
SELECT
  matched.id,
  'administrator',
  'system:2026-08-06-uncover250-role-grant',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM users AS matched
WHERE lower(trim(matched.email)) = lower(trim('UnCover250@gmail.com'))
  AND (
    SELECT COUNT(*)
    FROM users
    WHERE lower(trim(email)) = lower(trim('UnCover250@gmail.com'))
  ) = 1;

SELECT
  users.id AS user_id,
  users.email,
  account_roles.role,
  account_roles.assigned_by,
  account_roles.created_at
FROM users
JOIN account_roles ON account_roles.user_id = users.id
WHERE lower(trim(users.email)) = lower(trim('UnCover250@gmail.com'))
  AND account_roles.role = 'administrator';
