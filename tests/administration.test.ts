import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requireTrainingAiDeckSelection } from "../lib/training-ai-deck-selection";
import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../lib/public-deck-cache";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("administrator identity and authorization are server owned", async () => {
  const [accounts, auth, adminApi, page] = await Promise.all([
    read("lib/account-server.ts"),
    read("app/api/auth/route.ts"),
    read("app/api/admin/route.ts"),
    read("app/(workspace)/admin/page.tsx"),
  ]);
  assert.match(accounts, /BOOTSTRAP_ADMIN_USER_ID/);
  assert.doesNotMatch(accounts, /BOOTSTRAP_ADMIN_EMAIL|uncover250@gmail\.com/);
  assert.match(accounts, /user\.id === bootstrapAdministratorId/);
  assert.match(accounts, /requireAdministrator/);
  assert.match(accounts, /account_roles/);
  assert.match(accounts, /account_bans/);
  assert.match(auth, /This account has been banned/);
  assert.match(adminApi, /await requireAdministrator\(request\)/);
  assert.match(page, /roles\.includes\("administrator"\)/);
  assert.match(page, /redirect\("\/"\)/);
});

test("profile menu exposes Administrator only for administrator roles", async () => {
  const [shell, provider] = await Promise.all([
    read("components/application/AppShell.jsx"),
    read("components/application/AppProvider.jsx"),
  ]);
  assert.match(shell, /authUser\?\.roles\?\.includes\("administrator"\)/);
  assert.match(shell, /href="\/admin"/);
  assert.match(shell, />\s*Administrator\s*</);
  assert.match(provider, /first === "admin"/);
  assert.match(provider, /admin: "\/admin"/);
});

test("administrator menu includes AI, Card, and User Management", async () => {
  const [screen, css] = await Promise.all([
    read("components/routes/AdminScreen.tsx"),
    read("components/routes/AdminScreen.module.css"),
  ]);
  for (const contract of [
    "AI Management",
    "Deck Management",
    "Card Management",
    "User Management",
    "Open in Deck Editor",
    "Add Deck",
    "Reset data",
    "Delete Account",
  ]) assert.match(screen, new RegExp(contract));
  assert.match(screen, /Search users/);
  assert.match(screen, /Most decks/);
  assert.match(screen, /Banned/);
  assert.match(css, /@media\(max-width:700px\)/);
});

