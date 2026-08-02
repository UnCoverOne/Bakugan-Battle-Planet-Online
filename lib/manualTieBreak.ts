import {
  cloneMatch,
  completeMatch,
  passPriority,
  totalDamage,
  totalPower,
  type GameCard,
  type MatchState,
} from "./game";
import { ensureRulesState } from "./rules/state";

const TIE_BREAK_DECISION_MS = 120_000;
const RESULT_MS = 120_000;

export type TieBreakReveal = {
  card: GameCard;
  cost: number;
};

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

type TieBreakMatchState = MatchState & {
  rules?: TieBreakRulesState;
};

function rulesFor(state: MatchState) {
  return ensureRulesState(state) as TieBreakRulesState;
}

function playerById(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}

function activeOpenBakugan(state: MatchState, playerId: string) {
  const player = playerById(state, playerId);
  return player?.bakugan.find((bakugan) => (
    bakugan.id === state.selected[playerId] && bakugan.open
  ));
}

function appendLog(
  state: MatchState,
  kind: MatchState["log"][number]["kind"],
  message: string,
) {
  state.log.push({
    id: `${Date.now()}-tie-break-${state.log.length}`,
    at: Date.now(),
    kind,
    message,
  });
}

export function tieBreakCardCost(card: Pick<GameCard, "cost">) {
  return card.cost === "X" ? 0 : card.cost;
}

export function manualTieBreakState(
  input: MatchState | null | undefined,
): ManualTieBreakState | undefined {
  if (!input || input.phase === "result") return undefined;
  const tieBreak = (input as TieBreakMatchState).rules?.tieBreak;
  if (!tieBreak) return undefined;
  return tieBreak.gameNumber === input.gameNumber && tieBreak.turn === input.turn
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
    input
    && playerId
    && player
    && tieBreak?.status === "waiting"
    && input.phase === "power"
    && Object.prototype.hasOwnProperty.call(input.series, playerId)
    && !tieBreak.current[playerId]
    && player.deck > 0,
  );
}

