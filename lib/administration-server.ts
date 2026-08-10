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
    constructionIdentity: original.constructionIdentity,
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

  if (entity?.data_json && !entity.deleted_at) {
    const now = Date.now();
    const result = replacement
      ? await db.prepare(
        "UPDATE user_data_entities SET revision = revision + 1, data_json = ?, deleted_at = NULL, updated_at = ? WHERE user_id = ? AND entity_type = 'deck' AND entity_id = ? AND revision = ?",
      ).bind(JSON.stringify(replacement), now, userId, deckId, entity.revision).run()
      : await db.prepare(
        "UPDATE user_data_entities SET revision = revision + 1, data_json = NULL, deleted_at = ?, updated_at = ? WHERE user_id = ? AND entity_type = 'deck' AND entity_id = ? AND revision = ?",
      ).bind(new Date(now).toISOString(), now, userId, deckId, entity.revision).run();
    if (!result.meta?.changes) throw new Error("The public deck changed. Reload and try again.");
    return;
  }

  const row = await db.prepare("SELECT revision, data_json FROM user_data WHERE user_id = ?")
    .bind(userId).first() as { revision: number; data_json: string } | null;
  if (!row) throw new Error("The deck owner's account data no longer exists.");
  const snapshot = parseJson<Record<string, unknown>>(row.data_json, {});
  const decks = Array.isArray(snapshot.decks) ? snapshot.decks as DeckRecord[] : [];
  if (!decks.some((deck) => deck.id === deckId)) throw new Error("The public deck no longer exists.");
  snapshot.decks = replacement
    ? [replacement, ...decks.filter((deck) => deck.id !== deckId)]
    : decks.filter((deck) => deck.id !== deckId);
  snapshot.updatedAt = Date.now();
  await db.prepare("UPDATE user_data SET revision = ?, data_json = ?, updated_at = ? WHERE user_id = ?")
    .bind(row.revision + 1, JSON.stringify(snapshot), Date.now(), userId).run();
}

export async function updatePublicDeck(db: Database, deckId: string, value: unknown, administratorId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Deck data must be an object.");
  const current = (await listManagedPublicDecks(db)).find((item) => item.deck.id === deckId);
  if (!current) throw new Error("The public deck no longer exists.");
  const deck = { ...cloneDeck(value as DeckRecord), id: deckId, visibility: "Public" as const, updatedAt: new Date().toISOString() };
  const validation = validateDeck(deck);
  if (!validation.isLegal) throw new Error(`Public deck [${validation.issues[0].code}]: ${validation.issues[0].message}`);
  if (current.source.kind === "user" && current.source.userId) {
    await writeUserDeck(db, current.source.userId, deckId, deck);
  } else {
    await upsertResource(db, "public-deck", deckId, { deck, source: current.source }, true, administratorId);
  }
  return deck;
}

export async function deletePublicDeck(db: Database, deckId: string, administratorId: string) {
  const current = (await listManagedPublicDecks(db)).find((item) => item.deck.id === deckId);
  if (!current) throw new Error("The public deck no longer exists.");
  if (current.source.kind === "user" && current.source.userId) {
    await writeUserDeck(db, current.source.userId, deckId, null);
  }
  await upsertResource(db, "public-deck", deckId, { deleted: true, source: current.source }, false, administratorId);
}

const DEFAULT_AI_RESOURCE = "default-ai-aquos";

export async function listAiDecks(db: Database) {
  const rows = await resourceRows(db, "ai-deck");
  const decks = rows.flatMap((row) => {
    const value = parseJson<{ deck?: DeckRecord; deleted?: boolean }>(row.data_json, {});
    if (value.deleted || !value.deck) return [];
    return [{ id: row.resource_id, deck: cloneDeck(value.deck), enabled: Boolean(row.enabled), updatedAt: row.updated_at }];
  });
  if (!rows.some((row) => row.resource_id === DEFAULT_AI_RESOURCE)) {
    decks.unshift({ id: DEFAULT_AI_RESOURCE, deck: { ...cloneDeck(STARTER_DECKS[1]), id: DEFAULT_AI_RESOURCE, name: "Mira Nova Training Deck" }, enabled: true, updatedAt: 0 });
  }
  return decks;
}

