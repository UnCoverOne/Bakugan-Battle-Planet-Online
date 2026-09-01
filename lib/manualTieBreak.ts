import {
  cloneMatch,
  completeMatch,
  passPriority,
  resolveImmediateRuleObjects,
  totalDamage,
  totalPower,
  type GameCard,
  type MatchState,
} from "./game";
import { ensureRulesState } from "./rules/state";
import { emitRuleEvent } from "./rules/triggers";

const TIE_BREAK_DECISION_MS = 120_000;
const RESULT_MS = 120_000;
export const TIE_BREAK_PRESENTATION_MS = 2_600;

export type TieBreakReveal = { card: GameCard; cost: number };
export type TieBreakRound = {
  round: number;
  reveals: Record<string, TieBreakReveal>;
  tied: boolean;
};
export type ManualTieBreakState = {
  gameNumber: number;
  turn: number;
  round: number;
  decidingStat: "B-Power" | "Damage Rating";
  firstPasserId: string;
  secondPasserId: string;
  current: Record<string, TieBreakReveal>;
  lastRound?: TieBreakRound;
  status: "waiting" | "resolved";
  winnerId?: string;
  resolvedAt?: number;
};

type TieBreakRulesState = ReturnType<typeof ensureRulesState> & {
  tieBreak?: ManualTieBreakState;
};
type TieBreakMatchState = MatchState & { rules?: TieBreakRulesState };

const rulesFor = (state: MatchState) => ensureRulesState(state) as TieBreakRulesState;
const playerById = (state: MatchState, playerId: string) =>
  state.players.find((player) => player.id === playerId);
const activeOpenBakugan = (state: MatchState, playerId: string) =>
  playerById(state, playerId)?.bakugan.find((bakugan) => (
    bakugan.id === state.selected[playerId] && bakugan.open
  ));
const appendLog = (
  state: MatchState,
  kind: MatchState["log"][number]["kind"],
  message: string,
) => state.log.push({
  id: `${Date.now()}-tie-break-${state.log.length}`,
  at: Date.now(),
  kind,
  message,
});

export const tieBreakCardCost = (card: Pick<GameCard, "cost">) =>
  card.cost === "X" ? 0 : card.cost;

export function manualTieBreakState(input: MatchState | null | undefined) {
  if (!input || input.phase !== "power") return undefined;
  const tieBreak = (input as TieBreakMatchState).rules?.tieBreak;
  return tieBreak?.gameNumber === input.gameNumber && tieBreak.turn === input.turn
    ? tieBreak
    : undefined;
}

export function playerCanFlipTieBreak(
  input: MatchState | null | undefined,
  playerId: string | undefined,
) {
  const tieBreak = manualTieBreakState(input);
  const player = input && playerId ? playerById(input, playerId) : undefined;
  return Boolean(
    input && playerId && player
    && tieBreak?.status === "waiting"
    && !tieBreak.current[playerId]
    && !input.pendingChoice
    && player.deck > 0,
  );
}

export function shouldStartManualTieBreak(input: MatchState, playerId: string) {
  if (
    input.phase !== "power"
    || input.priority !== playerId
    || input.passes.length !== 1
    || input.batch.length
    || input.pendingChoice
    || input.triggerOrders.some((request) => !request.orderedIds)
    || manualTieBreakState(input)?.status === "waiting"
  ) return false;
  const participants = input.players.filter((player) => activeOpenBakugan(input, player.id));
  if (participants.length !== 2) return false;
  const values = participants.map((player) => input.victorByDamage
    ? totalDamage(input, player.id)
    : totalPower(input, player.id));
  return values[0] === values[1];
}

