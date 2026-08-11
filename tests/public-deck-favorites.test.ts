import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("public deck favorites are account-backed one-per-user social metadata", async () => {
  const [account, favorites, publicApi] = await Promise.all([
    read("lib/account-server.ts"),
    read("lib/public-deck-favorites-server.ts"),
    read("app/api/public-decks/route.ts"),
  ]);
  assert.match(account, /CREATE TABLE IF NOT EXISTS public_deck_favorites/);
  assert.match(account, /PRIMARY KEY \(user_id, deck_id\)/);
  assert.match(account, /ON DELETE CASCADE/);
  assert.match(favorites, /INSERT OR IGNORE INTO public_deck_favorites/);
  assert.match(favorites, /DELETE FROM public_deck_favorites WHERE user_id = \? AND deck_id = \?/);
  assert.match(favorites, /COUNT\(\*\) AS favorite_count/);
  assert.match(favorites, /listManagedPublicDecks/);
  assert.match(publicApi, /favorites,/);
  assert.match(publicApi, /getSessionUser\(request\)/);
  assert.match(publicApi, /action !== "favorite" && action !== "unfavorite"/);
  assert.match(publicApi, /assertSameOrigin\(request\)/);
  assert.match(publicApi, /enforceD1RateLimit/);
});

test("public deck UI supports optimistic Favorite state, ranking and personal filtering only online", async () => {
  const route = await read("components/routes/DeckRoutes.tsx");
  assert.match(route, /Most Favorited/);
  assert.match(route, /My Favorites/);
  assert.match(route, /viewerHasFavorited/);
  assert.match(route, /favoriteCount/);
  assert.match(route, /aria-pressed=\{favorite\.viewerHasFavorited\}/);
  assert.match(route, /catalogue\.status === "online"/);
  assert.match(route, /rememberAccountIntent\("favorite-deck"/);
  assert.match(route, /action: nextFavorited \? "favorite" : "unfavorite"/);
  assert.ok(route.includes('setState({ status: "offline", decks, favorites: {} })'));
});

test("favorite intent resumes after sign-in and permanent deck deletion cleans social rows", async () => {
  const [intent, prompt, guest, administration, sync] = await Promise.all([
    read("lib/account-intent.ts"),
    read("components/application/AccountAccessModal.tsx"),
    read("components/application/GuestExperienceController.tsx"),
    read("lib/administration-server.ts"),
    read("lib/account-data-server.ts"),
  ]);
  assert.match(intent, /\| "favorite-deck"/);
  assert.match(prompt, /Account required to favorite/);
  assert.match(guest, /intent\.reason === "favorite-deck"/);
  assert.match(guest, /action: "favorite"/);
  assert.match(guest, /bbp-public-deck-favorites-updated/);
  assert.match(administration, /DELETE FROM public_deck_favorites WHERE deck_id = \?/);
  assert.match(sync, /deletedDeckIds/);
  assert.match(sync, /DELETE FROM public_deck_favorites WHERE deck_id = \?/);
});
