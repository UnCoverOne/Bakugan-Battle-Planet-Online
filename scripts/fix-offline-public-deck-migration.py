from pathlib import Path

path = Path("scripts/apply-offline-public-deck-architecture.py")
text = path.read_text(encoding="utf-8")
marker = "# 9) Regression coverage locks the separation and cache semantics in place."
if marker not in text:
    raise SystemExit("migration regression marker not found")
head = text.split(marker, 1)[0]
tail = r'''# 9) Regression coverage locks the separation and cache semantics in place.
replace_exact(
    'tests/administration.test.ts',
    '''import { requireTrainingAiDeckSelection } from "../lib/training-ai-deck-selection";''',
    '''import { requireTrainingAiDeckSelection } from "../lib/training-ai-deck-selection";
import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../lib/public-deck-cache";'''
)
replace_exact(
    'tests/administration.test.ts',
    r'''  assert.match(decks, /action: adminPublicId \? "public-update" : "ai-update"/);''',
    r'''  assert.match(decks, /action: adminPublicId \? "public-update" : adminOfflineId \? "offline-update" : "ai-update"/);'''
)
replace_exact(
    'tests/administration.test.ts',
    r'''  assert.match(decks, /return \[\.\.\.remote, \.\.\.fallback\]/);''',
    r'''  assert.doesNotMatch(decks, /return \[\.\.\.remote, \.\.\.fallback\]/);
  assert.match(decks, /status: "online", decks: result\.decks/);
  assert.match(decks, /status: "offline"/);
  assert.match(decks, /BUNDLED_OFFLINE_PUBLIC_DECKS/);'''
)
replace_exact(
    'tests/administration.test.ts',
    r'''  assert.match(decks, /\}, \[fallback\]\);/);''',
    r'''  assert.doesNotMatch(decks, /\}, \[fallback\]\);/);'''
)
replace_exact(
    'tests/administration.test.ts',
    r'''  assert.match(builderPage, /decodedId\.startsWith\("admin-"\)/);
});''',
    r'''  assert.match(builderPage, /decodedId\.startsWith\("admin-"\)/);
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
});'''
)
replace_exact(
    'tests/deck-experience.test.ts',
    r'''  assert.match(route, /\(saveVisibility === "Public" \|\| adminAiId\) && !latest\.isLegal/);''',
    r'''  assert.match(route, /\(saveVisibility === "Public" \|\| adminAiId \|\| adminOfflineId\) && !latest\.isLegal/);'''
)

for path, needle in [
    ('components/routes/DeckRoutes.tsx', 'return [...remote, ...fallback]'),
    ('components/routes/DeckRoutes.tsx', 'usePublicDeckCatalogue(decks, profile.name)'),
    ('lib/administration-server.ts', 'PUBLIC_DECKS.map'),
]:
    ensure_absent(path, needle)

print('Offline public deck architecture patch applied successfully.')
'''
path.write_text(head + tail, encoding="utf-8")
print("Migration regression patching fixed.")
