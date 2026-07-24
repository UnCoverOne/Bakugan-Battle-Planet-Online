import assert from "node:assert/strict";
import test from "node:test";
import { STARTER_DECKS } from "../lib/data";
import {
  DECK_CODE_PREFIX,
  decodeDeckCode,
  encodeDeckCode,
  uniqueDeckName,
} from "../lib/deck-transfer";
import {
  mergeSnapshots,
  normalizeSnapshot,
  type UserSnapshot,
} from "../lib/persistence";

const snapshot = (updatedAt: number): UserSnapshot => ({
  schemaVersion: 1,
  updatedAt,
  profile: { name: "Brawler", faction: "Pyrus", signedIn: true },
  decks: [],
  history: [],
  settings: {
    reducedMotion: false,
    highContrast: false,
    sound: true,
    cardScale: 100,
    logDetail: "All events",
    challenges: "Everyone",
    replayLinks: true,
  },
  route: "dashboard",
  selectedDeckId: "",
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
  playerId: "player",
});

test("versioned deck share codes round-trip a complete legal deck", () => {
  const source = STARTER_DECKS[0];
  const code = encodeDeckCode(source);
  assert.ok(code.startsWith(DECK_CODE_PREFIX));
  const decoded = decodeDeckCode(code, () => "imported");
  assert.equal(decoded.id, "imported");
  assert.equal(decoded.name, source.name);
  assert.deepEqual(decoded.bakuganIds, source.bakuganIds);
  assert.deepEqual(decoded.coreIds, source.coreIds);
  assert.deepEqual(decoded.cardIds, source.cardIds);
});

test("deck imports reject damaged or unsupported payloads with useful errors", () => {
  assert.throws(() => decodeDeckCode("not-a-code", () => "x"), /version prefix/i);
  assert.throws(() => decodeDeckCode(`${DECK_CODE_PREFIX}damaged`, () => "x"), /damaged or incomplete/i);
});

test("duplicate deck names receive a stable disambiguator", () => {
  assert.equal(uniqueDeckName("Pyrus Fury", [{ name: "Pyrus Fury" }]), "Pyrus Fury (2)");
  assert.equal(
    uniqueDeckName("Pyrus Fury", [{ name: "Pyrus Fury" }, { name: "Pyrus Fury (2)" }]),
    "Pyrus Fury (3)",
  );
});

test("snapshot normalization enforces the 50-deck ceiling and safe routes", () => {
  const fallback = snapshot(1);
  const candidate = {
    ...fallback,
    route: "invented-route",
    decks: Array.from({ length: 60 }, (_, index) => ({
      ...STARTER_DECKS[0],
      id: `deck-${index}`,
      name: `Deck ${index}`,
      updatedAt: "not-a-time",
    })),
  };
  const normalized = normalizeSnapshot(candidate, fallback);
  assert.equal(normalized.decks.length, 50);
  assert.equal(normalized.route, "dashboard");
  assert.equal(normalized.decks[0].updatedAt, new Date(0).toISOString());
});

test("same-ID concurrent deck changes preserve a private conflict copy", () => {
  const local = snapshot(200);
  const cloud = snapshot(100);
  local.decks = [{ ...STARTER_DECKS[0], id: "shared", name: "Local edit", updatedAt: "2026-07-24T10:00:00.000Z" }];
  cloud.decks = [{ ...STARTER_DECKS[0], id: "shared", name: "Cloud edit", updatedAt: "2026-07-24T09:00:00.000Z" }];
  const merged = mergeSnapshots(local, cloud);
  assert.equal(merged.decks.find((deck) => deck.id === "shared")?.name, "Local edit");
  const conflict = merged.decks.find((deck) => deck.conflictOf === "shared");
  assert.equal(conflict?.name, "Cloud edit (conflict copy)");
  assert.equal(conflict?.visibility, "Private");
});
