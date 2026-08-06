import {
  CARDS,
  PUBLIC_DECKS,
  STARTER_DECKS,
  applyCardOverrides,
  validateDeck,
  type CardOverrideRecord,
  type DeckRecord,
} from "./data";
import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import type { GameCard } from "./game";

type Database = AccountDatabase;
type ManagedDeck = {
  deck: DeckRecord;
  source: { kind: "builtin" | "user" | "resource"; userId?: string };
};

const cloneDeck = (deck: DeckRecord): DeckRecord => ({
  ...deck,
  factions: [...deck.factions],
  bakuganIds: [...deck.bakuganIds],
  coreIds: [...deck.coreIds],
  cardIds: [...deck.cardIds],
  tags: [...(deck.tags ?? [])],
});

const parseJson = <T,>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

async function resourceRows(db: Database, resourceType: string) {
  await ensureAdministrationSchema(db);
  const result = await db.prepare(
    "SELECT resource_id, data_json, enabled, updated_at FROM admin_resources WHERE resource_type = ? ORDER BY updated_at DESC",
  ).bind(resourceType).all() as {
    results?: Array<{ resource_id: string; data_json: string; enabled: number; updated_at: number }>;
  };
  return result.results ?? [];
}

async function upsertResource(
  db: Database,
  resourceType: string,
  resourceId: string,
  data: unknown,
  enabled: boolean,
  administratorId: string,
) {
  await ensureAdministrationSchema(db);
  await db.prepare(
    "INSERT INTO admin_resources (resource_type, resource_id, data_json, enabled, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(resource_type, resource_id) DO UPDATE SET data_json = excluded.data_json, enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  ).bind(resourceType, resourceId, JSON.stringify(data), enabled ? 1 : 0, administratorId, Date.now()).run();
}

export type AdministratorAiVisibility = { revealAiCards: boolean };
const ADMINISTRATOR_AI_VISIBILITY_RESOURCE = "administrator-ai-visibility";

export async function getAdministratorAiVisibility(
  db: Database,
  administratorId: string,
): Promise<AdministratorAiVisibility> {
  const rows = await resourceRows(db, ADMINISTRATOR_AI_VISIBILITY_RESOURCE);
  const row = rows.find((candidate) => candidate.resource_id === administratorId);
  const value = row
    ? parseJson<{ revealAiCards?: boolean }>(row.data_json, {})
    : {};
  return { revealAiCards: Boolean(row?.enabled && value.revealAiCards) };
}

export async function setAdministratorAiVisibility(
  db: Database,
  administratorId: string,
  revealAiCards: boolean,
): Promise<AdministratorAiVisibility> {
  const value = { revealAiCards: Boolean(revealAiCards) };
  await upsertResource(
    db,
    ADMINISTRATOR_AI_VISIBILITY_RESOURCE,
    administratorId,
    value,
    value.revealAiCards,
    administratorId,
  );
  return value;
}

export async function loadCardOverrides(db: Database): Promise<CardOverrideRecord[]> {
  const rows = await resourceRows(db, "card");
  return rows.flatMap((row: { resource_id: string; data_json: string; enabled: number }) => {
    if (!row.enabled) return [];
    const card = parseJson<Record<string, unknown> | null>(row.data_json, null);
    return card ? [{ catalogId: row.resource_id, card }] : [];
  });
}

export async function applyDatabaseCardOverrides(db: Database) {
  return applyCardOverrides(await loadCardOverrides(db));
}

const forbiddenCardKeys = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "id",
  "catalogId",
  "constructionIdentity",
]);

