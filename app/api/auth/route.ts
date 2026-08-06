import {
  clearSessionCookie, createPasswordRecord, createSession, getDatabase,
  getAccountBan, getAccountRoles, getSessionUser, getUserByEmail, normalizeEmail, passwordRecordNeedsUpgrade,
  publicUser, revokeSession, validateAccountInput, verifyPassword,
} from "../../../lib/account-server";
import { deleteAccountData } from "../../../lib/account-data-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
  serverErrorResponse,
} from "../../../lib/server-errors";
import { encodedJsonBytes, MAX_SYNC_BYTES, validateUserSnapshot } from "../../../lib/user-data-server";

export const dynamic = "force-dynamic";
const MAX_AUTH_BYTES = 16_384;
const RECOVERY_PATTERN = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/;
let recoverySchemaReady = false;

const json = (value: unknown, status = 200, cookie?: string) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) },
});

function normalizeRecoveryCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function validateRecoveryCode(value: unknown) {
  const normalized = normalizeRecoveryCode(value);
  if (!RECOVERY_PATTERN.test(normalized)) {
    throw new ValidationError("Recovery code is invalid.");
  }
  return normalized;
}

async function ensureRecoverySchema(db: D1Database) {
  if (recoverySchemaReady) return;
  const columns = [
    "ALTER TABLE users ADD COLUMN recovery_code_hash TEXT",
    "ALTER TABLE users ADD COLUMN recovery_code_salt TEXT",
    "ALTER TABLE users ADD COLUMN recovery_code_iterations INTEGER",
  ];
  for (const statement of columns) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
  recoverySchemaReady = true;
}

async function recoveryRowForEmail(db: D1Database, email: string) {
  return db.prepare(
    "SELECT id, recovery_code_hash, recovery_code_salt, recovery_code_iterations FROM users WHERE email = ? COLLATE NOCASE",
  ).bind(normalizeEmail(email)).first<{
    id: string;
    recovery_code_hash: string | null;
    recovery_code_salt: string | null;
    recovery_code_iterations: number | null;
  }>();
}

