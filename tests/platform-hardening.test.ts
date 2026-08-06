import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { constructionIdentityForCard } from "../lib/content/construction-identity";
import { validateDeckConstruction, type DeckValidationCatalogue } from "../lib/deck-validation";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { applyEnergyEntryVisibility } from "../lib/energyVisibility";
import {
  ENGINE_METADATA_KEY,
  canonicalJson,
  initializeMatch,
  projectEventStreamsForPlayer,
  projectMatchForPlayer,
  reduceMatch,
  type CommandEnvelope,
  type EngineBackedMatchState,
  type GameEvent,
} from "../lib/engine";
import { isInternalMatchRequest, markInternalMatchRequest, stripInternalMatchHeaders } from "../lib/internal-request";
import { MATCH_RECONNECT_GRACE_MS } from "../lib/match-constants";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from "../lib/server-errors";

const source = (path: string) => readFileSync(path, "utf8");

test("printed typo variants share a construction identity", () => {
  const effect = "Your Bakugan gets +500 B.";
  assert.equal(
    constructionIdentityForCard({ displayName: "Might of Cyndeous", effect }),
    constructionIdentityForCard({ displayName: "Might of Cyndeus", effect }),
  );
});

test("deck copy limits use construction identity instead of catalogue ID", () => {
  const cards = new Map<string, {
    catalogId: string;
    displayName: string;
    effect: string;
    constructionIdentity: string;
    faction: string;
    factions: string[];
  }>();
  const shared = constructionIdentityForCard({ displayName: "Might of Cyndeus", effect: "Shared function." });
  cards.set("typo-a", { catalogId: "typo-a", displayName: "Might of Cyndeous", effect: "Shared function.", constructionIdentity: shared, faction: "Pyrus", factions: ["Pyrus"] });
  cards.set("typo-b", { catalogId: "typo-b", displayName: "Might of Cyndeus", effect: "Shared function.", constructionIdentity: shared, faction: "Pyrus", factions: ["Pyrus"] });
  for (let index = 0; index < 36; index += 1) {
    const id = `unique-${index}`;
    cards.set(id, { catalogId: id, displayName: id, effect: id, constructionIdentity: id, faction: "Pyrus", factions: ["Pyrus"] });
  }
  const characters = new Map([
    ["c1", { id: "c1", faction: "Pyrus", character: { coreTypes: ["Fist", "Shield"] } }],
    ["c2", { id: "c2", faction: "Pyrus", character: { coreTypes: ["Fist", "Helix"] } }],
    ["c3", { id: "c3", faction: "Pyrus", character: { coreTypes: ["Magic Shield", "Flaming Fist"] } }],
  ]);
  const cores = new Map([
    ["k1", { id: "k1", type: "Fist" }], ["k2", { id: "k2", type: "Shield" }],
    ["k3", { id: "k3", type: "Fist" }], ["k4", { id: "k4", type: "Helix" }],
    ["k5", { id: "k5", type: "Magic Shield" }], ["k6", { id: "k6", type: "Flaming Fist" }],
  ]);
  const catalogue: DeckValidationCatalogue = { cards, characters, cores };
  const result = validateDeckConstruction({
    name: "Identity test",
    bakuganIds: ["c1", "c2", "c3"],
    coreIds: ["k1", "k2", "k3", "k4", "k5", "k6"],
    cardIds: ["typo-a", "typo-b", "typo-a", "typo-b", ...Array.from({ length: 36 }, (_, index) => `unique-${index}`)],
  }, catalogue);
  assert.ok(result.issues.some((issue) => issue.code === "main_deck.copy_limit"));
});

test("best-of-three reset reconstructs the exact immutable original deck", () => {
  const p1 = makePlayer("p1", "P1", STARTER_DECKS[0]);
  const p2 = makePlayer("p2", "P2", STARTER_DECKS[1]);
  const initialized = initializeMatch("SERIES", "bo3", [p1, p2], {
    commandId: "series-create",
    actorId: "p1",
    issuedAt: 1_800_000_000_000,
    randomSeed: "series-seed",
    requestHash: "series-request",
  }).state;
  const state = structuredClone(initialized) as EngineBackedMatchState;
  state.phase = "result";
  state.winner = "p1";
  state.series.p1 = 1;
  const player = state.players[0];
  const moved = player.deckCards.shift()!;
  player.deck = player.deckCards.length;
  player.bakugan[0].evoStack.push(moved);
  const manifest = state[ENGINE_METADATA_KEY]!.originalDeckManifests!.p1;
  const envelope: CommandEnvelope = {
    commandId: "series-next-game",
    gameId: state.id,
    actorId: "p1",
    expectedVersion: state.version,
    issuedAt: 1_800_000_001_000,
    randomSeed: "series-next-seed",
    requestHash: canonicalJson({ type: "START_NEXT_SERIES_GAME" }),
    command: { type: "START_NEXT_SERIES_GAME" },
  };
  const next = reduceMatch(state, envelope).state;
  const rebuilt = next.players.find((candidate) => candidate.id === "p1")!;
  const allCards = [
    ...rebuilt.deckCards,
    ...rebuilt.hand,
    ...rebuilt.discard,
    ...rebuilt.energyZone,
    ...rebuilt.heroes,
    ...rebuilt.bakugan.flatMap((bakugan) => bakugan.evoStack),
  ];
  assert.equal(allCards.length, 40);
  assert.deepEqual(allCards.map((card) => card.catalogId).sort(), [...manifest.cardCatalogIds].sort());
  assert.ok(rebuilt.bakugan.every((bakugan) => bakugan.evoStack.length === 0));
});