export function shouldStartManualTieBreak(input: MatchState, playerId: string) {
  if (
    input.phase !== "power"
    || input.priority !== playerId
    || input.passes.length !== 1
    || input.batch.length > 0
    || input.pendingChoice
    || input.triggerOrders.some((request) => !request.orderedIds)
    || manualTieBreakState(input)?.status === "waiting"
  ) return false;

  const participants = input.players.filter((player) => activeOpenBakugan(input, player.id));
  if (participants.length !== 2) return false;
  const values = participants.map((player) => (
    input.victorByDamage ? totalDamage(input, player.id) : totalPower(input, player.id)
  ));
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

function resolveEmptyTieBreakDecks(
  state: MatchState,
  tieBreak: ManualTieBreakState,
) {
  const empty = state.players.filter((player) => player.deckCards.length === 0);
  for (const player of state.players) player.deck = player.deckCards.length;
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

export function passPriorityWithTieBreak(input: MatchState, playerId: string) {
  if (!shouldStartManualTieBreak(input, playerId)) return passPriority(input, playerId);

  const state = cloneMatch(input);
  const firstPasserId = state.passes[0];
  const tieBreak: ManualTieBreakState = {
    gameNumber: state.gameNumber,
    turn: state.turn,
    round: 1,
    decidingStat: state.victorByDamage ? "Damage Rating" : "B-Power",
    firstPasserId,
    secondPasserId: playerId,
    current: {},
    status: "waiting",
  };
  rulesFor(state).tieBreak = tieBreak;
  state.priority = "";
  state.passes = [];
  state.stepLabel = `Brawl Phase • ${tieBreak.decidingStat} tie-break • Flip top cards`;
  state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
  state.undoWindow = undefined;
  appendLog(
    state,
    "game",
    `${tieBreak.decidingStat} is tied. Both players must flip the top card of their deck.`,
  );
  resolveEmptyTieBreakDecks(state, tieBreak);
  state.version += 1;
  return state;
}

function restoreAndDeclareVictor(
  state: MatchState,
  tieBreak: ManualTieBreakState,
  winnerId: string,
) {
  const winnerBakugan = activeOpenBakugan(state, winnerId);
  if (!winnerBakugan) throw new Error("The tie-break Victor has no active open Bakugan.");

  tieBreak.status = "resolved";
  tieBreak.winnerId = winnerId;
  tieBreak.resolvedAt = Date.now();
  tieBreak.lastRound = {
    round: tieBreak.round,
    reveals: { ...tieBreak.current },
    tied: false,
  };

  state.phase = "power";
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

  const resolvedTieBreak = rulesFor(resolved).tieBreak;
  if (resolvedTieBreak) {
    resolvedTieBreak.status = "resolved";
    resolvedTieBreak.winnerId = winnerId;
    resolvedTieBreak.resolvedAt = tieBreak.resolvedAt;
    resolvedTieBreak.lastRound = tieBreak.lastRound;
  }
  const winner = playerById(resolved, winnerId)!;
  appendLog(
    resolved,
    "game",
    `${winner.name} won the ${tieBreak.decidingStat} tie-break and was declared Brawl Victor.`,
  );
  return resolved;
}

export function flipTieBreakCard(input: MatchState, playerId: string) {
  const tieBreak = manualTieBreakState(input);
  if (!tieBreak || tieBreak.status !== "waiting" || input.phase !== "power") {
    throw new Error("There is no active tie-break to resolve.");
  }
  if (tieBreak.current[playerId]) throw new Error("You already flipped for this tie-break round.");

  const state = cloneMatch(input);
  const stateTieBreak = manualTieBreakState(state)!;
  const player = playerById(state, playerId);
  if (!player) throw new Error("The tie-break player could not be found.");
  const card = player.deckCards.shift();
  player.deck = player.deckCards.length;
  state.informationEpoch += 1;
  state.undoWindow = undefined;

  if (!card) {
    resolveEmptyTieBreakDecks(state, stateTieBreak);
    state.version += 1;
    return state;
  }

  player.discard.push(card);
  const reveal: TieBreakReveal = { card, cost: tieBreakCardCost(card) };
  stateTieBreak.current[playerId] = reveal;
  appendLog(
    state,
    "random",
    `${player.name} flipped ${card.displayName || card.name} for the ${stateTieBreak.decidingStat} tie-break (${reveal.cost} Energy).`,
  );

  const reveals = state.players
    .map((candidate) => stateTieBreak.current[candidate.id])
    .filter((candidate): candidate is TieBreakReveal => Boolean(candidate));
  if (reveals.length < state.players.length) {
    state.stepLabel = `Brawl Phase • ${stateTieBreak.decidingStat} tie-break • Waiting for opponent`;
    state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
    state.version += 1;
    return state;
  }

  const [first, second] = state.players.map((candidate) => stateTieBreak.current[candidate.id]);
  if (first.cost === second.cost) {
    stateTieBreak.lastRound = {
      round: stateTieBreak.round,
      reveals: { ...stateTieBreak.current },
      tied: true,
    };
    appendLog(
      state,
      "game",
      `Tie-break round ${stateTieBreak.round} tied at ${first.cost} Energy. Both players flip again.`,
    );
    stateTieBreak.round += 1;
    stateTieBreak.current = {};
    state.stepLabel = `Brawl Phase • ${stateTieBreak.decidingStat} tie-break • Round ${stateTieBreak.round}`;
    state.deadline = Date.now() + TIE_BREAK_DECISION_MS;
    resolveEmptyTieBreakDecks(state, stateTieBreak);
    state.version += 1;
    return state;
  }

  const winner = first.cost > second.cost ? state.players[0] : state.players[1];
  return restoreAndDeclareVictor(state, stateTieBreak, winner.id);
}
