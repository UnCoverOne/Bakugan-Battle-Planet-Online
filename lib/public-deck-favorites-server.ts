import { ensureAdministrationSchema, type AccountDatabase } from "./account-server";
import { listManagedPublicDecks } from "./administration-server";

export type PublicDeckFavoriteMetadata = {
  favoriteCount: number;
  viewerHasFavorited: boolean;
};

export type PublicDeckFavoriteMap = Record<string, PublicDeckFavoriteMetadata>;

export async function listPublicDeckFavoriteMetadata(
  db: AccountDatabase,
  deckIds: readonly string[],
  viewerUserId?: string,
): Promise<PublicDeckFavoriteMap> {
  await ensureAdministrationSchema(db);
  const uniqueIds = [...new Set(deckIds.filter(Boolean))];
  if (!uniqueIds.length) return {};
  const allowed = new Set(uniqueIds);
  const counts = await db.prepare(
    "SELECT deck_id, COUNT(*) AS favorite_count FROM public_deck_favorites GROUP BY deck_id",
  ).all() as { results?: Array<{ deck_id: string; favorite_count: number }> };
  const countByDeck = new Map(
    (counts.results ?? [])
      .filter((row) => allowed.has(row.deck_id))
      .map((row) => [row.deck_id, Math.max(0, Number(row.favorite_count) || 0)]),
  );
  const viewerFavorites = new Set<string>();
  if (viewerUserId) {
    const result = await db.prepare(
      "SELECT deck_id FROM public_deck_favorites WHERE user_id = ?",
    ).bind(viewerUserId).all() as { results?: Array<{ deck_id: string }> };
    for (const row of result.results ?? []) {
      if (allowed.has(row.deck_id)) viewerFavorites.add(row.deck_id);
    }
  }
  return Object.fromEntries(uniqueIds.map((deckId) => [deckId, {
    favoriteCount: countByDeck.get(deckId) ?? 0,
    viewerHasFavorited: viewerFavorites.has(deckId),
  }]));
}

export async function setPublicDeckFavorite(
  db: AccountDatabase,
  userId: string,
  deckId: string,
  favorite: boolean,
) {
  const normalizedId = deckId.trim();
  if (!normalizedId) throw new Error("Public deck ID is required.");
  const exists = (await listManagedPublicDecks(db)).some((item) => item.deck.id === normalizedId);
  if (!exists) throw new Error("The public deck no longer exists.");
  await ensureAdministrationSchema(db);
  if (favorite) {
    await db.prepare(
      "INSERT OR IGNORE INTO public_deck_favorites (user_id, deck_id, created_at) VALUES (?, ?, ?)",
    ).bind(userId, normalizedId, Date.now()).run();
  } else {
    await db.prepare(
      "DELETE FROM public_deck_favorites WHERE user_id = ? AND deck_id = ?",
    ).bind(userId, normalizedId).run();
  }
  const count = await db.prepare(
    "SELECT COUNT(*) AS favorite_count FROM public_deck_favorites WHERE deck_id = ?",
  ).bind(normalizedId).first<{ favorite_count: number }>();
  const viewer = await db.prepare(
    "SELECT 1 AS present FROM public_deck_favorites WHERE user_id = ? AND deck_id = ?",
  ).bind(userId, normalizedId).first<{ present: number }>();
  return {
    deckId: normalizedId,
    favoriteCount: Math.max(0, Number(count?.favorite_count) || 0),
    viewerHasFavorited: Boolean(viewer?.present),
  };
}
