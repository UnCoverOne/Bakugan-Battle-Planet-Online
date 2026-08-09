import assert from "node:assert/strict";
import test from "node:test";
import { validateDeckConstruction, type DeckValidationCatalogue, type ValidatableDeck } from "../lib/deck-validation";
import { eloTransfer, rankForBp } from "../lib/ranked";
import { STARTER_DECKS, makePlayer, type CanonicalPlayerSelection, type DeckRecord } from "../lib/data";
import { createMatch } from "../lib/game";
import {
  beginRankedIntermission,
  eligibleRankedDecks,
  hideRankedDeckLists,
  initializeRankedLobby,
  joinRankedLobby,
  rankedSeries,
  selectRankedDeck,
  submitRankedBan,
} from "../lib/ranked-lobby";

const characters = new Map([
  ["c1", { id: "c1", faction: "Pyrus", character: { coreTypes: ["Fist", "Shield"] } }],
  ["c2", { id: "c2", faction: "Pyrus", character: { coreTypes: ["Fist", "Helix"] } }],
  ["c3", { id: "c3", faction: "Pyrus", character: { coreTypes: ["Magic Shield", "Flaming Fist"] } }],
]);
const cores = new Map(["Fist", "Shield", "Fist", "Helix", "Magic Shield", "Flaming Fist"].map((type, index) => [`core-${index}`, { id: `core-${index}`, type }]));
const cards = new Map(Array.from({ length: 20 }, (_, index) => [`p${index}`, { catalogId: `p${index}`, name: `Pyrus ${index}`, effect: `Effect ${index}`, constructionIdentity: `pyrus-${index}`, faction: "Pyrus", factions: ["Pyrus"] }]));
const catalogue: DeckValidationCatalogue = { cards, characters, cores };

function competitiveDeck(): ValidatableDeck {
  return { name: "Competitive", format: "competitive", bakuganIds: ["c1", "c2", "c3"], coreIds: [...cores.keys()], cardIds: Array.from({ length: 50 }, (_, index) => `p${index % 20}`) };
}

test("Competitive requires exactly 50 cards and applies construction-identity restrictions", () => {
  const deck = competitiveDeck();
  assert.equal(validateDeckConstruction(deck, catalogue).isLegal, true);
  const restricted = validateDeckConstruction(deck, catalogue, { restrictions: [{ constructionIdentity: "pyrus-0", limit: 1 }] });
  assert.ok(restricted.issues.some((issue) => issue.code === "main_deck.ranked_restriction" && issue.expected === 1));
  deck.cardIds.pop();
  assert.ok(validateDeckConstruction(deck, catalogue).issues.some((issue) => issue.code === "main_deck.exactly_fifty"));
});

test("Ranked Elo is a single zero-sum transfer that accounts for rating difference", () => {
  assert.deepEqual(eloTransfer(1_000, 1_000), { transfer: 12, winnerAfter: 1_012, loserAfter: 988 });
  assert.deepEqual(eloTransfer(1_200, 1_000), { transfer: 6, winnerAfter: 1_206, loserAfter: 994 });
  assert.deepEqual(eloTransfer(1_000, 1_200), { transfer: 18, winnerAfter: 1_018, loserAfter: 1_182 });
});

test("Brawler ranks use 200 BP intervals", () => {
  assert.equal(rankForBp(999), "Bronze");
  assert.equal(rankForBp(1_000), "Silver");
  assert.equal(rankForBp(1_200), "Gold");
  assert.equal(rankForBp(1_400), "Diamond");
  assert.equal(rankForBp(1_600), "Awesome Brawler");
});

function competitiveSavedDeck(source: DeckRecord, id: string, offset = 0): DeckRecord {
  const cardIds = [...source.cardIds];
  const counts = new Map(cardIds.map((cardId) => [cardId, cardIds.filter((candidate) => candidate === cardId).length]));
  const unique = [...new Set(cardIds)];
  for (let step = 0; step < unique.length; step += 1) {
    const cardId = unique[(step + offset) % unique.length];
    while (cardIds.length < 50 && (counts.get(cardId) ?? 0) < 3) {
      cardIds.push(cardId);
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    }
  }
  assert.equal(cardIds.length, 50);
  return { ...source, id, name: `Competitive ${id}`, cardIds, format: "competitive" };
}

function selections(playerId: string, source: DeckRecord): CanonicalPlayerSelection[] {
  return ["a", "b", "c"].map((suffix, index) => ({ playerId, name: playerId, deck: competitiveSavedDeck(source, `${playerId}-${suffix}`, index * 4) }));
}

test("Ranked Conquest hides simultaneous choices and retires only winning decks", () => {
  const ownerSelections = selections("owner", STARTER_DECKS[0]);
  const guestSelections = selections("guest", STARTER_DECKS[1]);
  const owner = makePlayer("owner", "Owner", ownerSelections[0].deck as DeckRecord);
  const guest = makePlayer("guest", "Guest", guestSelections[0].deck as DeckRecord);
  let match = initializeRankedLobby(createMatch("RANK01", "bo3", [owner, guest]), "owner", "account-owner", "Owner", ownerSelections, 4, []);
  match = joinRankedLobby(match, "guest", "account-guest", "Guest", guestSelections, []);

  match = submitRankedBan(match, "owner", "guest-c");
  assert.equal(rankedSeries(hideRankedDeckLists(match, "guest"))?.players.owner.bannedDeckId, undefined);
  assert.equal(rankedSeries(match)?.stage, "ban");
  match = submitRankedBan(match, "guest", "owner-c");
  assert.equal(rankedSeries(match)?.stage, "select");

  match = selectRankedDeck(match, "owner", "owner-a", []);
  assert.equal(rankedSeries(hideRankedDeckLists(match, "guest"))?.players.owner.selectedDeckId, undefined);
  assert.equal(rankedSeries(match)?.stage, "select");
  match = selectRankedDeck(match, "guest", "guest-a", []);
  assert.equal(rankedSeries(match)?.stage, "ready");

  match.phase = "result";
  match.winner = "owner";
  match.series.owner = 1;
  match = beginRankedIntermission(match);
  assert.equal(rankedSeries(match)?.stage, "select");
  assert.deepEqual(eligibleRankedDecks(match, "owner").map((deck) => deck.id), ["owner-b"]);
  assert.deepEqual(eligibleRankedDecks(match, "guest").map((deck) => deck.id).sort(), ["guest-a", "guest-b"]);
});
