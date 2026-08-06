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

const json = (value: unknown, status = 200, cookie?: string) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) },
});

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
    const sensitive = ["signup", "login", "change-password", "delete-account"].includes(action);
    await enforceD1RateLimit(db, `auth:${requestClientKey(request)}:${action}`, sensitive ? 12 : 60, 60_000);

    if (action === "signup") {
      const displayName = String(body.displayName ?? "").trim().replace(/\s+/g, " ");
      const email = validateAccountInput(String(body.email ?? ""), String(body.password ?? ""), displayName);
      const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
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
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.batch([
        db.prepare("INSERT INTO users (id, email, password_hash, password_salt, password_iterations, display_name, faction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, email, password.hash, password.salt, password.iterations, displayName, faction, now, now),
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
      if (passwordRecordNeedsUpgrade(row.password_iterations)) {
        const upgraded = await createPasswordRecord(String(body.password));
        await db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(upgraded.hash, upgraded.salt, upgraded.iterations, Date.now(), row.id).run();
      }
      return json({ user: publicUser(row, await getAccountRoles(db, row)), correlationId }, 200, await createSession(request, row.id));
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