function completeTieBreakDraw(state: MatchState, reason: string) {
  state.phase = "result";
  state.stepLabel = "Game complete";
  state.winner = "";
  state.resultReason = reason;
  state.deadline = Date.now() + RESULT_MS;
  state.priority = "";
  state.passes = [];
  state.batch = [];
  state.triggerOrders = [];
  state.pendingChoice = undefined;
  state.pendingReroll = undefined;
  state.pendingEffectDamageResume = undefined;
  state.pendingRerollOpenEvent = undefined;
  state.revealedFlip = undefined;
  state.undoWindow = undefined;
  appendLog(state, "system", `Game ${state.gameNumber} ended in a draw: ${reason}.`);
}

function resolveEmptyTieBreakDecks(state: MatchState, tieBreak: ManualTieBreakState) {
  const empty = state.players.filter((player) => player.deckCards.length === 0);
  state.players.forEach((player) => { player.deck = player.deckCards.length; });
  if (!empty.length) return false;
  delete rulesFor(state).tieBreak;
  if (empty.length === state.players.length) {
    completeTieBreakDraw(state, "Simultaneous empty-deck tie-break");
    return true;
  }
  const loser = empty[0];
  const winner = state.players.find((player) => player.id !== loser.id);
  if (!winner) {
    completeTieBreakDraw(state, "Unresolvable empty-deck tie-break");
    return true;
  }
  appendLog(state, "game", `${loser.name} could not flip a tie-break card.`);
  completeMatch(state, winner.id, `${tieBreak.decidingStat} tie-break deck-out`);
  return true;
}

function finalizeResolvedTieBreak(input: MatchState) {
  const state = cloneMatch(input);
  const tieBreak = manualTieBreakState(state);
  if (!tieBreak?.winnerId || tieBreak.status !== "resolved") {
    throw new Error("The tie-break result is not ready to advance.");
  }
  const winnerBakugan = activeOpenBakugan(state, tieBreak.winnerId);
  if (!winnerBakugan) throw new Error("The tie-break Victor has no active open Bakugan.");

  state.priority = tieBreak.secondPasserId;
  state.passes = [tieBreak.firstPasserId];
  state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
  const boosts = state.victorByDamage ? state.damageBoost : state.powerBoost;
  const previousBoost = boosts[winnerBakugan.id] ?? 0;
  boosts[winnerBakugan.id] = previousBoost + 1;
  const resolved = passPriority(state, tieBreak.secondPasserId);
  const resolvedBoosts = state.victorByDamage ? resolved.damageBoost : resolved.powerBoost;
  if (previousBoost) resolvedBoosts[winnerBakugan.id] = previousBoost;
  else delete resolvedBoosts[winnerBakugan.id];

  const persisted = rulesFor(resolved).tieBreak;
  if (persisted) Object.assign(persisted, {
    status: "resolved",
    winnerId: tieBreak.winnerId,
    resolvedAt: tieBreak.resolvedAt,
    lastRound: tieBreak.lastRound,
  });
  appendLog(
    resolved,
    "game",
    `${playerById(resolved, tieBreak.winnerId)?.name ?? "A player"} won the ${tieBreak.decidingStat} tie-break and was declared Brawl Victor.`,
  );
  return resolved;
}

export function passPriorityWithTieBreak(input: MatchState, playerId: string) {
  const tieBreak = manualTieBreakState(input);
  if (tieBreak?.status === "resolved") return finalizeResolvedTieBreak(input);
  if (!shouldStartManualTieBreak(input, playerId)) return passPriority(input, playerId);

  const state = cloneMatch(input);
  const nextTieBreak: ManualTieBreakState = {
    gameNumber: state.gameNumber,
    turn: state.turn,
    round: 1,
    decidingStat: state.victorByDamage ? "Damage Rating" : "B-Power",
    firstPasserId: state.passes[0],
    secondPasserId: playerId,
    current: {},
    status: "waiting",
  };
  rulesFor(state).tieBreak = nextTieBreak;
  state.priority = "";
  state.passes = [];
  state.stepLabel = `Brawl Phase • ${nextTieBreak.decidingStat} tie-break • Flip top cards`;
  state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
  state.undoWindow = undefined;
  appendLog(state, "game", `${nextTieBreak.decidingStat} is tied. Both players must flip the top card of their deck.`);
  resolveEmptyTieBreakDecks(state, nextTieBreak);
  state.version += 1;
  return state;
}

