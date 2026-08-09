import {
  canonicalDeckRecord,
  makeCanonicalPlayerWithRestrictions,
  type CanonicalPlayerSelection,
  type DeckRecord,
} from "./data";
import type { DeckRestriction } from "./deck-validation";
import { cloneMatch, startNextSeriesGame, type MatchState, type PlayerState } from "./game";
import { applyLobbyConfig, tagLobbyPlayerDeck } from "./lobby-config";
import type { RankedSettlement } from "./ranked";

export type RankedStage = "deck-lock" | "ban" | "select" | "ready" | "playing" | "complete";

export type RankedDeckSnapshot = DeckRecord & {
  submittedAt: number;
};

export type RankedPlayerSeries = {
  userId: string;
  displayName: string;
  decks: RankedDeckSnapshot[];
  bannedDeckId?: string;
  selectedDeckId?: string;
  wonDeckIds: string[];
};

export type RankedSeriesState = {
  rulesetVersion: number;
  restrictions: DeckRestriction[];
  stage: RankedStage;
  players: Record<string, RankedPlayerSeries>;
  currentDeckIds: Record<string, string>;
  settlement?: RankedSettlement;
};

export type RankedMatchState = MatchState & { ranked?: RankedSeriesState };

export function rankedSeries(state: MatchState) {
  return (state as RankedMatchState).ranked;
}

function cleanSubmission(selection: CanonicalPlayerSelection, restrictions: readonly DeckRestriction[]) {
  makeCanonicalPlayerWithRestrictions(selection, restrictions);
  const deck = canonicalDeckRecord(selection);
  if (deck.format !== "competitive") throw new Error("Ranked requires Competitive decks.");
  return { ...deck, submittedAt: Date.now() } satisfies RankedDeckSnapshot;
}

function validateThreeDecks(selections: CanonicalPlayerSelection[], restrictions: readonly DeckRestriction[]) {
  if (selections.length !== 3) throw new Error("Select exactly three Competitive decks.");
  if (new Set(selections.map((selection) => selection.deck.id)).size !== 3) {
    throw new Error("Select three different saved decks.");
  }
  const fingerprints = selections.map((selection) => [
    [...selection.deck.bakuganIds].sort().join(","),
    [...selection.deck.coreIds].sort().join(","),
    [...selection.deck.cardIds].sort().join(","),
  ].join("|"));
  if (new Set(fingerprints).size !== 3) throw new Error("Select three different deck lists, not duplicate copies of one deck.");
  return selections.map((selection) => cleanSubmission(selection, restrictions));
}

export function initializeRankedLobby(
  input: MatchState,
  playerId: string,
  userId: string,
  displayName: string,
  selections: CanonicalPlayerSelection[],
  rulesetVersion: number,
  restrictions: readonly DeckRestriction[],
) {
  const state = cloneMatch(input) as RankedMatchState;
  applyLobbyConfig(state, { mode: "ranked", rulesFormat: "competitive", meta: "battle-brawlers" });
  state.format = "bo3";
  state.ranked = {
    rulesetVersion,
    restrictions: restrictions.map((restriction) => ({ ...restriction })),
    stage: "deck-lock",
    players: {
      [playerId]: { userId, displayName, decks: validateThreeDecks(selections, restrictions), wonDeckIds: [] },
    },
    currentDeckIds: {},
  };
  return state;
}

export function joinRankedLobby(
  input: MatchState,
  playerId: string,
  userId: string,
  displayName: string,
  selections: CanonicalPlayerSelection[],
  restrictions: readonly DeckRestriction[],
) {
  const state = cloneMatch(input) as RankedMatchState;
  const ranked = state.ranked;
  if (!ranked) throw new Error("This is not a Ranked lobby.");
  if (Object.values(ranked.players).some((player) => player.userId === userId)) throw new Error("An account cannot occupy both Ranked seats.");
  ranked.players[playerId] = { userId, displayName, decks: validateThreeDecks(selections, restrictions), wonDeckIds: [] };
  ranked.stage = "ban";
  return state;
}

export function rankedAccountId(state: MatchState, playerId: string) {
  return rankedSeries(state)?.players[playerId]?.userId ?? "";
}

export function submitRankedBan(input: MatchState, playerId: string, opponentDeckId: string) {
  const state = cloneMatch(input) as RankedMatchState;
  const ranked = state.ranked;
  if (!ranked || ranked.stage !== "ban") throw new Error("Deck bans are not available now.");
  const actor = ranked.players[playerId];
  if (!actor) throw new Error("Unknown Ranked player.");
  const opponent = Object.entries(ranked.players).find(([id]) => id !== playerId)?.[1];
  if (!opponent?.decks.some((deck) => deck.id === opponentDeckId)) throw new Error("Choose one of the opponent's submitted decks.");
  if (actor.bannedDeckId) throw new Error("Your deck ban is already locked.");
  actor.bannedDeckId = opponentDeckId;
  if (Object.values(ranked.players).length === 2 && Object.values(ranked.players).every((player) => player.bannedDeckId)) ranked.stage = "select";
  state.version += 1;
  return state;
}