export type SelectedAiDeck = {
  resourceId: string;
  configurationRevision: number;
  deck: DeckRecord;
};

export async function selectEnabledLegalAiDeck(db: Database): Promise<SelectedAiDeck | null> {
  await applyDatabaseCardOverrides(db);
  const candidates = (await listAiDecks(db)).filter((item) => (
    item.enabled && validateDeck(item.deck).isLegal
  ));
  if (!candidates.length) return null;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const selected = candidates[bytes[0] % candidates.length];
  return {
    resourceId: selected.id,
    configurationRevision: selected.updatedAt,
    deck: cloneDeck(selected.deck),
  };
}

export async function addAiDeck(db: Database, value: unknown, administratorId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Deck data must be an object.");
  const source = cloneDeck(value as DeckRecord);
  const validation = validateDeck(source);
  if (!validation.isLegal) throw new Error(`AI decks must be valid: ${validation.issues[0].message}`);
  const id = `ai-${crypto.randomUUID()}`;
  const deck = { ...source, id, visibility: "Private" as const, updatedAt: new Date().toISOString() };
  await upsertResource(db, "ai-deck", id, { deck }, true, administratorId);
  return { id, deck, enabled: true, updatedAt: Date.now() };
}

export async function updateAiDeck(db: Database, resourceId: string, value: unknown, administratorId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Deck data must be an object.");
  const deck = { ...cloneDeck(value as DeckRecord), id: resourceId, visibility: "Private" as const, updatedAt: new Date().toISOString() };
  const validation = validateDeck(deck);
  if (!validation.isLegal) throw new Error(`AI decks must be valid: ${validation.issues[0].message}`);
  const current = (await listAiDecks(db)).find((item) => item.id === resourceId);
  if (!current) throw new Error("The AI deck no longer exists.");
  await upsertResource(db, "ai-deck", resourceId, { deck }, current.enabled, administratorId);
  return { ...current, deck, updatedAt: Date.now() };
}

export async function setAiDeckEnabled(db: Database, resourceId: string, enabled: boolean, administratorId: string) {
  await applyDatabaseCardOverrides(db);
  const current = (await listAiDecks(db)).find((item) => item.id === resourceId);
  if (!current) throw new Error("The AI deck no longer exists.");
  if (enabled && !validateDeck(current.deck).isLegal) {
    throw new Error("The AI deck is no longer legal under the current card catalogue.");
  }
  if (!enabled) {
    const remaining = (await listAiDecks(db)).filter((item) => (
      item.id !== resourceId && item.enabled && validateDeck(item.deck).isLegal
    ));
    if (current.enabled && validateDeck(current.deck).isLegal && !remaining.length) {
      throw new Error("At least one enabled legal AI deck must remain available.");
    }
  }
  await upsertResource(db, "ai-deck", resourceId, { deck: current.deck }, enabled, administratorId);
}

export async function deleteAiDeck(db: Database, resourceId: string, administratorId: string) {
  await applyDatabaseCardOverrides(db);
  const current = (await listAiDecks(db)).find((item) => item.id === resourceId);
  if (!current) throw new Error("The AI deck no longer exists.");
  const remaining = (await listAiDecks(db)).filter((item) => (
    item.id !== resourceId && item.enabled && validateDeck(item.deck).isLegal
  ));
  if (current.enabled && validateDeck(current.deck).isLegal && !remaining.length) {
    throw new Error("At least one enabled legal AI deck must remain available.");
  }
  if (resourceId === DEFAULT_AI_RESOURCE) {
    await upsertResource(db, "ai-deck", resourceId, { deleted: true }, false, administratorId);
    return;
  }
  await db.prepare("DELETE FROM admin_resources WHERE resource_type = 'ai-deck' AND resource_id = ?")
    .bind(resourceId).run();
}

export async function randomAiDeck(db: Database) {
  return (await selectEnabledLegalAiDeck(db))?.deck ?? null;
}
