import {
  ACCOUNT_ROLES,
  ensureAdministrationSchema,
  getBootstrapAdministratorUserId,
  getDatabase,
  requireAdministrator,
  type AccountDatabase,
  type AccountRole,
} from "../../../lib/account-server";
import {
  accountDataStatsByUser,
  deleteAccountData,
  resetAccountData,
} from "../../../lib/account-data-server";
import {
  addAiDeck,
  applyDatabaseCardOverrides,
  clearOfflinePublicDeckSlot,
  deleteAiDeck,
  deletePublicDeck,
  getAdministratorAiVisibility,
  listAiDecks,
  listManagedPublicDecks,
  listOfflinePublicDeckSlots,
  resetCardOverride,
  resetOfflinePublicDeckSlot,
  saveCardOverride,
  setAdministratorAiVisibility,
  setAiDeckEnabled,
  updateAiDeck,
  updateOfflinePublicDeckSlot,
  updatePublicDeck,
} from "../../../lib/administration-server";
import { loadAdministratorMatchEngineHistory } from "../../../lib/admin-engine-history-server";
import { CARDS } from "../../../lib/data";
import {
  getRankedRulesAdministration,
  publishRankedRules,
  rollbackRankedRules,
  saveRankedRulesDraft,
} from "../../../lib/ranked-server";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../lib/request-security";
import {
  AuthorizationError,
  ConflictError,
  ValidationError,
  serverErrorResponse,
} from "../../../lib/server-errors";

export const dynamic = "force-dynamic";
const MAX_ADMIN_BYTES = 1_000_000;
const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "no-store" },
});

async function listUsers(db: AccountDatabase) {
  const [usersResult, rolesResult, stats] = await Promise.all([
    db.prepare(
      "SELECT users.id, users.email, users.display_name, users.faction, users.created_at, users.updated_at, account_bans.reason AS ban_reason, account_bans.banned_at FROM users LEFT JOIN account_bans ON account_bans.user_id = users.id ORDER BY users.created_at DESC",
    ).all(),
    db.prepare("SELECT user_id, role FROM account_roles ORDER BY role").all(),
    accountDataStatsByUser(db),
  ]);
  const rolesByUser = new Map<string, string[]>();
  for (const row of rolesResult.results ?? []) {
    const roles = rolesByUser.get(String(row.user_id)) ?? [];
    roles.push(String(row.role));
    rolesByUser.set(String(row.user_id), roles);
  }
  const bootstrapAdministratorId = await getBootstrapAdministratorUserId();
  return (usersResult.results ?? []).map((row: Record<string, unknown>) => {
    const roles = rolesByUser.get(String(row.id)) ?? [];
    if (bootstrapAdministratorId && row.id === bootstrapAdministratorId && !roles.includes("administrator")) {
      roles.unshift("administrator");
    }
    const accountStats = stats.get(String(row.id)) ?? { deckCount: 0, matchCount: 0, updatedAt: 0 };
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      faction: row.faction,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dataUpdatedAt: accountStats.updatedAt,
      roles,
      banned: Boolean(row.banned_at),
      bannedAt: row.banned_at,
      banReason: row.ban_reason ?? "",
      deckCount: accountStats.deckCount,
      matchCount: accountStats.matchCount,
    };
  });
}

async function userById(db: AccountDatabase, userId: string) {
  return db.prepare("SELECT id, email, display_name, faction FROM users WHERE id = ?")
    .bind(userId).first<{ id: string; email: string; display_name: string; faction: string }>();
}

async function assertMutableUser(db: AccountDatabase, userId: string) {
  const target = await userById(db, userId);
  if (!target) throw new ConflictError("The selected account no longer exists.");
  const bootstrapAdministratorId = await getBootstrapAdministratorUserId();
  if (bootstrapAdministratorId && target.id === bootstrapAdministratorId) {
    throw new AuthorizationError("The bootstrap administrator account is protected.");
  }
  return target;
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    const url = new URL(request.url);
    const section = url.searchParams.get("section") ?? "overview";
    const id = url.searchParams.get("id");
    const code = url.searchParams.get("code");
    if (section === "users") return json({ users: await listUsers(db), roles: ACCOUNT_ROLES, correlationId });
    if (section === "cards") {
      await applyDatabaseCardOverrides(db);
      return json({ cards: CARDS, correlationId });
    }
    if (section === "ai-visibility") {
      return json({ ...(await getAdministratorAiVisibility(db, administrator.id)), correlationId });
    }
    if (section === "match-engine-history") {
      if (!code || !/^[A-Z2-9]{6}$/i.test(code)) throw new ValidationError("A valid match code is required.");
      const history = await loadAdministratorMatchEngineHistory(db, code.toUpperCase(), administrator.id);
      if (!history) throw new ConflictError("The selected match is no longer available.");
      return json({ history, correlationId });
    }
    if (section === "ai-decks") {
      const decks = await listAiDecks(db);
      return json({ decks: id ? decks.filter((item) => item.id === id) : decks, correlationId });
    }
    if (section === "public-decks") {
      const decks = await listManagedPublicDecks(db);
      return json({ decks: id ? decks.filter((item) => item.deck.id === id) : decks, correlationId });
    }
    if (section === "offline-decks") {
      const slots = await listOfflinePublicDeckSlots(db);
      return json({ slots: id ? slots.filter((slot) => slot.id === id) : slots, correlationId });
    }
    if (section === "ranked") return json({ ...(await getRankedRulesAdministration(db)), correlationId });
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
      correlationId,
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Administrator data is unavailable.", { route: "/api/admin", method: "GET" });
  }
}

