import {
  ACCOUNT_ROLES,
  BOOTSTRAP_ADMIN_EMAIL,
  ensureAdministrationSchema,
  getDatabase,
  normalizeEmail,
  requireAdministrator,
  type AccountDatabase,
  type AccountRole,
} from "../../../lib/account-server";
import {
  addAiDeck,
  applyDatabaseCardOverrides,
  deleteAiDeck,
  deletePublicDeck,
  listAiDecks,
  listManagedPublicDecks,
  resetCardOverride,
  saveCardOverride,
  setAiDeckEnabled,
  updateAiDeck,
  updatePublicDeck,
} from "../../../lib/administration-server";
import { CARDS } from "../../../lib/data";
import { assertSameOrigin, enforceD1RateLimit, RateLimitError, requestClientKey } from "../../../lib/request-security";

export const dynamic = "force-dynamic";
const MAX_ADMIN_BYTES = 1_000_000;
const DEFAULT_SETTINGS = {
  reducedMotion: false,
  highContrast: false,
  sound: true,
  cardScale: 100,
  logDetail: "All events",
  challenges: "Everyone",
  replayLinks: true,
};
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
};

async function listUsers(db: AccountDatabase) {
  const usersResult = await db.prepare(
    "SELECT users.id, users.email, users.display_name, users.faction, users.created_at, users.updated_at, user_data.data_json, user_data.updated_at AS data_updated_at, account_bans.reason AS ban_reason, account_bans.banned_at FROM users LEFT JOIN user_data ON user_data.user_id = users.id LEFT JOIN account_bans ON account_bans.user_id = users.id ORDER BY users.created_at DESC",
  ).all();
  const rolesResult = await db.prepare("SELECT user_id, role FROM account_roles ORDER BY role").all();
  const rolesByUser = new Map<string, string[]>();
  for (const row of rolesResult.results ?? []) {
    const roles = rolesByUser.get(String(row.user_id)) ?? [];
    roles.push(String(row.role));
    rolesByUser.set(String(row.user_id), roles);
  }
  return (usersResult.results ?? []).map((row: Record<string, unknown>) => {
    const snapshot = parseJson<Record<string, unknown>>(String(row.data_json ?? ""), {});
    const roles = rolesByUser.get(String(row.id)) ?? [];
    if (normalizeEmail(String(row.email)) === BOOTSTRAP_ADMIN_EMAIL && !roles.includes("administrator")) roles.unshift("administrator");
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      faction: row.faction,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dataUpdatedAt: row.data_updated_at,
      roles,
      banned: Boolean(row.banned_at),
      bannedAt: row.banned_at,
      banReason: row.ban_reason ?? "",
      deckCount: Array.isArray(snapshot.decks) ? snapshot.decks.length : 0,
      matchCount: Array.isArray(snapshot.history) ? snapshot.history.length : 0,
    };
  });
}

async function userById(db: AccountDatabase, userId: string) {
  return db.prepare("SELECT id, email, display_name, faction FROM users WHERE id = ?")
    .bind(userId).first<{ id: string; email: string; display_name: string; faction: string }>();
}

async function assertMutableUser(db: AccountDatabase, userId: string) {
  const target = await userById(db, userId);
  if (!target) throw new Error("The selected account no longer exists.");
  if (normalizeEmail(target.email) === BOOTSTRAP_ADMIN_EMAIL) {
    throw new Error("The bootstrap administrator account is protected.");
  }
  return target;
}

async function resetUserData(db: AccountDatabase, userId: string, scope: string) {
  const target = await userById(db, userId);
  if (!target) throw new Error("The selected account no longer exists.");
  if (scope === "all") {
    await db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId).run();
    return;
  }
  const row = await db.prepare("SELECT revision, data_json FROM user_data WHERE user_id = ?")
    .bind(userId).first() as { revision: number; data_json: string } | null;
  if (!row) return;
  const snapshot = parseJson<Record<string, unknown>>(row.data_json, {});
  if (scope === "decks") {
    snapshot.decks = [];
    snapshot.builderDeck = null;
    snapshot.selectedDeckId = "";
  } else if (scope === "history") {
    snapshot.history = [];
  } else if (scope === "settings") {
    snapshot.settings = DEFAULT_SETTINGS;
  } else if (scope === "profile") {
    snapshot.profile = { name: target.display_name, faction: target.faction, signedIn: false };
  } else {
    throw new Error("Choose a supported account-data type.");
  }
  snapshot.updatedAt = Date.now();
  await db.prepare("UPDATE user_data SET revision = ?, data_json = ?, updated_at = ? WHERE user_id = ?")
    .bind(row.revision + 1, JSON.stringify(snapshot), Date.now(), userId).run();
}