test("AI deck registry controls Training AI selection", async () => {
  const [server, endpoint, provider, screen] = await Promise.all([
    read("lib/administration-server.ts"),
    read("app/api/ai-decks/route.ts"),
    read("components/application/AppProvider.jsx"),
    read("components/routes/AdminScreen.tsx"),
  ]);
  assert.match(server, /listAiDecks/);
  assert.match(server, /setAiDeckEnabled/);
  assert.match(server, /randomAiDeck/);
  assert.match(endpoint, /selectEnabledLegalAiDeck/);
  assert.match(provider, /fetch\("\/api\/ai-decks"/);
  assert.match(provider, /requireTrainingAiDeckSelection/);
  assert.doesNotMatch(provider, /let aiDeck = data\.STARTER_DECKS/);
  assert.match(screen, /action: "ai-toggle"/);
  assert.match(screen, /action: "ai-delete"/);
  assert.match(screen, /admin-ai:/);
  assert.match(server, /At least one enabled legal AI deck must remain available/);
  assert.match(server, /return \(await selectEnabledLegalAiDeck\(db\)\)\?\.deck \?\? null/);
  assert.doesNotMatch(server, /if \(!candidates\.length\) return cloneDeck\(STARTER_DECKS\[1\]\)/);
  assert.match(endpoint, /resourceId/);
  assert.match(endpoint, /configurationRevision/);
});

test("Training AI selection rejects empty, malformed, and illegal responses", () => {
  const legal = { id: "legal" };
  const isLegal = (deck: { id: string }) => deck.id === legal.id;
  assert.throws(() => requireTrainingAiDeckSelection(null, isLegal), /invalid response/i);
  assert.throws(() => requireTrainingAiDeckSelection({ deck: legal }, isLegal), /invalid deck/i);
  assert.throws(() => requireTrainingAiDeckSelection({
    deck: { id: "illegal" },
    resourceId: "disabled-resource",
    configurationRevision: 1,
  }, isLegal), /invalid deck/i);
  assert.deepEqual(requireTrainingAiDeckSelection({
    deck: legal,
    resourceId: "enabled-resource",
    configurationRevision: 42,
  }, isLegal), {
    deck: legal,
    resourceId: "enabled-resource",
    configurationRevision: 42,
  });
});

test("card edits are persisted as overrides and applied to client and authoritative matches", async () => {
  const [server, data, publicApi, provider, game] = await Promise.all([
    read("lib/administration-server.ts"),
    read("lib/data.ts"),
    read("app/api/card-overrides/route.ts"),
    read("components/application/AppProvider.jsx"),
    read("app/api/game/route.ts"),
  ]);
  assert.match(server, /normalizeCardEdit/);
  assert.match(server, /upsertResource\(db, "card"/);
  assert.match(data, /applyCardOverrides/);
  assert.match(data, /constructionIdentity/);
  assert.match(publicApi, /loadCardOverrides/);
  assert.match(provider, /bbp-card-overrides-updated/);
  assert.match(game, /applyDatabaseCardOverrides/);
});

test("user management supports roles, entity-backed scoped resets, bans, and deletion", async () => {
  const [api, accountData] = await Promise.all([
    read("app/api/admin/route.ts"),
    read("lib/account-data-server.ts"),
  ]);
  for (const action of [
    "set-role",
    "reset-user-data",
    "ban-user",
    "unban-user",
    "delete-user",
  ]) assert.match(api, new RegExp(`action === "${action}"`));
  for (const scope of ["decks", "history", "settings", "profile", "all"]) {
    assert.match(api, new RegExp(`"${scope}"`));
  }
  assert.match(api, /bootstrap administrator account is protected/i);
  assert.match(api, /await resetAccountData/);
  assert.match(api, /await deleteAccountData/);
  assert.match(accountData, /DELETE FROM user_data_entities/);
  assert.match(accountData, /DELETE FROM user_match_history/);
  assert.match(api, /DELETE FROM sessions WHERE user_id/);
});

test("administrators can edit and delete any public deck from its View screen", async () => {
  const [decks, publicApi, server, builderPage] = await Promise.all([
    read("components/routes/DeckRoutes.tsx"),
    read("app/api/public-decks/route.ts"),
    read("lib/administration-server.ts"),
    read("app/(workspace)/builder/[id]/page.tsx"),
  ]);
  assert.match(decks, /Edit as Administrator/);
  assert.match(decks, /Delete Deck/);
  assert.match(decks, /admin-public:/);
  assert.match(decks, /action: adminPublicId \? "public-update" : adminOfflineId \? "offline-update" : "ai-update"/);
  assert.match(publicApi, /listPublicDecks/);
  assert.match(server, /deletePublicDeck/);
  assert.match(server, /updatePublicDeck/);
  assert.match(server, /FROM user_data_entities/);
  assert.match(server, /entity_type = 'deck'/);
  assert.match(server, /NOT EXISTS \(SELECT 1 FROM user_data_entities/);
  assert.match(server, /UPDATE user_data_entities SET revision = revision \+ 1/);
  assert.doesNotMatch(decks, /return \[\.\.\.remote, \.\.\.fallback\]/);
  assert.match(decks, /status: "online", decks: result\.decks/);
  assert.match(decks, /status: "offline"/);
  assert.match(decks, /BUNDLED_OFFLINE_PUBLIC_DECKS/);
  assert.doesNotMatch(decks, /\}, \[fallback\]\);/);
  assert.match(builderPage, /decodedId\.startsWith\("admin-"\)/);
});

test("offline public deck slots are administrator managed and excluded from the online catalogue", async () => {
  const [server, endpoint, adminApi, screen, data, sync] = await Promise.all([
    read("lib/administration-server.ts"),
    read("app/api/public-decks/route.ts"),
    read("app/api/admin/route.ts"),
    read("components/routes/AdminScreen.tsx"),
    read("lib/data.ts"),
    read("components/application/PublicDeckFallbackSync.tsx"),
  ]);
  assert.match(data, /BUNDLED_OFFLINE_PUBLIC_DECKS/);
  assert.match(data, /OFFLINE_PUBLIC_DECK_SLOT_IDS/);
  assert.doesNotMatch(server, /const managed: ManagedDeck\[\] = PUBLIC_DECKS/);
  assert.match(server, /const managed: ManagedDeck\[\] = \[\]/);
  assert.match(server, /OFFLINE_PUBLIC_DECK_RESOURCE_TYPE = "offline-public-deck"/);
  assert.match(server, /listOfflinePublicDeckSlots/);
  assert.match(server, /updateOfflinePublicDeckSlot/);
  assert.match(server, /clearOfflinePublicDeckSlot/);
  assert.match(endpoint, /offlineFallbackDecks/);
  assert.match(endpoint, /offlineFallbackRevision/);
  assert.match(adminApi, /section === "offline-decks"/);
  assert.match(adminApi, /action === "offline-update"/);
  assert.match(adminApi, /action === "offline-clear"/);
  assert.match(adminApi, /action === "offline-reset"/);
  assert.match(screen, /Fallback Deck Slots/);
  assert.match(screen, /admin-offline:/);
  assert.match(sync, /OFFLINE_PUBLIC_DECKS_UPDATED_EVENT/);
});

test("offline public deck cache preserves an intentionally empty managed snapshot", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readOfflinePublicDeckCache(storage), null);
  writeOfflinePublicDeckCache(storage, [], 17);
  assert.deepEqual(readOfflinePublicDeckCache(storage), []);
});
