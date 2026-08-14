import {
  alternateWinEffectPending,
  cloneMatch,
  completeMatch,
  recordCardPlayedForTurn,
  revealedFlipCanBePlayed,
  resumePendingEffectAfterDamage,
  type CardLogEvent,
  type CardChoices,
  type GameCard,
  type MatchState,
} from "./game";
import { beginCardPayment, cardCostAfterFreeBase, commitCardPayment, maximumPayableEnergy, prepareDeclaredEnergyPayment } from "./rules/costs";
import { ruleDefinitionForCard } from "./rules/catalogue";
import { createRuleObject } from "./rules/objects";
import { ensureRulesState } from "./rules/state";
import { emitRuleEvent } from "./rules/triggers";

const DAMAGE_DECISION_MS = 35_000;
const POST_DAMAGE_MS = 25_000;
const PACT_OF_DARKNESS_ID = "bb-152";

type PactOfDarknessPayment = {
  playerId: string;
  cardId: string;
  stage: "decision" | "discard" | "declined" | "paid";
  discardedCardId?: string;
};

type DamageResumeRules = ReturnType<typeof ensureRulesState> & {
  damageResume?: { playerId: string; previousPhase: "damage"; revealedFlipId: string };
  pactOfDarknessPayment?: PactOfDarknessPayment;
  attackDamageSequence?: number;
  attackDamageTracker?: { sequence: number; actorId: string; originId: string; count: number };
};

function clearPactOfDarknessPayment(state: MatchState, cardId?: string) {
  const rules = ensureRulesState(state) as DamageResumeRules;
  if (!cardId || rules.pactOfDarknessPayment?.cardId === cardId) {
    delete rules.pactOfDarknessPayment;
  }
  if (state.pendingChoice?.kind === "payment" && (!cardId || state.pendingChoice.cardId === cardId)) {
    state.pendingChoice = undefined;
  }
}

function playerById(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id === playerId);
}
function otherPlayer(state: MatchState, playerId: string) {
  return state.players.find((player) => player.id !== playerId);
}
function log(
  state: MatchState,
  kind: MatchState["log"][number]["kind"],
  message: string,
  card?: Pick<GameCard, "catalogId" | "id">,
  cardEvent?: CardLogEvent,
) {
  state.log.push({
    id: `${Date.now()}-manual-damage-${state.log.length}`,
    at: Date.now(),
    kind,
    message,
    ...(card && cardEvent ? {
      cardCatalogId: card.catalogId,
      cardInstanceId: card.id,
      cardEvent,
    } : {}),
  });
}
function damageDealerId(state: MatchState) {
  const suspended = state.pendingEffectDamageResume?.sourceEffectId;
  const sourceObject = suspended ? state.batch.find((object) => object.id === suspended) : undefined;
  if (sourceObject) return sourceObject.controllerId;
  return state.players.find((player) => player.bakugan.some((bakugan) => bakugan.id === state.damageOrigin))?.id;
}

function recordDamageCardTaken(state: MatchState) {
  const rules = ensureRulesState(state) as DamageResumeRules;
  if (!rules.attackDamageTracker) {
    const actorId = damageDealerId(state);
    if (!actorId) return;
    const sequence = (rules.attackDamageSequence ?? 0) + 1;
    rules.attackDamageSequence = sequence;
    rules.attackDamageTracker = { sequence, actorId, originId: state.damageOrigin, count: 0 };
  }
  rules.attackDamageTracker.count += 1;
}

function emitCompletedAttackDamage(state: MatchState) {
  const rules = ensureRulesState(state) as DamageResumeRules;
  const tracker = rules.attackDamageTracker;
  if (!tracker) return;
  delete rules.attackDamageTracker;
  emitRuleEvent(state, {
    id: `${state.turn}:attack-damage:${tracker.sequence}:${tracker.actorId}`,
    name: "ATTACK_DAMAGE_DEALT",
    actorId: tracker.actorId,
    controllerId: tracker.actorId,
    targetBakuganId: state.players.flatMap((player) => player.bakugan).some((bakugan) => bakugan.id === tracker.originId)
      ? tracker.originId
      : undefined,
    amount: tracker.count,
    createdAt: Date.now(),
  });
}