export async function GET(request: Request) {
  try {
    await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    const url = new URL(request.url);
    const section = url.searchParams.get("section") ?? "overview";
    const id = url.searchParams.get("id");
    if (section === "users") return json({ users: await listUsers(db), roles: ACCOUNT_ROLES });
    if (section === "cards") {
      await applyDatabaseCardOverrides(db);
      return json({ cards: CARDS });
    }
    if (section === "ai-decks") {
      const decks = await listAiDecks(db);
      return json({ decks: id ? decks.filter((item) => item.id === id) : decks });
    }
    if (section === "public-decks") {
      const decks = await listManagedPublicDecks(db);
      return json({ decks: id ? decks.filter((item) => item.deck.id === id) : decks });
    }
    const [users, aiDecks, publicDecks] = await Promise.all([
      listUsers(db),
      listAiDecks(db),
      listManagedPublicDecks(db),
    ]);
    return json({
      counts: {
        users: users.length,
        bannedUsers: users.filter((user: { banned: boolean }) => user.banned).length,
        aiDecks: aiDecks.length,
        enabledAiDecks: aiDecks.filter((deck) => deck.enabled).length,
        publicDecks: publicDecks.length,
        cards: CARDS.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Administrator data is unavailable.";
    return json({ error: message }, /required/i.test(message) ? 403 : 400);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    await enforceD1RateLimit(db, `admin:${administrator.id}:${requestClientKey(request)}`, 120, 60_000);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_ADMIN_BYTES) return json({ error: "Administrator request is too large." }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "set-role") {
      const userId = String(body.userId ?? "");
      const role = String(body.role ?? "") as AccountRole;
      if (!ACCOUNT_ROLES.includes(role)) throw new Error("Role is invalid.");
      await assertMutableUser(db, userId);
      if (Boolean(body.enabled)) {
        await db.prepare("INSERT OR IGNORE INTO account_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, role, administrator.id, Date.now()).run();
      } else {
        await db.prepare("DELETE FROM account_roles WHERE user_id = ? AND role = ?").bind(userId, role).run();
      }
      return json({ ok: true });
    }

    if (action === "reset-user-data") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      await resetUserData(db, userId, String(body.scope ?? ""));
      return json({ ok: true });
    }

    if (action === "ban-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      const reason = String(body.reason ?? "").trim().slice(0, 500);
      await db.prepare(
        "INSERT INTO account_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, banned_at = excluded.banned_at",
      ).bind(userId, reason, administrator.id, Date.now()).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
      return json({ ok: true });
    }

    if (action === "unban-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      await db.prepare("DELETE FROM account_bans WHERE user_id = ?").bind(userId).run();
      return json({ ok: true });
    }

    if (action === "delete-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      await db.batch([
        db.prepare("DELETE FROM user_data WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM account_roles WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM account_bans WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      ]);
      return json({ ok: true });
    }

    if (action === "card-save") return json({ card: await saveCardOverride(db, body.card, administrator.id) });
    if (action === "card-reset") {
      await resetCardOverride(db, String(body.catalogId ?? ""));
      return json({ ok: true });
    }
    if (action === "ai-add") return json({ deck: await addAiDeck(db, body.deck, administrator.id) }, 201);
    if (action === "ai-update") return json({ deck: await updateAiDeck(db, String(body.id ?? ""), body.deck, administrator.id) });
    if (action === "ai-toggle") {
      await setAiDeckEnabled(db, String(body.id ?? ""), Boolean(body.enabled), administrator.id);
      return json({ ok: true });
    }
    if (action === "ai-delete") {
      await deleteAiDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true });
    }
    if (action === "public-update") return json({ deck: await updatePublicDeck(db, String(body.id ?? ""), body.deck, administrator.id) });
    if (action === "public-delete") {
      await deletePublicDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true });
    }
    return json({ error: "Unknown administrator action." }, 400);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return Response.json({ error: error.message, retryAfter: error.retryAfterSeconds }, {
        status: 429,
        headers: { "cache-control": "no-store", "retry-after": String(error.retryAfterSeconds) },
      });
    }
    const message = error instanceof Error ? error.message : "Administrator action failed.";
    return json({ error: message }, /required/i.test(message) ? 403 : 400);
  }
}