async function recoveryCodeMatches(
  code: string,
  row: Awaited<ReturnType<typeof recoveryRowForEmail>>,
) {
  if (
    !row?.recovery_code_hash ||
    !row.recovery_code_salt ||
    !row.recovery_code_iterations
  ) return false;
  return verifyPassword(code, {
    password_hash: row.recovery_code_hash,
    password_salt: row.recovery_code_salt,
    password_iterations: row.recovery_code_iterations,
  });
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    return json({ user: await getSessionUser(request), correlationId });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Account service unavailable.", { route: "/api/auth", method: "GET" });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  let action = "unknown";
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    const rawBytes = new TextEncoder().encode(raw).byteLength;
    if (rawBytes > MAX_SYNC_BYTES + MAX_AUTH_BYTES) {
      return json({ error: "Account request is too large.", code: "VALIDATION_ERROR", correlationId }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ValidationError("Account request is not valid JSON.");
    }
    action = String(body.action ?? "");
    if (action !== "signup" && rawBytes > MAX_AUTH_BYTES) {
      return json({ error: "Account request is too large.", code: "VALIDATION_ERROR", correlationId }, 413);
    }
    const db = await getDatabase();
    await ensureRecoverySchema(db);
    const sensitive = ["signup", "login", "recover-password", "change-password", "delete-account"].includes(action);
    await enforceD1RateLimit(db, `auth:${requestClientKey(request)}:${action}`, sensitive ? 12 : 60, 60_000);

    if (action === "signup") {
      const displayName = String(body.displayName ?? "").trim().replace(/\s+/g, " ");
      const email = validateAccountInput(String(body.email ?? ""), String(body.password ?? ""), displayName);
      const recoveryCode = validateRecoveryCode(body.recoveryCode);
      const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Pyrus", "Ventus", "Aurelus"];
      const faction = factions.includes(String(body.faction)) ? String(body.faction) : "Pyrus";
      if (await getUserByEmail(email)) throw new ConflictError("An account already exists for that email address.");
      if (!body.initialData || typeof body.initialData !== "object" || Array.isArray(body.initialData)) {
        throw new ValidationError("Choose the account data to create during registration.");
      }
      if (encodedJsonBytes(body.initialData) > MAX_SYNC_BYTES) {
        return json({
          error: "Account data is too large. Remove old replays or unused decks and try again.",
          code: "VALIDATION_ERROR",
          correlationId,
        }, 413);
      }
      try {
        validateUserSnapshot(body.initialData);
      } catch (error) {
        throw new ValidationError(
          error instanceof Error ? error.message : "Account data is invalid.",
          error instanceof Error ? error.message : String(error),
        );
      }
      const password = await createPasswordRecord(String(body.password));
      const recovery = await createPasswordRecord(recoveryCode);
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO users (id, email, password_hash, password_salt, password_iterations, recovery_code_hash, recovery_code_salt, recovery_code_iterations, display_name, faction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, email, password.hash, password.salt, password.iterations, recovery.hash, recovery.salt, recovery.iterations, displayName, faction, now, now),
        db.prepare("INSERT INTO user_data (user_id, revision, data_json, updated_at) VALUES (?, 1, ?, ?)")
          .bind(id, JSON.stringify(body.initialData), now),
      ]);
      const user = { id, email, displayName, faction, createdAt: now };
      return json({ user: { ...user, roles: await getAccountRoles(db, user) }, revision: 1, correlationId }, 201, await createSession(request, id));
    }

    if (action === "login") {
      const email = normalizeEmail(String(body.email ?? ""));
      const row = await getUserByEmail(email);
      const valid = row ? await verifyPassword(String(body.password ?? ""), row) : false;
      if (!row || !valid) throw new AuthenticationError("Email or password is incorrect.");
      if (await getAccountBan(db, row.id)) throw new AuthorizationError("This account has been banned.");
      const updates: D1PreparedStatement[] = [];
      if (passwordRecordNeedsUpgrade(row.password_iterations)) {
        const upgraded = await createPasswordRecord(String(body.password));
        updates.push(db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(upgraded.hash, upgraded.salt, upgraded.iterations, Date.now(), row.id));
      }
      if (body.recoveryCode) {
        const recoveryCode = validateRecoveryCode(body.recoveryCode);
        const recovery = await createPasswordRecord(recoveryCode);
        updates.push(db.prepare("UPDATE users SET recovery_code_hash = ?, recovery_code_salt = ?, recovery_code_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(recovery.hash, recovery.salt, recovery.iterations, Date.now(), row.id));
      }
      if (updates.length) await db.batch(updates);
      return json({ user: publicUser(row, await getAccountRoles(db, row)), correlationId }, 200, await createSession(request, row.id));
    }

    if (action === "recover-password") {
      const email = normalizeEmail(String(body.email ?? ""));
      const newPassword = String(body.newPassword ?? "");
      validateAccountInput(email, newPassword);
      const suppliedCode = validateRecoveryCode(body.recoveryCode);
      const nextRecoveryCode = validateRecoveryCode(body.nextRecoveryCode);
      const recoveryRow = await recoveryRowForEmail(db, email);
      if (!recoveryRow || !(await recoveryCodeMatches(suppliedCode, recoveryRow))) {
        throw new AuthenticationError("Email or recovery code is incorrect.");
      }
      if (await getAccountBan(db, recoveryRow.id)) throw new AuthorizationError("This account has been banned.");
      const password = await createPasswordRecord(newPassword);
      const nextRecovery = await createPasswordRecord(nextRecoveryCode);
      await db.batch([
        db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, recovery_code_hash = ?, recovery_code_salt = ?, recovery_code_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(password.hash, password.salt, password.iterations, nextRecovery.hash, nextRecovery.salt, nextRecovery.iterations, Date.now(), recoveryRow.id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(recoveryRow.id),
      ]);
      return json({ ok: true, correlationId });
    }

    if (action === "logout") {
      await revokeSession(request);
      return json({ ok: true, correlationId }, 200, clearSessionCookie(request));
    }

    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    if (action === "change-password") {
      const current = String(body.currentPassword ?? "");
      const next = String(body.newPassword ?? "");
      validateAccountInput(user.email, next);
      const row = await getUserByEmail(user.email);
      if (!row || !(await verifyPassword(current, row))) throw new AuthorizationError("Current password is incorrect.");
      const password = await createPasswordRecord(next);
      await db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
        .bind(password.hash, password.salt, password.iterations, Date.now(), user.id).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
      return json({ ok: true, correlationId }, 200, await createSession(request, user.id));
    }
    if (action === "update-profile") {
      const displayName = String(body.displayName ?? "").trim().replace(/\s+/g, " ");
      if (!displayName || displayName.length > 20) throw new ValidationError("Brawler Name must be between 1 and 20 characters.");
      const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
      const faction = factions.includes(String(body.faction)) ? String(body.faction) : user.faction;
      await db.prepare("UPDATE users SET display_name = ?, faction = ?, updated_at = ? WHERE id = ?").bind(displayName, faction, Date.now(), user.id).run();
      return json({ user: { ...user, displayName, faction }, correlationId });
    }
    if (action === "delete-account") {
      if (String(body.confirmation ?? "").trim().toUpperCase() !== "DELETE") {
        throw new ValidationError("Type DELETE to confirm account removal.");
      }
      await deleteAccountData(db, user.id);
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
        db.prepare("DELETE FROM account_roles WHERE user_id = ?").bind(user.id),
        db.prepare("DELETE FROM account_bans WHERE user_id = ?").bind(user.id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      ]);
      return json({ ok: true, correlationId }, 200, clearSessionCookie(request));
    }
    throw new ValidationError("Unknown account action.");
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Account request failed.", { route: "/api/auth", method: "POST", action });
  }
}