export function normalizeCardEdit(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Card data must be an object.");
  const candidate = value as Record<string, unknown>;
  const catalogId = String(candidate.catalogId ?? "");
  const original = CARDS.find((card) => card.catalogId === catalogId);
  if (!original) throw new Error("The selected card does not exist.");
  const clean: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(candidate)) {
    if (forbiddenCardKeys.has(key)) continue;
    if (field === undefined || typeof field === "function" || typeof field === "symbol") continue;
    clean[key] = field;
  }
  const merged = {
    ...original,
    ...clean,
    id: original.id,
    catalogId: original.catalogId,
  } as GameCard;
  if (!merged.displayName.trim() || !merged.name.trim()) throw new Error("Card names cannot be empty.");
  if (!["Action", "Flip", "Hero", "Evo", "Character"].includes(merged.type)) throw new Error("Card type is invalid.");
  if (!["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].includes(merged.faction)) throw new Error("Card faction is invalid.");
  if (!Array.isArray(merged.factions) || !merged.factions.length) throw new Error("At least one card faction is required.");
  if (!Array.isArray(merged.mechanics) || !Array.isArray(merged.coreTypes)) throw new Error("Mechanics and BakuCore types must be arrays.");
  return { catalogId, card: clean, merged };
}

export async function saveCardOverride(db: Database, value: unknown, administratorId: string) {
  const normalized = normalizeCardEdit(value);
  await upsertResource(db, "card", normalized.catalogId, normalized.card, true, administratorId);
  applyCardOverrides([{ catalogId: normalized.catalogId, card: normalized.card }]);
  return normalized.merged;
}

export async function resetCardOverride(db: Database, catalogId: string) {
  await ensureAdministrationSchema(db);
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = 'card' AND resource_id = ?")
    .bind(catalogId).run();
}

export async function listManagedPublicDecks(db: Database): Promise<ManagedDeck[]> {
  await ensureAdministrationSchema(db);
  type UserDeckRow = {
    id: string;
    display_name: string;
    data_json: string;
  };

  let entityRows: UserDeckRow[] = [];
  let entitySchemaAvailable = true;
  try {
    const result = await db.prepare(
      "SELECT users.id, users.display_name, user_data_entities.data_json FROM user_data_entities JOIN users ON users.id = user_data_entities.user_id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE user_data_entities.entity_type = 'deck' AND user_data_entities.deleted_at IS NULL AND user_data_entities.data_json IS NOT NULL AND account_bans.user_id IS NULL",
    ).all() as { results?: UserDeckRow[] };
    entityRows = result.results ?? [];
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/no such table:\s*user_data_entities/i.test(error.message)
    ) {
      throw error;
    }
    entitySchemaAvailable = false;
  }

  const legacyResult = await db.prepare(
    `SELECT users.id, users.display_name, user_data.data_json FROM user_data JOIN users ON users.id = user_data.user_id LEFT JOIN account_bans ON account_bans.user_id = users.id WHERE account_bans.user_id IS NULL${entitySchemaAvailable ? " AND NOT EXISTS (SELECT 1 FROM user_data_entities WHERE user_data_entities.user_id = users.id)" : ""}`,
  ).all() as { results?: UserDeckRow[] };

  const managed: ManagedDeck[] = PUBLIC_DECKS.map((deck) => ({
    deck: cloneDeck(deck),
    source: { kind: "builtin" as const },
  }));
  const addUserDeck = (row: UserDeckRow, deck: DeckRecord) => {
    if (deck.visibility !== "Public") return;
    managed.push({
      deck: {
        ...cloneDeck(deck),
        creator: deck.creator ?? row.display_name,
        publishedAt: deck.publishedAt ?? deck.updatedAt,
      },
      source: { kind: "user", userId: row.id },
    });
  };
  for (const row of entityRows) {
    const deck = parseJson<DeckRecord | null>(row.data_json, null);
    if (deck) addUserDeck(row, deck);
  }
  for (const row of legacyResult.results ?? []) {
    const snapshot = parseJson<{ decks?: DeckRecord[] }>(row.data_json, {});
    for (const deck of snapshot.decks ?? []) addUserDeck(row, deck);
  }
  const overrides = await resourceRows(db, "public-deck");
  for (const row of overrides) {
    const value = parseJson<{ deck?: DeckRecord; deleted?: boolean; source?: ManagedDeck["source"] }>(row.data_json, {});
    const index = managed.findIndex((item) => item.deck.id === row.resource_id);
    if (value.deleted) {
      if (index >= 0) managed.splice(index, 1);
      continue;
    }
    if (value.deck) {
      const replacement = { deck: cloneDeck(value.deck), source: value.source ?? { kind: "resource" as const } };
      if (index >= 0) managed[index] = replacement;
      else managed.push(replacement);
    }
  }
  return managed
    .filter((item, index, all) => all.findIndex((candidate) => candidate.deck.id === item.deck.id) === index)
    .sort((left, right) => Date.parse(right.deck.publishedAt ?? right.deck.updatedAt) - Date.parse(left.deck.publishedAt ?? left.deck.updatedAt));
}