function enterPostDamage(state: MatchState) {
  emitCompletedAttackDamage(state);
  if (resumePendingEffectAfterDamage(state)) return;
  state.phase = "postDamage";
  state.stepLabel = "Damage Step • Post-damage priority";
  state.priority = state.startingPlayer;
  state.passes = [];
  state.revealedFlip = undefined;
  state.deadline = Date.now() + POST_DAMAGE_MS;
}

export function playerCanFlipDamage(state: MatchState | null | undefined, playerId: string | undefined) {
  return Boolean(state && playerId && state.phase === "damage" && state.pendingLoser === playerId
    && state.pendingDamage > 0 && !state.revealedFlip && !state.pendingChoice);
}

export function flipDamageCard(input: MatchState, playerId: string) {
  if (!playerCanFlipDamage(input, playerId)) throw new Error("The next damage card cannot be flipped now.");
  const state = cloneMatch(input);
  clearPactOfDarknessPayment(state);
  const player = playerById(state, playerId)!;
  const card = player.deckCards.shift();
  player.deck = player.deckCards.length;
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  if (!card) {
    const winner = otherPlayer(state, playerId);
    if (!winner) throw new Error("The opposing player could not be found.");
    completeMatch(state, winner.id, "Deck-out damage");
    state.version += 1;
    return state;
  }
  state.pendingDamage = Math.max(0, state.pendingDamage - 1);
  recordDamageCardTaken(state);
  player.discard.push(card);
  log(state, "game", `${player.name} flipped ${card.name} as damage (${state.pendingDamage} remaining).`);
  if (card.type === "Flip") {
    state.revealedFlip = card;
    state.stepLabel = `Damage Step • Flip decision • ${state.pendingDamage} remaining`;
    state.priority = playerId;
    state.deadline = Date.now() + DAMAGE_DECISION_MS;
  } else if (state.pendingDamage <= 0) enterPostDamage(state);
  else {
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
  if (flipCardId && alternateWinEffectPending(input)) {
    throw new Error("Dragonoid Maximus's alternate win effect cannot be responded to with cards.");
  }
  if (!flipCardId) {
    const existingRules = ensureRulesState(input) as DamageResumeRules;
    if (flip.catalogId === PACT_OF_DARKNESS_ID
      && existingRules.pactOfDarknessPayment?.cardId === flip.id
      && existingRules.pactOfDarknessPayment.stage === "paid") {
      throw new Error("Pact of Darkness must be played after its Sacrifice cost is paid.");
    }
    const state = cloneMatch(input);
    clearPactOfDarknessPayment(state, flip.id);
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
  if (flip.id !== flipCardId) throw new Error("Only the currently revealed Flip card may be played.");
  if (!revealedFlipCanBePlayed(input, playerId, flip)) {
    throw new Error("This Flip card's Stop condition is not met by the attacking Bakugan.");
  }

  const state = cloneMatch(input);
  const statePlayer = playerById(state, playerId)!;
  const stateFlip = state.revealedFlip!;
  const damageRules = ensureRulesState(state) as DamageResumeRules;
  if (stateFlip.catalogId === PACT_OF_DARKNESS_ID) {
    const pact = damageRules.pactOfDarknessPayment;
    if (!pact || pact.cardId !== stateFlip.id || pact.playerId !== playerId) {
      const sacrificeEnergyCost = cardCostAfterFreeBase(state, playerId, stateFlip, choices);
      const payableEnergy = maximumPayableEnergy(state, playerId);
      if (!statePlayer.hand.length) {
        damageRules.pactOfDarknessPayment = {
playerId,
cardId: stateFlip.id,
stage: "declined",
        };
      } else if (payableEnergy < sacrificeEnergyCost) {
        throw new Error(`Pact of Darkness cannot be played by Sacrifice: its free base still costs ${sacrificeEnergyCost} Energy after cost increases, but only ${payableEnergy} is available.`);
      } else {
        damageRules.pactOfDarknessPayment = {
playerId,
cardId: stateFlip.id,
stage: "decision",
        };
        state.pendingChoice = {
id: `${state.id}:${state.version}:${stateFlip.id}:pact-sacrifice-decision`,
kind: "payment",
controllerId: playerId,
cardId: stateFlip.id,
schema: {
  id: `${state.id}:${state.version}:${stateFlip.id}:pact-sacrifice-decision-schema`,
  sourceId: stateFlip.id,
  sourceName: stateFlip.displayName || stateFlip.name,
  controllerId: playerId,
  timing: "pay",
  simultaneous: false,
  fields: [{
    id: "confirmed",
    kind: "confirm",
    label: "Pay Sacrifice by discarding a card to play Pact of Darkness for free?",
    chooserId: playerId,
    visibility: "public",
    timing: "pay",
    minimum: 1,
    maximum: 1,
    required: true,
    options: [
      {
        id: "yes",
        label: "Pay Sacrifice",
        description: sacrificeEnergyCost > 0
          ? `${sacrificeEnergyCost} Energy is still required after cost increases.`
          : "The Energy cost is 0 after modifiers.",
      },
      { id: "no", label: "Keep the 4 Energy cost" },
    ],
  }],
},
answers: {},
createdVersion: state.version,
resumePriority: playerId,
resumeDeadline: state.deadline,
resumeStepLabel: state.stepLabel,
        };
        state.priority = playerId;
        state.stepLabel = `${stateFlip.displayName || stateFlip.name} • Sacrifice decision`;
        state.deadline = Date.now() + DAMAGE_DECISION_MS;
        log(state, "game", `${statePlayer.name} is deciding whether to pay Pact of Darkness's Sacrifice cost.`);
        state.version += 1;
        return state;
      }
    } else if (pact.stage === "decision" || pact.stage === "discard") {
      throw new Error("Complete or skip Pact of Darkness's Sacrifice decision first.");
    }
  }
  const payment = beginCardPayment(state, playerId, stateFlip, choices);
  prepareDeclaredEnergyPayment(state, playerId, payment.calculatedCost);
  commitCardPayment(state, playerId);
  // A Flip is still the next card played for effects such as Superfuel.
  // Consume the complete stacked reduction after its payment is calculated.
  state.nextCardCostReduction[playerId] = 0;
  statePlayer.discard = statePlayer.discard.filter((card) => card.id !== stateFlip.id);
  state.revealedFlip = undefined;
  clearPactOfDarknessPayment(state, stateFlip.id);
  recordCardPlayedForTurn(statePlayer, stateFlip, state.turn);

  const definition = ruleDefinitionForCard(stateFlip);
  const ability = definition.abilities.find((candidate) => candidate.kind === "spell") ?? definition.abilities[0];
  const object = createRuleObject({ controllerId: playerId, card: stateFlip, ability, choices, kind: "card" });
  state.batch.push(object);
  const rules = ensureRulesState(state) as DamageResumeRules;
  rules.damageResume = { playerId, previousPhase: "damage", revealedFlipId: stateFlip.id };

  // Damage is paused in a normal priority window. Stop and all other text are
  // applied only if this exact batch object resolves and are therefore negatable.
  state.phase = "postDamage";
  state.stepLabel = `Damage Step • Respond to ${stateFlip.displayName || stateFlip.name}`;
  state.priority = playerId;
  state.passes = [];
  state.deadline = Date.now() + POST_DAMAGE_MS;
  emitRuleEvent(state, {
    id: `${state.turn}:card-play:${stateFlip.id}`,
    name: "CARD_PLAYED",
    actorId: playerId,
    controllerId: playerId,
    card: stateFlip,
    cardType: "Flip",
    createdAt: Date.now(),
  });
  log(state, "game", `${player.name} added ${stateFlip.name} to the batch for ${payment.calculatedCost} Energy.`, stateFlip, "played", playerId);
  state.version += 1;
  return state;
}

export function resumeDamageAfterFlipWindow(state: MatchState) {
  const rules = ensureRulesState(state) as DamageResumeRules;
  const resume = rules.damageResume;
  const suspendedSourceId = state.pendingEffectDamageResume?.sourceEffectId;
  const unresolvedBatch = state.batch.some((object) => object.id !== suspendedSourceId);
  if (!resume || unresolvedBatch || state.pendingChoice) return state;
  delete rules.damageResume;
  if (state.pendingDamage <= 0) enterPostDamage(state);
  else {
    state.phase = "damage";
    state.stepLabel = `Damage Step • ${state.pendingDamage} cards to flip`;
    state.priority = resume.playerId;
    state.passes = [];
    state.deadline = Date.now() + DAMAGE_DECISION_MS;
  }
  return state;
}
