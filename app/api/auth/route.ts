import {
  clearSessionCookie, createPasswordRecord, createSession, getDatabase,
  getSessionUser, getUserByEmail, normalizeEmail, publicUser, revokeSession,
  validateAccountInput, verifyPassword,
} from "../../../lib/account-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200, cookie?: string) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) },
});

export async function GET(request: Request) {
  try { return json({ user: await getSessionUser(request) }); }
  catch (error) { return json({ user: null, error: error instanceof Error ? error.message : "Account service unavailable." }, 503); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return json({ error: "Account request is too large." }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const db = await getDatabase();
    const sensitive = ["signup", "login", "change-password", "delete-account"].includes(action);
    await enforceD1RateLimit(db, `auth:${requestClientKey(request)}:${action}`, sensitive ? 12 : 60, 60_000);

    if (action === "signup") {
      const email = validateAccountInput(String(body.email ?? ""), String(body.password ?? ""), String(body.displayName ?? ""));
      const displayName = String(body.displayName ?? "").trim();
      const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
      const faction = factions.includes(String(body.faction)) ? String(body.faction) : "Pyrus";
      if (await getUserByEmail(email)) return json({ error: "An account already exists for that email address." }, 409);
      const password = await createPasswordRecord(String(body.password));
      const id = crypto.randomUUID();
      const now = Date.now();
      await db.prepare("INSERT INTO users (id, email, password_hash, password_salt, password_iterations, display_name, faction, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, email, password.hash, password.salt, password.iterations, displayName, faction, now, now).run();
      return json({ user: { id, email, displayName, faction, createdAt: now } }, 201, await createSession(request, id));
    }

    if (action === "login") {
      const email = normalizeEmail(String(body.email ?? ""));
      const row = await getUserByEmail(email);
      const valid = row ? await verifyPassword(String(body.password ?? ""), row) : false;
      if (!row || !valid) return json({ error: "Email or password is incorrect." }, 401);
      if (row.password_iterations < 600_000) {
        const upgraded = await createPasswordRecord(String(body.password));
        await db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
          .bind(upgraded.hash, upgraded.salt, upgraded.iterations, Date.now(), row.id).run();
      }
      return json({ user: publicUser(row) }, 200, await createSession(request, row.id));
    }

    if (action === "logout") {
      await revokeSession(request);
      return json({ ok: true }, 200, clearSessionCookie(request));
    }

    const user = await getSessionUser(request);
    if (!user) return json({ error: "Sign in is required." }, 401);
    if (action === "change-password") {
      const current = String(body.currentPassword ?? "");
      const next = String(body.newPassword ?? "");
      validateAccountInput(user.email, next);
      const row = await getUserByEmail(user.email);
      if (!row || !(await verifyPassword(current, row))) return json({ error: "Current password is incorrect." }, 403);
      const password = await createPasswordRecord(next);
      await db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ? WHERE id = ?")
        .bind(password.hash, password.salt, password.iterations, Date.now(), user.id).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
      return json({ ok: true }, 200, await createSession(request, user.id));
    }
    if (action === "update-profile") {
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName || displayName.length > 20) return json({ error: "Brawler name must be between 1 and 20 characters." }, 400);
      const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
      const faction = factions.includes(String(body.faction)) ? String(body.faction) : user.faction;
      await db.prepare("UPDATE users SET display_name = ?, faction = ?, updated_at = ? WHERE id = ?").bind(displayName, faction, Date.now(), user.id).run();
      return json({ user: { ...user, displayName, faction } });
    }
    if (action === "delete-account") {
      if (String(body.confirmation ?? "").trim().toUpperCase() !== "DELETE") return json({ error: "Type DELETE to confirm account removal." }, 400);
      await db.batch([
        db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(user.id),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      ]);
      return json({ ok: true }, 200, clearSessionCookie(request));
    }
    return json({ error: "Unknown account action." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Account request failed." }, 400);
  }
}