export async function listPublicDecks(db: Database) {
  return (await listManagedPublicDecks(db)).map((item) => item.deck);
}

async function writeUserDeck(
  db: Database,
  userId: string,
  deckId: string,
  replacement: DeckRecord | null,
) {
  let entity: { revision: number; data_json: string | null; deleted_at: string | null } | null = null;
  try {
    entity = await db.prepare(
      "SELECT revision, data_json, deleted_at FROM user_data_entities WHERE user_id = ? AND entity_type = 'deck' AND entity_id = ?",
    ).bind(userId, deckId).first() as typeof entity;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/no such table:\s*user_data_entities/i.test(error.message)
    ) {
      throw error;
    }
  }
  if (entity) {
    const now = Date.now();
    await db.prepare(
      "UPDATE user_data_entities SET revision = revision + 1, data_json = ?, deleted_at = ?, updated_at = ? WHERE user_id = ? AND entity_type = 'deck' AND entity_id = ? AND revision = ?",
    ).bind(
      replacement ? JSON.stringify(replacement) : null,
      replacement ? null : new Date(now).toISOString(),
      now,
      userId,
      deckId,
      entity.revision,
    ).run();
    return;
  }

  const row = await db.prepare("SELECT revision, data_json FROM user_data WHERE user_id = ?")
    .bind(userId).first() as { revision: number; data_json: string } | null;
  if (!row) throw new Error("The deck owner no longer has synced data.");
  const snapshot = parseJson<{ decks?: DeckRecord[]; deletedDecks?: Array<{ id: string; deletedAt: string }>; updatedAt?: number }>(row.data_json, {});
  const decks = snapshot.decks ?? [];
  const index = decks.findIndex((deck) => deck.id === deckId);
  if (index < 0) throw new Error("The public deck no longer exists.");
  if (replacement) decks[index] = replacement;
  else decks.splice(index, 1);
  snapshot.decks = decks;
  snapshot.deletedDecks = replacement
    ? (snapshot.deletedDecks ?? []).filter((item) => item.id !== deckId)
    : [...(snapshot.deletedDecks ?? []).filter((item) => item.id !== deckId), { id: deckId, deletedAt: new Date().toISOString() }];
  snapshot.updatedAt = Date.now();
  await db.prepare("UPDATE user_data SET revision = ?, data_json = ?, updated_at = ? WHERE user_id = ?")
    .bind(row.revision + 1, JSON.stringify(snapshot), Date.now(), userId).run();
}

function normalizeDeck(value: unknown, fallbackId?: string): DeckRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Deck data must be an object.");
  const candidate = value as Partial<DeckRecord>;
  const id = fallbackId ?? String(candidate.id ?? "");
  const deck: DeckRecord = {
    id,
    name: String(candidate.name ?? "").trim().slice(0, 80),
    factions: Array.isArray(candidate.factions) ? candidate.factions.map(String) : [],
    bakuganIds: Array.isArray(candidate.bakuganIds) ? candidate.bakuganIds.map(String) : [],
    coreIds: Array.isArray(candidate.coreIds) ? candidate.coreIds.map(String) : [],
    cardIds: Array.isArray(candidate.cardIds) ? candidate.cardIds.map(String) : [],
    updatedAt: new Date().toISOString(),
    visibility: candidate.visibility === "Draft" || candidate.visibility === "Private" ? candidate.visibility : "Public",
    format: candidate.format === "singleton" ? "singleton" : "standard",
    revision: Number.isFinite(candidate.revision) ? Number(candidate.revision) + 1 : 1,
    favourite: Boolean(candidate.favourite),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String).slice(0, 20) : [],
    notes: String(candidate.notes ?? "").slice(0, 2_000),
    leadCardId: candidate.leadCardId ? String(candidate.leadCardId) : undefined,
    creator: candidate.creator ? String(candidate.creator).slice(0, 80) : undefined,
    description: candidate.description ? String(candidate.description).slice(0, 2_000) : undefined,
    publishedAt: candidate.publishedAt ? String(candidate.publishedAt) : new Date().toISOString(),
  };
  const validation = validateDeck(deck);
  if (!validation.isLegal) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
  return deck;
}