function holdTieBreakWinner(
  state: MatchState,
  tieBreak: ManualTieBreakState,
  winnerId: string,
) {
  tieBreak.status = "resolved";
  tieBreak.winnerId = winnerId;
  tieBreak.resolvedAt = Date.now();
  tieBreak.lastRound = {
    round: tieBreak.round,
    reveals: { ...tieBreak.current },
    tied: false,
  };
  state.priority = "";
  state.passes = [];
  state.stepLabel = `Brawl Phase • ${tieBreak.decidingStat} tie-break • Higher cost revealed`;
  state.deadline = tieBreak.resolvedAt + TIE_BREAK_PRESENTATION_MS;
  state.undoWindow = undefined;
  appendLog(
    state,
    "game",
    `${playerById(state, winnerId)?.name ?? "A player"} revealed the higher Energy cost in the ${tieBreak.decidingStat} tie-break.`,
  );
  state.version += 1;
  return state;
}

export function flipTieBreakCard(input: MatchState, playerId: string) {
  const tieBreak = manualTieBreakState(input);
  if (tieBreak?.status === "resolved") return finalizeResolvedTieBreak(input);
  if (!tieBreak || tieBreak.status !== "waiting") {
    throw new Error("There is no active tie-break to resolve.");
  }
  if (input.pendingChoice) throw new Error("Complete the pending deck-flip choice before flipping again.");
  if (tieBreak.current[playerId]) throw new Error("You already flipped for this tie-break round.");

  const state = cloneMatch(input);
  const liveTieBreak = manualTieBreakState(state)!;
  const player = playerById(state, playerId);
  if (!player) throw new Error("The tie-break player could not be found.");
  const card = player.deckCards.shift();
  player.deck = player.deckCards.length;
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  if (!card) {
    resolveEmptyTieBreakDecks(state, liveTieBreak);
    state.version += 1;
    return state;
  }

  player.discard.push(card);
  const reveal = { card, cost: tieBreakCardCost(card) };
  liveTieBreak.current[playerId] = reveal;
  appendLog(state, "random", `${player.name} flipped ${card.displayName || card.name} for the ${liveTieBreak.decidingStat} tie-break (${reveal.cost} Energy).`);
  const deckFlipTriggers = emitRuleEvent(state, {
    id: `${state.turn}:deck-flip:tiebreak:${playerId}:${card.id}:${state.informationEpoch}`,
    name: "CARD_FLIPPED_FROM_DECK",
    actorId: playerId,
    controllerId: playerId,
    card,
    cardType: card.type,
    createdAt: Date.now(),
  });
  resolveImmediateRuleObjects(state, deckFlipTriggers);

  const reveals = state.players.map((candidate) => liveTieBreak.current[candidate.id]);
  if (reveals.some((candidate) => !candidate)) {
    state.stepLabel = `Brawl Phase • ${liveTieBreak.decidingStat} tie-break • Waiting for opponent`;
    state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
    state.version += 1;
    return state;
  }

  const [first, second] = reveals as TieBreakReveal[];
  if (first.cost === second.cost) {
    liveTieBreak.lastRound = {
      round: liveTieBreak.round,
      reveals: { ...liveTieBreak.current },
      tied: true,
    };
    appendLog(state, "game", `Tie-break round ${liveTieBreak.round} tied at ${first.cost} Energy. Both players flip again.`);
    liveTieBreak.round += 1;
    liveTieBreak.current = {};
    state.stepLabel = `Brawl Phase • ${liveTieBreak.decidingStat} tie-break • Round ${liveTieBreak.round}`;
    state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
    resolveEmptyTieBreakDecks(state, liveTieBreak);
    state.version += 1;
    return state;
  }

  const winner = first.cost > second.cost ? state.players[0] : state.players[1];
  return holdTieBreakWinner(state, liveTieBreak, winner.id);
}
