import {
  cloneMatch,
  emitGameEvent,
  resolveStructuredEffect,
  splitWhenPlayedEffect,
  type CardChoices,
  type GameCard,
  type MatchState,
  type PendingEffect,
} from "./game";
import {
  effectiveCardEnergyCost,
  prepareEnergyPayment,
} from "./cardPayment";

const DAMAGE_DECISION_MS = 35_000;
const POST_DAMAGE_MS = 25_000;
const RESULT_MS = 120_000;

function playerById(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}

function otherPlayer(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id !== playerId);
}

function log(state: MatchState, kind: MatchState["log"][number]["kind"], message: string) {
  state.log.push({
    id: `${Date.now()}-manual-damage-${state.log.length}`,
    at: Date.now(),
    kind,
    message,
  });
}

function enterPostDamage(state: MatchState) {
  state.phase = "postDamage";
  state.stepLabel = "Damage Step • Post-damage priority";
  state.priority = state.startingPlayer;
  state.passes = [];
  state.revealedFlip = undefined;
  state.deadline = Date.now() + POST_DAMAGE_MS;
}

function flipStopsDamage(state: MatchState, card: GameCard) {
  const text = card.effect;
  const faction = state.damageFaction;
  if (/\[Stop\] an attack/i.test(text)) return true;
  const non = text.match(/\[Stop\] non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i);
  if (non) return Boolean(faction && faction !== non[1]);
  const listed = [...text.matchAll(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)]
    .map((match) => match[1]);
  return Boolean(faction && /\[Stop\]/i.test(text) && listed.includes(faction));
}

export function playerCanFlipDamage(
  state: MatchState | null | undefined,
  playerId: string | undefined,
) {
  return Boolean(
    state
    && playerId
    && state.phase === "damage"
    && state.pendingLoser === playerId
    && state.pendingDamage > 0
    && !state.revealedFlip
    && !state.pendingChoice,
  );
}

export function flipDamageCard(input: MatchState, playerId: string) {
  if (!playerCanFlipDamage(input, playerId)) {
    throw new Error("The next damage card cannot be flipped now.");
  }

  const state = cloneMatch(input);
  const player = playerById(state, playerId)!;
  const card = player.deckCards.shift();
  player.deck = player.deckCards.length;
  state.informationEpoch += 1;
  state.undoWindow = undefined;

  if (!card) {
    const winner = otherPlayer(state, playerId);
    if (!winner) throw new Error("The opposing player could not be found.");
    state.series[winner.id] = (state.series[winner.id] ?? 0) + 1;
    state.phase = "result";
    state.stepLabel = "Game complete";
    state.winner = winner.id;
    state.resultReason = "Deck-out damage";
    state.deadline = Date.now() + RESULT_MS;
    log(state, "system", `${winner.name} wins because ${player.name} could not flip another damage card.`);
    state.version += 1;
    return state;
  }

  state.pendingDamage = Math.max(0, state.pendingDamage - 1);
  player.discard.push(card);
  log(state, "game", `${player.name} flipped ${card.name} as damage (${state.pendingDamage} remaining).`);

  if (card.type === "Flip") {
    state.revealedFlip = card;
    state.stepLabel = `Damage Step • Flip decision • ${state.pendingDamage} remaining`;
    state.priority = playerId;
    state.deadline = Date.now() + DAMAGE_DECISION_MS;
  } else if (state.pendingDamage <= 0) {
    enterPostDamage(state);
  } else {
    state.stepLabel = `Damage Step • ${state.pendingDamage} cards to flip`;
    state.deadline = Date.now() + DAMAGE_DECISION_MS;
  }

  state.version += 1;
  return state;
}

export function resolveManualDamage(
  input: MatchState,
  playerId: string,
  flipCardId?: string,
  choices: CardChoices = {},
) {
  const player = playerById(input, playerId);
  const flip = input.revealedFlip;
  if (input.phase !== "damage" || input.pendingLoser !== playerId || !player || !flip) {
    throw new Error("There is no revealed Flip decision for you.");
  }

  if (!flipCardId) {
    const state = cloneMatch(input);
    state.revealedFlip = undefined;
    log(state, "game", `${player.name} skipped ${flip.name}.`);
    if (state.pendingDamage <= 0) enterPostDamage(state);
    else {
      state.stepLabel = `Damage Step • ${state.pendingDamage} cards to flip`;
      state.priority = playerId;
      state.deadline = Date.now() + DAMAGE_DECISION_MS;
    }
    state.version += 1;
    return state;
  }

  if (flip.id !== flipCardId) throw new Error("Only the currently selected Flip card may be played.");

  const cost = effectiveCardEnergyCost(input, playerId, flip, choices);
  const prepared = prepareEnergyPayment(input, playerId, cost);
  const preparedPlayer = playerById(prepared, playerId)!;
  preparedPlayer.energy = Math.max(0, preparedPlayer.energy - cost);
  preparedPlayer.discard = preparedPlayer.discard.filter((card) => card.id !== flip.id);
  prepared.revealedFlip = undefined;

  if (flipStopsDamage(prepared, flip)) prepared.pendingDamage = 0;
  const split = splitWhenPlayedEffect(flip.effect);
  const pending: PendingEffect = {
    id: `${flip.id}-damage-resolution-${prepared.version}`,
    controllerId: playerId,
    card: flip,
    effect: split.cardEffect,
    choices,
    kind: "card",
  };
  const resolved = resolveStructuredEffect(prepared, pending);
  emitGameEvent(resolved, {
    id: `${resolved.turn}:card-play:${flip.id}`,
    type: "card-play",
    playerId,
    cardType: "Flip",
    sourceCards: split.triggerEffect ? [flip] : undefined,
  });
  log(resolved, "game", `${player.name} played ${flip.name} for ${cost} Energy.`);

  if (!resolved.pendingChoice) {
    if (resolved.pendingDamage <= 0) enterPostDamage(resolved);
    else {
      resolved.phase = "damage";
      resolved.stepLabel = `Damage Step • ${resolved.pendingDamage} cards to flip`;
      resolved.priority = playerId;
      resolved.passes = [];
      resolved.deadline = Date.now() + DAMAGE_DECISION_MS;
    }
  }
  return resolved;
}