export async function listAiDecks(db: Database) {
  const rows = await resourceRows(db, "ai-deck");
  if (!rows.length) {
    return STARTER_DECKS.map((deck) => ({ ...cloneDeck(deck), id: `default-ai:${deck.id}`, enabled: true, managed: false }));
  }
  return rows.map((row) => ({ ...cloneDeck(parseJson<DeckRecord>(row.data_json, STARTER_DECKS[0])), enabled: Boolean(row.enabled), managed: true }));
}

export async function addAiDeck(db: Database, value: unknown, administratorId: string) {
  const deck = normalizeDeck(value, `admin-ai:${crypto.randomUUID()}`);
  await upsertResource(db, "ai-deck", deck.id, deck, true, administratorId);
  return { ...deck, enabled: true, managed: true };
}

export async function updateAiDeck(db: Database, id: string, value: unknown, administratorId: string) {
  const existing = (await listAiDecks(db)).find((deck) => deck.id === id);
  if (!existing) throw new Error("The AI deck no longer exists.");
  const deck = normalizeDeck({ ...existing, ...(value as object) }, id);
  await upsertResource(db, "ai-deck", deck.id, deck, existing.enabled !== false, administratorId);
  return { ...deck, enabled: existing.enabled !== false, managed: true };
}

export async function setAiDeckEnabled(db: Database, id: string, enabled: boolean, administratorId: string) {
  const decks = await listAiDecks(db);
  const target = decks.find((deck) => deck.id === id);
  if (!target) throw new Error("The AI deck no longer exists.");
  if (!enabled && decks.filter((deck) => deck.enabled && deck.id !== id).length === 0) throw new Error("At least one AI deck must remain enabled.");
  await upsertResource(db, "ai-deck", target.id, target, enabled, administratorId);
}

export async function deleteAiDeck(db: Database, id: string, administratorId: string) {
  const decks = await listAiDecks(db);
  const target = decks.find((deck) => deck.id === id);
  if (!target) throw new Error("The AI deck no longer exists.");
  if (decks.filter((deck) => deck.enabled && deck.id !== id).length === 0) throw new Error("At least one AI deck must remain enabled.");
  await upsertResource(db, "ai-deck", target.id, target, false, administratorId);
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = 'ai-deck' AND resource_id = ?")
    .bind(id).run();
}

export async function updatePublicDeck(db: Database, id: string, value: unknown, administratorId: string) {
  const managed = (await listManagedPublicDecks(db)).find((item) => item.deck.id === id);
  if (!managed) throw new Error("The public deck no longer exists.");
  const deck = normalizeDeck({ ...managed.deck, ...(value as object), visibility: "Public" }, id);
  if (managed.source.kind === "user" && managed.source.userId) await writeUserDeck(db, managed.source.userId, id, deck);
  else await upsertResource(db, "public-deck", id, { deck, source: managed.source }, true, administratorId);
  return deck;
}

export async function deletePublicDeck(db: Database, id: string, administratorId: string) {
  const managed = (await listManagedPublicDecks(db)).find((item) => item.deck.id === id);
  if (!managed) throw new Error("The public deck no longer exists.");
  if (managed.source.kind === "user" && managed.source.userId) await writeUserDeck(db, managed.source.userId, id, null);
  else await upsertResource(db, "public-deck", id, { deleted: true, source: managed.source }, false, administratorId);
}
