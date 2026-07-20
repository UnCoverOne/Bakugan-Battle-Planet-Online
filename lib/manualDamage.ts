import {
  cloneMatch,
  passPriority,
  resolveDamage,
  type CardChoices,
  type GameCard,
  type MatchState,
  type PendingEffect,
} from "./game";
import {
  effectiveCardEnergyCost,
  prepareEnergyPayment,
} from "./cardPayment";
import {
  hasPendingDraws,
  reconcileAttackDrawEffects,
  reconcileResolvedDrawEffect,
} from "./drawQueue";
import { reconcileResolvedEvos } from "./evo";

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

function isStrata(card: GameCard) {
  return card.name === "Strata"
    || /all players draw an additional card each turn/i.test(card.effect);
}

/**
 * The legacy generic effect parser interpreted Strata as an immediate one-shot
 * draw when the Hero resolved. Undo only those appended cards so Strata remains
 * in play and its ongoing modifier can be applied by the player-confirmed Draw
 * Step on subsequent turns.
 */
function reconcileResolvedStrata(input: MatchState, next: MatchState) {
  const newlyResolved = next.players.reduce((count, player) => {
    const before = input.players.find((candidate) => candidate.id === player.id);
    const beforeIds = new Set(before?.heroes.map((hero) => hero.id) ?? []);
    return count + player.heroes.filter((hero) => !beforeIds.has(hero.id) && isStrata(hero)).length;
  }, 0);
  if (!newlyResolved) return next;

  for (const player of next.players) {
    const before = input.players.find((candidate) => candidate.id === player.id);
    if (!before) continue;
    const deckReduction = Math.max(0, before.deckCards.length - player.deckCards.length);
    const handIncrease = Math.max(0, player.hand.length - before.hand.length);
    let restore = Math.min(newlyResolved, deckReduction, handIncrease);
    while (restore > 0) {
      const card = player.hand.pop();
      if (!card) break;
      player.deckCards.unshift(card);
      restore -= 1;
    }
    player.deck = player.deckCards.length;
  }

  const existingLogLength = input.log.length;
  next.log = [
    ...next.log.slice(0, existingLogLength),
    ...next.log.slice(existingLogLength).filter((entry) => (
      !/could not draw because their deck is empty/i.test(entry.message)
    )),
  ];
  return next;
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

function resolvingBatchObject(input: MatchState): PendingEffect | null {
  return input.passes.length >= 1 ? input.batch.at(-1) ?? null : null;
}

/**
 * The legacy engine resolves all ordinary damage cards immediately when the
 * Victor window closes. Restore those cards and retain only the calculated
 * amount so the visible client can flip them one click at a time.
 */
export function passPriorityWithManualDamage(input: MatchState, playerId: string) {
  if (hasPendingDraws(input)) {
    throw new Error("Complete every pending Draw action before passing priority.");
  }
  const resolving = resolvingBatchObject(input);
  let next = passPriority(input, playerId);
  next = reconcileResolvedStrata(input, next);
  next = reconcileResolvedEvos(input, next);
  next = reconcileResolvedDrawEffect(input, next, resolving);

  if (input.phase !== "victor" || next.phase === "victor" || !next.pendingLoser) return next;

  const beforeLoser = playerById(input, next.pendingLoser);
  const afterLoser = playerById(next, next.pendingLoser);
  if (!beforeLoser || !afterLoser) return next;

  const removedCards = Math.max(0, beforeLoser.deckCards.length - afterLoser.deckCards.length);
  const calculatedDamage = Math.max(0, next.pendingDamage + removedCards);
  afterLoser.deckCards = structuredClone(beforeLoser.deckCards);
  afterLoser.deck = afterLoser.deckCards.length;
  afterLoser.discard = structuredClone(beforeLoser.discard);
  next.series = structuredClone(input.series);
  next.winner = "";
  next.resultReason = "";
  next.pendingDamage = calculatedDamage;
  next.revealedFlip = undefined;
  next.passes = [];

  if (calculatedDamage <= 0) {
    enterPostDamage(next);
  } else {
    next.phase = "damage";
    next.stepLabel = `Damage Step • ${calculatedDamage} cards to flip`;
    next.priority = next.pendingLoser;
    next.deadline = Date.now() + DAMAGE_DECISION_MS;
  }
  log(next, "game", `${afterLoser.name} must manually flip ${calculatedDamage} damage card${calculatedDamage === 1 ? "" : "s"}.`);
  return reconcileAttackDrawEffects(input, next, calculatedDamage);
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
    && !state.revealedFlip,
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

function drawRemainingDamageToHand(state: MatchState, playerId: string, amount: number) {
  const player = playerById(state, playerId);
  if (!player) return;
  let drawn = 0;
  while (drawn < amount) {
    const card = player.deckCards.shift();
    if (!card) break;
    player.hand.push(card);
    drawn += 1;
  }
  player.deck = player.deckCards.length;
  log(state, "game", `${player.name} put ${drawn} remaining damage card${drawn === 1 ? "" : "s"} into their hand.`);
}

export function resolveManualDamage(
  input: MatchState,
  playerId: string,
  flipCardId?: string,
  choices: CardChoices = {},
) {
  const player = playerById(input, playerId);
  const flip = input.revealedFlip;
  if (
    input.phase !== "damage"
    || input.pendingLoser !== playerId
    || !player
    || !flip
  ) {
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

  if (flip.id !== flipCardId) {
    throw new Error("Only the currently selected Flip card may be played.");
  }

  const remainingDamage = input.pendingDamage;
  const cost = effectiveCardEnergyCost(input, playerId, flip, choices);
  const prepared = prepareEnergyPayment(input, playerId, cost);
  const preparedPlayer = playerById(prepared, playerId)!;
  preparedPlayer.discard = preparedPlayer.discard.filter((card) => card.id !== flip.id);

  // Existing Flip resolution handles the printed effect and final destination.
  // Give it an empty automatic queue, then restore the manual queue when the
  // Flip neither stops nor replaces the remaining damage procedure.
  prepared.pendingDamage = 0;
  const resolved = resolveDamage(prepared, playerId, flip.id, choices);
  const stopped = flipStopsDamage(input, flip) || flip.name === "Blackhole";
  const movesRemainingToHand = flip.name === "Brain Geyser";

  if (movesRemainingToHand && remainingDamage > 0 && resolved.phase !== "result") {
    drawRemainingDamageToHand(resolved, playerId, remainingDamage);
    resolved.pendingDamage = 0;
    resolved.pendingLoser = playerId;
    enterPostDamage(resolved);
  } else if (!stopped && remainingDamage > 0 && resolved.phase !== "result") {
    resolved.phase = "damage";
    resolved.stepLabel = `Damage Step • ${remainingDamage} cards to flip`;
    resolved.priority = playerId;
    resolved.passes = [];
    resolved.pendingLoser = playerId;
    resolved.pendingDamage = remainingDamage;
    resolved.revealedFlip = undefined;
    resolved.deadline = Date.now() + DAMAGE_DECISION_MS;
  }

  return reconcileResolvedDrawEffect(prepared, resolved, {
    id: `${flip.id}-manual-resolution`,
    controllerId: playerId,
    card: flip,
    choices,
    kind: "card",
  });
}