export async function POST(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const administrator = await requireAdministrator(request);
    const db = await getDatabase();
    await ensureAdministrationSchema(db);
    await enforceD1RateLimit(db, `admin:${administrator.id}:${requestClientKey(request)}`, 120, 60_000);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_ADMIN_BYTES) {
      return json({ error: "Administrator request is too large.", code: "VALIDATION_ERROR", correlationId }, 413);
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ValidationError("Administrator request is not valid JSON.");
    }
    const action = String(body.action ?? "");

    if (action === "set-role") {
      const userId = String(body.userId ?? "");
      const role = String(body.role ?? "") as AccountRole;
      if (!ACCOUNT_ROLES.includes(role)) throw new ValidationError("Role is invalid.");
      await assertMutableUser(db, userId);
      if (Boolean(body.enabled)) {
        await db.prepare("INSERT OR IGNORE INTO account_roles (user_id, role, assigned_by, created_at) VALUES (?, ?, ?, ?)")
          .bind(userId, role, administrator.id, Date.now()).run();
      } else {
        await db.prepare("DELETE FROM account_roles WHERE user_id = ? AND role = ?").bind(userId, role).run();
      }
      return json({ ok: true, correlationId });
    }

    if (action === "reset-user-data") {
      const userId = String(body.userId ?? "");
      const target = await assertMutableUser(db, userId);
      const scope = String(body.scope ?? "");
      if (!["all", "decks", "history", "settings", "profile"].includes(scope)) {
        throw new ValidationError("Choose a supported account-data type.");
      }
      await resetAccountData(
        db,
        userId,
        scope as "all" | "decks" | "history" | "settings" | "profile",
        { displayName: target.display_name, faction: target.faction },
      );
      return json({ ok: true, correlationId });
    }

    if (action === "ban-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      const reason = String(body.reason ?? "").trim().slice(0, 500);
      await db.prepare(
        "INSERT INTO account_bans (user_id, reason, banned_by, banned_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason, banned_by = excluded.banned_by, banned_at = excluded.banned_at",
      ).bind(userId, reason, administrator.id, Date.now()).run();
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
      return json({ ok: true, correlationId });
    }

    if (action === "unban-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      await db.prepare("DELETE FROM account_bans WHERE user_id = ?").bind(userId).run();
      return json({ ok: true, correlationId });
    }

    if (action === "delete-user") {
      const userId = String(body.userId ?? "");
      await assertMutableUser(db, userId);
      await deleteAccountData(db, userId);
      await db.batch([
        db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM account_roles WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM account_bans WHERE user_id = ?").bind(userId),
        db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
      ]);
      return json({ ok: true, correlationId });
    }

    if (action === "card-save") return json({ card: await saveCardOverride(db, body.card, administrator.id), correlationId });
    if (action === "card-reset") {
      await resetCardOverride(db, String(body.catalogId ?? ""));
      return json({ ok: true, correlationId });
    }
    if (action === "ai-visibility") {
      return json({
        ...(await setAdministratorAiVisibility(db, administrator.id, Boolean(body.enabled))),
        correlationId,
      });
    }
    if (action === "ai-add") return json({ deck: await addAiDeck(db, body.deck, administrator.id), correlationId }, 201);
    if (action === "ai-update") return json({ deck: await updateAiDeck(db, String(body.id ?? ""), body.deck, administrator.id), correlationId });
    if (action === "ai-toggle") {
      await setAiDeckEnabled(db, String(body.id ?? ""), Boolean(body.enabled), administrator.id);
      return json({ ok: true, correlationId });
    }
    if (action === "ai-delete") {
      await deleteAiDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true, correlationId });
    }
    if (action === "public-update") return json({ deck: await updatePublicDeck(db, String(body.id ?? ""), body.deck, administrator.id), correlationId });
    if (action === "public-delete") {
      await deletePublicDeck(db, String(body.id ?? ""), administrator.id);
      return json({ ok: true, correlationId });
    }
    if (action === "offline-update") {
      return json({ slot: await updateOfflinePublicDeckSlot(db, String(body.id ?? ""), body.deck, administrator.id), correlationId });
    }
    if (action === "offline-clear") {
      return json({ slot: await clearOfflinePublicDeckSlot(db, String(body.id ?? ""), administrator.id), correlationId });
    }
    if (action === "offline-reset") {
      return json({ slot: await resetOfflinePublicDeckSlot(db, String(body.id ?? "")), correlationId });
    }
    if (action === "ranked-save-draft") {
      return json({ draft: await saveRankedRulesDraft(db, body.restrictions, administrator.id), correlationId });
    }
    if (action === "ranked-publish") {
      return json({ ruleset: await publishRankedRules(db, body.restrictions, administrator.id), correlationId });
    }
    if (action === "ranked-rollback") {
      const version = Number(body.version);
      if (!Number.isInteger(version) || version < 1) throw new ValidationError("Choose a valid Ranked ruleset version.");
      return json({ ruleset: await rollbackRankedRules(db, version, administrator.id), correlationId });
    }
    throw new ValidationError("Unknown administrator action.");
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Administrator action failed.", { route: "/api/admin", method: "POST" });
  }
}
