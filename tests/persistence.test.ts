import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_DECKS } from "../lib/data";
import { mergeSnapshots, normalizeSnapshot, type UserSnapshot } from "../lib/persistence";

const base = (updatedAt: number): UserSnapshot => ({
  schemaVersion: 1,
  updatedAt,
  profile: { name: "DanBrawler", faction: "Pyrus", signedIn: true },
  decks: [STARTER_DECKS[0]],
  history: [],
  settings: { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone" },
  route: "dashboard",
  selectedDeckId: STARTER_DECKS[0].id,
  builderDeck: null,
  deckQuery: "",
  compendiumQuery: "",
  compendiumTab: "cards",
  format: "bo1",
  matchMode: "solo",
  joinCode: "",
  match: null,
  online: false,
  selectedCore: "",
  logFilter: "all",
  replay: null,
  replayIndex: 0,
  playerId: "player-a",
});

test("snapshot normalization rejects invalid routes and preserves safe defaults", () => {
  const fallback = base(100);
  const normalized = normalizeSnapshot({ ...fallback, route: "not-a-route", profile: { name: "", faction: "Unknown", signedIn: 1 } }, fallback);
  assert.equal(normalized.route, "dashboard");
  assert.equal(normalized.profile.name, "DanBrawler");
  assert.equal(normalized.profile.faction, "Pyrus");
  assert.equal(normalized.profile.signedIn, true);
});

test("cloud merge keeps newer UI state while combining unique decks and results", () => {
  const local = base(200);
  local.decks = [STARTER_DECKS[0], { ...STARTER_DECKS[1], id: "local-deck" }];
  local.history = [{ id: "local-result", result: "Victor", opponent: "Mira", score: "1–0", reason: "Damage", at: "2026-07-14T10:00:00.000Z", log: [] }];
  local.route = "builder";

  const cloud = base(100);
  cloud.decks = [{ ...STARTER_DECKS[2], id: "cloud-deck" }];
  cloud.history = [{ id: "cloud-result", result: "Defeat", opponent: "Nova", score: "0–1", reason: "Deck out", at: "2026-07-13T10:00:00.000Z", log: [] }];
  cloud.route = "history";

  const merged = mergeSnapshots(local, cloud);
  assert.equal(merged.route, "builder");
  assert.deepEqual(new Set(merged.decks.map((deck) => deck.id)), new Set([STARTER_DECKS[0].id, "local-deck", "cloud-deck"]));
  assert.deepEqual(new Set(merged.history.map((result) => result.id)), new Set(["local-result", "cloud-result"]));
});
