import assert from "node:assert/strict";
import test from "node:test";
import { mergeSnapshots, selectSnapshot, toCloudSnapshot, type UserSnapshot } from "../lib/persistence";

const deck = (id: string, name: string, updatedAt: string) => ({
  id,
  name,
  factions: ["Pyrus"],
  bakuganIds: ["bakugan-1", "bakugan-2", "bakugan-3"],
  coreIds: ["core-1", "core-2", "core-3", "core-4", "core-5", "core-6"],
  cardIds: Array.from({ length: 40 }, (_, index) => `card-${index + 1}`),
  updatedAt,
  visibility: "Private" as const,
  format: "standard" as const,
  revision: 1,
  favourite: false,
  tags: [],
  notes: "",
});

const snapshot = (overrides: Partial<UserSnapshot> = {}): UserSnapshot => ({
  schemaVersion: 1,
  updatedAt: 100,
  profile: { name: "Local Brawler", faction: "Pyrus", signedIn: true },
  decks: [deck("local-deck", "Local Deck", "2026-01-01T00:00:00.000Z")],
  deletedDecks: [],
  history: [],
  settings: { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone" },
  route: "match",
  selectedDeckId: "local-deck",
  builderDeck: null,
  deckQuery: "dragonoid",
  compendiumQuery: "fury",
  compendiumTab: "rulings",
  format: "bo1",
  matchMode: "solo",
  joinCode: "ABC123",
  match: { id: "local-match", version: 7 } as UserSnapshot["match"],
  online: true,
  selectedCore: "core-1",
  logFilter: "gameplay",
  replay: { id: "replay-1", result: "Victor", opponent: "Mira", score: "1–0", reason: "Cards", at: "2026-01-01T00:00:00.000Z", log: [] },
  replayIndex: 12,
  playerId: "device-player",
  ...overrides,
});

test("cloud snapshots contain durable account data but no device session state", () => {
  const local = snapshot();
  const cloud = toCloudSnapshot(local);

  assert.equal(cloud.profile.name, local.profile.name);
  assert.equal(cloud.profile.signedIn, false);
  assert.deepEqual(cloud.decks, local.decks);
  assert.equal(cloud.selectedDeckId, local.selectedDeckId);
  assert.equal(cloud.route, "dashboard");
  assert.equal(cloud.deckQuery, "");
  assert.equal(cloud.compendiumQuery, "");
  assert.equal(cloud.joinCode, "");
  assert.equal(cloud.match, null);
  assert.equal(cloud.online, false);
  assert.equal(cloud.replay, null);
  assert.equal(cloud.replayIndex, 0);
  assert.equal(cloud.playerId, "");
});

test("cloud restore updates durable data without replacing the current device session", () => {
  const local = snapshot();
  const cloud = snapshot({
    updatedAt: 200,
    profile: { name: "Cloud Brawler", faction: "Aquos", signedIn: false },
    decks: [deck("cloud-deck", "Cloud Deck", "2026-02-01T00:00:00.000Z")],
    selectedDeckId: "cloud-deck",
    settings: { ...local.settings, highContrast: true },
    route: "dashboard",
    deckQuery: "remote-query",
    joinCode: "REMOTE",
    match: null,
    online: false,
    replay: null,
    replayIndex: 0,
    playerId: "remote-player",
  });

  const restored = selectSnapshot(local, cloud, "cloud");

  assert.equal(restored.profile.name, "Cloud Brawler");
  assert.equal(restored.profile.signedIn, true);
  assert.equal(restored.selectedDeckId, "cloud-deck");
  assert.equal(restored.settings.highContrast, true);
  assert.equal(restored.route, local.route);
  assert.equal(restored.deckQuery, local.deckQuery);
  assert.equal(restored.joinCode, local.joinCode);
  assert.equal(restored.match, local.match);
  assert.equal(restored.online, local.online);
  assert.equal(restored.replay, local.replay);
  assert.equal(restored.replayIndex, local.replayIndex);
  assert.equal(restored.playerId, local.playerId);
});

test("automatic merge uses the newer durable snapshot and retains local session state", () => {
  const local = snapshot({ updatedAt: 100 });
  const cloud = snapshot({
    updatedAt: 200,
    profile: { name: "Cloud Brawler", faction: "Ventus", signedIn: false },
    decks: [deck("cloud-deck", "Cloud Deck", "2026-02-01T00:00:00.000Z")],
    selectedDeckId: "cloud-deck",
    route: "settings",
    deckQuery: "cloud search",
    playerId: "cloud-device",
  });

  const merged = mergeSnapshots(local, cloud);

  assert.equal(merged.profile.name, "Cloud Brawler");
  assert.equal(merged.selectedDeckId, "cloud-deck");
  assert.equal(merged.decks.some((candidate) => candidate.id === "cloud-deck"), true);
  assert.equal(merged.decks.some((candidate) => candidate.id === "local-deck"), true);
  assert.equal(merged.route, local.route);
  assert.equal(merged.deckQuery, local.deckQuery);
  assert.equal(merged.playerId, local.playerId);
  assert.equal(merged.match, local.match);
});


test("same-ID deck edits choose the newest revision without manufacturing conflict copies", () => {
  const local = snapshot({
    updatedAt: 200,
    decks: [deck("shared", "Newest", "2026-03-02T00:00:00.000Z")],
  });
  const cloud = snapshot({
    updatedAt: 100,
    decks: [deck("shared", "Older", "2026-03-01T00:00:00.000Z")],
  });

  const merged = mergeSnapshots(local, cloud);

  assert.deepEqual(merged.decks.map((candidate) => candidate.id), ["shared"]);
  assert.equal(merged.decks[0].name, "Newest");
  assert.equal(merged.decks.some((candidate) => candidate.name.includes("conflict copy")), false);
});

test("a deck deletion tombstone prevents an older device copy from being restored", () => {
  const deletedAt = "2026-03-02T00:00:00.000Z";
  const local = snapshot({
    updatedAt: Date.parse(deletedAt),
    decks: [],
    deletedDecks: [{ id: "shared", deletedAt }],
  });
  const cloud = snapshot({
    updatedAt: 100,
    decks: [deck("shared", "Stale copy", "2026-03-01T00:00:00.000Z")],
  });

  const merged = mergeSnapshots(local, cloud);

  assert.equal(merged.decks.some((candidate) => candidate.id === "shared"), false);
  assert.deepEqual(merged.deletedDecks, [{ id: "shared", deletedAt }]);
});

test("an intentional recreation newer than a deletion removes the tombstone", () => {
  const local = snapshot({
    updatedAt: 300,
    decks: [deck("shared", "Recreated", "2026-03-03T00:00:00.000Z")],
  });
  const cloud = snapshot({
    updatedAt: 200,
    decks: [],
    deletedDecks: [{ id: "shared", deletedAt: "2026-03-02T00:00:00.000Z" }],
  });

  const merged = mergeSnapshots(local, cloud);

  assert.equal(merged.decks[0].name, "Recreated");
  assert.deepEqual(merged.deletedDecks, []);
});

test("cloud selection does not union stale browser decks into a resumed account session", () => {
  const local = snapshot({ decks: [deck("stale-local", "Stale", "2026-03-01T00:00:00.000Z")] });
  const cloud = snapshot({
    updatedAt: 200,
    decks: [deck("cloud-only", "Cloud", "2026-03-02T00:00:00.000Z")],
  });

  const restored = selectSnapshot(local, cloud, "cloud");

  assert.deepEqual(restored.decks.map((candidate) => candidate.id), ["cloud-only"]);
  assert.equal(restored.route, local.route);
  assert.equal(restored.playerId, local.playerId);
});
