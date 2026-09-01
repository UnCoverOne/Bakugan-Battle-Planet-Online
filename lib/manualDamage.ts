import {
  alternateWinEffectPending,
  cloneMatch,
  completeScheduledAttackActions,
  completeMatch,
  prepareRevealedFlipPlay,
  revealedFlipCanBePlayed,
  resolveImmediateRuleObjects,
  resumePendingEffectAfterDamage,
  type CardLogEvent,
  type CardChoices,
  type GameCard,
  type MatchState,
} from "./game";
import { ensureRulesState } from "./rules/state";
import { emitRuleEvent } from "./rules/triggers";

const DAMAGE_DECISION_MS = 35_000;
const POST_DAMAGE_MS = 25_000;
type DamageResumeRules = ReturnType<typeof ensureRulesState> & {
  damageResume?: { playerId: string; previousPhase: "damage"; revealedFlipId: string };
  attackDamageSequence?: number;
  attackDamageTracker?: { sequence: number; actorId: string; originId: string; count: number };
};


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
  completeScheduledAttackActions(state);
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
  const pendingBefore = Math.max(0, state.pendingDamage);
  const rules = ensureRulesState(state);
  const dealerId = damageDealerId(state);
  const printedArmor = card.type === "Baku-Gear" && Number.isFinite(card.armorRating)
    ? Math.max(0, card.armorRating ?? 0)
    : 0;
  const armorIgnored = Boolean(dealerId && rules.ignoreArmorRating?.[dealerId]);
  const effectiveArmor = armorIgnored ? 0 : printedArmor;
  const cardAbsorbed = Math.min(pendingBefore, 1);
  const armorAbsorbed = Math.min(Math.max(0, pendingBefore - cardAbsorbed), effectiveArmor);
  const totalAbsorbed = cardAbsorbed + armorAbsorbed;
  state.pendingDamage = Math.max(0, pendingBefore - totalAbsorbed);
  if (armorAbsorbed > 0) {
    rules.armorDamageReducedThisTurn![playerId] = (rules.armorDamageReducedThisTurn?.[playerId] ?? 0) + armorAbsorbed;
  }
  recordDamageCardTaken(state);
  player.discard.push(card);
  const armorNote = printedArmor > 0
    ? ` • Armor ${printedArmor}${armorIgnored ? " ignored" : ""}`
    : "";
  log(state, "game", `${player.name} flipped ${card.name} as damage${armorNote} (absorbed ${totalAbsorbed}; ${state.pendingDamage} remaining).`);
  const deckFlipTriggers = emitRuleEvent(state, {
    id: `${state.turn}:deck-flip:damage:${playerId}:${card.id}:${state.informationEpoch}`,
    name: "CARD_FLIPPED_FROM_DECK",
    actorId: playerId,
    controllerId: playerId,
    card,
    cardType: card.type,
    createdAt: Date.now(),
  });
  resolveImmediateRuleObjects(state, deckFlipTriggers);
  if (card.type === "Flip" || card.type === "Flip Hero") {
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
  if (flip.id !== flipCardId) throw new Error("Only the currently revealed Flip card may be played.");
  if (!revealedFlipCanBePlayed(input, playerId, flip)) {
    throw new Error("This Flip card's Stop condition is not met by the attacking Bakugan.");
  }

  return prepareRevealedFlipPlay(input, playerId, flip.id, choices);
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