test("Energy identities are visible only during an explicit deck reveal window", () => {
  const p1 = makePlayer("p1", "P1", STARTER_DECKS[0]);
  const p2 = makePlayer("p2", "P2", STARTER_DECKS[1]);
  const state = initializeMatch("ENERGY", "bo1", [p1, p2], {
    commandId: "energy-create",
    actorId: "p1",
    issuedAt: 1_000,
    randomSeed: "energy-seed",
    requestHash: "energy-request",
  }).state;
  const card = state.players[0].deckCards.shift()!;
  applyEnergyEntryVisibility([card], "deck", 1_000);
  state.players[0].energyZone.push(card);
  const visible = projectMatchForPlayer(state, "p1", 2_000).players[0].energyZone[0];
  const hidden = projectMatchForPlayer(state, "p1", 7_000).players[0].energyZone[0];
  const opponentView = projectMatchForPlayer(state, "p2", 2_000).players[0].energyZone[0];
  assert.equal(visible.catalogId, card.catalogId);
  assert.equal(hidden.catalogId, "hidden");
  assert.equal(opponentView.catalogId, "hidden");
});

test("client event streams never retain a moved Energy card identity", () => {
  const event: GameEvent = {
    gameId: "g",
    commandId: "c",
    sequence: 1,
    type: "CARD_MOVED",
    actorId: "p1",
    visibility: "controller",
    visibleTo: "p1",
    payload: { cardId: "secret", cardName: "Secret Card", cardType: "Action", ownerId: "p1", from: "deck", to: "energy" },
    engineVersion: "e",
    rulesVersion: "r",
    cardCatalogueVersion: "c",
    digitalAdaptationVersion: "d",
    contentSchemaVersion: 1,
    createdAt: 1,
  };
  const projected = projectEventStreamsForPlayer([event], "p1").privateEvents[0];
  assert.equal(projected.payload.cardName, "Face-down Energy card");
  assert.equal("cardType" in projected.payload, false);
});

test("public coordinator headers cannot authenticate an internal request", () => {
  const forged = new Request("https://example.test/api/game", {
    headers: { "x-match-coordinator": "durable-object", "x-bbp-internal-match-coordinator": "forged" },
  });
  assert.equal(isInternalMatchRequest(forged), false);
  const headers = new Headers();
  markInternalMatchRequest(headers, "https://example.test/api/game");
  assert.equal(isInternalMatchRequest(new Request("https://example.test/api/game", { headers })), true);
  stripInternalMatchHeaders(headers);
  assert.equal(isInternalMatchRequest(new Request("https://example.test/api/game", { headers })), false);
});

test("typed server errors retain the required status mapping", () => {
  assert.equal(new ValidationError("x").status, 400);
  assert.equal(new AuthenticationError().status, 401);
  assert.equal(new AuthorizationError().status, 403);
  assert.equal(new ConflictError("x").status, 409);
  assert.equal(new RateLimitError(3).status, 429);
  assert.equal(new ServiceUnavailableError().status, 503);
});

test("multiplayer reconnect policy is two minutes everywhere", () => {
  assert.equal(MATCH_RECONNECT_GRACE_MS, 120_000);
  assert.match(source("lib/data.ts"), /MATCH_RECONNECT_GRACE_SECONDS \/ 60/);
  assert.match(source("worker/index.ts"), /MATCH_RECONNECT_GRACE_MS/);
});

test("platform routes use shared and authenticated infrastructure", () => {
  const game = source("app/api/game/route.ts");
  const worker = source("worker/index.ts");
  const store = source("components/game-screen-v2/matchStore.ts");
  assert.match(game, /isInternalMatchRequest\(request\)/);
  assert.doesNotMatch(game, /x-match-coordinator/);
  assert.match(game, /commandResultVersion: receipt\.resultVersion/);
  assert.match(game, /seat: \{ playerId: player\.id/);
  assert.match(worker, /socket\.send/);
  assert.match(worker, /match_socket_publish_failed/);
  assert.doesNotMatch(worker, /x-match-coordinator/);
  assert.match(store, /intentionalClose/);
  assert.match(store, /transportGeneration/);
  assert.match(store, /AbortController/);
  assert.match(store, /scheduleReconnect/);
  assert.match(store, /document\.hidden \? 12_000 : 2_500/);
  assert.match(source("app/api/user-data/route.ts"), /syncAccountData/);
  assert.match(source("app/api/admin/route.ts"), /resetAccountData/);
  assert.doesNotMatch(source("lib/account-server.ts"), /BOOTSTRAP_ADMIN_EMAIL/);
  assert.match(source("lib/account-server.ts"), /BOOTSTRAP_ADMIN_USER_ID/);
});