function opponentBan(ranked: RankedSeriesState, playerId: string) {
  return Object.entries(ranked.players).find(([id]) => id !== playerId)?.[1].bannedDeckId;
}

export function eligibleRankedDecks(state: MatchState, playerId: string) {
  const ranked = rankedSeries(state);
  const player = ranked?.players[playerId];
  if (!ranked || !player) return [];
  const banned = opponentBan(ranked, playerId);
  return player.decks.filter((deck) => deck.id !== banned && !player.wonDeckIds.includes(deck.id));
}

function replaceRankedPlayer(state: RankedMatchState, playerId: string, deck: RankedDeckSnapshot, restrictions: readonly DeckRestriction[]) {
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index < 0) throw new Error("Unknown Ranked seat.");
  const previous = state.players[index];
  const replacement = tagLobbyPlayerDeck(makeCanonicalPlayerWithRestrictions({
    playerId,
    name: previous.name,
    deck,
  }, restrictions), deck);
  replacement.connected = previous.connected;
  replacement.lastSeen = previous.lastSeen;
  replacement.ready = false;
  state.players[index] = replacement;
}

export function selectRankedDeck(
  input: MatchState,
  playerId: string,
  deckId: string,
  restrictions: readonly DeckRestriction[],
) {
  const state = cloneMatch(input) as RankedMatchState;
  const ranked = state.ranked;
  if (!ranked || ranked.stage !== "select") throw new Error("Round deck selection is not available now.");
  const player = ranked.players[playerId];
  const deck = eligibleRankedDecks(state, playerId).find((candidate) => candidate.id === deckId);
  if (!player || !deck) throw new Error("Choose an unbanned deck that has not already won.");
  if (player.selectedDeckId) throw new Error("Your round deck is already locked.");
  player.selectedDeckId = deckId;
  state.version += 1;
  if (Object.values(ranked.players).length !== 2 || !Object.values(ranked.players).every((candidate) => candidate.selectedDeckId)) return state;

  for (const [seatId, seriesPlayer] of Object.entries(ranked.players)) {
    const selected = seriesPlayer.decks.find((candidate) => candidate.id === seriesPlayer.selectedDeckId)!;
    replaceRankedPlayer(state, seatId, selected, restrictions);
    ranked.currentDeckIds[seatId] = selected.id;
  }
  if (state.gameNumber > 1 || (state.gameNumber === 1 && state.series && Object.values(state.series).some((wins) => wins > 0))) {
    ranked.stage = "playing";
    return startNextSeriesGame(state) as RankedMatchState;
  }
  ranked.stage = "ready";
  return state;
}

export function beginRankedIntermission(input: MatchState) {
  const state = cloneMatch(input) as RankedMatchState;
  const ranked = state.ranked;
  if (!ranked || state.phase !== "result") throw new Error("The Ranked round is not complete.");
  const needed = 2;
  if (Math.max(...Object.values(state.series)) >= needed) {
    ranked.stage = "complete";
    return state;
  }
  const winningPlayerId = state.winner;
  const winningDeckId = winningPlayerId ? ranked.currentDeckIds[winningPlayerId] : undefined;
  const winner = winningPlayerId ? ranked.players[winningPlayerId] : undefined;
  if (winningDeckId && winner && !winner.wonDeckIds.includes(winningDeckId)) winner.wonDeckIds.push(winningDeckId);
  for (const player of Object.values(ranked.players)) delete player.selectedDeckId;
  ranked.stage = "select";
  state.version += 1;
  return state;
}

export function hideRankedDeckLists(input: MatchState, viewerPlayerId: string) {
  const state = cloneMatch(input) as RankedMatchState;
  const ranked = state.ranked;
  if (!ranked) return state;
  for (const [playerId, player] of Object.entries(ranked.players)) {
    if (playerId === viewerPlayerId) continue;
    player.decks = player.decks.map((deck) => ({ ...deck, cardIds: [] }));
    if (ranked.stage === "ban") delete player.bannedDeckId;
    if (ranked.stage === "select") delete player.selectedDeckId;
  }
  return state;
}

export function rankedSeriesScore(state: MatchState) {
  return state.players.map((player) => state.series[player.id] ?? 0).join("–");
}
