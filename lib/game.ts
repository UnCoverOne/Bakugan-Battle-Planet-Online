import {
  buildChoiceSchema,
  buildChoiceSchemaFromSpecs,
  mergeChoiceAnswers,
  schemaHasLegalCompletion,
  schemaIsComplete,
  validateChoices,
} from "./rules/choices";
import { executeRuleProgram } from "./rules/executor";
import { compileCardEffect, type RuleAction, type RuleInstruction } from "./rules/effects";
import { ruleDefinitionForCard } from "./rules/catalogue";
import { activeUnchargedEnergyIds, beginCardPayment, cardPaymentModes, commitCardPayment, instabrawlCostFor, maximumPayableEnergy, normalizeEnergyCardState, payEnergyCost, prepareDeclaredEnergyPayment, rechargeEnergyCards, setEnergyCardChargeState, unchargeEnergyCards } from "./rules/costs";
import { canonicalEvoTargetAllowed } from "./rules/identity";
import { evaluateBakuganCharacteristics, ruleConditionActive } from "./rules/modifiers";
import { turnDrawCounts } from "./rules/turn-draw";
import { playerIdsForScope, zoneOwnerIdsFor } from "./rules/primitives";
import { evaluateNumberValue, type EvaluationMoment, type NumberValue } from "./rules/values";
import { captureCardPlayValues, captureInstructionValues, captureRuleConditionValues } from "./rules/value-capture";
import { beginRuleObjectResolution, completeRuleObject, copyRuleObject, createRuleObject, negateRuleObject } from "./rules/objects";
import { applyReplacements, registerReplacement } from "./rules/replacements";
import { ensureRulesState, isRuleObject, normalizeRuleObjects } from "./rules/state";
import type { AbilityDefinition, ContinuousModifier, PendingCardPlay, RuleActionResult, RuleCondition, RulesCardId } from "./rules/model";
import { collectRuleTriggers, emitRuleEvent } from "./rules/triggers";
import { effectiveBakuganFactions, effectiveBakucoreCells, effectiveCardFactions } from "./rules/derived-characteristics";
import { isDualWieldGear } from "./rules/baku-gear";
import { applyEnergyEntryVisibility } from "./energyVisibility";
import {
  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
  PhysicalSimulationError,
  physicalRotationPhaseOpenCell,
  resolvePhysicalRollOutcome,
  simulatePhysicalRollStep,
} from "./rules/physical-simulation";
import {
  EngineRuntimeLimitError,
  MAX_PHYSICAL_ROLL_ATTEMPTS,
  consumePhysicalRollAttempt,
} from "./engine/limits";

// Backward-compatible server/test entry point. The interactive client imports
// the clearer manual-damage name directly.
export { resolveManualDamage as resolveDamage } from "./manualDamage";

export type Faction = "Pyrus" | "Aquos" | "Darkus" | "Haos" | "Ventus" | "Aurelus";
export type CoreType = "Fist" | "Flaming Fist" | "Shield" | "Magic Shield" | "Helix";
export type CardType = "Action" | "Flip" | "Flip Hero" | "Hero" | "Baku-Gear" | "Evo" | "Character";

export type GameCard = {
  id: string;
  catalogId: string;
  number: number;
  name: string;
  displayName: string;
  faction: Faction;
  factions: Faction[];
  type: CardType;
  cost: number | "X";
  rarity: string;
  effect: string;
  mechanics: string[];
  bPower: number | null;
  damage: number | null;
  coreTypes: CoreType[];
  evolvesFrom: string | null;
  art: string;
  source?: string;
  hasProvidedScan?: boolean;
  slug?: string;
  collectorNumber?: string;
  armorRating?: number;
  fusionPairId?: string;
  fusionFace?: "a" | "b";
  /** Turn in which this physical card instance entered play. */
  playedTurn?: number;
  /** This Hero was played through its temporary InstaBrawl payment route. */
  instabrawl?: boolean;
  /** Owner-only deadline for a card Energized from the top of the deck. */
  energyFaceRevealUntil?: number;
  /** A Sync reveal remains public while this physical card stays in hand. */
  revealedToOpponents?: boolean;
};

export type Bakugan = {
  id: string;
  name: string;
  faction: Faction;
  bPower: number;
  damage: number;
  rollAccuracy: number;
  doubleCoreChance: number;
  art: string;
  character: GameCard;
  open: boolean;
  heldCoreCells: string[];
  evoStack: GameCard[];
  /** Baku-Gear cards attached to this Bakugan. */
  bakuGear?: GameCard[];
  /** Reverse Character face used by a two-card Fusion printing. */
  fusionCharacter?: GameCard;
  fused?: boolean;
  /** Turn in which this Bakugan most recently opened. */
  openedTurn?: number;
};

export type CorePrinting = {
  id: string;
  set: "Battle Brawlers" | "Armored Alliance";
  number: number;
  art: string;
};

export type Core = {
  id: string;
  /** Immutable catalogue identity shared by physically separate copies. */
  catalogId?: string;
  set?: "Battle Brawlers" | "Armored Alliance";
  number: number;
  name: string;
  type: CoreType;
  bonus: number;
  damageBonus: number;
  frostStrike?: number;
  shadowStrike?: boolean;
  bakuGearCostReduction?: number;
  fusionBonus?: number;
  fusionDamageBonus?: number;
  fusionFrostStrike?: number;
  conditionalFactions?: Faction[];
  conditionalBonus?: number;
  conditionalDamage?: number;
  /** Alternate physical printings that share this catalogue core's rules. */
  printings?: CorePrinting[];
  /** True only when the supplied archive contains a front scan for this printing. */
  hasProvidedScan?: boolean;
  art: string;
};

export type PlayerState = {
  id: string;
  name: string;
  bakugan: Bakugan[];
  cores: Core[];
  deck: number;
  deckCards: GameCard[];
  hand: GameCard[];
  discard: GameCard[];
  energyZone: GameCard[];
  heroes: GameCard[];
  /** Produced but unspent Energy; shown by the Energy indicator. */
  energy: number;
  /** Energy cards currently horizontal / uncharged. */
  unchargedEnergyIds?: string[];
  /** Automatic Charge Step recharge prevention keyed by card id and turn. */
  energyRechargeLocks?: Record<string, number>;
  /** @deprecated Legacy orientation aliases retained for snapshot compatibility. */
  tappedEnergyIds?: string[];
  energyTapTurn?: number;
  ready: boolean;
  connected: boolean;
  lastSeen: number;
  energizedThisTurn: boolean;
  cardsPlayedThisTurn: number;
  /** Printed Energy costs of cards this player has played during the current turn. */
  playedCardCostsThisTurn?: number[];
  /** Printed card types played this turn, in event order. */
  playedCardTypesThisTurn?: CardType[];
  /** Printed mechanics on cards played this turn, in event order. */
  playedCardMechanicsThisTurn?: string[];
  /** Distinct factions represented by cards this player has played this turn. */
  factionsPlayedThisTurn?: Faction[];
  /** Physical cards actually discarded from hand this turn (not merely put into discard). */
  discardedCardIdsThisTurn?: string[];
  /** Publicly revealed top-deck card awaiting a linked free-play decision. */
  revealedDeckCardId?: string;
};

export type Placement = { playerId: string; core: Core; cell: string; order: number; attachedTo?: string; revealed?: boolean };
export type RollPathPoint = { x: number; y: number };
export type PhysicalCollisionDecision = {
  kind: "primary-contested" | "secondary-yielded";
  coreCell: string;
  winnerPlayerId: string;
  affectedPlayerId: string;
  policy: string;
};
export type RollResult =
  | "miss-closed"
  | "open-no-core"
  | "intended-core"
  | "overshoot"
  | "undershoot"
  | "skew-left"
  | "skew-right"
  | "path-intercept";
export type RollOutcome = {
  playerId: string;
  bakuganId: string;
  target: string;
  resolvedTarget: string;
  result: RollResult;
  cores: string[];
  accuracyRoll: number;
  deviationRoll: number;
  doubleRoll: number;
  secondCoreRoll: number;
  doubleCore: boolean;
  path: RollPathPoint[];
  note: string;
  /** Versioned digital-adaptation profile that interpreted the physical roll. */
  simulationProfileId?: string;
  /** One-based attempt number when every Bakugan remained closed and the step repeated. */
  attempt?: number;
  /** Structured contested-pickup decisions retained for replay and diagnostics. */
  collisionDecisions?: PhysicalCollisionDecision[];
  /** Present when this outcome replaced an earlier roll for the same selected Bakugan. */
  rerollSequence?: number;
  rerollSource?: string;
};

export type CardChoices = {
  /** Bakugan that created a trigger or receives an Evo; never an effect target. */
  sourceBakuganId?: string;
  targetBakuganId?: string;
  secondaryTargetBakuganId?: string;
  targetEffectId?: string;
  targetCardId?: string;
  targetPlayerId?: string;
  targetHeroId?: string;
  targetEvoId?: string;
  targetEnergyId?: string;
  targetEnergyIds?: string[];
  coreCell?: string;
  secondaryCoreCell?: string;
  discardCardIds?: string[];
  handCardIds?: string[];
  orderedCardIds?: string[];
  deckCardId?: string;
  /** Physical event card used by generic play-triggered copy effects. */
  eventCardId?: string;
  /** Card revealed from hand to satisfy a Sync clause. */
  syncCardId?: string;
  xValue?: number;
  mode?: string;
  /** Selected normal/alternative payment route for the current card play. */
  paymentMode?: string;
  /** Whether the controller chose the card's optional Empower payment. */
  empower?: boolean | string;
  confirmed?: boolean;
  keepBakuGearId?: string;
  simultaneousAnswers?: Record<string, CardChoices>;
};

export type PendingReroll = {
  id: string;
  playerId: string;
  bakuganId: string;
  sourceEffectId?: string;
  sourceName: string;
  mandatory: boolean;
  targetCell?: string;
  resumePriority: string;
  resumeDeadline: number;
  resumeStepLabel: string;
};

export type CoinFlipResult = "heads" | "tails";

export type PendingCoinFlip = {
  id: string;
  controllerId: string;
  sourceEffectId: string;
  sourceName: string;
  result: CoinFlipResult;
  createdAt: number;
  resolveAt: number;
  resumePriority: string;
  resumeDeadline: number;
  resumeStepLabel: string;
};

export type PendingEffectDamageResume = {
  sourceEffectId: string;
  phase: Phase;
  priority: string;
  deadline: number;
  stepLabel: string;
};

export type PendingEffect = {
  id: string;
  controllerId: string;
  /** Physical owner of this card, which can differ from its resolving controller. */
  cardOwnerId?: string;
  card: GameCard;
  choices: CardChoices;
  kind: "card" | "trigger" | "copy";
  effect?: string;
  sourceId?: string;
  /** Event that created this trigger, used for timing and information redaction. */
  createdByEventId?: string;
  negated?: boolean;
  /** Next compiled instruction to execute. Persisted so a choice can suspend resolution. */
  instructionIndex?: number;
  /** Clause-scoped answers keyed by compiled instruction index. */
  resolvedChoices?: Record<string, CardChoices>;
  /** Marks Dragonoid Maximus's unique alternate-win effect on the batch. */
  alternateWin?: boolean;
};

export type TriggerOrderRequest = {
  id: string;
  event: string;
  controllerId: string;
  triggerIds: string[];
  triggers: PendingEffect[];
  orderedIds?: string[];
};

export type UndoWindow = {
  actorId: string;
  action: "play-card";
  beforeVersion: number;
  afterVersion: number;
  batchObjectId: string;
  informationEpoch: number;
  priorityEpoch: number;
  /** True once preparation or resolution exposed information that cannot be put back. */
  irreversibleInformation: boolean;
  snapshot?: string;
};

export type Phase =
  | "lobby" | "startingPlayer" | "placement" | "draw" | "energize" | "selection" | "preRoll" | "target" | "reroll"
  | "power" | "victor" | "damage" | "postDamage" | "retract" | "endPlay" | "charge" | "reset"
  | "handLimit" | "result";

export type CardLogEvent = "played" | "effect";
export type MatchLogEntry = {
  id: string;
  at: number;
  kind: "game" | "random" | "system" | "connection";
  message: string;
  /** Structured card identity for visual history views. Optional for legacy snapshots. */
  cardCatalogId?: string;
  cardInstanceId?: string;
  cardEvent?: CardLogEvent;
  /** Player who played the card or controlled the resolving effect. */
  playerId?: string;
};

export type MatchState = {
  id: string;
  code: string;
  format: "bo1" | "bo3";
  version: number;
  gameNumber: number;
  turn: number;
  series: Record<string, number>;
  phase: Phase;
  stepLabel: string;
  players: PlayerState[];
  startingPlayer: string;
  priority: string;
  placementTurn: number;
  placements: Placement[];
  selected: Record<string, string>;
  targets: Record<string, string>;
  rolls: Record<string, RollOutcome>;
  pendingReroll?: PendingReroll;
  pendingCoinFlip?: PendingCoinFlip;
  coinFlipResults: Record<string, CoinFlipResult>;
  pendingEffectDamageResume?: PendingEffectDamageResume;
  pendingRerollOpenEvent?: { playerId: string; bakuganId: string; sourceEffectId?: string };
  rerollOpenedByEffect: Record<string, boolean>;
  rerollTargetByEffect: Record<string, string>;
  rerollUsage: Record<string, number>;
  rerollSequence: number;
  repeatRollAfterReroll: boolean;
  nextCardCostReduction: Record<string, number>;
  /** One-shot reductions that apply only to the next card's Empower cost. */
  nextCardEmpowerReduction: Record<string, number>;
  /** One-shot permission that makes the next card's Empower cost free. */
  nextCardEmpowerFree: Record<string, boolean>;
  temporaryVictorDiscards: Record<string, { controllerId: string; sourceName: string; amount: number }>;
  powerBoost: Record<string, number>;
  damageBoost: Record<string, number>;
  frostStrike: Record<string, number>;
  doubleStrike: Record<string, boolean>;
  shadowStrike: Record<string, boolean>;
  passes: string[];
  batch: PendingEffect[];
  pendingChoice?: import("./rules/choices").PendingCardChoice;
  triggerOrders: TriggerOrderRequest[];
  collectedEventKeys: string[];
  /** Game number whose start-of-game event has already been staged. */
  gameStartEventedGame?: number;
  informationEpoch: number;
  priorityEpoch: number;
  undoWindow?: UndoWindow;
  initialStartingPlayer: string;
  startingPlayerRevealedAt: number;
  drawPreparedTurn?: number;
  drawReadyAt?: number;
  drawDeadline?: number;
  drawnPlayerIds?: string[];
  drawRemainingByPlayer?: Record<string, number>;
  victorByDamage: boolean;
  pendingDamage: number;
  pendingLoser: string;
  damageOrigin: string;
  damageFaction?: Faction;
  revealedFlip?: GameCard;
  teamAttack: boolean;
  pendingBrawlRetracts: string[];
  delayedRetracts: string[];
  copyNextAction: Record<string, number>;
  brawlWinner: string;
  winner: string;
  resultReason: string;
  /** Administrator-selected Training AI resource used when this match began. */
  trainingAiDeck?: {
    resourceId: string;
    configurationRevision: number;
  };
  deadline: number;
  log: MatchLogEntry[];
};

// Radius-four axial board: a true hexagon containing 61 legal cells.
// Existing radius-three cell IDs stay stable so saved matches remain compatible.
export const HEX_CELLS = Array.from({ length: 9 }, (_, qIndex) => qIndex - 4).flatMap((q) =>
  Array.from({ length: 9 }, (_, rIndex) => rIndex - 4)
    .filter((r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= 4)
    .map((r) => ({ id: `h${q + 3}-${r + 3}`, q, r })),
);
export const CENTER_CELL = "h3-3";
const secureRandomInt = (maximum: number) => {
  if (maximum <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const limit = Math.floor(0x1_0000_0000 / maximum) * maximum;
    const value = new Uint32Array(1);
    do cryptoApi.getRandomValues(value); while (value[0] >= limit);
    return value[0] % maximum;
  }
  return Math.floor(Math.random() * maximum);
};
export const uid = () => globalThis.crypto?.randomUUID?.()
  ?? `${Date.now().toString(36)}-${secureRandomInt(0x1_0000_0000).toString(36)}`;

const PHASE_TIMERS: Record<Phase, number> = {
  lobby: 60, startingPlayer: 8, placement: 45, draw: 35, energize: 35, selection: 35, preRoll: 30, target: 30, reroll: 30,
  power: 40, victor: 30, damage: 35, postDamage: 25, retract: 10, endPlay: 35, charge: 2, reset: 2,
  handLimit: 40, result: 120,
};
const deadlineFor = (phase: Phase) => Date.now() + PHASE_TIMERS[phase] * 1000;
const distance = (a: { q: number; r: number }, b: { q: number; r: number }) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
const cellAt = (id: string) => HEX_CELLS.find((cell) => cell.id === id);
const entry = (
  state: MatchState,
  kind: MatchLogEntry["kind"],
  message: string,
  card?: Pick<GameCard, "catalogId" | "id">,
  cardEvent?: CardLogEvent,
  playerId?: string,
) => {
  state.log.push({
    id: `${Date.now()}-${state.log.length}-${Math.random().toString(36).slice(2, 5)}`,
    at: Date.now(),
    kind,
    message,
    ...(card && cardEvent ? {
      cardCatalogId: card.catalogId,
      cardInstanceId: card.id,
      cardEvent,
    } : {}),
    ...(playerId ? { playerId } : {}),
  });
};
const withVersion = (state: MatchState) => { state.version += 1; return state; };
export const cloneMatch = (state: MatchState): MatchState => JSON.parse(JSON.stringify(state));

/** Upgrade resumable snapshots created before current engine fields existed. */
export const normalizeMatchState = (input: MatchState): MatchState => {
  const state = cloneMatch(input);
  ensureRulesState(state);
  normalizeRuleObjects(state);
  state.triggerOrders = Array.isArray(state.triggerOrders) ? state.triggerOrders : [];
  state.collectedEventKeys = Array.isArray(state.collectedEventKeys) ? state.collectedEventKeys : [];
  state.gameStartEventedGame = Number.isFinite(state.gameStartEventedGame) ? Number(state.gameStartEventedGame) : 0;
  state.informationEpoch = Number.isFinite(state.informationEpoch) ? Number(state.informationEpoch) : 0;
  state.priorityEpoch = Number.isFinite(state.priorityEpoch) ? Number(state.priorityEpoch) : 0;
  state.initialStartingPlayer = state.initialStartingPlayer || state.startingPlayer || state.players[0]?.id || "";
  state.startingPlayerRevealedAt = Number.isFinite(state.startingPlayerRevealedAt)
    ? Number(state.startingPlayerRevealedAt)
    : 0;
  state.batch = Array.isArray(state.batch) ? state.batch : [];
  state.passes = Array.isArray(state.passes) ? state.passes : [];
  state.placements = Array.isArray(state.placements) ? state.placements : [];
  state.pendingBrawlRetracts = Array.isArray(state.pendingBrawlRetracts) ? state.pendingBrawlRetracts : [];
  for (const player of state.players) {
    normalizeEnergyCardState(player, state.turn);
    const legacyIds = new Map<string, Core[]>();
    player.cores = player.cores.map((core, index) => {
      const catalogId = core.catalogId ?? core.id;
      const instance = core.catalogId
        ? core
        : { ...core, catalogId, id: `${catalogId}-${player.id}-core-${index}` };
      const copies = legacyIds.get(catalogId) ?? [];
      copies.push(instance);
      legacyIds.set(catalogId, copies);
      return instance;
    });
    const usedInstances = new Set<string>();
    for (const placement of state.placements.filter((item) => item.playerId === player.id)) {
      const catalogId = placement.core.catalogId ?? placement.core.id;
      const copies = legacyIds.get(catalogId) ?? [];
      // Current snapshots already name the physical copy that was actually placed.
      // Only fall back to another copy of the same catalogue entry for legacy states.
      const instance = copies.find((core) => (
        core.id === placement.core.id && !usedInstances.has(core.id)
      )) ?? copies.find((core) => !usedInstances.has(core.id));
      if (instance) {
        placement.core = instance;
        usedInstances.add(instance.id);
      }
    }
    const playedCards = [
      ...player.deckCards,
      ...player.hand,
      ...player.discard,
      ...player.energyZone,
      ...player.heroes,
      ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
      ...state.batch.filter((object) => object.controllerId === player.id).map((object) => object.card),
    ].filter((card) => card.playedTurn === state.turn);
    player.factionsPlayedThisTurn = [...new Set([
      ...(Array.isArray(player.factionsPlayedThisTurn) ? player.factionsPlayedThisTurn : []),
      ...playedCards.flatMap(effectiveCardFactions),
    ])];
    player.playedCardCostsThisTurn = playedCards.map((card) => card.cost === "X" ? 0 : card.cost);
    player.playedCardTypesThisTurn = playedCards.map((card) => card.type);
    player.playedCardMechanicsThisTurn = playedCards.flatMap((card) => card.mechanics ?? []);
  }
  state.selected = state.selected && typeof state.selected === "object" ? state.selected : {};
  state.targets = state.targets && typeof state.targets === "object" ? state.targets : {};
  state.rolls = state.rolls && typeof state.rolls === "object" ? state.rolls : {};
  state.coinFlipResults = state.coinFlipResults && typeof state.coinFlipResults === "object" ? state.coinFlipResults : {};
  if (state.pendingCoinFlip && typeof state.pendingCoinFlip !== "object") state.pendingCoinFlip = undefined;
  state.rerollOpenedByEffect = state.rerollOpenedByEffect && typeof state.rerollOpenedByEffect === "object" ? state.rerollOpenedByEffect : {};
  state.rerollTargetByEffect = state.rerollTargetByEffect && typeof state.rerollTargetByEffect === "object" ? state.rerollTargetByEffect : {};
  state.rerollUsage = state.rerollUsage && typeof state.rerollUsage === "object" ? state.rerollUsage : {};
  state.rerollSequence = Number.isFinite(state.rerollSequence) ? Number(state.rerollSequence) : 0;
  state.repeatRollAfterReroll = Boolean(state.repeatRollAfterReroll);
  if (state.pendingEffectDamageResume && typeof state.pendingEffectDamageResume !== "object") state.pendingEffectDamageResume = undefined;
  if (state.pendingRerollOpenEvent && typeof state.pendingRerollOpenEvent !== "object") state.pendingRerollOpenEvent = undefined;
  state.nextCardCostReduction = state.nextCardCostReduction && typeof state.nextCardCostReduction === "object" ? state.nextCardCostReduction : {};
  state.nextCardEmpowerReduction = state.nextCardEmpowerReduction && typeof state.nextCardEmpowerReduction === "object" ? state.nextCardEmpowerReduction : {};
  state.nextCardEmpowerFree = state.nextCardEmpowerFree && typeof state.nextCardEmpowerFree === "object" ? state.nextCardEmpowerFree : {};
  state.temporaryVictorDiscards = state.temporaryVictorDiscards && typeof state.temporaryVictorDiscards === "object" ? state.temporaryVictorDiscards : {};
  for (const roll of Object.values(state.rolls)) {
    const legacyResult = roll.result as RollOutcome["result"] | "miss" | "target-core" | "adjacent-core" | "double-core";
    if (legacyResult === "miss") roll.result = "miss-closed";
    else if (legacyResult === "target-core") roll.result = "intended-core";
    else if (legacyResult === "adjacent-core") roll.result = "skew-left";
    else if (legacyResult === "double-core") roll.result = "intended-core";
    roll.deviationRoll = Number.isFinite(roll.deviationRoll) ? roll.deviationRoll : roll.accuracyRoll * 100;
    roll.secondCoreRoll = Number.isFinite(roll.secondCoreRoll) ? roll.secondCoreRoll : roll.doubleRoll * 100;
    roll.doubleCore = typeof roll.doubleCore === "boolean" ? roll.doubleCore : roll.cores.length > 1;
    roll.path = Array.isArray(roll.path) ? roll.path : [];
  }
  state.log = Array.isArray(state.log) ? state.log : [];
  return state;
};

const otherPlayer = (state: MatchState, playerId: string) => state.players.find((player) => player.id !== playerId)!;
const playerById = (state: MatchState, playerId: string) => state.players.find((player) => player.id === playerId)!;
const syncDeck = (player: PlayerState) => { player.deck = player.deckCards.length; };
export const recordCardPlayedForTurn = (player: PlayerState, card: GameCard, turn: number) => {
  card.playedTurn = turn;
  player.cardsPlayedThisTurn += 1;
  player.playedCardCostsThisTurn = [...(player.playedCardCostsThisTurn ?? []), card.cost === "X" ? 0 : card.cost];
  player.playedCardTypesThisTurn = [...(player.playedCardTypesThisTurn ?? []), card.type];
  player.playedCardMechanicsThisTurn = [...(player.playedCardMechanicsThisTurn ?? []), ...(card.mechanics ?? [])];
  player.factionsPlayedThisTurn = [...new Set([
    ...(player.factionsPlayedThisTurn ?? []),
    ...effectiveCardFactions(card),
  ])];
};
const drawCards = (state: MatchState, player: PlayerState, amount: number) => {
  if (amount > 0) {
    state.informationEpoch += 1;
    if (state.undoWindow) state.undoWindow.irreversibleInformation = true;
    state.undoWindow = undefined;
  }
  for (let index = 0; index < amount; index += 1) {
    const card = player.deckCards.shift();
    if (!card) { entry(state, "game", `${player.name} could not draw because their deck is empty.`); break; }
    player.hand.push(card);
  }
  syncDeck(player);
};

const discardFromHand = (state: MatchState, player: PlayerState, amount: number, selected: string[] = []) => {
  const ids = selected.length ? selected : player.hand.slice(0, amount).map((card) => card.id);
  const discarded: GameCard[] = [];
  for (const id of ids.slice(0, amount)) {
    const index = player.hand.findIndex((card) => card.id === id);
    if (index >= 0) {
      const [card] = player.hand.splice(index, 1);
      player.discard.push(card);
      discarded.push(card);
      player.discardedCardIdsThisTurn = [...new Set([...(player.discardedCardIdsThisTurn ?? []), card.id])];
    }
  }
  entry(state, "game", `${player.name} discarded ${Math.min(amount, ids.length)} card${amount === 1 ? "" : "s"}.`);
  const active = activeBakugan(state, player.id);
  emitGameEvent(state, {
    id: `${state.turn}:discard:${discarded.map((card) => card.id).join(",")}:${state.version}`,
    type: "discard",
    playerId: player.id,
    targetBakuganId: active?.id,
    sourceCards: discarded,
  });
  if (player.hand.length === 0) emitGameEvent(state, {
    id: `${state.turn}:hand-empty:${player.id}:${state.version}`,
    type: "hand-empty",
    playerId: player.id,
  });
};

const shuffle = <T,>(values: T[]) => {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = secureRandomInt(index + 1); [values[index], values[swap]] = [values[swap], values[index]];
  }
};

const setPhase = (state: MatchState, phase: Phase, label: string, priority = state.startingPlayer) => {
  state.phase = phase; state.stepLabel = label; state.priority = priority; state.passes = []; state.deadline = deadlineFor(phase);
};

export const createMatch = (code: string, format: "bo1" | "bo3", players: PlayerState[]): MatchState => {
  const startingPlayer = players[0]?.id ?? "";
  return {
    id: uid(), code, format, version: 1, gameNumber: 1, turn: 0,
    series: Object.fromEntries(players.map((player) => [player.id, 0])), phase: "lobby", stepLabel: "Players ready",
    players, startingPlayer, initialStartingPlayer: startingPlayer, startingPlayerRevealedAt: 0,
    priority: startingPlayer, placementTurn: 0, placements: [], selected: {}, targets: {}, rolls: {},
    coinFlipResults: {}, rerollOpenedByEffect: {}, rerollTargetByEffect: {}, rerollUsage: {}, rerollSequence: 0, repeatRollAfterReroll: false, nextCardCostReduction: {}, nextCardEmpowerReduction: {}, nextCardEmpowerFree: {}, temporaryVictorDiscards: {},
    powerBoost: {}, damageBoost: {}, frostStrike: {}, doubleStrike: {}, shadowStrike: {}, passes: [], batch: [], victorByDamage: false,
    pendingDamage: 0, pendingLoser: "", damageOrigin: "", teamAttack: false, pendingBrawlRetracts: [], delayedRetracts: [], copyNextAction: {}, brawlWinner: "", winner: "", resultReason: "",
    triggerOrders: [], collectedEventKeys: [], gameStartEventedGame: 0, informationEpoch: 0, priorityEpoch: 0,
    deadline: deadlineFor("lobby"),
    log: [{ id: "start", at: Date.now(), kind: "system", message: `Match ${code} created • ${format.toUpperCase()} • complete Battle Planet rules` }],
  };
};

export const setReady = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (!player || state.phase !== "lobby") throw new Error("Ready is not legal now.");
  if (player.bakugan.length !== 3 || player.cores.length !== 6 || player.deckCards.length !== 35 || player.hand.length !== 5) throw new Error("Lock a legal 40-card deck, three Bakugan, and six matching BakuCores.");
  player.ready = true; player.lastSeen = Date.now(); entry(state, "system", `${player.name} locked a legal deck.`);
  if (state.players.length === 2 && state.players.every((candidate) => candidate.ready)) {
    const selected = state.players[secureRandomInt(state.players.length)];
    state.initialStartingPlayer = selected.id;
    state.startingPlayer = selected.id;
    state.priority = selected.id;
    state.startingPlayerRevealedAt = Date.now() + 2_500;
    setPhase(state, "startingPlayer", "Selecting the first BakuCore player", selected.id);
    state.deadline = state.startingPlayerRevealedAt + 30_000;
    state.informationEpoch += 1;
    entry(state, "random", `Server starting-player selection: ${selected.name} will place the first BakuCore.`);
  }
  return withVersion(state);
};

export const beginCorePlacement = (input: MatchState, now = Date.now()) => {
  const state = cloneMatch(input);
  if (state.phase !== "startingPlayer") throw new Error("Starting-player selection is not active.");
  if (now < state.startingPlayerRevealedAt) throw new Error("The starting-player reveal animation is still running.");
  setPhase(state, "placement", "BakuCore placement 1 / 12", state.initialStartingPlayer);
  entry(state, "game", `${playerById(state, state.initialStartingPlayer).name} won the server selection and places the first BakuCore in the centre.`);
  return withVersion(state);
};

export const legalPlacementCells = (state: MatchState) => {
  if (!state.placements.length) return [CENTER_CELL];
  const occupied = new Set(state.placements.map((placement) => placement.cell));
  return HEX_CELLS.filter((cell) => !occupied.has(cell.id) && state.placements.some((placement) => {
    const other = cellAt(placement.cell); return other && distance(cell, other) === 1;
  })).map((cell) => cell.id);
};

export const placeCore = (input: MatchState, playerId: string, coreId: string, cell: string) => {
  const state = cloneMatch(input);
  if (state.phase !== "placement" || state.priority !== playerId) throw new Error("It is not your placement turn.");
  if (!legalPlacementCells(state).includes(cell)) throw new Error("That Core position is not legal on the connected hex grid.");
  const player = playerById(state, playerId); const core = player.cores.find((candidate) => candidate.id === coreId);
  if (!core || state.placements.some((placement) => placement.playerId === playerId && placement.core.id === coreId)) throw new Error("Choose an unused BakuCore.");
  state.placements.push({ playerId, core, cell, order: state.placements.length + 1 });
  entry(state, "game", `${player.name} placed a face-down BakuCore.`); state.placementTurn += 1;
  if (state.placements.length === 12) {
    state.startingPlayer = playerId;
    state.priority = playerId;
    beginTurn(state);
    entry(state, "game", `The twelve-Core Hide Matrix is complete. ${player.name} placed the final BakuCore and is the first turn's starting player.`);
  } else {
    state.priority = otherPlayer(state, playerId).id; state.stepLabel = `BakuCore placement ${state.placements.length + 1} / 12`; state.deadline = deadlineFor("placement");
  }
  return withVersion(state);
};

const beginTurn = (state: MatchState) => {
  state.turn += 1; state.startingPlayer = state.brawlWinner || state.startingPlayer; state.priority = state.startingPlayer;
  ensureRulesState(state).delayedCardTriggers = [];
  ensureRulesState(state).scheduledActions = [];
  state.selected = {}; state.targets = {}; state.rolls = {}; state.pendingReroll = undefined; state.pendingCoinFlip = undefined; state.coinFlipResults = {}; state.pendingEffectDamageResume = undefined; state.pendingRerollOpenEvent = undefined; state.rerollOpenedByEffect = {}; state.rerollTargetByEffect = {}; state.rerollUsage = {}; state.rerollSequence = 0; state.repeatRollAfterReroll = false; state.nextCardCostReduction = {}; state.nextCardEmpowerReduction = {}; state.nextCardEmpowerFree = {}; state.temporaryVictorDiscards = {}; state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {};
  ensureRulesState(state).ignoreArmorRating = {};
  ensureRulesState(state).armorDamageReducedThisTurn = {};
  state.doubleStrike = {}; state.shadowStrike = {}; state.batch = []; state.victorByDamage = false; state.pendingDamage = 0;
  state.pendingLoser = ""; state.damageOrigin = ""; state.revealedFlip = undefined; state.teamAttack = false; state.pendingBrawlRetracts = []; state.delayedRetracts = []; state.winner = "";
  state.collectedEventKeys = [];
  for (const player of state.players) {
    player.energy = 0;
    normalizeEnergyCardState(player, state.turn);
    player.energizedThisTurn = false; player.cardsPlayedThisTurn = 0;
    player.playedCardCostsThisTurn = []; player.playedCardTypesThisTurn = []; player.playedCardMechanicsThisTurn = []; player.factionsPlayedThisTurn = []; player.discardedCardIdsThisTurn = [];
  }
  const now = Date.now();
  const drawCounts = turnDrawCounts(state);
  state.drawPreparedTurn = state.turn;
  state.drawReadyAt = now + (state.turn === 1 ? 3_000 : 0);
  state.drawDeadline = state.drawReadyAt + PHASE_TIMERS.draw * 1_000;
  state.drawnPlayerIds = [];
  state.drawRemainingByPlayer = drawCounts;
  setPhase(state, "draw", state.turn === 1 ? `Turn ${state.turn} • Draw Step begins in 3 seconds` : `Turn ${state.turn} • Draw Step`, state.startingPlayer);
  state.deadline = state.drawDeadline;
  const drawSummary = state.players.map((player) => {
    const count = drawCounts[player.id] ?? 1;
    return `${player.name} has ${count} explicit Draw action${count === 1 ? "" : "s"}`;
  }).join("; ");
  entry(state, "game", `Turn ${state.turn} began. ${drawSummary}.`);
  if (state.turn === 1 && state.gameStartEventedGame !== state.gameNumber) {
    state.gameStartEventedGame = state.gameNumber;
    emitGameEvent(state, {
      id: `game-start:${state.gameNumber}`,
      type: "game-started",
      playerId: "*",
      playerIds: state.players.map((player) => player.id),
    });
  }
};

export const energizeCard = (input: MatchState, playerId: string, cardId?: string) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "energize" || player.energizedThisTurn) throw new Error("Your Energize decision is already complete.");
  if (cardId) {
    const index = player.hand.findIndex((card) => card.id === cardId); if (index < 0) throw new Error("Choose a card in your hand.");
    const [card] = player.hand.splice(index, 1);
    applyEnergyEntryVisibility([card], "hand");
    player.energyZone.push(card);
    setEnergyCardChargeState(state, player.id, [card.id], "charged");
    emitEnergizedEvents(state, player, [card], `${state.turn}:energize:${player.id}:${card.id}`);
    entry(state, "game", `${player.name} Energized a card face down.`);
  } else entry(state, "game", `${player.name} declined to Energize.`);
  player.energizedThisTurn = true;
  if (state.players.every((candidate) => candidate.energizedThisTurn)) setPhase(state, "selection", "Roll Phase • Selection Step", state.startingPlayer);
  return withVersion(state);
};

const retractBakugan = (state: MatchState, bakugan: Bakugan) => {
  bakugan.open = false;
  for (const cell of bakugan.heldCoreCells) {
    const placement = state.placements.find((candidate) => candidate.cell === cell); if (placement) delete placement.attachedTo;
  }
  bakugan.heldCoreCells = [];
};

export const selectBakugan = (input: MatchState, playerId: string, bakuganId: string) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "selection") throw new Error("Bakugan selection is not legal now.");
  if (!player.bakugan.some((bakugan) => !bakugan.open)) player.bakugan.forEach((bakugan) => retractBakugan(state, bakugan));
  const bakugan = player.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!bakugan || bakugan.open) throw new Error("Choose a closed Bakugan.");
  state.selected[playerId] = bakuganId; entry(state, "game", `${player.name} selected a closed Bakugan.`);
  emitGameEvent(state, { id: `${state.turn}:select:${playerId}:${bakuganId}`, type: "select", playerId, targetBakuganId: bakuganId });
  if (state.players.every((candidate) => state.selected[candidate.id])) {
    setPhase(state, "preRoll", "Roll Phase • Pre-roll priority", state.startingPlayer);
    entry(state, "game", "Both players selected. The pre-roll priority window is open.");
  }
  return withVersion(state);
};

export const rotationPhaseOpenCell = (
  state: MatchState,
  playerId: string,
  targetCell: string,
) => physicalRotationPhaseOpenCell(
  state,
  HEX_CELLS,
  playerId,
  targetCell,
  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
);

export const resolveRollOutcome = (
  state: MatchState,
  player: PlayerState,
  randomRoll: (maximum: number) => number = secureRandomInt,
): RollOutcome => resolvePhysicalRollOutcome(
  state,
  HEX_CELLS,
  player,
  randomRoll,
  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
);

const performRolls = (state: MatchState) => {
  const simulation = (() => {
    try {
      return simulatePhysicalRollStep(
        state,
        HEX_CELLS,
        secureRandomInt,
        BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
        { onAttempt: () => consumePhysicalRollAttempt() },
      );
    } catch (error) {
      if (error instanceof PhysicalSimulationError && error.code === "ROLL_ATTEMPT_LIMIT") {
        throw new EngineRuntimeLimitError(
          "physicalRollAttempts",
          MAX_PHYSICAL_ROLL_ATTEMPTS,
          MAX_PHYSICAL_ROLL_ATTEMPTS + 1,
        );
      }
      throw error;
    }
  })();
  for (const attempt of simulation.attempts) {
    for (const roll of attempt.outcomes) {
      entry(
        state,
        "random",
        `${playerById(state, roll.playerId).name}: physical ${simulation.profileId} attempt ${attempt.attempt}, accuracy ${roll.accuracyRoll}/100, double ${roll.doubleRoll}/100 → ${roll.result}. ${roll.note}`,
      );
    }
    if (attempt.repeated) {
      entry(
        state,
        "game",
        `Physical roll attempt ${attempt.attempt} left every Bakugan closed. The Rolling Step repeats under ${simulation.profileId}.`,
      );
    }
  }
  for (const decision of simulation.collisionDecisions) {
    entry(
      state,
      "game",
      `Physical collision on ${decision.coreCell}: ${playerById(state, decision.winnerPlayerId).name} kept the pickup; ${playerById(state, decision.affectedPlayerId).name} was resolved by ${decision.policy}.`,
    );
  }
  const outcomes = simulation.outcomes;
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  const openedPlayerIds: string[] = [];
  for (const roll of outcomes) {
    state.rolls[roll.playerId] = roll;
    const player = playerById(state, roll.playerId);
    const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;
    bakugan.open = roll.result !== "miss-closed";
    if (bakugan.open) {
      openedPlayerIds.push(player.id);
      (bakugan as Bakugan & { openedTurn?: number }).openedTurn = state.turn;
      for (const cell of roll.cores) {
        const placement = state.placements.find((candidate) => candidate.cell === cell);
        if (placement) placement.attachedTo = bakugan.id;
      }
      bakugan.heldCoreCells.push(...roll.cores.filter((cell) => !bakugan.heldCoreCells.includes(cell)));
    }
  }
  setPhase(state, "power", "Brawl Phase • Power Step", state.startingPlayer);
  emitGameEvent(state, {
    id: `${state.turn}:open:${state.informationEpoch}:${openedPlayerIds.sort().join("+")}`,
    type: "open",
    playerId: "*",
    playerIds: openedPlayerIds,
  });
};
export const targetCore = (input: MatchState, playerId: string, cell: string) => {
  const state = cloneMatch(input);
  if (state.phase !== "target" || !state.placements.some((placement) => placement.cell === cell && !placement.attachedTo)) throw new Error("Choose an available Core in the Hide Matrix.");
  state.targets[playerId] = cell; entry(state, "game", `${playerById(state, playerId).name} locked a secret target.`);
  if (state.players.every((player) => state.targets[player.id])) performRolls(state);
  return withVersion(state);
};

const activeBakugan = (state: MatchState, playerId: string) => playerById(state, playerId).bakugan.find((bakugan) => bakugan.id === state.selected[playerId]);
const topCard = (bakugan: Bakugan) => bakugan.evoStack.at(-1) ?? (bakugan.fused ? bakugan.fusionCharacter : undefined) ?? bakugan.character;

const DRAGONOID_MAXIMUS_CARD_ID = "ex-2";
const DRAGONOID_MAXIMUS_REQUIRED_HEROES = ["Dan", "Wynton", "Lia"];

export function alternateWinEffectPending(
  state: Pick<MatchState, "batch"> | null | undefined,
) {
  return Boolean(state?.batch.some((effect) => effect.alternateWin));
}

function stageDragonoidMaximusWinEffect(state: MatchState) {
  if (state.phase === "result" || alternateWinEffectPending(state)) return false;
  for (const owner of state.players) {
    const sourceBakugan = owner.bakugan.find((bakugan) => (
      bakugan.evoStack.at(-1)?.catalogId === DRAGONOID_MAXIMUS_CARD_ID
    ));
    const source = sourceBakugan?.evoStack.at(-1);
    if (!source || !sourceBakugan) continue;
    if (!ruleConditionActive(
      state,
      owner,
      { kind: "controls-named-cards", names: [...DRAGONOID_MAXIMUS_REQUIRED_HEROES] },
      sourceBakugan,
    )) continue;
    const ability = ruleDefinitionForCard(source).abilities.find((candidate) => candidate.kind !== "triggered");
    if (!ability) continue;
    const effect = createRuleObject({
      controllerId: owner.id,
      card: source,
      ability,
      kind: "trigger",
      sourceId: source.id,
    });
    effect.alternateWin = true;
    effect.effect = source.effect;
    // The alternate-win effect is placed beneath every object already on the
    // batch. Existing objects resolve normally, but no new cards may be played.
    state.batch.unshift(effect);
    state.passes = [];
    state.undoWindow = undefined;
    state.stepLabel = `${source.displayName || source.name} • Alternate win effect`;
    entry(
      state,
      "system",
      `${source.displayName || source.name}'s alternate win effect entered the batch. No cards may be played until it resolves.`,
      source,
      "effect",
      owner.id,
    );
    return true;
  }
  return false;
}

class RerollResolutionSuspended extends Error {
  constructor() {
    super("Reroll resolution suspended for a physical roll.");
    this.name = "RerollResolutionSuspended";
  }
}

class DamageResolutionSuspended extends Error {
  constructor() {
    super("Card resolution suspended for a separate attack.");
    this.name = "DamageResolutionSuspended";
  }
}

class CoinFlipResolutionSuspended extends Error {
  constructor() {
    super("Card resolution suspended for a coin flip presentation.");
    this.name = "CoinFlipResolutionSuspended";
  }
}

class CardPlayResolutionSuspended extends Error {
  constructor() {
    super("Card resolution suspended while a nested card play is declared and paid.");
    this.name = "CardPlayResolutionSuspended";
  }
}

function rerollTargetPlayerId(state: MatchState, controllerId: string, target: "controller" | "opponent") {
  return target === "opponent" ? otherPlayer(state, controllerId).id : controllerId;
}

function canStartReroll(state: MatchState, playerId: string) {
  const bakugan = activeBakugan(state, playerId);
  const bothMissed = state.players.every((player) => state.rolls[player.id]?.result === "miss-closed");
  return Boolean(
    state.phase === "power"
    && !bothMissed
    && !state.pendingReroll
    && bakugan
    && state.rolls[playerId]
    && state.placements.some((placement) => !placement.attachedTo),
  );
}

export function cardRerollTimingLegal(state: MatchState, controllerId: string, card: GameCard) {
  if (!/\bmust Reroll\b/i.test(card.effect)) return true;
  const target = /opponent(?:'s)?|opposing Bakugan|their Bakugan/i.test(card.effect) ? "opponent" : "controller";
  return canStartReroll(state, rerollTargetPlayerId(state, controllerId, target));
}

export function intrinsicRerollAbility(state: MatchState | null | undefined, playerId?: string) {
  if (!state || !playerId) return null;
  const bakugan = activeBakugan(state, playerId);
  const roll = state.rolls[playerId];
  if (!bakugan || !roll || roll.result !== "miss-closed") return null;
  const source = topCard(bakugan);
  const text = source.effect;
  if (!/you may Reroll .*miss a Roll|miss a Roll .*you may Reroll|you may Reroll this .*miss/i.test(text)) return null;
  const unlimited = /any time you miss/i.test(text);
  const used = state.rerollUsage[source.id] ?? 0;
  if (!unlimited && used >= 1) return null;
  return { bakugan, source, unlimited, used };
}

export function playerCanActivateIntrinsicReroll(state: MatchState | null | undefined, playerId?: string) {
  return Boolean(
    state
    && playerId
    && state.phase === "power"
    && state.priority === playerId
    && intrinsicRerollAbility(state, playerId)
    && canStartReroll(state, playerId),
  );
}

function beginRerollMutable(
  state: MatchState,
  playerId: string,
  source: { effectId?: string; name: string; mandatory: boolean },
) {
  if (!canStartReroll(state, playerId)) {
    if (source.mandatory) throw new Error("A mandatory Reroll can resolve only after the first roll and before the Victor Step.");
    return false;
  }
  const bakugan = activeBakugan(state, playerId)!;
  const player = playerById(state, playerId);
  const resumePriority = state.startingPlayer;
  const resumeDeadline = deadlineFor("power");
  retractBakugan(state, bakugan);
  delete state.targets[playerId];
  state.pendingReroll = {
    id: `reroll:${state.gameNumber}:${state.turn}:${state.rerollSequence + 1}:${uid()}`,
    playerId,
    bakuganId: bakugan.id,
    sourceEffectId: source.effectId,
    sourceName: source.name,
    mandatory: source.mandatory,
    resumePriority,
    resumeDeadline,
    resumeStepLabel: "Brawl Phase • Power Step",
  };
  setPhase(state, "reroll", `Roll Phase • Reroll • ${player.name} chooses a BakuCore`, playerId);
  entry(state, "game", `${source.name} requires ${player.name} to reroll ${bakugan.name}.`);
  state.undoWindow = undefined;
  return true;
}

export function activateIntrinsicReroll(input: MatchState, playerId: string) {
  const state = cloneMatch(input);
  const ability = intrinsicRerollAbility(state, playerId);
  if (!playerCanActivateIntrinsicReroll(state, playerId) || !ability) {
    throw new Error("This Bakugan does not have an unused Reroll ability for its current miss.");
  }
  state.rerollUsage[ability.source.id] = (state.rerollUsage[ability.source.id] ?? 0) + 1;
  beginRerollMutable(state, playerId, { name: ability.source.displayName || ability.source.name, mandatory: true });
  return withVersion(state);
}

export function selectRerollTarget(input: MatchState, playerId: string, cell: string) {
  const state = cloneMatch(input);
  const pending = state.pendingReroll;
  if (state.phase !== "reroll" || !pending || pending.playerId !== playerId || state.priority !== playerId) {
    throw new Error("Reroll target selection is not legal now.");
  }
  if (!state.placements.some((placement) => placement.cell === cell && !placement.attachedTo)) {
    throw new Error("Choose an available BakuCore in the Hide Matrix.");
  }
  pending.targetCell = cell;
  state.targets[playerId] = cell;
  state.stepLabel = `Roll Phase • Reroll • ${playerById(state, playerId).name} confirms the roll`;
  state.deadline = Date.now() + PHASE_TIMERS.reroll * 1_000;
  entry(state, "game", `${playerById(state, playerId).name} locked a BakuCore target for the reroll.`);
  return withVersion(state);
}

function rerollSourceIsComplete(state: MatchState, sourceEffectId?: string) {
  return !sourceEffectId || !state.batch.some((effect) => effect.id === sourceEffectId);
}

export function finalizeRerollContinuation(state: MatchState, sourceEffectId?: string) {
  if (!rerollSourceIsComplete(state, sourceEffectId) || hasQueuedEffectDraw(state)) return;
  const openEvent = state.pendingRerollOpenEvent;
  if (openEvent && (!openEvent.sourceEffectId || openEvent.sourceEffectId === sourceEffectId)) {
    emitGameEvent(state, {
      id: `${state.turn}:reroll-open:${state.rerollSequence}:${openEvent.playerId}`,
      type: "open",
      playerId: openEvent.playerId,
      playerIds: [openEvent.playerId],
      targetBakuganId: openEvent.bakuganId,
    });
    state.pendingRerollOpenEvent = undefined;
  }
  if (sourceEffectId) {
    delete state.rerollOpenedByEffect[sourceEffectId];
    delete state.rerollTargetByEffect[sourceEffectId];
  }
  if (!state.repeatRollAfterReroll) return;
  state.repeatRollAfterReroll = false;
  state.targets = {};
  setPhase(state, "target", "Roll Phase • Rolling Step • Both players reroll after all Bakugan remained closed", state.startingPlayer);
  entry(state, "game", "The rerolled Bakugan missed while the opposing Bakugan was closed. Both players repeat the Rolling Step.");
}

export function confirmReroll(
  input: MatchState,
  playerId: string,
  randomRoll: (maximum: number) => number = secureRandomInt,
) {
  const state = cloneMatch(input);
  const pending = state.pendingReroll;
  if (state.phase !== "reroll" || !pending || pending.playerId !== playerId || state.priority !== playerId || !pending.targetCell) {
    throw new Error("Reroll confirmation is not legal now.");
  }
  const player = playerById(state, playerId);
  const bakugan = player.bakugan.find((candidate) => candidate.id === pending.bakuganId);
  if (!bakugan || state.selected[playerId] !== bakugan.id) throw new Error("The selected Bakugan is no longer available to reroll.");
  state.targets[playerId] = pending.targetCell;
  const outcome = resolveRollOutcome(state, player, randomRoll);
  state.rerollSequence += 1;
  outcome.rerollSequence = state.rerollSequence;
  outcome.rerollSource = pending.sourceName;
  state.rolls[playerId] = outcome;
  const opened = outcome.result !== "miss-closed";
  bakugan.open = opened;
  bakugan.heldCoreCells = [];
  if (opened) {
    (bakugan as Bakugan & { openedTurn?: number }).openedTurn = state.turn;
    for (const cell of outcome.cores) {
      const placement = state.placements.find((candidate) => candidate.cell === cell);
      if (placement) placement.attachedTo = bakugan.id;
    }
    bakugan.heldCoreCells.push(...outcome.cores);
  }
  entry(
    state,
    "random",
    `${player.name}: reroll ${state.rerollSequence}, accuracy ${outcome.accuracyRoll}/100, double ${outcome.doubleRoll}/100 → ${outcome.result}. ${outcome.note}`,
  );
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  if (pending.sourceEffectId) {
    state.rerollOpenedByEffect[pending.sourceEffectId] = opened;
    state.rerollTargetByEffect[pending.sourceEffectId] = bakugan.id;
  }
  if (opened) state.pendingRerollOpenEvent = {
    playerId,
    bakuganId: bakugan.id,
    sourceEffectId: pending.sourceEffectId,
  };
  const opponent = otherPlayer(state, playerId);
  const opposingBakugan = activeBakugan(state, opponent.id);
  state.repeatRollAfterReroll = !opened && !opposingBakugan?.open;
  const sourceEffectId = pending.sourceEffectId;
  const resumePriority = pending.resumePriority;
  const resumeDeadline = Math.max(pending.resumeDeadline, Date.now() + PHASE_TIMERS.power * 1_000);
  state.pendingReroll = undefined;
  delete state.targets[playerId];
  state.phase = "power";
  state.stepLabel = pending.resumeStepLabel;
  state.priority = resumePriority;
  state.passes = [];
  state.deadline = resumeDeadline;

  if (sourceEffectId) {
    const effect = state.batch.find((candidate) => candidate.id === sourceEffectId);
    if (effect) {
      const completed = resolvePendingEffect(state, effect);
      if (completed) state.batch = state.batch.filter((candidate) => candidate.id !== effect.id);
      if (!completed || state.pendingChoice || state.pendingReroll) return withVersion(state);
    }
  }
  finalizeRerollContinuation(state, sourceEffectId);
  if (!state.pendingChoice && !state.pendingReroll && !hasQueuedEffectDraw(state) && state.phase === "power" && !state.triggerOrders.some((request) => !request.orderedIds)) {
    state.priority = state.startingPlayer;
    state.deadline = deadlineFor("power");
  }
  return withVersion(state);
}
const heldCores = (state: MatchState, bakugan: Bakugan) => bakugan.heldCoreCells.map((cell) => state.placements.find((placement) => placement.cell === cell)?.core).filter(Boolean) as Core[];
const hasCoreType = (state: MatchState, bakugan: Bakugan, type: CoreType) => heldCores(state, bakugan).some((core) => core.type === type);
const coreCode: Record<string, CoreType> = { MS: "Magic Shield", FF: "Flaming Fist", FT: "Fist", SD: "Shield", HE: "Helix" };

const conditionActive = (state: MatchState, player: PlayerState, text: string, choices: CardChoices) => {
  const lower = text.toLowerCase(); const opponent = otherPlayer(state, player.id);
  if (lower.includes("flow")) return player.cardsPlayedThisTurn > 1;
  if (lower.includes("fury")) return player.hand.length === 0;
  if (lower.includes("turbo")) return player.energyZone.length > opponent.energyZone.length;
  if (lower.includes("domination")) return player.bakugan.reduce((sum, b) => sum + b.heldCoreCells.length, 0) > opponent.bakugan.reduce((sum, b) => sum + b.heldCoreCells.length, 0);
  if (lower.includes("sacrifice")) return Boolean(choices.discardCardIds?.length);
  if (lower.includes("only have one open bakugan")) return player.bakugan.filter((bakugan) => bakugan.open).length === 1;
  if (lower.includes("three or more heroes")) return player.heroes.length >= 3;
  if (lower.includes("five or more hero")) return player.heroes.length >= 5;
  if (lower.includes("15 or more energy")) return player.energyZone.length >= 15;
  if (lower.includes("played two or more cards this turn")) return player.cardsPlayedThisTurn >= 2;
  if (lower.includes("if you do")) return choices.confirmed !== false && Boolean(
    choices.discardCardIds?.length || choices.handCardIds?.length || choices.targetHeroId || choices.targetBakuganId,
  );
  if (/damage rating\] becomes 10 or greater/i.test(text)) {
    const bakugan = chooseBakugan(state, player.id, choices);
    return Boolean(bakugan && (topCard(bakugan).damage ?? bakugan.damage) + (state.damageBoost[bakugan.id] ?? 0) >= 10);
  }
  const controlledHero = text.match(/if you control ([^,.]+)/i)?.[1]?.trim().toLowerCase();
  if (controlledHero) return player.heroes.some((hero) => hero.name.toLowerCase() === controlledHero);
  const inspectedType = text.match(/if (?:one|any) of (?:them|those cards) (?:is|are) (?:a|an) (Action|Flip|Hero|Evo|Character) card/i)?.[1] as CardType | undefined;
  if (inspectedType) {
    const inspectedId = choices.deckCardId ?? choices.orderedCardIds?.[0]
      ?? state.players.map((owner) => owner.revealedDeckCardId).find(Boolean);
    return state.players.some((owner) => owner.deckCards.some((candidate) => candidate.id === inspectedId && candidate.type === inspectedType));
  }
  if (/(?:not|isn['’]t) a Flip card/i.test(text)) {
    const revealedId = (player as PlayerState & { revealedDeckCardId?: string }).revealedDeckCardId;
    const revealed = player.deckCards.find((card) => card.id === revealedId);
    return Boolean(revealed && revealed.type !== "Flip" && revealed.type !== "Flip Hero");
  }
  return false;
};


export const cardChoiceSpec = (_state: MatchState, _playerId: string, card: GameCard) => {
  const mapping: Partial<Record<keyof CardChoices, string>> = {
    targetBakuganId: "targetBakugan",
    targetEffectId: "targetEffect",
    targetPlayerId: "targetPlayer",
    targetHeroId: "targetHero",
    targetEvoId: "targetEvo",
    targetEnergyId: "targetEnergy",
    targetEnergyIds: "targetEnergy",
    sourceBakuganId: "targetBakugan",
    secondaryTargetBakuganId: "targetBakugan",
    targetCardId: "targetCard",
    coreCell: "core",
    secondaryCoreCell: "core",
    discardCardIds: "discard",
    handCardIds: "multiHand",
    orderedCardIds: "deckOrder",
    deckCardId: "deckCard",
    xValue: "xValue",
    mode: "mode",
    paymentMode: "mode",
    empower: "mode",
    confirmed: "mode",
  };
  const definition = ruleDefinitionForCard(card);
  const result = [...new Set(definition.play.choices
    .filter((choice) => choice.timing === "announce" || choice.timing === "pay")
    .map((choice) => mapping[choice.id])
    .filter((value): value is string => Boolean(value)))];
  if (instabrawlCostFor(card) != null && !result.includes("mode")) result.push("mode");
  return result;
};

const stageSimultaneousTriggers = (state: MatchState, event: string, triggers: PendingEffect[]) => {
  if (!triggers.length) return;
  const apnap = [...state.players].sort((a, b) => Number(b.id === state.startingPlayer) - Number(a.id === state.startingPlayer));
  const requests = apnap.map((player) => {
    const controlled = triggers.filter((trigger) => trigger.controllerId === player.id);
    return {
      id: uid(),
      event,
      controllerId: player.id,
      triggerIds: controlled.map((trigger) => trigger.id),
      triggers: controlled,
      orderedIds: controlled.length <= 1 ? controlled.map((trigger) => trigger.id) : undefined,
    };
  }).filter((request) => request.triggers.length);
  state.triggerOrders.push(...requests);
  if (state.triggerOrders.some((request) => !request.orderedIds)) {
    state.stepLabel = `${event} • Order simultaneous triggers`;
    state.priority = state.triggerOrders.find((request) => !request.orderedIds)!.controllerId;
    state.deadline = Date.now() + 35_000;
  } else {
    for (const request of state.triggerOrders) state.batch.push(...request.triggers);
    state.triggerOrders = [];
  }
};

export const orderTriggers = (input: MatchState, playerId: string, requestId: string, orderedIds: string[]) => {
  const state = cloneMatch(input);
  const request = state.triggerOrders.find((candidate) => candidate.id === requestId);
  if (!request || request.controllerId !== playerId || request.orderedIds) throw new Error("You do not have triggers to order.");
  if (orderedIds.length !== request.triggerIds.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !request.triggerIds.includes(id))) {
    throw new Error("Order every simultaneous trigger exactly once.");
  }
  request.orderedIds = orderedIds;
  const unresolved = state.triggerOrders.find((candidate) => !candidate.orderedIds);
  if (unresolved) {
    state.priority = unresolved.controllerId;
    state.deadline = Date.now() + 35_000;
  } else {
    for (const group of state.triggerOrders) {
      for (const id of group.orderedIds!) state.batch.push(group.triggers.find((trigger) => trigger.id === id)!);
    }
    entry(state, "game", `${request.event} triggers entered the batch in active-player/non-active-player order.`);
    state.triggerOrders = [];
    state.priority = state.startingPlayer;
    state.deadline = deadlineFor(state.phase);
  }
  return withVersion(state);
};

export type GameEvent = {
  id: string;
  type: "select" | "open" | "discard" | "energize" | "gear-attach" | "card-play" | "fusion" | "victor" | "attack" | "damage-taken" | "hand-empty" | "end-turn" | "game-started";
  playerId: string;
  playerIds?: string[];
  cardType?: CardType;
  targetBakuganId?: string;
  sourceCards?: GameCard[];
  choices?: CardChoices;
};

/** Collect typed triggered abilities for one authoritative game event. */
export const collectTriggersForEvent = (state: MatchState, event: GameEvent) => {
  if (state.collectedEventKeys.includes(event.id)) return [];
  state.collectedEventKeys.push(event.id);
  const names = {
    "game-started": "GAME_STARTED", select: "BAKUGAN_SELECTED", open: "BAKUGAN_OPENED", discard: "CARD_DISCARDED", energize: "ENERGY_CARD_ENERGIZED",
    "gear-attach": "BAKU_GEAR_ATTACHED",
    "card-play": "CARD_PLAYED", fusion: "FUSION_COMPLETED", victor: "VICTOR_DECLARED", attack: "ATTACK_CREATED",
    "damage-taken": "DAMAGE_TAKEN", "hand-empty": "HAND_EMPTIED", "end-turn": "TURN_ENDED",
  } as const;
  const actorIds = (event.type === "open" || event.type === "game-started") && event.playerIds
    ? [...new Set(event.playerIds)]
    : [event.playerId === "*" ? state.startingPlayer : event.playerId];
  return actorIds.flatMap((actorId) => collectRuleTriggers(state, {
    id: actorIds.length > 1 ? `${event.id}:${actorId}` : event.id,
    name: names[event.type],
    actorId,
    controllerId: event.playerId === "*" ? actorId : event.playerId,
    card: event.sourceCards?.[0],
    cardType: event.cardType,
    targetBakuganId: event.targetBakuganId ?? (event.type === "open" ? state.selected[actorId] : undefined),
    choices: event.choices,
    amount: event.type === "attack" ? state.pendingDamage : undefined,
    createdAt: Date.now(),
  })) as PendingEffect[];
};

/** Resolve trigger objects created by an immediate event before its phase can continue. */
export function resolveImmediateRuleObjects(state: MatchState, objects: PendingEffect[]) {
  for (const object of objects) {
    const live = state.batch.find((candidate) => candidate.id === object.id);
    if (!live) continue;
    const completed = live.negated || resolvePendingEffect(state, live);
    if (completed) state.batch = state.batch.filter((candidate) => candidate.id !== live.id);
    else break;
  }
}

export const emitGameEvent = (state: MatchState, event: GameEvent) => {
  const triggers = collectTriggersForEvent(state, event);
  stageSimultaneousTriggers(state, event.type, triggers);
  return triggers;
};

type MutableCardPlayResult = "staged" | "committed";

function choiceValuePresent(choices: CardChoices, id: keyof CardChoices) {
  const value = choices[id];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
}

function captureCardPlayMoment(state: MatchState, request: PendingCardPlay, moment: EvaluationMoment) {
  const { card } = playSourceCard(state, request);
  const definition = ruleDefinitionForCard(card);
  request.valueSnapshots = captureCardPlayValues(state, definition.play, moment, {
    controllerId: request.controllerId,
    chosenPlayerId: request.choices.targetPlayerId,
    choices: request.choices,
    sourceCardId: card.id,
  }, request.valueSnapshots ?? {});
  return request.valueSnapshots;
}

function playSourceCard(state: MatchState, request: PendingCardPlay) {
  const owner = playerById(state, request.sourceOwnerId);
  if (!owner) throw new Error("The card's source-zone owner is no longer in the match.");
  if (request.sourceZone === "hand") {
    const card = owner.hand.find((candidate) => candidate.id === request.cardId);
    if (!card) throw new Error("The card is no longer in the requested hand.");
    return { owner, card };
  }
  if (request.sourceZone === "deck") {
    const card = owner.deckCards.find((candidate) => candidate.id === request.cardId);
    if (!card) throw new Error("The card is no longer in the requested deck position.");
    return { owner, card };
  }
  if (request.sourceZone === "damage-reveal") {
    const card = owner.discard.find((candidate) => candidate.id === request.cardId);
    if (!card || state.revealedFlip?.id !== card.id) throw new Error("The revealed Flip is no longer available to play.");
    return { owner, card };
  }
  const card = owner.discard.find((candidate) => candidate.id === request.cardId);
  if (!card) throw new Error("The card is no longer in the requested discard pile.");
  return { owner, card };
}

function removePlaySourceCard(state: MatchState, request: PendingCardPlay) {
  const { owner, card } = playSourceCard(state, request);
  if (request.sourceZone === "hand") owner.hand = owner.hand.filter((candidate) => candidate.id !== card.id);
  else if (request.sourceZone === "deck") {
    owner.deckCards = owner.deckCards.filter((candidate) => candidate.id !== card.id);
    syncDeck(owner);
    delete owner.revealedDeckCardId;
  } else {
    owner.discard = owner.discard.filter((candidate) => candidate.id !== card.id);
    if (request.sourceZone === "damage-reveal") state.revealedFlip = undefined;
  }
  return card;
}

function validateCardPlayRequest(state: MatchState, request: PendingCardPlay, choices: CardChoices) {
  if (alternateWinEffectPending(state)) throw new Error("Dragonoid Maximus's alternate win effect cannot be responded to with cards.");
  const { card } = playSourceCard(state, request);
  if (card.type === "Character") throw new Error("Character cards cannot be played from a card zone.");
  if (request.instabrawl && (request.origin !== "priority" || card.type !== "Hero" || instabrawlCostFor(card) == null)) {
    throw new Error("Only a Hero with a printed InstaBrawl cost can use InstaBrawl.");
  }
  if (!cardRerollTimingLegal(state, request.controllerId, card)) {
    throw new Error("This mandatory Reroll card can be played only after the first roll and before the Victor Step.");
  }
  if (request.origin === "priority") {
    if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== request.controllerId) {
      throw new Error("You do not have priority in a card-play window.");
    }
    if (request.sourceZone !== "hand" || request.sourceOwnerId !== request.controllerId) {
      throw new Error("An ordinary priority play must begin in your hand.");
    }
    if (card.type === "Flip" || card.type === "Flip Hero") throw new Error("Flip cards are played only when revealed by damage.");
  }
  if (request.origin === "damage") {
    if (state.phase !== "damage" || state.pendingLoser !== request.controllerId || request.sourceZone !== "damage-reveal") {
      throw new Error("A damage-revealed Flip can only be played during its Damage Step decision.");
    }
    if (!["Flip", "Flip Hero"].includes(card.type) || !revealedFlipCanBePlayed(state, request.controllerId, card)) {
      throw new Error("This revealed Flip cannot legally be played against the current attack.");
    }
  }
  if (card.type === "Baku-Gear") {
    const target = playerById(state, request.controllerId).bakugan.find((candidate) => candidate.id === choices.targetBakuganId);
    // Allow the declaration stage to expose the target choice. Once a target
    // has been supplied, validate the attachment against the live state.
    if (!target && choices.targetBakuganId) throw new Error("Choose one of your Bakugan for this Baku-Gear.");
    if (!target) return;
    if (!target.open) throw new Error("Baku-Gear must be attached to an open Bakugan.");
    const requiredFaction = card.effect.match(/only play this on an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan/i)?.[1];
    if (requiredFaction && !effectiveBakuganFactions(target).includes(requiredFaction as Faction)) {
      throw new Error(`This Baku-Gear can only be played on a ${requiredFaction} Bakugan.`);
    }
    const attached = target.bakuGear ?? [];
    if (attached.length >= 2) throw new Error("That Bakugan has no open Baku-Gear slot.");
  }
  if (card.cost === "X" && !request.forcedFreeBase && !Number.isFinite(choices.xValue)) {
    const definition = ruleDefinitionForCard(card);
    if (!definition.play.choices.some((choice) => choice.id === "xValue" && choice.timing === "pay")) {
      throw new Error("Choose X before paying for this card.");
    }
  }
}

function selectedPaymentMode(state: MatchState, request: PendingCardPlay, card: GameCard, choices: CardChoices) {
  const modes = cardPaymentModes(state, request.controllerId, card, choices, { forcedFreeBase: request.forcedFreeBase, capturedValues: request.valueSnapshots });
  const inferredAlternative = modes.find((mode) => mode.id !== "normal" && mode.id !== "forced-free"
    && mode.additionalCosts.some((cost) => choiceValuePresent(choices, cost.choiceId)));
  const id = request.forcedFreeBase ? "forced-free" : choices.paymentMode ?? inferredAlternative?.id ?? "normal";
  return { modes, mode: modes.find((candidate) => candidate.id === id) };
}

function paymentModeField(state: MatchState, request: PendingCardPlay, card: GameCard, choices: CardChoices) {
  if (request.forcedFreeBase) return undefined;
  const { modes } = selectedPaymentMode(state, request, card, choices);
  if (modes.length <= 1) return undefined;
  return {
    id: "paymentMode" as const,
    kind: "mode" as const,
    label: "Choose how to pay for this card",
    chooserId: request.controllerId,
    visibility: "public" as const,
    timing: "pay" as const,
    minimum: 1,
    maximum: 1,
    required: true,
    options: modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      description: mode.legal
        ? `${mode.energyCost} Energy${mode.additionalCosts.length ? " plus the listed additional cost" : ""}.`
        : mode.reason ?? "This payment method is unavailable.",
      disabled: !mode.legal,
    })),
  };
}

function alternativeCostChoiceIds(card: GameCard) {
  return new Set(ruleDefinitionForCard(card).play.costModifiers.flatMap((modifier) => (
    modifier.kind === "cost-alternative"
      ? modifier.components.filter((component): component is Extract<typeof component, { kind: "cost-discard" }> => component.kind === "cost-discard").map((component) => component.choiceId)
      : []
  )));
}

function stageAdditionalCardPlayCosts(state: MatchState, request: PendingCardPlay): MutableCardPlayResult {
  const { card } = playSourceCard(state, request);
  const choices = request.choices;
  const { mode } = selectedPaymentMode(state, request, card, choices);
  if (!mode) throw new Error("The selected card payment method is no longer available.");
  if (!mode.legal) throw new Error(mode.reason ?? "The selected card payment method is unavailable.");
  const missing = mode.additionalCosts.find((cost) => {
    const value = choices[cost.choiceId];
    return !Array.isArray(value) || value.length !== cost.amount;
  });
  if (missing?.kind === "discard") {
    const payer = playerById(state, request.controllerId);
    const options = payer.hand
      .filter((candidate) => candidate.id !== card.id)
      .map((candidate) => ({ id: candidate.id, label: candidate.displayName || candidate.name, ownerId: payer.id }));
    if (options.length < missing.amount) throw new Error(`This payment requires ${missing.amount} discardable card${missing.amount === 1 ? "" : "s"}.`);
    state.pendingChoice = {
      id: uid(),
      kind: "card-play",
      controllerId: request.controllerId,
      cardId: request.cardId,
      schema: {
        id: `${state.id}:${state.version}:${request.cardId}:additional-cost`,
        sourceId: request.cardId,
        sourceName: card.displayName || card.name,
        controllerId: request.controllerId,
        timing: "pay",
        simultaneous: false,
        fields: [{
          id: missing.choiceId,
          kind: "hand-cards",
          label: `Choose ${missing.amount} card${missing.amount === 1 ? "" : "s"} to discard as an additional cost`,
          chooserId: request.controllerId,
          visibility: "private",
          timing: "pay",
          minimum: missing.amount,
          maximum: missing.amount,
          required: true,
          options,
        }],
      },
      answers: {},
      createdVersion: state.version,
      beforeState: request.beforeState,
      playRequest: request,
      playStage: "additional-cost",
      cancellable: request.origin !== "effect" || Boolean(request.optional),
      irreversibleInformation: request.irreversibleInformation,
    };
    state.priority = request.controllerId;
    state.stepLabel = `${card.displayName || card.name} • Additional cost`;
    state.deadline = Date.now() + 35_000;
    return "staged";
  }
  captureCardPlayMoment(state, request, "pay");
  commitCardPlayMutable(state, request);
  return "committed";
}

function emitPaymentDiscardEvents(state: MatchState, controllerId: string, cards: GameCard[]) {
  if (!cards.length) return;
  const player = playerById(state, controllerId);
  emitGameEvent(state, {
    id: `${state.turn}:discard:${cards.map((card) => card.id).join(",")}:${state.version}:payment`,
    type: "discard",
    playerId: controllerId,
    targetBakuganId: activeBakugan(state, controllerId)?.id,
    sourceCards: cards,
  });
  if (player.hand.length === 0) emitGameEvent(state, {
    id: `${state.turn}:hand-empty:${controllerId}:${state.version}:payment`,
    type: "hand-empty",
    playerId: controllerId,
  });
}

function commitCardPlayMutable(state: MatchState, request: PendingCardPlay) {
  const located = playSourceCard(state, request);
  const card = located.card;
  const choices = request.choices;
  validateCardPlayRequest(state, request, choices);
  const { mode } = selectedPaymentMode(state, request, card, choices);
  if (!mode || !mode.legal) throw new Error(mode?.reason ?? "This card has no legal payment method.");
  if (mode.instabrawl && request.origin !== "priority") {
    throw new Error("InstaBrawl can only be declared when playing a Hero from your hand.");
  }
  request.instabrawl = Boolean(mode.instabrawl);

  const discardedBeforePayment = mode.additionalCosts.flatMap((cost) => {
    const value = choices[cost.choiceId];
    const ids = new Set(Array.isArray(value) ? value.map(String) : []);
    return playerById(state, request.controllerId).hand.filter((candidate) => ids.has(candidate.id));
  });
  const context = {
    forcedFreeBase: request.forcedFreeBase,
    instabrawlBaseCost: mode.instabrawl ? instabrawlCostFor(card) ?? undefined : undefined,
    selectedAlternativeId: mode.id === "normal" || mode.id === "forced-free" ? undefined : mode.id,
    capturedValues: request.valueSnapshots,
  };
  const payment = beginCardPayment(state, request.controllerId, card, choices, context);
  prepareDeclaredEnergyPayment(state, request.controllerId, payment.calculatedCost);
  commitCardPayment(state, request.controllerId);
  emitPaymentDiscardEvents(state, request.controllerId, discardedBeforePayment);

  const played = removePlaySourceCard(state, request);
  if (request.instabrawl) played.instabrawl = true;
  const controller = playerById(state, request.controllerId);
  recordCardPlayedForTurn(controller, played, state.turn);
  state.nextCardEmpowerReduction ??= {};
  state.nextCardEmpowerFree ??= {};
  state.nextCardCostReduction[request.controllerId] = 0;
  state.nextCardEmpowerReduction[request.controllerId] = 0;
  state.nextCardEmpowerFree[request.controllerId] = false;
  ensureRulesState(state).costModifiers = ensureRulesState(state).costModifiers.filter((modifier) => !(
    modifier.duration === "next-card"
    && playerIdsForScope(state, modifier.playerScope, { controllerId: modifier.controllerId }).includes(request.controllerId)
  ));

  const definition = ruleDefinitionForCard(played);
  const ability = definition.abilities.find((candidate) => candidate.kind !== "triggered") ?? definition.abilities[0];
  if (!ability) throw new Error(`${played.name} does not have a legal card-play ability.`);
  const batchObject = createRuleObject({
    controllerId: request.controllerId,
    cardOwnerId: request.cardOwnerId,
    card: played,
    ability,
    choices,
    kind: "card",
  });
  batchObject.valueSnapshots = structuredClone(request.valueSnapshots ?? {});
  state.batch.push(batchObject);
  state.passes = [];
  if (played.type === "Action") {
    if ((state.copyNextAction[request.controllerId] ?? 0) > 0) {
      state.copyNextAction[request.controllerId] -= 1;
      state.batch.push(copyRuleObject(batchObject, request.controllerId));
    }
  }

  emitGameEvent(state, {
    id: `${state.turn}:card-play:${played.id}`,
    type: "card-play",
    playerId: request.controllerId,
    cardType: played.type,
    sourceCards: [played],
    targetBakuganId: played.type === "Evo"
      ? (choices.sourceBakuganId ?? choices.targetBakuganId)
      : activeBakugan(state, request.controllerId)?.id,
    choices,
  });

  if (request.origin === "damage") {
    const rules = ensureRulesState(state) as ReturnType<typeof ensureRulesState> & {
      damageResume?: { playerId: string; previousPhase: "damage"; revealedFlipId: string };
    };
    rules.damageResume = { playerId: request.controllerId, previousPhase: "damage", revealedFlipId: played.id };
    state.phase = "postDamage";
    state.stepLabel = `Damage Step • Respond to ${played.displayName || played.name}`;
    state.priority = request.controllerId;
    state.deadline = Date.now() + 25_000;
  }

  const freeWording = mode.freeBase ? " after its base Energy cost became free" : "";
  entry(state, "game", `${controller.name} added ${played.name} to the batch for ${payment.calculatedCost} Energy${freeWording}.`, played, "played", request.controllerId);

  if (request.origin === "priority") {
    state.undoWindow = {
      actorId: request.controllerId,
      action: "play-card",
      beforeVersion: state.version,
      afterVersion: state.version + 1,
      batchObjectId: batchObject.id,
      informationEpoch: state.informationEpoch,
      priorityEpoch: state.priorityEpoch,
      irreversibleInformation: Boolean(request.irreversibleInformation),
      snapshot: request.beforeState,
    };
  } else state.undoWindow = undefined;
  return batchObject;
}

function stageCardPlayMutable(state: MatchState, request: PendingCardPlay): MutableCardPlayResult {
  const { card } = playSourceCard(state, request);
  validateCardPlayRequest(state, request, request.choices);
  const definition = ruleDefinitionForCard(card);
  const alternativeIds = alternativeCostChoiceIds(card);
  const alreadyChosen = (id: keyof CardChoices) => choiceValuePresent(request.choices, id);
  const announce = buildChoiceSchemaFromSpecs(
    state,
    request.controllerId,
    card,
    definition.play.choices.filter((choice) => !alreadyChosen(choice.id)),
    "announce",
    request.choices,
  );
  const pay = buildChoiceSchemaFromSpecs(
    state,
    request.controllerId,
    card,
    definition.play.choices.filter((choice) => !alternativeIds.has(choice.id) && !alreadyChosen(choice.id)),
    "pay",
    request.choices,
  );
  const mode = paymentModeField(state, request, card, request.choices);
  const fields = [...announce.fields, ...pay.fields, ...(mode && !alreadyChosen("paymentMode") ? [mode] : [])];
  if (fields.length) {
    const schema = { ...announce, timing: "announce" as const, fields, simultaneous: announce.simultaneous || pay.simultaneous };
    const enabledCompletion = schemaHasLegalCompletion(schema);
    // A damage-revealed Flip may expose unavailable payment methods so the
    // player can see why it cannot be paid and choose Skip instead.
    if (!enabledCompletion && request.origin !== "damage") {
      throw new Error(`${card.displayName || card.name} has no legal targets, choices, or payment method.`);
    }
    state.pendingChoice = {
      id: uid(),
      kind: "card-play",
      controllerId: request.controllerId,
      cardId: request.cardId,
      schema,
      answers: {},
      createdVersion: state.version,
      beforeState: request.beforeState,
      playRequest: request,
      playStage: "declare",
      cancellable: request.origin !== "effect" || Boolean(request.optional),
      irreversibleInformation: request.irreversibleInformation,
    };
    state.priority = fields.find((field) => field.options.some((option) => !option.disabled))?.chooserId
      ?? fields[0]?.chooserId
      ?? request.controllerId;
    state.stepLabel = `${card.displayName || card.name} • Declare card play`;
    state.deadline = Date.now() + 35_000;
    return "staged";
  }
  captureCardPlayMoment(state, request, "announce");
  return stageAdditionalCardPlayCosts(state, request);
}

function finishNestedCardPlayContinuation(state: MatchState, request: PendingCardPlay) {
  if (request.origin !== "effect" || !request.parentEffectId) return;
  const parent = state.batch.find((candidate) => candidate.id === request.parentEffectId);
  if (!parent) return;
  parent.instructionIndex = request.parentNextInstructionIndex ?? parent.instructionIndex ?? 0;
  if (isRuleObject(parent)) parent.cursor.instructionIndex = parent.instructionIndex;
  state.priority = request.resumePriority ?? state.startingPlayer;
  state.deadline = request.resumeDeadline ?? deadlineFor(state.phase);
  state.stepLabel = request.resumeStepLabel ?? state.stepLabel;
  const completed = resolvePendingEffect(state, parent);
  if (completed) {
    state.batch = state.batch.filter((candidate) => candidate.id !== parent.id);
    finalizeRerollContinuation(state, parent.id);
    if (!state.pendingChoice && !state.pendingReroll && !hasQueuedEffectDraw(state)) {
      state.priority = state.startingPlayer;
      state.deadline = deadlineFor(state.phase);
    }
  }
}

function cancelNestedCardPlayContinuation(state: MatchState, request: PendingCardPlay) {
  if (request.origin === "effect") {
    finishNestedCardPlayContinuation(state, request);
    return;
  }
  if (request.origin === "damage") {
    state.phase = "damage";
    state.priority = request.controllerId;
    state.stepLabel = `Damage Step • Flip decision • ${state.pendingDamage} remaining`;
    state.deadline = Date.now() + 35_000;
  }
}

export const prepareRevealedFlipPlay = (input: MatchState, playerId: string, cardId: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input);
  if (state.pendingChoice) throw new Error("Complete the current choice before playing the revealed Flip.");
  const flip = state.revealedFlip;
  if (!flip || flip.id !== cardId) throw new Error("Only the currently revealed Flip card may be played.");
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "damage-reveal",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "damage",
    choices: { ...choices },
    beforeState: undefined,
  };
  stageCardPlayMutable(state, request);
  return withVersion(state);
};

export const prepareCardPlay = (input: MatchState, playerId: string, cardId: string) => {
  const state = cloneMatch(input);
  if (state.pendingChoice) throw new Error("Complete the current choice before starting another action.");
  const player = playerById(state, playerId);
  const card = player.hand.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("That card is not in your hand.");
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "hand",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "priority",
    choices: {},
    beforeState: JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined }),
  };
  stageCardPlayMutable(state, request);
  return withVersion(state);
};

export const cancelCardChoice = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  const pending = state.pendingChoice;
  if (!pending || ["resolution", "forced-discard", "gear-replacement"].includes(pending.kind) || pending.controllerId !== playerId || Object.keys(pending.answers).length) {
    throw new Error("This card choice can no longer be cancelled.");
  }
  if (pending.cancellable === false) throw new Error("This card play is mandatory and cannot be cancelled.");
  const request = pending.playRequest;
  const card = request ? playSourceCard(state, request).card : playerById(state, playerId).hand.find((candidate) => candidate.id === pending.cardId);
  state.pendingChoice = undefined;
  if (request) cancelNestedCardPlayContinuation(state, request);
  if (!request || request.origin === "priority") {
    state.priority = playerId;
    state.stepLabel = `${state.phase} • Priority`;
  }
  entry(state, "game", `${playerById(state, playerId).name} cancelled ${card?.name ?? "the pending card"} before playing it.`);
  return withVersion(state);
};

export const submitCardChoice = (input: MatchState, playerId: string, choices: CardChoices) => {
  const state = cloneMatch(input);
  const pending = state.pendingChoice;
  if (!pending) throw new Error("There is no pending card choice.");
  if (!pending.schema.fields.some((field) => field.chooserId === playerId)) throw new Error("This choice belongs to another player.");
  validateChoices(pending.schema, playerId, choices);
  pending.answers[playerId] = choices;
  const irreversible = playerId !== pending.controllerId
    || pending.schema.fields.some((field) => field.chooserId === playerId && field.visibility === "private");
  if (irreversible) {
    pending.irreversibleInformation = true;
    state.informationEpoch += 1;
    if (state.undoWindow) state.undoWindow.irreversibleInformation = true;
    state.undoWindow = undefined;
  }
  entry(state, "game", `${playerById(state, playerId).name} locked ${pending.schema.simultaneous ? "a private" : "a"} choice for ${pending.schema.sourceName}.`);
  if (!schemaIsComplete(pending.schema, pending.answers)) {
    const next = pending.schema.fields.find((field) => !pending.answers[field.chooserId]);
    if (next) state.priority = next.chooserId;
    return withVersion(state);
  }
  const merged = mergeChoiceAnswers(pending.schema, pending.answers);
  const submittedSyncCardId = choices.syncCardId?.[0] ?? merged.syncCardId;
  const syncCauseCard = pending.kind === "resolution" && pending.pendingEffectId
    ? state.batch.find((candidate) => candidate.id === pending.pendingEffectId)?.card
    : undefined;
  let revealTriggers: PendingEffect[] = [];
  if (submittedSyncCardId) {
    const revealed = playerById(state, pending.controllerId).hand.find((card) => card.id === submittedSyncCardId);
    if (revealed) {
      revealed.revealedToOpponents = true;
      entry(state, "game", `${playerById(state, pending.controllerId).name} revealed ${revealed.name} from hand for Sync.`);
      revealTriggers = syncCauseCard ? emitHandRevealEvents(
        state,
        pending.controllerId,
        [revealed],
        syncCauseCard,
        `${pending.id}:hand-reveal:sync`,
      ) : [];
    }
  }
  if (pending.kind === "resolution" && pending.instructionIndex != null
    && submittedSyncCardId && pending.schema.fields.some((field) => field.id === "syncCardId")) {
    const effect = state.batch.find((candidate) => candidate.id === pending.pendingEffectId);
    if (!effect) throw new Error("The resolving batch object is no longer available.");
    effect.resolvedChoices = {
      ...(effect.resolvedChoices ?? {}),
      [String(pending.instructionIndex)]: {
        ...(effect.resolvedChoices?.[String(pending.instructionIndex)] ?? {}),
        syncCardId: choices.syncCardId,
      },
    };
    if (revealTriggers.length) {
      state.pendingChoice = undefined;
      resolveImmediateRuleObjects(state, revealTriggers);
      if (!state.pendingChoice && !state.pendingReroll && !state.pendingCoinFlip) {
        state.priority = pending.resumePriority ?? state.startingPlayer;
        state.deadline = pending.resumeDeadline ?? deadlineFor(state.phase);
        state.stepLabel = pending.resumeStepLabel ?? state.stepLabel;
      }
      return withVersion(state);
    }
    const remainingFields = pending.schema.fields.filter((field) => {
      if (field.id === "syncCardId") return false;
      const value = choices[field.id];
      return value === undefined || (Array.isArray(value) && value.length === 0);
    }).map((field) => ({ ...field, minimum: Math.max(1, field.minimum), required: true }));
    if (remainingFields.length) {
      pending.schema = { ...pending.schema, fields: remainingFields };
      pending.answers = {};
      state.priority = remainingFields[0].chooserId;
      state.stepLabel = `${effect.card.displayName || effect.card.name} • Complete Sync clause`;
      state.deadline = Date.now() + 35_000;
      return withVersion(state);
    }
  }
  if (pending.kind === "card-play" && pending.playRequest) {
    const request: PendingCardPlay = structuredClone(pending.playRequest);
    request.choices = { ...request.choices, ...merged };
    request.irreversibleInformation = Boolean(request.irreversibleInformation || pending.irreversibleInformation);
    state.pendingChoice = undefined;
    if (pending.playStage === "declare") captureCardPlayMoment(state, request, "announce");
    const result = stageAdditionalCardPlayCosts(state, request);
    if (result === "committed") finishNestedCardPlayContinuation(state, request);
    return withVersion(state);
  }
  if (pending.kind === "forced-discard") {
    const field = pending.schema.fields.find((candidate) => candidate.id === "discardCardIds" && candidate.chooserId === playerId);
    const amount = field?.maximum ?? 0;
    state.pendingChoice = undefined;
    if (amount > 0) discardFromHand(state, playerById(state, playerId), amount, merged.discardCardIds ?? []);
    state.priority = pending.resumePriority ?? state.startingPlayer;
    state.deadline = pending.resumeDeadline ?? deadlineFor(state.phase);
    state.stepLabel = pending.resumeStepLabel ?? state.stepLabel;
    return withVersion(state);
  }
  if (pending.kind === "gear-replacement") {
    const target = playerById(state, pending.controllerId).bakugan.find((bakugan) => bakugan.id === pending.gearReplacement?.bakuganId);
    const keepId = merged.keepBakuGearId;
    if (target && keepId && pending.gearReplacement?.gearIds.includes(keepId)) {
      const kept = target.bakuGear?.find((gear) => gear.id === keepId);
      const removed = target.bakuGear?.filter((gear) => gear.id !== keepId) ?? [];
      target.bakuGear = kept ? [kept] : [];
      playerById(state, pending.controllerId).discard.push(...removed);
    }
    state.pendingChoice = undefined;
    state.priority = pending.resumePriority ?? state.startingPlayer;
    state.deadline = pending.resumeDeadline ?? deadlineFor(state.phase);
    state.stepLabel = pending.resumeStepLabel ?? state.stepLabel;
    return withVersion(state);
  }
  if (pending.kind === "resolution" && pending.instructionIndex != null) {
    const effect = state.batch.find((candidate) => candidate.id === pending.pendingEffectId);
    const instruction = effect
      ? compileCardEffect(effect.card, effect.effect ?? effect.card.effect).instructions[pending.instructionIndex]
      : undefined;
    const targetPlayerId = merged.targetPlayerId;
    if (effect && instruction && targetPlayerId
      && instruction.actions.some((action) => action.kind === "discard")
      && /choose a player to discard a card/i.test(instruction.sourceText)
      && !merged.discardCardIds?.length) {
      const targetPlayer = playerById(state, targetPlayerId);
      effect.resolvedChoices = {
        ...(effect.resolvedChoices ?? {}),
        [String(pending.instructionIndex)]: {
          ...(effect.resolvedChoices?.[String(pending.instructionIndex)] ?? {}),
          targetPlayerId,
        },
      };
      if (targetPlayer.hand.length) {
        state.pendingChoice = {
          ...pending,
          id: uid(),
          schema: {
            id: `${state.id}:${state.version}:${effect.card.id}:chosen-player-discard`,
            sourceId: effect.card.id,
            sourceName: effect.card.displayName || effect.card.name,
            controllerId: effect.controllerId,
            timing: "resolve",
            simultaneous: false,
            fields: [{
              id: "discardCardIds",
              kind: "hand-cards",
              label: "Choose a card to discard",
              chooserId: targetPlayerId,
              visibility: "private",
              timing: "resolve",
              minimum: 1,
              maximum: 1,
              required: true,
              options: targetPlayer.hand.map((card) => ({
                id: card.id,
                label: card.displayName || card.name,
                ownerId: targetPlayerId,
              })),
            }],
          },
          answers: {},
        };
        state.priority = targetPlayerId;
        state.stepLabel = `${effect.card.displayName || effect.card.name} • Choose a discard`;
        state.deadline = Date.now() + 35_000;
        return withVersion(state);
      }
    }
  }
  if (pending.kind === "resolution") {
    const effect = state.batch.find((candidate) => candidate.id === pending.pendingEffectId);
    if (!effect || pending.instructionIndex == null) throw new Error("The resolving batch object is no longer available.");
    effect.resolvedChoices = {
      ...(effect.resolvedChoices ?? {}),
      [String(pending.instructionIndex)]: {
        ...(effect.resolvedChoices?.[String(pending.instructionIndex)] ?? {}),
        ...merged,
      },
    };
    state.pendingChoice = undefined;
    state.priority = pending.resumePriority ?? state.startingPlayer;
    state.deadline = pending.resumeDeadline ?? deadlineFor(state.phase);
    state.stepLabel = pending.resumeStepLabel ?? state.stepLabel;
    const completed = resolvePendingEffect(state, effect);
    if (completed) {
      state.batch = state.batch.filter((candidate) => candidate.id !== effect.id);
      if (!hasQueuedEffectDraw(state)) {
        state.priority = state.startingPlayer;
        state.deadline = deadlineFor(state.phase);
      }
      if (state.phase === "damage" && state.pendingDamage <= 0 && !state.revealedFlip) finishDamage(state);
      finalizeRerollContinuation(state, effect.id);
    }
    return withVersion(state);
  }
  return playCard(state, pending.controllerId, pending.cardId, merged);
};

export const splitWhenPlayedEffect = (effect: string) => {
  const sentences = effect.split(/(?<=\.)\s+/);
  const triggerIndex = sentences.findIndex((sentence) => /when you play this(?: card)?/i.test(sentence));
  if (triggerIndex < 0) return { cardEffect: effect, triggerEffect: "" };
  const sentence = sentences[triggerIndex];
  const triggerEffect = sentence.replace(/^.*?when you play this(?: card)?\s*[:,]?\s*/i, "").trim();
  return {
    cardEffect: sentences.filter((_, index) => index !== triggerIndex).join(" ").trim(),
    triggerEffect: triggerEffect || sentence,
  };
};

export const playCard = (input: MatchState, playerId: string, cardId: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input);
  const request: PendingCardPlay = {
    controllerId: playerId,
    cardId,
    sourceZone: "hand",
    sourceOwnerId: playerId,
    cardOwnerId: playerId,
    origin: "priority",
    choices: { ...choices },
    beforeState: JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined }),
  };
  commitCardPlayMutable(state, request);
  return withVersion(state);
};

export type FusionActivationRequirement = {
  id: string;
  label: string;
  energyCost: number;
  coreTypes: CoreType[];
  sourceText?: string;
  condition?: RuleCondition;
  legal: boolean;
  reason?: string;
};

const fusionCoreTypes: Record<string, CoreType> = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
};

function fusionRequirementsFromCard(card: GameCard): Array<Pick<FusionActivationRequirement, "id" | "label" | "energyCost" | "coreTypes" | "sourceText" | "condition">> {
  const requirements: Array<Pick<FusionActivationRequirement, "id" | "label" | "energyCost" | "coreTypes" | "sourceText" | "condition">> = [];
  for (const line of card.effect.split(/\n|(?<=\.)/)) {
    const match = line.trim().match(/^(?:(\d+)\s+\[Energy\]|\[((?:FT|FF|SD|MS|HE)(?:\]\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE))*)\])\s*:\s*<Fusion>/i);
    if (!match) continue;
    const symbols = match[2]
      ? [...match[2].matchAll(/(FT|FF|SD|MS|HE)/gi)].map((candidate) => fusionCoreTypes[candidate[1].toUpperCase()])
      : [];
    const energyCost = Number(match[1] ?? 0);
    const coreLabel = symbols.join(" or ");
    requirements.push({
      id: match[1] ? `energy:${energyCost}` : `core:${coreLabel}`,
      label: match[1] ? `Pay ${energyCost} Energy` : `Hold ${coreLabel} Core`,
      energyCost,
      coreTypes: symbols,
      sourceText: line.trim(),
    });
  }
  // A Fusion with no Energy/Core prefix is a zero-cost activated ability when
  // its own printed condition is satisfied. Triggered text such as
  // "When you ... <Fusion>" is handled by the normal trigger system instead
  // and must not become a duplicate manual button.
  if (!requirements.length && card.type === "Character" && /<Fusion>/i.test(card.effect)
    && !/^\s*(?:\[?Victor\]?|when\b|if you\b|each player\b)/i.test(card.effect)) {
    requirements.push({
      id: "condition",
      label: "Meet printed condition",
      energyCost: 0,
      coreTypes: [],
      sourceText: card.effect.trim(),
      condition: ruleDefinitionForCard(card).abilities
        .flatMap((ability) => ability.instructions)
        .find((instruction) => instruction.actions.some((action) => action.kind === "fusion"))?.condition,
    });
  }
  return requirements;
}

export function fusionActivationRequirements(
  state: MatchState,
  playerId: string,
  bakuganId: string,
): FusionActivationRequirement[] {
  const owner = state.players.find((candidate) => candidate.id === playerId);
  const bakugan = owner?.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!owner || !bakugan?.fusionCharacter) return [];
  const base = fusionRequirementsFromCard(bakugan.character);
  const heldTypes = new Set(effectiveBakucoreCells(state, bakugan, owner)
    .map((cell) => state.placements.find((placement) => placement.cell === cell)?.core?.type)
    .filter((type): type is CoreType => Boolean(type)));
  return base.map((requirement) => {
    if (bakugan.fused) return { ...requirement, legal: false, reason: "This Bakugan is already fused." };
    if (bakugan.evoStack.length) return { ...requirement, legal: false, reason: "A Bakugan with an Evo cannot fuse." };
    if (requirement.condition && !ruleConditionActive(state, owner, requirement.condition, bakugan)) {
      return { ...requirement, legal: false, reason: "The printed Fusion condition is not met." };
    }
    if (requirement.coreTypes.length && !requirement.coreTypes.some((type) => heldTypes.has(type))) {
      return { ...requirement, legal: false, reason: `This Bakugan is not holding a ${requirement.label.replace(/^Hold /, "")}.` };
    }
    if (requirement.energyCost > maximumPayableEnergy(state, playerId)) {
      return { ...requirement, legal: false, reason: `Not enough Energy. ${requirement.energyCost} required.` };
    }
    return { ...requirement, legal: true };
  });
}

export function activateFusion(
  input: MatchState,
  playerId: string,
  bakuganId: string,
  requirementId?: string,
) {
  const state = cloneMatch(input);
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) {
    throw new Error("You do not have priority to activate Fusion.");
  }
  if (state.pendingChoice || state.pendingCoinFlip || state.pendingReroll || state.triggerOrders.some((request) => !request.orderedIds)) {
    throw new Error("Fusion cannot be activated while another decision is pending.");
  }
  const owner = playerById(state, playerId);
  const bakugan = owner.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!bakugan?.fusionCharacter) throw new Error("This Bakugan has no Fusion face.");
  const legal = fusionActivationRequirements(state, playerId, bakuganId).filter((requirement) => requirement.legal);
  const requirement = requirementId ? legal.find((candidate) => candidate.id === requirementId) : legal[0];
  if (!requirement) throw new Error("This Bakugan has no legal Fusion requirement.");

  payEnergyCost(state, playerId, requirement.energyCost, bakugan.character.id);
  const ability: AbilityDefinition = {
    id: `${bakugan.character.catalogId}:fusion-activation`,
    kind: "activated",
    instructions: [{
      id: `${bakugan.character.catalogId}:fusion-activation:instruction`,
      condition: { kind: "always" },
      effects: [{ kind: "fusion", operation: "fuse", targetChoiceId: "targetBakuganId", requirement: requirement.id }],
      actions: [{ kind: "fusion", operation: "fuse", targetChoiceId: "targetBakuganId", requirement: requirement.id }],
      choices: [],
      sourceText: requirement.sourceText ?? `${requirement.label}: <Fusion>`,
    }],
  };
  const pending = createRuleObject({
    controllerId: playerId,
    cardOwnerId: playerId,
    card: bakugan.character,
    ability,
    choices: { targetBakuganId: bakuganId },
    kind: "card",
    sourceId: bakugan.character.id,
  });
  state.batch.push(pending);
  state.passes = [];
  entry(state, "game", `${owner.name} activated Fusion for ${bakugan.name}.`, bakugan.character, "effect", playerId);
  return withVersion(state);
}

const chooseBakugan = (state: MatchState, controllerId: string, choices: CardChoices, preferEnemy = false) => {
  const all = state.players.flatMap((player) => player.bakugan);
  if (choices.targetBakuganId) return all.find((bakugan) => bakugan.id === choices.targetBakuganId);
  if (!preferEnemy && choices.sourceBakuganId) return all.find((bakugan) => bakugan.id === choices.sourceBakuganId);
  const owner = preferEnemy ? otherPlayer(state, controllerId) : playerById(state, controllerId);
  return activeBakugan(state, owner.id) ?? owner.bakugan.find((bakugan) => bakugan.open) ?? owner.bakugan[0];
};

function destroyHeroCard(state: MatchState, owner: PlayerState, hero: GameCard, sourceId: string) {
  const result = applyReplacements(state, {
    id: `${state.turn}:destroy:hero:${owner.id}:${hero.id}:${state.version}`,
    kind: "DESTROY",
    actorId: owner.id,
    sourceId,
    targetId: hero.id,
    metadata: { object: "hero", ownerId: owner.id, cardType: hero.type },
  });
  if (!result.event) return false;
  const discarded = { ...hero };
  delete discarded.instabrawl;
  owner.discard.push(discarded);
  return true;
}

function destroyEvoCard(state: MatchState, owner: PlayerState, evo: GameCard, sourceId: string) {
  const result = applyReplacements(state, {
    id: `${state.turn}:destroy:evo:${owner.id}:${evo.id}:${state.version}`,
    kind: "DESTROY",
    actorId: owner.id,
    sourceId,
    targetId: evo.id,
    metadata: { object: "evo", ownerId: owner.id, cardType: evo.type },
  });
  if (!result.event) return false;
  const discarded = { ...evo };
  delete discarded.instabrawl;
  owner.discard.push(discarded);
  return true;
}

const destroyHero = (state: MatchState, controllerId: string, choices: CardChoices, allEnemy: boolean, sourceId = "system") => {
  const owners = allEnemy ? [otherPlayer(state, controllerId)] : state.players;
  for (const owner of owners) {
    const selected = allEnemy ? owner.heroes : owner.heroes.filter((hero) => hero.id === choices.targetHeroId);
    if (!selected.length) continue;
    const ids = new Set(selected.map((hero) => hero.id));
    const remaining: GameCard[] = [];
    for (const hero of owner.heroes) {
      if (!ids.has(hero.id) || !destroyHeroCard(state, owner, hero, sourceId)) remaining.push(hero);
    }
    owner.heroes = remaining;
  }
};

const destroyEvo = (
  state: MatchState,
  controllerId: string,
  choices: CardChoices,
  options: { allEnemy?: boolean; allPlayers?: boolean; excludeSourceId?: string } = {},
  sourceId = "system",
) => {
  const owners = options.allPlayers
    ? state.players
    : options.allEnemy ? [otherPlayer(state, controllerId)] : state.players;
  for (const owner of owners) for (const bakugan of owner.bakugan) {
    const selected = options.allEnemy || options.allPlayers
      ? bakugan.evoStack.filter((evo) => evo.id !== options.excludeSourceId)
      : bakugan.evoStack.filter((evo) => evo.id === choices.targetEvoId);
    if (!selected.length) continue;
    const ids = new Set(selected.map((evo) => evo.id));
    const remaining: GameCard[] = [];
    for (const evo of bakugan.evoStack) {
      if (!ids.has(evo.id) || !destroyEvoCard(state, owner, evo, sourceId)) remaining.push(evo);
    }
    bakugan.evoStack = remaining;
  }
};

const destroyEnergy = (state: MatchState, amount: number, selectedIds: string[]) => {
  const ids = new Set(selectedIds.slice(0, amount));
  const located = state.players.flatMap((owner) => owner.energyZone
    .filter((card) => ids.has(card.id))
    .map((card) => ({ owner, card })));
  if (amount <= 0 || located.length !== amount) return;
  for (const owner of state.players) {
    const selected = located.filter((item) => item.owner.id === owner.id).map((item) => item.card);
    if (!selected.length) continue;
    const selectedSet = new Set(selected.map((card) => card.id));
    owner.energyZone = owner.energyZone.filter((card) => !selectedSet.has(card.id));
    owner.discard.push(...selected);
    normalizeEnergyCardState(owner, state.turn);
  }
  state.informationEpoch += 1;
  state.undoWindow = undefined;
};

function applyEnergizedEntryState(
  state: MatchState,
  player: PlayerState,
  cards: readonly GameCard[],
  enters: "charged" | "uncharged",
) {
  if (!cards.length) return;
  setEnergyCardChargeState(state, player.id, cards.map((card) => card.id), enters);
}

function emitEnergizedEvents(
  state: MatchState,
  player: PlayerState,
  cards: readonly GameCard[],
  eventPrefix: string,
) {
  for (const card of cards) {
    emitGameEvent(state, {
      id: `${eventPrefix}:${card.id}`,
      type: "energize",
      playerId: player.id,
      targetBakuganId: activeBakugan(state, player.id)?.id,
      sourceCards: [card],
    });
  }
}

/** Queue triggers caused by an effect revealing one or more hand cards. */
function emitHandRevealEvents(
  state: MatchState,
  handOwnerId: string,
  cards: readonly GameCard[],
  causeCard: GameCard,
  eventPrefix: string,
) {
  return cards.flatMap((revealed, index) => emitRuleEvent(state, {
    id: `${eventPrefix}:${index}:${revealed.id}`,
    name: "CARD_REVEALED_FROM_HAND",
    actorId: handOwnerId,
    controllerId: handOwnerId,
    card: revealed,
    cardType: revealed.type,
    causeCard,
    createdAt: Date.now(),
  }));
}

const instructionChoices = (pending: PendingEffect, instructionIndex: number) => Object.entries(pending.resolvedChoices ?? {})
  .filter(([index]) => Number(index) <= instructionIndex)
  .sort(([left], [right]) => Number(left) - Number(right))
  .reduce<CardChoices>((merged, [, answers]) => ({ ...merged, ...answers }), { ...pending.choices });

const actionResultKey = (instructionIndex: number, actionIndex: number) => `${instructionIndex}:${actionIndex}`;

function previousActionResult(pending: PendingEffect, instructionIndex: number, actionIndex: number) {
  if (!isRuleObject(pending)) return undefined;
  return Object.entries(pending.actionResults ?? {})
    .map(([key, result]) => {
      const [priorInstruction, priorAction] = key.split(":").map(Number);
      return { priorInstruction, priorAction, result };
    })
    .filter(({ priorInstruction, priorAction }) => Number.isFinite(priorInstruction) && Number.isFinite(priorAction)
      && (priorInstruction < instructionIndex || (priorInstruction === instructionIndex && priorAction < actionIndex)))
    .sort((left, right) => left.priorInstruction - right.priorInstruction || left.priorAction - right.priorAction)
    .at(-1)?.result;
}

function storeActionResult(pending: PendingEffect, instructionIndex: number, actionIndex: number, result: RuleActionResult) {
  if (!isRuleObject(pending)) return;
  pending.actionResults = pending.actionResults ?? {};
  pending.actionResults[actionResultKey(instructionIndex, actionIndex)] = {
    amount: Math.max(0, Math.floor(result.amount)),
    ...(result.amountByPlayer ? {
      amountByPlayer: Object.fromEntries(Object.entries(result.amountByPlayer).map(([id, amount]) => [id, Math.max(0, Math.floor(amount))])),
    } : {}),
    ...(result.cardCost != null ? { cardCost: Math.max(0, Math.floor(result.cardCost)) } : {}),
  };
}

type EffectDrawState = MatchState & {
  pendingDrawQueue?: Array<{ id: string; playerId: string; remaining: number; total: number; sourceName: string; sourceEffectId?: string }>;
  pendingDrawResumePriority?: string;
  pendingDrawResumeDeadline?: number;
  pendingDrawResumeStepLabel?: string;
};

const enqueueEffectDraw = (state: MatchState, player: PlayerState, amount: number, sourceName: string, sourceEffectId?: string) => {
  if (amount <= 0) return;
  const queued = state as EffectDrawState;
  if (!queued.pendingDrawQueue?.length) {
    queued.pendingDrawResumePriority = state.priority;
    queued.pendingDrawResumeDeadline = state.deadline;
    queued.pendingDrawResumeStepLabel = state.stepLabel;
  }
  queued.pendingDrawQueue = [...(queued.pendingDrawQueue ?? []), {
    id: uid(),
    playerId: player.id,
    remaining: amount,
    total: amount,
    sourceName,
    sourceEffectId,
  }];
  const active = queued.pendingDrawQueue[0];
  state.priority = active.playerId;
  state.stepLabel = `${active.sourceName} • Draw ${active.remaining} card${active.remaining === 1 ? "" : "s"}`;
  state.deadline = Date.now() + 35_000;
};

const hasQueuedEffectDraw = (state: MatchState) => Boolean((state as EffectDrawState).pendingDrawQueue?.length);

const ruleConditionIsActive = (
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  instructionIndex = pending.instructionIndex ?? 0,
) => {
  const player = playerById(state, pending.controllerId);
  const choices = instructionChoices(pending, instructionIndex);
  if (instruction.condition.kind === "selection-made") {
    const selected = pending.resolvedChoices?.[String(instructionIndex)]?.[instruction.condition.choiceId];
    return Array.isArray(selected) ? selected.length > 0 : Boolean(selected);
  }
  if (instruction.condition.kind === "mode-selected") {
    return choices.mode === instruction.condition.mode || choices.mode === "both";
  }
  if (instruction.condition.kind === "empower-selected") {
    return choices.empower === true || choices.empower === "yes" || choices.empower === "true";
  }
  if (instruction.condition.kind === "reroll-opened") return Boolean(state.rerollOpenedByEffect[pending.id]);
  if (instruction.condition.kind === "coin-result") return state.coinFlipResults[pending.id] === instruction.condition.result;
  if (instruction.condition.kind === "printed") return conditionActive(state, player, instruction.condition.text, choices);
  const conditionTarget = pending.kind === "trigger" && choices.sourceBakuganId
    ? state.players.flatMap((candidate) => candidate.bakugan)
      .find((bakugan) => bakugan.id === choices.sourceBakuganId)
    : chooseBakugan(state, pending.controllerId, choices);
  return ruleConditionActive(state, player, instruction.condition, conditionTarget, choices);
};

function recordTemporaryCardStatModifier(
  state: MatchState,
  pending: PendingEffect,
  action: Extract<RuleAction, { kind: "modify-stat" }>,
  targetBakuganId: string,
  amount: number,
  instructionIndex: number,
  actionIndex: number,
) {
  const rules = ensureRulesState(state);
  const id = `${pending.id}:legacy-mirror:${instructionIndex}:${actionIndex}:${targetBakuganId}:${action.stat}`;
  const base = {
    id,
    source: {
      kind: "card" as const,
      instanceId: pending.sourceId ?? pending.card.id,
      catalogId: pending.card.catalogId as RulesCardId,
    },
    controllerId: pending.controllerId,
    target: "chosen-bakugan" as const,
    targetBakuganId,
    amount,
    layer: "temporary" as const,
    duration: "turn" as const,
    createdTurn: state.turn,
    sourceCategory: "card" as const,
  };
  const modifier: ContinuousModifier = action.stat === "frost"
    ? { ...base, keyword: "FrostStrike" }
    : { ...base, stat: action.stat };
  rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== id);
  rules.modifiers.push(modifier);
}

const executeRuleAction = (
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  action: RuleAction,
  instructionIndex: number,
  actionIndex: number,
) => {
  const { card, controllerId } = pending;
  const choices = instructionChoices(pending, instructionIndex);
  const player = playerById(state, controllerId);
  const opponent = otherPlayer(state, controllerId);
  const text = instruction.sourceText;
  const lower = text.toLowerCase();
  const preferEnemy = /^-|enemy|opposing|non-\[/.test(lower) && !/one of your/.test(lower);
  const rerollTargetId = state.rerollTargetByEffect[pending.id];
  const allBakugan = state.players.flatMap((candidate) => candidate.bakugan);
  const target = allBakugan.find((bakugan) => bakugan.id === rerollTargetId)
    ?? chooseBakugan(state, controllerId, choices, preferEnemy);
  const resolveNumber = (value: NumberValue, scopedChoices: CardChoices = choices, chooserId?: string) => evaluateNumberValue(state, value, {
    controllerId,
    chooserId,
    chosenPlayerId: scopedChoices.targetPlayerId,
    choices: scopedChoices,
    sourceBakuganId: scopedChoices.sourceBakuganId,
    sourceCardId: pending.sourceId ?? pending.card.id,
    moment: "resolve",
    capturedValues: isRuleObject(pending) ? pending.valueSnapshots : undefined,
    previousResult: previousActionResult(pending, instructionIndex, actionIndex),
    characteristics: (candidate, owner) => evaluateBakuganCharacteristics(state, candidate, owner),
  });
  const recordResult = (result: RuleActionResult) => storeActionResult(pending, instructionIndex, actionIndex, result);

  switch (action.kind) {
    case "choice":
      return;
    case "pay-energy": {
      if (choices.confirmed === false) return;
      const amount = Math.max(0, Math.floor(resolveNumber(action.amount)));
      if (maximumPayableEnergy(state, controllerId) < amount) return;
      payEnergyCost(state, controllerId, amount, pending.sourceId ?? card.id);
      recordResult({ amount });
      return;
    }
    case "trigger": {
      if (action.event === "VICTOR_DECLARED" && target) {
        const amount = Number(text.match(/opponent.*discard\s+(\d+)\s+cards?/i)?.[1] ?? 0);
        if (amount > 0) {
          const existing = state.temporaryVictorDiscards[target.id];
          state.temporaryVictorDiscards[target.id] = {
            controllerId,
            sourceName: existing
              ? `${existing.sourceName} + ${card.displayName || card.name}`
              : card.displayName || card.name,
            amount: (existing?.amount ?? 0) + amount,
          };
        }
      }
      return;
    }
    case "ignore-armor-rating": {
      if (action.duration === "turn") {
        ensureRulesState(state).ignoreArmorRating![controllerId] = true;
      }
      return;
    }
    case "fusion": {
      const selectedId = action.targetChoiceId ? choices[action.targetChoiceId] : choices.targetBakuganId ?? choices.sourceBakuganId;
      const fusionTarget = allBakugan.find((candidate) => candidate.id === selectedId)
        ?? (action.targetChoiceId === "sourceBakuganId" ? allBakugan.find((candidate) => candidate.id === choices.sourceBakuganId) : undefined);
      if (!fusionTarget?.fusionCharacter) return;
      if (action.operation === "unfuse") {
        if (!fusionTarget.fused) return;
        fusionTarget.fused = false;
        entry(state, "game", `${fusionTarget.name} was unfused.`, fusionTarget.character, "effect", controllerId);
        return;
      }
      // Fusion is legal only for an unfused, non-Evolved Fusion Bakugan. The
      // activation requirement was checked when the ability entered the
      // batch; only the target's continuing legality is checked on resolve.
      if (fusionTarget.fused || fusionTarget.evoStack.length) return;
      fusionTarget.fused = true;
      entry(state, "game", `${fusionTarget.name} fused.`, fusionTarget.fusionCharacter, "effect", controllerId);
      emitGameEvent(state, {
        id: `${state.turn}:fusion:${fusionTarget.id}:${pending.id}`,
        type: "fusion",
        playerId: controllerId,
        targetBakuganId: fusionTarget.id,
        sourceCards: [fusionTarget.character],
        choices,
      });
      return;
    }
    case "watch-turn-event": {
      const candidates = action.definition.relationship === "opponent"
        ? state.players.filter((owner) => owner.id !== controllerId)
        : action.definition.relationship === "controller"
          ? [player]
          : state.players;
      if (action.definition.cardType && candidates.some((owner) => owner.playedCardTypesThisTurn?.includes(action.definition.cardType!))) return;
      const rules = ensureRulesState(state);
      const watchId = `${pending.id}:${instructionIndex}:${actionIndex}:watch`;
      rules.delayedCardTriggers = rules.delayedCardTriggers.filter((watch) => watch.id !== watchId && watch.createdTurn === state.turn);
      rules.delayedCardTriggers.push({
        id: watchId,
        controllerId,
        cardOwnerId: pending.cardOwnerId ?? controllerId,
        card: structuredClone(card),
        definition: structuredClone(action.definition),
        effectText: action.effectText,
        createdTurn: state.turn,
      });
      return;
    }
    case "schedule": {
      const rules = ensureRulesState(state);
      const scheduledId = `${pending.id}:${instructionIndex}:${actionIndex}:${action.timing}`;
      rules.scheduledActions = rules.scheduledActions.filter((scheduled) => (
        scheduled.id !== scheduledId && scheduled.createdTurn === state.turn
      ));
      rules.scheduledActions.push({
        id: scheduledId,
        timing: action.timing,
        controllerId,
        cardOwnerId: pending.cardOwnerId ?? controllerId,
        card: structuredClone(card),
        sourceId: pending.sourceId ?? card.id,
        effects: structuredClone(action.effects),
        createdTurn: state.turn,
      });
      return;
    }
    case "cost":
      if (action.duration === "next-card") {
        state.nextCardEmpowerReduction ??= {};
        state.nextCardEmpowerFree ??= {};
        if (action.costScope === "empower") {
          if (action.operation === "reduce") state.nextCardEmpowerReduction[controllerId] = (state.nextCardEmpowerReduction[controllerId] ?? 0) + resolveNumber(action.amount);
          else if (action.operation === "increase") state.nextCardEmpowerReduction[controllerId] = (state.nextCardEmpowerReduction[controllerId] ?? 0) - resolveNumber(action.amount);
          else if (action.operation === "free") state.nextCardEmpowerFree[controllerId] = true;
        } else if (action.operation === "reduce") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) + resolveNumber(action.amount);
        else if (action.operation === "increase") state.nextCardCostReduction[controllerId] = (state.nextCardCostReduction[controllerId] ?? 0) - resolveNumber(action.amount);
      } else if (action.operation === "free" && action.duration === "turn") {
        const rules = ensureRulesState(state);
        rules.costModifiers.push({
          id: `${pending.id}:${instructionIndex}:${actionIndex}:cost-free`,
          sourceId: pending.sourceId ?? pending.card.id,
          controllerId,
          kind: "free",
          amount: 0,
          duration: "turn",
          cardType: action.cardType,
          playerScope: action.playerScope ?? "controller",
          choices: structuredClone(choices),
          valueSnapshots: isRuleObject(pending) ? structuredClone(pending.valueSnapshots ?? {}) : undefined,
          createdTurn: state.turn,
        });
      }
      return;
    case "coin-flip": {
      const now = Date.now();
      const result: CoinFlipResult = secureRandomInt(2) === 0 ? "heads" : "tails";
      state.coinFlipResults[pending.id] = result;
      pending.instructionIndex = instructionIndex + 1;
      if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;
      state.pendingCoinFlip = {
        id: uid(),
        controllerId,
        sourceEffectId: pending.id,
        sourceName: card.displayName || card.name,
        result,
        createdAt: now,
        resolveAt: now + 2_200,
        resumePriority: state.priority,
        resumeDeadline: state.deadline,
        resumeStepLabel: state.stepLabel,
      };
      state.priority = controllerId;
      state.stepLabel = `${card.displayName || card.name} • Coin flip`;
      state.deadline = now + 35_000;
      state.informationEpoch += 1;
      state.undoWindow = undefined;
      entry(state, "random", `${player.name}: ${card.displayName || card.name} coin flip → ${result}.`, card, "effect", controllerId);
      throw new CoinFlipResolutionSuspended();
    }
    case "reroll": {
      if (!action.mandatory && choices.confirmed === false) return;
      if (action.requiresDiscard && !choices.discardCardIds?.length) return;
      if (action.requiresDiscard && choices.discardCardIds!.some((id) => player.hand.some((candidate) => candidate.id === id))) {
        throw new Error("The selected Sacrifice must be discarded before the Reroll begins.");
      }
      const rollerId = rerollTargetPlayerId(state, controllerId, action.target);
      pending.instructionIndex = instructionIndex + 1;
      if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;
      if (!beginRerollMutable(state, rollerId, {
        effectId: pending.id,
        name: card.displayName || card.name,
        mandatory: action.mandatory,
      })) return;
      throw new RerollResolutionSuspended();
    }
    case "continuous": {
      if (pending.kind === "card" && ["Hero", "Evo"].includes(card.type)
        && action.modifier.duration === "while-source-active") return;
      const rules = ensureRulesState(state);
      const modifier = {
        ...structuredClone(action.modifier),
        id: `${pending.id}:${action.modifier.id}`,
        controllerId,
        source: pending.sourceId
          ? { kind: "card" as const, instanceId: pending.sourceId, catalogId: pending.card.catalogId as `bb-${number}` }
          : action.modifier.source,
        createdTurn: state.turn,
        choices: structuredClone(choices),
        valueSnapshots: isRuleObject(pending) ? structuredClone(pending.valueSnapshots ?? {}) : undefined,
      };
      rules.modifiers = rules.modifiers.filter((candidate) => candidate.id !== modifier.id);
      rules.modifiers.push(modifier);
      return;
    }
    case "replacement":
    case "prevention":
      registerReplacement(state, {
        id: `${pending.id}:${instructionIndex}:${actionIndex}:${action.kind}`,
        source: pending.sourceId
          ? { kind: "card", instanceId: pending.sourceId, catalogId: pending.card.catalogId as `bb-${number}` }
          : { kind: "card", instanceId: pending.card.id, catalogId: pending.card.catalogId as `bb-${number}` },
        controllerId,
        effect: action,
      });
      return;
    case "modify-stat": {
      if (pending.kind === "card" && ["Hero", "Evo"].includes(card.type) && action.duration === "while-source-active") return;
      if (card.name === "Gravity Shift" && (
        (choices.mode === "damage" && action.stat === "power")
        || (choices.mode === "power" && action.stat === "damage")
      )) return;
      const amount = resolveNumber(action.amount);
      const explicitActionTarget = action.targetChoiceId
        ? choices[action.targetChoiceId]
        : undefined;
      const selectedTarget = typeof explicitActionTarget === "string"
        ? allBakugan.find((bakugan) => bakugan.id === explicitActionTarget)
        : target;
      const targets = action.scope === "all-enemy" ? opponent.bakugan
        : action.scope === "all-friendly" ? player.bakugan
          : action.scope === "all-bakugan" ? allBakugan
            : selectedTarget ? [selectedTarget] : [];
      for (const selected of targets) {
        // Keep the legacy aggregate maps for snapshot/UI compatibility, but
        // also retain each card modifier as an independently filterable rules
        // object. The modifier evaluator subtracts these mirrored entries from
        // the aggregate before applying them, so positive and negative effects
        // never collapse into a single number for ShadowStrike.
        if (action.stat === "power") state.powerBoost[selected.id] = (state.powerBoost[selected.id] ?? 0) + amount;
        else if (action.stat === "damage") state.damageBoost[selected.id] = (state.damageBoost[selected.id] ?? 0) + amount;
        else state.frostStrike[selected.id] = (state.frostStrike[selected.id] ?? 0) + amount;
        recordTemporaryCardStatModifier(
          state,
          pending,
          action,
          selected.id,
          amount,
          instructionIndex,
          actionIndex,
        );
      }
      return;
    }
    case "grant-keyword":
      if (pending.kind === "card" && ["Hero", "Evo"].includes(card.type) && action.duration === "while-source-active") return;
      if (!target) return;
      if (action.keyword === "DoubleStrike") state.doubleStrike[target.id] = true;
      else if (action.keyword === "ShadowStrike") state.shadowStrike[target.id] = true;
      else if (action.keyword === "FrostStrike") state.frostStrike[target.id] = (state.frostStrike[target.id] ?? 0) + resolveNumber(action.value ?? 1);
      else if (action.keyword === "Stop" && flipStopsDamage(state, card)) {
        state.pendingDamage = 0;
        state.revealedFlip = undefined;
      }
      return;
    case "draw": {
      if (/\bmay draw/i.test(text) && choices.confirmed === false) return;
      const recipientIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });
      for (const recipientId of recipientIds) {
        const amount = Math.max(0, Math.floor(resolveNumber(action.amount, choices, recipientId)));
        enqueueEffectDraw(state, playerById(state, recipientId), amount, card.displayName || card.name, pending.id);
      }
      return;
    }
    case "discard": {
      const affectedIds = choices.targetPlayerId
        ? [choices.targetPlayerId]
        : playerIdsForScope(state, action.playerScope ?? (/your opponent|opponent discards/i.test(text) ? "opponent" : "controller"), { controllerId, choices });
      const amountByPlayer: Record<string, number> = {};
      const discardedCards: GameCard[] = [];
      for (const affectedId of affectedIds) {
        const affected = playerById(state, affectedId);
        const beforeCards = [...affected.hand];
        const before = affected.hand.length;
        const scopedChoices = choices.simultaneousAnswers?.[affectedId] ?? choices;
        const selected = scopedChoices.discardCardIds ?? scopedChoices.handCardIds ?? [];
        const factionChoice = action.factionChoiceId ? scopedChoices[action.factionChoiceId] : undefined;
        const chosenFaction = typeof factionChoice === "string" ? factionChoice : undefined;
        const factionSelected = chosenFaction
          ? affected.hand.filter((candidate) => effectiveCardFactions(candidate).includes(chosenFaction as Faction)).map((candidate) => candidate.id)
          : selected;
        const expressionAmount = Math.max(0, Math.floor(resolveNumber(action.amount, scopedChoices, affectedId)));
        const minimum = Math.max(0, Math.floor(resolveNumber(action.minimum, scopedChoices, affectedId)));
        const maximum = Math.max(minimum, Math.floor(resolveNumber(action.maximum, scopedChoices, affectedId)));
        const amount = chosenFaction ? factionSelected.length : minimum === 0 ? selected.length : selected.length || expressionAmount;
        if (amount > 0) discardFromHand(state, affected, Math.min(maximum, amount), factionSelected);
        amountByPlayer[affectedId] = Math.max(0, before - affected.hand.length);
        const remainingIds = new Set(affected.hand.map((candidate) => candidate.id));
        discardedCards.push(...beforeCards.filter((candidate) => !remainingIds.has(candidate.id)));
      }
      recordResult({
        amount: Object.values(amountByPlayer).reduce((sum, amount) => sum + amount, 0),
        amountByPlayer,
        ...(discardedCards.length === 1 ? {
          cardCost: discardedCards[0].cost === "X" ? 0 : discardedCards[0].cost,
        } : {}),
      });
      return;
    }
    case "energize": {
      if (action.source === "hand" || action.source === "deck" || action.source === "discard") {
        const affectedIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices });
        for (const affectedId of affectedIds) {
          const scopedChoices = choices.simultaneousAnswers?.[affectedId] ?? choices;
          if (scopedChoices.confirmed === false) continue;
          const ownership = {
            controllerId,
            chooserId: affectedId,
            chosenPlayerId: scopedChoices.targetPlayerId,
            choices: scopedChoices,
          };
          const destinationId = zoneOwnerIdsFor(
            state,
            action.destinationOwner ?? (action.playerScope === "each-player" ? "each-player" : "controller"),
            ownership,
          )[0] ?? affectedId;
          const sourceId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", ownership)[0] ?? destinationId;
          const destination = playerById(state, destinationId);
          const source = playerById(state, sourceId);
          const amount = Math.max(0, Math.floor(resolveNumber(action.amount, scopedChoices, affectedId)));
          if (action.source === "hand") {
            const selectedIds = scopedChoices.handCardIds?.slice(0, amount) ?? [];
            if (selectedIds.length !== amount || new Set(selectedIds).size !== amount) continue;
            const selected = new Set(selectedIds);
            const energized = source.hand.filter((candidate) => selected.has(candidate.id));
            if (energized.length !== amount) continue;
            source.hand = source.hand.filter((candidate) => !selected.has(candidate.id));
            applyEnergyEntryVisibility(energized, "hand");
            destination.energyZone.push(...energized);
            applyEnergizedEntryState(state, destination, energized, action.enters);
            emitEnergizedEvents(state, destination, energized, `${pending.id}:energize:${actionIndex}`);
          } else if (action.source === "deck") {
            const energized: GameCard[] = [];
            for (let index = 0; index < amount; index += 1) {
              const energyCard = source.deckCards.shift();
              if (energyCard) energized.push(energyCard);
            }
            applyEnergyEntryVisibility(energized, "deck");
            destination.energyZone.push(...energized);
            applyEnergizedEntryState(state, destination, energized, action.enters);
            emitEnergizedEvents(state, destination, energized, `${pending.id}:energize:${actionIndex}`);
            syncDeck(source);
          } else {
            const energized = source.discard.splice(0, amount);
            applyEnergyEntryVisibility(energized, "discard");
            destination.energyZone.push(...energized);
            applyEnergizedEntryState(state, destination, energized, action.enters);
            emitEnergizedEvents(state, destination, energized, `${pending.id}:energize:${actionIndex}`);
          }
        }
      } else if (choices.confirmed === false) return;
      else if (action.source === "hero") {
        for (const owner of state.players) {
          const index = owner.heroes.findIndex((hero) => hero.id === choices.targetHeroId);
          if (index >= 0) {
            const energized = owner.heroes.splice(index, 1);
            for (const moved of energized) delete moved.instabrawl;
            applyEnergyEntryVisibility(energized, "hero");
            owner.energyZone.push(...energized);
            applyEnergizedEntryState(state, owner, energized, action.enters);
            emitEnergizedEvents(state, owner, energized, `${pending.id}:energize:${actionIndex}`);
            break;
          }
        }
      } else if (action.source === "self" && !player.energyZone.some((candidate) => candidate.id === card.id)) {
        for (const owner of state.players) owner.heroes = owner.heroes.filter((candidate) => candidate.id !== card.id);
        player.discard = player.discard.filter((candidate) => candidate.id !== card.id);
        applyEnergyEntryVisibility([card], "self");
        player.energyZone.push(card);
        applyEnergizedEntryState(state, player, [card], action.enters);
        emitEnergizedEvents(state, player, [card], `${pending.id}:energize:${actionIndex}`);
      }
      return;
    }
    case "generate-energy": {
      const recipientIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });
      for (const recipientId of recipientIds) {
        const recipient = playerById(state, recipientId);
        const amount = resolveNumber(action.amount, choices, recipientId);
        recipient.energy += Math.max(0, amount);
      }
      return;
    }
    case "uncharge-energy": {
      const recipientIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });
      for (const recipientId of recipientIds) {
        const recipient = playerById(state, recipientId);
        const uncharged = new Set(activeUnchargedEnergyIds(recipient, state.turn));
        const charged = recipient.energyZone.filter((energyCard) => !uncharged.has(energyCard.id));
        const amount = action.amount === "all"
? charged.length
: Math.max(0, Math.floor(resolveNumber(action.amount, choices, recipientId)));
        const requested = (choices.targetEnergyIds ?? []).filter((id) => charged.some((energyCard) => energyCard.id === id));
        const selected = requested.length
? requested.slice(0, amount)
: charged.slice(0, amount).map((energyCard) => energyCard.id);
        unchargeEnergyCards(state, recipientId, selected, {
producesEnergy: action.producesEnergy,
preventChargeStepRecharge: action.preventChargeStepRecharge,
        });
      }
      return;
    }
    case "recharge-energy": {
      if (choices.confirmed === false) return;
      const selected = action.amount === "all" ? undefined : (choices.targetEnergyIds ?? []).slice(0, Math.max(0, Math.floor(resolveNumber(action.amount))));
      rechargeEnergyCards(state, controllerId, selected);
      return;
    }
    case "set-stat":
      if (target) {
        const value = resolveNumber(action.value);
        if (action.stat === "power") state.powerBoost[target.id] = value - (topCard(target).bPower ?? target.bPower);
        else state.damageBoost[target.id] = value - (topCard(target).damage ?? target.damage);
      }
      return;
    case "set-rule":
      if (action.rule === "victor-stat") state.victorByDamage = action.value === "damage";
      return;
    case "win-game": {
      if (card.catalogId === DRAGONOID_MAXIMUS_CARD_ID) {
        // The printed condition is state-based. Its ordinary Evo program only
        // checks whether the unique effect should be staged after the Evo has
        // entered play; the staged object performs the actual game win.
        if (!pending.alternateWin) return;
        const sourceStillActive = playerById(state, controllerId).bakugan.some((bakugan) => (
bakugan.evoStack.at(-1)?.id === (pending.sourceId ?? card.id)
        ));
        if (!sourceStillActive) {
entry(state, "system", `${card.displayName || card.name}'s alternate win effect resolved without an active source.`);
return;
        }
      }
      completeMatch(state, controllerId, action.reason);
      return;
    }
    case "damage-to-hand": {
      const amount = state.pendingDamage;
      for (let index = 0; index < amount; index += 1) {
        const damageCard = player.deckCards.shift();
        if (!damageCard) break;
            player.hand.push({ ...damageCard, revealedToOpponents: undefined });
      }
      syncDeck(player);
      state.pendingDamage = 0;
      state.informationEpoch += 1;
      state.undoWindow = undefined;
      entry(state, "game", `${player.name} put all remaining damage into their hand.`);
      return;
    }
    case "end-turn":
      state.pendingDamage = 0;
      state.revealedFlip = undefined;
      state.batch = [];
      for (const owner of state.players) {
        if (action.recharge) rechargeEnergyCards(state, owner.id, undefined, { respectChargeStepLocks: true });
        owner.energy = 0;
      }
      beginTurn(state);
      entry(state, "game", `${card.name} ended the turn${action.recharge ? "" : " without recharging Energy"}.`);
      return;
    case "shuffle-deck":
      shuffle(player.deckCards);
      syncDeck(player);
      return;
case "swap-bakucore": {
  if (choices.confirmed === false) return;
  const holderBakugan = (holder: typeof action.leftHolder) => {
    if (holder === "source-bakugan") return allBakugan.find((candidate) => candidate.id === choices.sourceBakuganId);
    if (holder === "opponent-active") return activeBakugan(state, opponent.id);
    return activeBakugan(state, controllerId);
  };
  const leftBakugan = holderBakugan(action.leftHolder);
  const rightBakugan = holderBakugan(action.rightHolder);
  const leftCell = choices[action.leftCoreChoiceId];
  const rightCell = choices[action.rightCoreChoiceId];
  if (!leftBakugan || !rightBakugan || leftBakugan.id === rightBakugan.id
    || typeof leftCell !== "string" || typeof rightCell !== "string" || leftCell === rightCell) return;
  const leftPlacement = state.placements.find((placement) => placement.cell === leftCell);
  const rightPlacement = state.placements.find((placement) => placement.cell === rightCell);
  if (!leftPlacement || !rightPlacement
    || leftPlacement.attachedTo !== leftBakugan.id || rightPlacement.attachedTo !== rightBakugan.id
    || !leftBakugan.heldCoreCells.includes(leftCell) || !rightBakugan.heldCoreCells.includes(rightCell)) return;
  leftPlacement.attachedTo = rightBakugan.id;
  rightPlacement.attachedTo = leftBakugan.id;
  leftBakugan.heldCoreCells = leftBakugan.heldCoreCells.map((cell) => cell === leftCell ? rightCell : cell);
  rightBakugan.heldCoreCells = rightBakugan.heldCoreCells.map((cell) => cell === rightCell ? leftCell : cell);
  entry(
    state,
    "game",
    `${card.displayName || card.name} swapped ${leftPlacement.core.name} and ${rightPlacement.core.name}.`,
    card,
    "effect",
    controllerId,
  );
  return;
}
    case "move": {
      const actionAmount = Math.max(0, Math.floor(resolveNumber(action.amount)));
      const destroyCount = (owner: PlayerState) => action.object === "hero"
        ? owner.heroes.length
        : action.object === "evo"
          ? owner.bakugan.reduce((sum, bakugan) => sum + bakugan.evoStack.length, 0)
          : action.object === "energy"
            ? owner.energyZone.length
            : 0;
      const tracksDestroyedObjects = action.verb === "destroy" && ["hero", "evo", "energy"].includes(action.object);
      const beforeByPlayer = tracksDestroyedObjects
        ? Object.fromEntries(state.players.map((owner) => [owner.id, destroyCount(owner)]))
        : undefined;

      if (action.verb === "destroy" && action.object === "hero" && /destroy this/i.test(text)) {
        for (const owner of state.players) {
          const destroyed = owner.heroes.filter((hero) => hero.id === pending.sourceId || hero.id === card.id);
          const destroyedIds = new Set(destroyed.map((hero) => hero.id));
          const remaining: GameCard[] = [];
          for (const hero of owner.heroes) {
            if (!destroyedIds.has(hero.id) || !destroyHeroCard(state, owner, hero, pending.sourceId ?? card.id)) remaining.push(hero);
          }
          owner.heroes = remaining;
        }
      } else if (action.verb === "destroy" && action.object === "hero") {
        if (action.playerScope === "all-players") {
          for (const owner of state.players) {
            const remaining: GameCard[] = [];
            for (const hero of owner.heroes) {
              if (!destroyHeroCard(state, owner, hero, pending.sourceId ?? card.id)) remaining.push(hero);
            }
            owner.heroes = remaining;
          }
        } else destroyHero(state, controllerId, choices, actionAmount > 2, pending.sourceId ?? card.id);
      } else if (action.verb === "destroy" && action.object === "evo") destroyEvo(state, controllerId, choices, {
        allEnemy: actionAmount > 2 && action.playerScope !== "all-players",
        allPlayers: action.playerScope === "all-players",
        excludeSourceId: action.excludeSource ? pending.sourceId ?? card.id : undefined,
      }, pending.sourceId ?? card.id);
      else if (action.verb === "destroy" && action.object === "energy") {
        if (action.retainChoiceId && action.playerScope === "each-player") {
          for (const owner of state.players) {
            const scopedChoices = choices.simultaneousAnswers?.[owner.id] ?? choices;
            const selectedValue = scopedChoices[action.retainChoiceId];
            const keptIds = new Set(Array.isArray(selectedValue) ? selectedValue.map(String) : []);
            if (!keptIds.size || [...keptIds].some((id) => !owner.energyZone.some((energy) => energy.id === id))) continue;
            const destroyed = owner.energyZone.filter((energy) => !keptIds.has(energy.id));
            owner.energyZone = owner.energyZone.filter((energy) => keptIds.has(energy.id));
            owner.discard.push(...destroyed);
          }
        } else {
          const amount = card.catalogId === "bb-97"
            ? choices.targetEnergyIds?.length ?? 0
            : actionAmount;
          destroyEnergy(state, amount, choices.targetEnergyIds ?? []);
        }
      } else if (action.verb === "destroy" && action.object === "baku-gear") {
        const gearId = choices.targetCardId;
        if (gearId) for (const owner of state.players) {
          for (const bakugan of owner.bakugan) {
            const index = (bakugan.bakuGear ?? []).findIndex((gear) => gear.id === gearId);
            if (index < 0) continue;
            const [destroyed] = bakugan.bakuGear!.splice(index, 1);
            owner.discard.push(destroyed);
            break;
          }
        }
      } else if (action.verb === "control" && action.object === "hero") {
        const index = opponent.heroes.findIndex((hero) => hero.id === choices.targetHeroId);
        if (index >= 0) {
          const moved = opponent.heroes.splice(index, 1);
          for (const hero of moved) delete hero.instabrawl;
          player.heroes.push(...moved);
        }
      } else if (action.verb === "control" && action.object === "baku-gear") {
        const gearId = choices.targetCardId;
        const destination = target;
        if (gearId && destination && destination.open) for (const owner of state.players) {
          const sourceBakugan = owner.bakugan.find((bakugan) => bakugan.bakuGear?.some((gear) => gear.id === gearId));
          const gearIndex = sourceBakugan?.bakuGear?.findIndex((gear) => gear.id === gearId) ?? -1;
          if (!sourceBakugan || gearIndex < 0 || (destination.bakuGear?.length ?? 0) >= 1) continue;
          const [gear] = sourceBakugan.bakuGear!.splice(gearIndex, 1);
          destination.bakuGear = [...(destination.bakuGear ?? []), gear];
          emitGameEvent(state, {
            id: `${pending.id}:gear-attach:${destination.id}:${gear.id}`,
            type: "gear-attach",
            playerId: controllerId,
            targetBakuganId: destination.id,
            sourceCards: [gear],
            choices,
          });
          break;
        }
      } else if (action.verb === "retract" && action.object === "bakugan") {
        const targets = actionAmount > 2
          ? state.players.flatMap((owner) => owner.bakugan).filter((bakugan) => bakugan.open)
          : target ? [target] : [];
        for (const candidate of targets) retractBakugan(state, candidate);
      }
      else if (action.verb === "attach" && action.object === "bakucore" && target) {
        const placement = state.placements.find((candidate) => candidate.cell === choices.coreCell && !candidate.attachedTo);
        if (placement) {
          placement.attachedTo = target.id;
          target.heldCoreCells.push(placement.cell);
        }
      } else if (action.verb === "attach" && action.object === "baku-gear" && target) {
        const cardOwner = playerById(state, pending.cardOwnerId ?? controllerId);
        const sourceIndex = cardOwner.discard.findIndex((candidate) => candidate.id === card.id);
        const attached = target.bakuGear ?? [];
        if (target.open && sourceIndex >= 0 && attached.length < 2) {
          const [gear] = cardOwner.discard.splice(sourceIndex, 1);
          target.bakuGear = [...(target.bakuGear ?? []), gear];
          emitGameEvent(state, {
            id: `${pending.id}:gear-attach:${target.id}:${gear.id}`,
            type: "gear-attach",
            playerId: controllerId,
            targetBakuganId: target.id,
            sourceCards: [gear],
            choices,
          });
        }
      } else if (action.verb === "remove" && action.object === "bakucore") {
        const owners = actionAmount > 2 ? [opponent] : state.players;
        for (const owner of owners) for (const bakugan of owner.bakugan) {
          const cells = actionAmount > 2 ? [...bakugan.heldCoreCells] : bakugan.heldCoreCells.filter((cell) => cell === choices.coreCell);
          for (const cell of cells) {
            const placement = state.placements.find((candidate) => candidate.cell === cell);
            if (placement) delete placement.attachedTo;
          }
          bakugan.heldCoreCells = bakugan.heldCoreCells.filter((cell) => !cells.includes(cell));
        }
      } else if (action.verb === "return" && action.object === "bakucore") {
        const placement = state.placements.find((candidate) => candidate.cell === choices.coreCell);
        if (placement) {
          delete placement.attachedTo;
          placement.revealed = false;
        }
      } else if (action.verb === "return" && action.object === "baku-gear") {
        const gearId = choices.targetCardId;
        if (gearId) for (const owner of state.players) {
          for (const bakugan of owner.bakugan) {
            const index = (bakugan.bakuGear ?? []).findIndex((gear) => gear.id === gearId);
            if (index < 0) continue;
            const [returned] = bakugan.bakuGear!.splice(index, 1);
            owner.hand.push({ ...returned, revealedToOpponents: undefined });
            break;
          }
        }
      } else if (action.verb === "return" && action.object === "card"
        && action.subject === "self" && action.destination === "owner-deck-bottom") {
        if (pending.kind === "card") {
          const cardOwner = playerById(state, pending.cardOwnerId ?? controllerId);
          if (!cardOwner.deckCards.some((candidate) => candidate.id === card.id)) {
            cardOwner.deckCards.push(card);
            syncDeck(cardOwner);
            entry(
              state,
              "game",
              `${card.displayName || card.name} returned to the bottom of ${cardOwner.name}'s deck.`,
              card,
              "effect",
              controllerId,
            );
          }
        }
      } else if (action.verb === "return" && action.object === "card") {
        if (choices.targetCardId) {
          for (const owner of state.players) {
            const heroIndex = owner.heroes.findIndex((candidate) => candidate.id === choices.targetCardId);
            if (heroIndex >= 0) {
              const returned = owner.heroes.splice(heroIndex, 1);
              for (const hero of returned) delete hero.instabrawl;
              owner.hand.push(...returned);
              break;
            }
            const bakugan = owner.bakugan.find((candidate) => candidate.evoStack.at(-1)?.id === choices.targetCardId);
            if (bakugan) {
              const returned = bakugan.evoStack.pop();
              if (returned) owner.hand.push(returned);
              break;
            }
          }
        } else if (!player.hand.some((candidate) => candidate.id === card.id)) {
          const owner = playerById(state, pending.cardOwnerId ?? controllerId);
          owner.discard = owner.discard.filter((candidate) => candidate.id !== card.id);
          owner.hand.push({ ...card, revealedToOpponents: undefined });
        }
      } else if (action.verb === "shuffle" && action.object === "card") {
        const ids = choices.handCardIds ?? choices.discardCardIds ?? [];
        const fromHand = /from your hand into your deck/i.test(text);
        const source = fromHand ? player.hand : player.discard;
        const moved = source.filter((candidate) => ids.includes(candidate.id)).slice(0, actionAmount);
        const movedIds = new Set(moved.map((candidate) => candidate.id));
        if (fromHand) player.hand = player.hand.filter((candidate) => !movedIds.has(candidate.id));
        else player.discard = player.discard.filter((candidate) => !movedIds.has(candidate.id));
        player.deckCards.push(...moved);
        shuffle(player.deckCards);
        syncDeck(player);
        recordResult({ amount: moved.length, amountByPlayer: { [player.id]: moved.length } });
        return;
      }

      if (beforeByPlayer) {
        const amountByPlayer = Object.fromEntries(state.players.map((owner) => [
          owner.id,
          Math.max(0, (beforeByPlayer[owner.id] ?? 0) - destroyCount(owner)),
        ]));
        recordResult({
          amount: Object.values(amountByPlayer).reduce((sum, amount) => sum + amount, 0),
          amountByPlayer,
        });
      }
      return;
    }
    case "reveal": {
      if (action.object === "bakucore") {
        const placement = state.placements.find((candidate) => candidate.cell === choices.coreCell && !candidate.attachedTo);
        if (placement) {
          placement.revealed = true;
          entry(state, "game", `${player.name} turned ${placement.core.name} face up in the Hide Matrix.`);
        }
      } else {
        const revealOwnerId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", { controllerId, choices })[0] ?? controllerId;
        const revealed = revealTopDeckCard(state, playerById(state, revealOwnerId));
        recordResult({
          amount: revealed ? 1 : 0,
          ...(revealed ? { cardCost: revealed.cost === "X" ? 0 : revealed.cost } : {}),
        });
      }
      return;
    }
    case "reorder-deck": {
      const ids = choices.orderedCardIds ?? [];
      const top = player.deckCards.slice(0, Math.max(0, Math.floor(resolveNumber(action.amount))));
      if (ids.length !== top.length || new Set(ids).size !== ids.length || ids.some((id) => !top.some((card) => card.id === id))) return;
      const byId = new Map(top.map((candidate) => [candidate.id, candidate]));
      player.deckCards.splice(0, top.length, ...ids.map((id) => byId.get(id)!));
      syncDeck(player);
      state.informationEpoch += 1;
      state.undoWindow = undefined;
      entry(state, "game", `${player.name} reordered the top ${top.length} cards of their deck.`);
      return;
    }
    case "play": {
      if (alternateWinEffectPending(state)) {
        entry(state, "game", `${card.name} could not play another card while Dragonoid Maximus's alternate win effect was on the batch.`);
        return;
      }
      if (choices.confirmed === false) return;
      let sourceZone: PendingCardPlay["sourceZone"];
      let sourceOwnerId = controllerId;
      let selected: GameCard | undefined;
      if (action.source === "hand") {
        const ownerId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", { controllerId, choices })[0] ?? controllerId;
        const owner = playerById(state, ownerId);
        const selectedId = choices.handCardIds?.[0];
        selected = owner.hand.find((candidate) => candidate.id === selectedId);
        sourceZone = "hand";
        sourceOwnerId = ownerId;
      } else if (action.source === "discard") {
        const ownerId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", { controllerId, choices })[0] ?? controllerId;
        const owner = playerById(state, ownerId);
        const selectedId = choices.discardCardIds?.[0];
        selected = owner.discard.find((candidate) => candidate.id === selectedId);
        sourceZone = "discard";
        sourceOwnerId = ownerId;
      } else if (action.source === "self") {
        sourceZone = "discard";
        sourceOwnerId = pending.cardOwnerId ?? controllerId;
        selected = playerById(state, sourceOwnerId).discard.find((candidate) => candidate.id === card.id);
      } else if (action.source === "revealed-hand") {
        sourceZone = "hand";
        sourceOwnerId = pending.cardOwnerId ?? controllerId;
        selected = playerById(state, sourceOwnerId).hand.find((candidate) => candidate.id === card.id);
      } else {
        sourceZone = "deck";
        const revealedId = player.revealedDeckCardId ?? choices.deckCardId;
        selected = player.deckCards.find((candidate) => candidate.id === revealedId);
      }
      if (!selected || (action.cardType && selected.type !== action.cardType)) return;
      if (action.excludedCardTypes?.includes(selected.type)) return;
      if (action.factions?.length && !effectiveCardFactions(selected).some((faction) => action.factions!.includes(faction))) return;
      if (action.cardMechanic && !selected.mechanics.some((mechanic) => mechanic.toLowerCase() === action.cardMechanic!.toLowerCase())) return;
      if (action.cardName) {
        const normalize = (value: string) => value
          .replace(/[\[\]]/g, "")
          .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\s+/i, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const wanted = normalize(action.cardName);
        if (![selected.displayName, selected.name].some((value) => normalize(value) === wanted)) return;
      }
      const printedCost = selected.cost === "X" ? Number.POSITIVE_INFINITY : selected.cost;
      if (action.maximumCost != null && printedCost > resolveNumber(action.maximumCost)) return;
      if (action.source === "revealed-deck" && (selected.type === "Flip" || selected.type === "Flip Hero")) {
        delete player.revealedDeckCardId;
        return;
      }
      const childChoices: CardChoices = {};
      if (selected.type === "Evo") {
        const definition = ruleDefinitionForCard(selected);
        const printedTarget = choices.sourceBakuganId ?? choices.targetBakuganId;
        const candidate = player.bakugan.find((bakugan) => bakugan.id === printedTarget && canonicalEvoTargetAllowed(definition, bakugan))
          ?? (() => {
            const active = activeBakugan(state, controllerId);
            return active && canonicalEvoTargetAllowed(definition, active)
              ? active
              : player.bakugan.find((bakugan) => canonicalEvoTargetAllowed(definition, bakugan));
          })();
        if (candidate) {
          // The generic Evo declaration uses targetBakuganId while some
          // effect-originated plays historically carried sourceBakuganId.
          // Populate both aliases so the nested play does not reopen a target
          // choice that the parent effect has already determined.
          childChoices.sourceBakuganId = candidate.id;
          childChoices.targetBakuganId = candidate.id;
        }
      }
      const destinationOwnerId = zoneOwnerIdsFor(state, action.destinationOwner ?? action.sourceOwner ?? "controller", { controllerId, choices })[0]
        ?? sourceOwnerId;
      const request: PendingCardPlay = {
        controllerId,
        cardId: selected.id,
        sourceZone,
        sourceOwnerId,
        cardOwnerId: action.destinationOwner ? destinationOwnerId : sourceOwnerId,
        forcedFreeBase: action.free,
        origin: "effect",
        parentEffectId: pending.id,
        parentNextInstructionIndex: instructionIndex + 1,
        resumePriority: state.priority,
        resumeDeadline: state.deadline,
        resumeStepLabel: state.stepLabel,
        resumePhase: state.phase,
        optional: /may/i.test(text),
        choices: childChoices,
      };
      try {
        const staged = stageCardPlayMutable(state, request);
        if (staged === "staged") {
          pending.instructionIndex = instructionIndex + 1;
          if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;
          throw new CardPlayResolutionSuspended();
        }
      } catch (error) {
        if (error instanceof CardPlayResolutionSuspended) throw error;
        if (request.optional) {
          entry(state, "game", `${card.name}: the optional free card play was unavailable and did nothing.`);
          return;
        }
        throw error;
      }
      return;
    }
    case "attack": {
      const attackAmount = Math.max(0, Math.floor(resolveNumber(action.amount)));
      state.pendingEffectDamageResume = {
        sourceEffectId: pending.id,
        phase: state.phase,
        priority: state.startingPlayer,
        deadline: deadlineFor(state.phase),
        stepLabel: state.stepLabel,
      };
      state.pendingLoser = opponent.id;
      state.pendingDamage = attackAmount;
      state.damageOrigin = pending.sourceId ?? pending.card.id;
      state.damageFaction = action.faction as Faction;
      pending.instructionIndex = instructionIndex + 1;
      if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;
      setPhase(state, "damage", `Damage Step • ${attackAmount} incoming from ${pending.card.displayName || pending.card.name}`, opponent.id);
      entry(state, "game", `${pending.card.name} made a ${action.faction ?? "separate"} attack for ${attackAmount}.`);
      throw new DamageResolutionSuspended();
    }
    case "negate": {
      const selectedId = choices.targetEffectId;
      if (!selectedId) return;
      const index = state.batch.findIndex((effect) => {
        const printedCost = effect.card.cost === "X" ? Number.POSITIVE_INFINITY : effect.card.cost;
        return effect.id !== pending.id
          && effect.id === selectedId
          && !effect.negated
          && (!action.targetKinds?.length || action.targetKinds.includes(effect.kind))
          && (action.cardType === "any" || effect.card.type === action.cardType)
          && (action.maximumCost == null || printedCost <= resolveNumber(action.maximumCost));
      });
      if (index >= 0) {
        const [negated] = state.batch.splice(index, 1);
        if (isRuleObject(negated)) negateRuleObject(negated);
        if (negated.kind === "card" && ["Action", "Flip", "Flip Hero", "Hero", "Baku-Gear", "Evo"].includes(negated.card.type)) {
          const owner = playerById(state, negated.cardOwnerId ?? negated.controllerId);
          if (!owner.discard.some((candidate) => candidate.id === negated.card.id)) owner.discard.push(negated.card);
        }
        if (action.copy && choices.confirmed !== false) {
          const typed = isRuleObject(negated) ? negated : normalizeRuleObjects({ ...state, batch: [negated] }).batch[0];
          if (isRuleObject(typed)) state.batch.push(copyRuleObject(typed, controllerId, { independentChoices: true }));
        }
      }
      return;
    }
    case "search": {
      const index = player.deckCards.findIndex((candidate) => (
        candidate.id === choices.deckCardId
        && (!action.cardType || candidate.type === action.cardType)
      ));
      if (index >= 0) {
        const [found] = player.deckCards.splice(index, 1);
        player.hand.push({ ...found, revealedToOpponents: undefined });
        shuffle(player.deckCards);
        syncDeck(player);
        state.informationEpoch += 1;
        state.undoWindow = undefined;
        entry(state, "game", `${player.name} searched, revealed ${found.name}, put it into hand, then shuffled.`);
      }
      return;
    }
    case "copy": {
      if (choices.confirmed === false) return;
      const count = Math.max(0, Math.floor(action.count == null ? 1 : resolveNumber(action.count)));
      const copyControllers = playerIdsForScope(state, action.controller ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });
      if (action.target === "next-action") {
        for (const copyControllerId of copyControllers) {
          state.copyNextAction[copyControllerId] = (state.copyNextAction[copyControllerId] ?? 0) + count;
        }
        return;
      }
      if (action.target === "played-action") {
        const selected = state.batch.find((effect) => effect.card.id === choices.eventCardId && effect.card.type === "Action" && !effect.negated);
        if (!selected) return;
        const normalized = isRuleObject(selected) ? selected : normalizeRuleObjects({ ...state, batch: [selected] }).batch[0];
        if (!isRuleObject(normalized)) return;
        for (const copyControllerId of copyControllers) {
          for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
            state.batch.push(copyRuleObject(normalized, copyControllerId, { independentChoices: action.independentChoices }));
          }
        }
        return;
      }
      if (action.target === "discarded-action-this-turn") {
      const selectedId = choices.targetCardId;
      if (typeof selectedId !== "string") return;
      const owner = state.players.find((candidate) => (
        (candidate.discardedCardIdsThisTurn ?? []).includes(selectedId)
        && candidate.discard.some((discarded) => discarded.id === selectedId && discarded.type === "Action")
      ));
      const selected = owner?.discard.find((discarded) => discarded.id === selectedId && discarded.type === "Action");
      if (!owner || !selected) return;
      const definition = ruleDefinitionForCard(selected);
      const ability = definition.abilities.find((candidate) => candidate.kind === "spell") ?? definition.abilities[0];
      if (!ability) return;
      for (const copyControllerId of copyControllers) {
        for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
          state.batch.push(createRuleObject({
            controllerId: copyControllerId,
            cardOwnerId: owner.id,
            card: selected,
            ability,
            choices: {},
            kind: "copy",
            sourceId: selected.id,
          }));
        }
      }
      return;
    }
      if (action.target === "revealed-action") {
        const ownerId = zoneOwnerIdsFor(state, action.sourceOwner ?? "controller", { controllerId, choices })[0] ?? controllerId;
        const owner = playerById(state, ownerId);
        const revealed = owner.deckCards.find((candidate) => candidate.id === owner.revealedDeckCardId && candidate.type === "Action");
        if (!revealed) return;
        const definition = ruleDefinitionForCard(revealed);
        const ability = definition.abilities.find((candidate) => candidate.kind === "spell") ?? definition.abilities[0];
        if (!ability) return;
        for (const copyControllerId of copyControllers) {
          for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
            state.batch.push(createRuleObject({ controllerId: copyControllerId, cardOwnerId: ownerId, card: revealed, ability, choices: {}, kind: "copy", sourceId: revealed.id }));
          }
        }
        return;
      }
      const targetChoiceId = action.targetChoiceId ?? "targetEffectId";
      const selectedId = choices[targetChoiceId];
      if (typeof selectedId !== "string") return;
      const selected = state.batch.find((effect) => effect.id === selectedId && effect.id !== pending.id && !effect.negated);
      if (!selected) return;
      const normalized = isRuleObject(selected) ? selected : normalizeRuleObjects({ ...state, batch: [selected] }).batch[0];
      if (!isRuleObject(normalized)) return;
      for (const copyControllerId of copyControllers) {
        for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {
          state.batch.push(copyRuleObject(normalized, copyControllerId, { independentChoices: action.independentChoices }));
        }
      }
      return;
    }
    case "rules-text": {
      const setPower = text.match(/\[B\] becomes (\d+)/i);
      if (target && setPower) state.powerBoost[target.id] = Number(setPower[1]) - (topCard(target).bPower ?? target.bPower);
      if (/victor is decided by highest \[damage rating\]/i.test(text)) state.victorByDamage = true;
      if (/retract your Bakugan at the end of the turn/i.test(text) && target) state.delayedRetracts.push(target.id);
      if (/return this to (?:your )?hand|put this into your hand/i.test(text)) player.hand.push({ ...card, revealedToOpponents: undefined });
      else if (/bottom of your deck/i.test(text)) {
        player.deckCards.push(card);
        syncDeck(player);
      }
      return;
    }
  }
};

/** Execute and consume deterministic effects promised for the end of an attack. */
export function completeScheduledAttackActions(state: MatchState) {
  const rules = ensureRulesState(state);
  const due = rules.scheduledActions.filter((scheduled) => (
    scheduled.timing === "after-attack" && scheduled.createdTurn === state.turn
  ));
  if (!due.length) return;
  const dueIds = new Set(due.map((scheduled) => scheduled.id));
  rules.scheduledActions = rules.scheduledActions.filter((scheduled) => !dueIds.has(scheduled.id));
  for (const scheduled of due) {
    const instruction: RuleInstruction = {
      id: `${scheduled.id}:instruction`,
      condition: { kind: "always" },
      effects: scheduled.effects,
      actions: scheduled.effects,
      choices: [],
      sourceText: `After this attack: ${scheduled.card.effect}`,
    };
    const ability = {
      id: `${scheduled.id}:ability`,
      kind: "spell" as const,
      instructions: [instruction],
    };
    const object = createRuleObject({
      controllerId: scheduled.controllerId,
      cardOwnerId: scheduled.cardOwnerId,
      card: scheduled.card,
      ability,
      kind: "trigger",
      sourceId: scheduled.sourceId,
    });
    for (const [index, effect] of scheduled.effects.entries()) {
      executeRuleAction(state, object, instruction, effect, 0, index);
    }
  }
}

function ruleActionIsExecutable(action: RuleAction): boolean {
  if (action.kind === "choice") return false;
  if (action.kind === "sequence") return action.effects.some(ruleActionIsExecutable);
  if (action.kind === "conditional") {
    return action.whenTrue.some(ruleActionIsExecutable)
      || Boolean(action.whenFalse?.some(ruleActionIsExecutable));
  }
  return true;
}

function ruleActionMatches(
  action: RuleAction,
  predicate: (candidate: RuleAction) => boolean,
): boolean {
  if (predicate(action)) return true;
  if (action.kind === "sequence") return action.effects.some((nested) => ruleActionMatches(nested, predicate));
  if (action.kind === "conditional") return action.whenTrue.some((nested) => ruleActionMatches(nested, predicate))
    || Boolean(action.whenFalse?.some((nested) => ruleActionMatches(nested, predicate)));
  if (action.kind === "replacement") return action.replaceWith.some((nested) => ruleActionMatches(nested, predicate));
  if (action.kind === "schedule") return action.effects.some((nested) => ruleActionMatches(nested, predicate));
  return false;
}

function instructionHasAction(
  instruction: RuleInstruction,
  predicate: (candidate: RuleAction) => boolean,
) {
  return instruction.effects.some((action) => ruleActionMatches(action, predicate));
}

function instructionOffersRevealedDeckPlay(instruction: RuleInstruction) {
  return instructionHasAction(instruction, (action) => (
    action.kind === "play" && action.source === "revealed-deck"
  ));
}

function revealTopDeckCard(state: MatchState, player: PlayerState) {
  const revealed = player.deckCards[0];
  if (!revealed || player.revealedDeckCardId === revealed.id) return revealed;
  player.revealedDeckCardId = revealed.id;
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  entry(state, "game", `${player.name} revealed ${revealed.name} from the top of their deck.`);
  return revealed;
}

function stageMandatoryDeckReveal(
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  schema: ReturnType<typeof buildChoiceSchema>,
) {
  const publicReveal = schema.fields.some((field) => (
    field.kind === "deck-order"
    && field.visibility === "public"
    && /^Reveal the top \d+ cards?$/i.test(field.label)
  ));
  if (!publicReveal || !/reveal the top card of your deck/i.test(instruction.sourceText)) return;
  const revealed = revealTopDeckCard(state, playerById(state, pending.controllerId));
  if (
    (revealed?.type !== "Flip" && revealed?.type !== "Flip Hero")
    || !instructionOffersRevealedDeckPlay(instruction)
  ) return;
  const confirmation = schema.fields.find((field) => field.id === "confirmed");
  if (confirmation) confirmation.options = confirmation.options.filter((option) => option.id === "no");
}

function captureResolvedInstructionValues(
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  instructionIndex: number,
) {
  if (!isRuleObject(pending)) return;
  const scopedChoices = instructionChoices(pending, instructionIndex);
  pending.valueSnapshots = captureInstructionValues(state, instruction, "resolve", {
    controllerId: pending.controllerId,
    chosenPlayerId: scopedChoices.targetPlayerId,
    choices: scopedChoices,
    sourceCardId: pending.sourceId ?? pending.card.id,
    sourceBakuganId: scopedChoices.sourceBakuganId,
  }, pending.valueSnapshots ?? {});
}

function stageResolutionInstructionChoice(
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  instructionIndex: number,
  stopWhenEmpty?: keyof CardChoices,
): "continue" | "suspend" | "skip" {
  const existing = pending.resolvedChoices?.[String(instructionIndex)];
  const partialSync = Boolean(existing?.syncCardId && instruction.choices.some((choice) => choice.id === "syncCardId"));
  if (existing && !partialSync) {
    captureResolvedInstructionValues(state, pending, instruction, instructionIndex);
    return existing.confirmed === false ? "skip" : "continue";
  }
  if (!instruction.effects.some(ruleActionIsExecutable)) {
    captureResolvedInstructionValues(state, pending, instruction, instructionIndex);
    return "continue";
  }
  const schema = buildChoiceSchema(
    state,
    pending.controllerId,
    pending.card,
    instruction.sourceText,
    instructionChoices(pending, instructionIndex),
    "resolve",
  );
  schema.fields = schema.fields.filter((field) => !(field.id === "xValue" && pending.choices.xValue != null));
  // Optional Sync gates any choices that follow it in the same printed
  // clause. They are initially skippable so declining Sync can resolve the
  // clause; a successful reveal promotes the remaining choices to required
  // and asks for them before the gated effects execute.
  const syncField = schema.fields.find((field) => field.id === "syncCardId");
  if (partialSync) {
    schema.fields = schema.fields
      .filter((field) => field.id !== "syncCardId")
      .map((field) => ({ ...field, minimum: Math.max(1, field.minimum), required: true }));
  } else if (syncField?.minimum === 0) {
    schema.fields = schema.fields.map((field) => field.id === "syncCardId"
      ? field
      : { ...field, minimum: 0, required: false });
  }
  const payAction = instruction.actions.find((action): action is Extract<RuleAction, { kind: "pay-energy" }> => action.kind === "pay-energy");
  if (payAction) {
    const payAmount = evaluateNumberValue(state, payAction.amount, {
      controllerId: pending.controllerId,
      choices: instructionChoices(pending, instructionIndex),
      sourceCardId: pending.sourceId ?? pending.card.id,
      moment: "resolve",
    });
    const confirmation = schema.fields.find((field) => field.id === "confirmed");
    if (confirmation) {
      const paymentUnavailable = maximumPayableEnergy(state, pending.controllerId) < payAmount;
      const targetUnavailable = schema.fields.some((field) => (
        field.id !== "confirmed"
        && field.minimum > 0
        && field.options.filter((option) => !option.disabled).length < field.minimum
      ));
      const reason = paymentUnavailable
        ? `Requires ${payAmount} available Energy`
        : targetUnavailable ? "No legal target or card is available" : undefined;
      if (reason) confirmation.options = confirmation.options.map((option) => (
        option.id === "yes" ? { ...option, disabled: true, description: reason } : option
      ));
    }
  }
  if (!schema.fields.length) {
    captureResolvedInstructionValues(state, pending, instruction, instructionIndex);
    return "continue";
  }
  stageMandatoryDeckReveal(state, pending, instruction, schema);
  const topDeckSelection = schema.fields.find((field) => field.id === "deckCardId");
  if (
    schema.fields.some((field) => field.kind === "deck-order" && field.requestedWindowSize)
    && topDeckSelection
    && topDeckSelection.options.length === 0
  ) {
    const confirmation = schema.fields.find((field) => field.id === "confirmed");
    if (confirmation) confirmation.options = confirmation.options.filter((option) => option.id === "no");
  }
  const emptyTopDeckWindow = schema.fields.some((field) => (
    field.kind === "deck-order"
    && field.requestedWindowSize
    && field.options.length === 0
  ));
  if (emptyTopDeckWindow) {
    entry(state, "game", `${pending.card.name}: there were no cards to inspect, so the clause did nothing.`);
    return "skip";
  }
  const repeatField = stopWhenEmpty
    ? schema.fields.find((field) => field.id === stopWhenEmpty)
    : undefined;
  if (repeatField && repeatField.options.length === 0) return "skip";
  const selectionField = instruction.condition.kind === "selection-made"
    ? schema.fields.find((field) => field.id === instruction.condition.choiceId)
    : undefined;
  if (selectionField && selectionField.options.length === 0) return "skip";
  if (schema.fields.every((field) => field.maximum === 0 && field.options.length === 0)) return "skip";
  if (!schemaHasLegalCompletion(schema)) {
    entry(state, "game", `${pending.card.name}: the clause had no legal choice and did nothing.`);
    return "skip";
  }
  const handViewer = schema.fields.find((field) => field.viewerOnly);
  if (handViewer) {
    const revealedIds = new Set(handViewer.options.map((option) => option.id));
    const revealedCards = state.players.flatMap((owner) => owner.hand)
      .filter((candidate) => revealedIds.has(candidate.id));
    const revealTriggers = emitHandRevealEvents(
      state,
      handViewer.options[0]?.ownerId ?? pending.controllerId,
      revealedCards,
      pending.card,
      `${pending.id}:hand-reveal:${instructionIndex}`,
    );
    if (revealTriggers.length) {
      resolveImmediateRuleObjects(state, revealTriggers);
      if (state.pendingChoice || state.pendingReroll || state.pendingCoinFlip) return "suspend";
    }
  }
  state.pendingChoice = {
    id: uid(),
    kind: "resolution",
    controllerId: pending.controllerId,
    cardId: pending.card.id,
    schema,
    answers: {},
    createdVersion: state.version,
    pendingEffectId: pending.id,
    instructionIndex,
    resumePriority: state.priority,
    resumeDeadline: state.deadline,
    resumeStepLabel: state.stepLabel,
    irreversibleInformation: false,
  };
  state.priority = schema.fields[0]?.chooserId ?? pending.controllerId;
  state.stepLabel = `${pending.card.displayName || pending.card.name} • Resolve clause ${instructionIndex + 1}`;
  state.deadline = Date.now() + 35_000;
  pending.instructionIndex = instructionIndex;
  if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex;
  return "suspend";
}

function resolvePendingEffect(state: MatchState, pending: PendingEffect) {
  if (isRuleObject(pending)) beginRuleObjectResolution(pending);
  const program = compileCardEffect(pending.card, pending.effect ?? pending.card.effect);
  let result: ReturnType<typeof executeRuleProgram>;
  try {
    result = executeRuleProgram(program, {
      conditionIsActive: (instruction, instructionIndex) => {
        if (isRuleObject(pending)) {
          pending.valueSnapshots = captureRuleConditionValues(state, instruction.condition, "resolve", {
            controllerId: pending.controllerId,
            chosenPlayerId: pending.choices.targetPlayerId,
            choices: pending.choices,
            sourceCardId: pending.sourceId ?? pending.card.id,
            sourceBakuganId: pending.choices.sourceBakuganId,
          }, pending.valueSnapshots ?? {});
        }
        return ruleConditionIsActive(state, pending, instruction, instructionIndex);
      },
      beforeInstruction: (instruction, instructionIndex) => {
        if (hasQueuedEffectDraw(state)) {
          pending.instructionIndex = instructionIndex;
          if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex;
          return "suspend";
        }
        return stageResolutionInstructionChoice(state, pending, instruction, instructionIndex);
      },
      execute: (action, instruction, cursor) => {
        executeRuleAction(state, pending, instruction, action, cursor.instructionIndex, cursor.effectIndex);
        pending.instructionIndex = cursor.instructionIndex;
      },
      afterInstruction: (instruction, instructionIndex) => {
        const choiceId = instruction.repeatWhileSelected;
        if (!choiceId) return "continue";
        const selected = pending.resolvedChoices?.[String(instructionIndex)]?.[choiceId];
        const madeSelection = Array.isArray(selected) ? selected.length > 0 : Boolean(selected);
        if (!madeSelection) return "continue";
        delete pending.resolvedChoices?.[String(instructionIndex)];
        const readiness = stageResolutionInstructionChoice(
          state,
          pending,
          instruction,
          instructionIndex,
          choiceId,
        );
        return readiness === "suspend" ? "suspend" : "continue";
      },
    }, pending.instructionIndex ?? 0);
  } catch (error) {
    if (error instanceof RerollResolutionSuspended || error instanceof DamageResolutionSuspended || error instanceof CoinFlipResolutionSuspended || error instanceof CardPlayResolutionSuspended) return false;
    throw error;
  }

  if (!result.completed) return false;
  pending.instructionIndex = result.instructionIndex;
  const player = playerById(state, pending.controllerId);
  const cardOwner = playerById(state, pending.cardOwnerId ?? pending.controllerId);
  const choices = {
    ...pending.choices,
    ...Object.values(pending.resolvedChoices ?? {}).reduce<CardChoices>((merged, answer) => ({ ...merged, ...answer }), {}),
  };
  if (pending.kind === "card" && (pending.card.type === "Hero" || pending.card.type === "Flip Hero")
    && !player.heroes.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    player.heroes.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Evo") {
    const target = player.bakugan.find((bakugan) => bakugan.id === (choices.sourceBakuganId ?? choices.targetBakuganId));
    if (target && canonicalEvoTargetAllowed(ruleDefinitionForCard(pending.card), target)) {
      target.evoStack.push(pending.card);
      const wasFaceDown = !target.open && !(target as Bakugan & { characterFaceUp?: boolean }).characterFaceUp;
      (target as Bakugan & { characterFaceUp?: boolean }).characterFaceUp = true;
      if (wasFaceDown) entry(state, "game", `${target.name}'s Character card was turned face up before its Evo entered play.`);
    } else player.discard.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Baku-Gear") {
    const target = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId);
    if (target) {
      target.bakuGear = [...(target.bakuGear ?? []), pending.card];
      emitGameEvent(state, {
        id: `${pending.id}:gear-attach:${target.id}:${pending.card.id}`,
        type: "gear-attach",
        playerId: pending.controllerId,
        targetBakuganId: target.id,
        sourceCards: [pending.card],
        choices,
      });
      const attached = target.bakuGear ?? [];
      if (attached.length > 1 && !attached.some(isDualWieldGear)) {
        state.pendingChoice = {
          id: uid(),
          kind: "gear-replacement",
          controllerId: pending.controllerId,
          cardId: pending.card.id,
          schema: {
            id: `${state.id}:${state.version}:${pending.card.id}:gear-replacement`,
            sourceId: pending.card.id,
            sourceName: pending.card.displayName || pending.card.name,
            controllerId: pending.controllerId,
            timing: "resolve",
            simultaneous: false,
            fields: [{
              id: "keepBakuGearId",
              kind: "card",
              label: "Choose the Baku-Gear to keep",
              chooserId: pending.controllerId,
              visibility: "public",
              timing: "resolve",
              minimum: 1,
              maximum: 1,
              required: true,
              options: attached.map((gear) => ({ id: gear.id, label: gear.displayName || gear.name })),
            }],
          },
          answers: {},
          createdVersion: state.version,
          pendingEffectId: pending.id,
          resumePriority: state.priority,
          resumeDeadline: state.deadline,
          resumeStepLabel: state.stepLabel,
          gearReplacement: { bakuganId: target.id, gearIds: attached.map((gear) => gear.id) },
        };
        state.priority = pending.controllerId;
        state.stepLabel = `${pending.card.displayName || pending.card.name} • Choose Baku-Gear`;
        state.deadline = Date.now() + 35_000;
      }
    }
    else cardOwner.discard.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Action"
    && !player.hand.some((card) => card.id === pending.card.id)
    && !player.discard.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    if (!cardOwner.deckCards.some((card) => card.id === pending.card.id)) cardOwner.discard.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Flip"
    && !player.hand.some((card) => card.id === pending.card.id)
    && !player.discard.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    cardOwner.discard.push(pending.card);
  }
  for (const owner of state.players) {
    if (owner.id === player.id || choices.orderedCardIds?.includes(owner.revealedDeckCardId ?? "")) delete owner.revealedDeckCardId;
  }
  if (isRuleObject(pending)) completeRuleObject(pending);
  // Completion and removal are one transaction. Self-moving effects such as
  // Turn to Energy must never leave a terminal rule object stranded in the
  // batch if a caller resumes through a different continuation path.
  state.batch = state.batch.filter((candidate) => candidate.id !== pending.id);
  delete state.coinFlipResults[pending.id];
  if (!pending.alternateWin) stageDragonoidMaximusWinEffect(state);
  entry(state, "game", `${pending.card.name} finished resolving its typed rule program.`, pending.card, "effect", pending.controllerId);
  return true;
}

export function completeCoinFlip(input: MatchState, playerId: string) {
  const state = cloneMatch(input);
  const pending = state.pendingCoinFlip;
  if (!pending) throw new Error("There is no coin flip waiting to finish.");
  if (pending.controllerId !== playerId) throw new Error("Only the resolving card's controller can finish this coin flip.");
  const effect = state.batch.find((candidate) => candidate.id === pending.sourceEffectId);
  state.pendingCoinFlip = undefined;
  state.priority = pending.resumePriority;
  state.deadline = Math.max(pending.resumeDeadline, deadlineFor(state.phase));
  state.stepLabel = pending.resumeStepLabel;
  state.passes = [];
  if (!effect) {
    delete state.coinFlipResults[pending.sourceEffectId];
    return withVersion(state);
  }
  const completed = resolvePendingEffect(state, effect);
  if (completed && !hasQueuedEffectDraw(state)) {
    state.priority = state.startingPlayer;
    state.deadline = deadlineFor(state.phase);
  }
  return withVersion(state);
}

export function resumePendingEffectAfterDamage(state: MatchState) {
  const resume = state.pendingEffectDamageResume;
  if (!resume) return false;
  delete state.pendingEffectDamageResume;
  state.pendingDamage = 0;
  state.pendingLoser = "";
  state.damageOrigin = "";
  state.damageFaction = undefined;
  state.revealedFlip = undefined;
  state.phase = resume.phase;
  state.priority = resume.priority;
  state.deadline = Math.max(resume.deadline, deadlineFor(resume.phase));
  state.stepLabel = resume.stepLabel;
  state.passes = [];

  const effect = state.batch.find((candidate) => candidate.id === resume.sourceEffectId);
  if (effect) {
    const completed = resolvePendingEffect(state, effect);
    if (completed) state.batch = state.batch.filter((candidate) => candidate.id !== effect.id);
    if (!completed || state.pendingChoice || state.pendingReroll || hasQueuedEffectDraw(state)) return true;
  }
  finalizeRerollContinuation(state, resume.sourceEffectId);
  if (!state.pendingChoice && !state.pendingReroll && !hasQueuedEffectDraw(state)
    && ["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase)) {
    state.priority = state.startingPlayer;
    state.deadline = deadlineFor(state.phase);
  }
  return true;
}

export function resumePendingEffectAfterDraw(state: MatchState, sourceEffectId?: string) {
  if (!sourceEffectId) {
    finalizeRerollContinuation(state, state.pendingRerollOpenEvent?.sourceEffectId);
    return;
  }
  const effect = state.batch.find((candidate) => candidate.id === sourceEffectId);
  if (effect) {
    const completed = resolvePendingEffect(state, effect);
    if (completed) state.batch = state.batch.filter((candidate) => candidate.id !== effect.id);
    if (!completed || state.pendingChoice || state.pendingReroll || hasQueuedEffectDraw(state)) return;
  }
  finalizeRerollContinuation(state, sourceEffectId);
  if (!state.pendingChoice && !state.pendingReroll && !hasQueuedEffectDraw(state)
    && ["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase)) {
    state.priority = state.startingPlayer;
    state.deadline = deadlineFor(state.phase);
  }
}

const applyEffect = (state: MatchState, pending: PendingEffect) => resolvePendingEffect(state, pending);

/** Start an already-paid effect without mutating and then reconstructing state. */
export const resolveStructuredEffect = (input: MatchState, pending: PendingEffect) => {
  const state = cloneMatch(input);
  if (!state.batch.some((candidate) => candidate.id === pending.id)) state.batch.push(pending);
  // cloneMatch normalizes the existing batch, but callers of this public
  // helper may provide a legacy PendingEffect after that normalization has
  // happened. Normalize again so result snapshots and previous-result values
  // are recorded on a RuleObject just as they are in the production reducer.
  normalizeRuleObjects(state);
  const live = state.batch.find((candidate) => candidate.id === pending.id)!;
  if (resolvePendingEffect(state, live)) state.batch = state.batch.filter((candidate) => candidate.id !== live.id);
  return withVersion(state);
};

const staticModifier = (state: MatchState, bakugan: Bakugan, owner: PlayerState) => {
  const evaluated = evaluateBakuganCharacteristics(state, bakugan, owner);
  return {
    power: evaluated.power,
    damage: evaluated.damage,
    frost: evaluated.frostStrike,
    double: evaluated.doubleStrike,
    shadow: evaluated.shadowStrike,
  };
};

export const totalPower = (state: MatchState, playerId: string) => {
  const bakugan = activeBakugan(state, playerId); const roll = state.rolls[playerId];
  return !bakugan || roll?.result === "miss-closed" ? 0 : staticModifier(state, bakugan, playerById(state, playerId)).power;
};
export const totalDamage = (state: MatchState, playerId: string) => {
  const bakugan = activeBakugan(state, playerId); return bakugan ? staticModifier(state, bakugan, playerById(state, playerId)).damage : 0;
};

const tieBreak = (state: MatchState) => {
  while (true) {
    const cards = state.players.map((player) => ({ player, card: player.deckCards.shift() })); cards.forEach(({ player }) => syncDeck(player));
    if (cards.every(({ card }) => !card)) return "";
    if (!cards[0].card) return cards[1].player.id; if (!cards[1].card) return cards[0].player.id;
    cards.forEach(({ player, card }) => player.discard.push(card!));
    const costs = cards.map(({ card }) => card!.cost === "X" ? 0 : card!.cost); entry(state, "random", `B-Power tie-break flipped costs ${costs[0]} and ${costs[1]}.`);
    if (costs[0] !== costs[1]) return cards[costs[0] > costs[1] ? 0 : 1].player.id;
  }
};

function stageTemporaryVictorDiscard(state: MatchState, winnerId: string, bakugan?: Bakugan) {
  if (!bakugan) return;
  const effect = state.temporaryVictorDiscards[bakugan.id];
  if (!effect) return;
  delete state.temporaryVictorDiscards[bakugan.id];
  const opponent = otherPlayer(state, winnerId);
  const amount = Math.min(effect.amount, opponent.hand.length);
  if (amount <= 0) return;
  const resumePriority = state.priority;
  const resumeDeadline = state.deadline;
  const resumeStepLabel = state.stepLabel;
  state.pendingChoice = {
    id: uid(),
    kind: "forced-discard",
    controllerId: effect.controllerId,
    cardId: `temporary-victor:${bakugan.id}`,
    schema: {
      id: `${state.id}:${state.version}:temporary-victor:${bakugan.id}`,
      sourceId: bakugan.id,
      sourceName: effect.sourceName,
      controllerId: effect.controllerId,
      timing: "resolve",
      simultaneous: false,
      fields: [{
        id: "discardCardIds",
        kind: "hand-cards",
        label: `Choose ${amount} card${amount === 1 ? "" : "s"} to discard`,
        chooserId: opponent.id,
        visibility: "private",
        timing: "resolve",
        minimum: amount,
        maximum: amount,
        required: true,
        options: opponent.hand.map((candidate) => ({
          id: candidate.id,
          label: candidate.displayName || candidate.name,
          ownerId: opponent.id,
        })),
      }],
    },
    answers: {},
    createdVersion: state.version,
    resumePriority,
    resumeDeadline,
    resumeStepLabel,
    irreversibleInformation: true,
  };
  state.priority = opponent.id;
  state.stepLabel = `${effect.sourceName} • Victor discard`;
  state.deadline = Date.now() + 35_000;
}

const declareVictor = (state: MatchState) => {
  const participants = state.players.filter((player) => activeBakugan(state, player.id)?.open);
  if (!participants.length) throw new Error("The Rolling Step must produce an open Bakugan.");
  let winnerId = participants[0].id;
  if (participants.length === 2) {
    const values = participants.map((player) => state.victorByDamage ? totalDamage(state, player.id) : totalPower(state, player.id));
    winnerId = values[0] === values[1] ? tieBreak(state) : participants[values[0] > values[1] ? 0 : 1].id;
    if (!winnerId) { state.phase = "result"; state.resultReason = "Simultaneous empty-deck tie-break"; state.winner = ""; return; }
  }
  state.brawlWinner = winnerId; state.startingPlayer = winnerId; setPhase(state, "victor", "Brawl Phase • Victor Step", winnerId);
  entry(state, "game", `${playerById(state, winnerId).name} was declared Victor by ${state.victorByDamage ? "Damage Rating" : "B-Power"}.`);
  const bakugan = activeBakugan(state, winnerId);
  emitGameEvent(state, { id: `${state.turn}:victor:${winnerId}`, type: "victor", playerId: winnerId, targetBakuganId: bakugan?.id });
  stageTemporaryVictorDiscard(state, winnerId, bakugan);
};

const beginDamage = (state: MatchState) => {
  const winner = playerById(state, state.brawlWinner); const loser = otherPlayer(state, winner.id); const attacking = activeBakugan(state, winner.id)!;
  const openTeam = winner.bakugan.filter((bakugan) => bakugan.open); state.teamAttack = openTeam.length === 3;
  const loserBakugan = activeBakugan(state, loser.id);
  state.pendingBrawlRetracts = [...new Set([
    ...(loserBakugan ? [loserBakugan.id] : []),
    ...(state.teamAttack ? openTeam.map((bakugan) => bakugan.id) : []),
  ])];
  const stats = staticModifier(state, attacking, winner); let damage = state.teamAttack ? openTeam.reduce((sum, bakugan) => sum + staticModifier(state, bakugan, winner).damage, 0) : stats.damage;
  if (stats.double) damage *= 2;
  state.pendingLoser = loser.id; state.pendingDamage = Math.max(0, damage); state.damageOrigin = attacking.id; state.damageFaction = attacking.faction;
  setPhase(state, "damage", `Damage Step • ${damage} incoming`, loser.id); entry(state, "game", `${winner.name} attacks for ${damage}${state.teamAttack ? " as a Team Attack" : ""}.`);
  emitGameEvent(state, { id: `${state.turn}:attack:${attacking.id}`, type: "attack", playerId: winner.id, targetBakuganId: attacking.id });
  if (damage > 0) emitGameEvent(state, { id: `${state.turn}:damage-taken:${loser.id}`, type: "damage-taken", playerId: loser.id });
  else finishDamage(state);
};

export const flipStopsDamage = (state: MatchState, card: GameCard) => {
  const text = card.effect;
  const coreTypes = [...text.matchAll(/\[(MS|FF|FT|SD|HE)\]/gi)]
    .map((match) => coreCode[match[1].toUpperCase()])
    .filter((type): type is CoreType => Boolean(type));
  if (/\[Stop\]\s+(?:an?|the)\s+Bakugan\s+(?:is\s+)?holding/i.test(text)) {
    const attacker = state.players.flatMap((player) => player.bakugan)
      .find((bakugan) => bakugan.id === state.damageOrigin);
    return Boolean(attacker && coreTypes.some((type) => hasCoreType(state, attacker, type)));
  }
  if (/\bstop the attack\b/i.test(text)) return true;
  if (/\[Stop\] an attack/i.test(text)) return true;
  const attackingBakugan = state.players.flatMap((player) => player.bakugan)
    .find((bakugan) => bakugan.id === state.damageOrigin);
  const factions = attackingBakugan
    ? effectiveBakuganFactions(attackingBakugan)
    : state.damageFaction ? [state.damageFaction] : [];
  // Legacy and hand-built snapshots may omit the attack source. Normal games
  // always carry it; preserve those snapshots rather than rejecting every Flip.
  if (!factions.length) return true;
  const non = text.match(/\[Stop\] non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i);
  if (non) return !factions.includes(non[1] as Faction);
  const listed = [...text.matchAll(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)]
    .map((match) => match[1] as Faction);
  return /\[Stop\]/i.test(text) && listed.some((faction) => factions.includes(faction));

};

export function revealedFlipCanBePlayed(
  state: MatchState | null | undefined,
  playerId: string | undefined,
  card: GameCard | undefined = state?.revealedFlip,
) {
  if (!state || !playerId || !card) return false;
  if (state.phase !== "damage" || state.pendingLoser !== playerId || state.revealedFlip?.id !== card.id) return false;
  return !/\[Stop\]/i.test(card.effect) || flipStopsDamage(state, card);
}

function finishDamage(state: MatchState) {
  state.revealedFlip = undefined;
  completeScheduledAttackActions(state);
  if (resumePendingEffectAfterDamage(state)) return;
  setPhase(state, "postDamage", "Damage Step • Post-damage priority", state.startingPlayer);
}

function resolveInstabrawlCleanup(state: MatchState) {
  for (const owner of state.players) {
    const remaining: GameCard[] = [];
    for (const hero of owner.heroes) {
      if (!hero.instabrawl) {
        remaining.push(hero);
        continue;
      }
      if (destroyHeroCard(state, owner, hero, `instabrawl:${hero.id}`)) {
        entry(state, "game", `${hero.displayName || hero.name} was destroyed by InstaBrawl at the end of the turn.`, hero, "effect", owner.id);
      } else {
        // The temporary status is consumed even when a destruction-prevention
        // effect such as Honey Trap keeps the Hero in play.
        delete hero.instabrawl;
        remaining.push(hero);
      }
    }
    owner.heroes = remaining;
  }
}

function beginChargeStep(state: MatchState) {
  emitGameEvent(state, { id: `${state.turn}:end-turn`, type: "end-turn", playerId: state.startingPlayer });
  if (state.batch.length || state.triggerOrders.length) return;
  resolveInstabrawlCleanup(state);
  for (const player of state.players) for (const bakugan of player.bakugan) {
    if (state.delayedRetracts.includes(bakugan.id)) retractBakugan(state, bakugan);
  }
  for (const player of state.players) {
    rechargeEnergyCards(state, player.id, undefined, { respectChargeStepLocks: true });
    player.energy = 0;
  }
  setPhase(state, "charge", "End Phase • Charge Step", state.startingPlayer);
  entry(state, "game", "Both players charged all Energy cards.");
}

function beginResetStep(state: MatchState) {
  state.powerBoost = {};
  state.damageBoost = {};
  state.frostStrike = {};
  state.doubleStrike = {};
  state.shadowStrike = {};
  const rules = ensureRulesState(state);
  rules.modifiers = rules.modifiers.filter((modifier) => modifier.duration !== "turn");
  rules.replacements = rules.replacements.filter((replacement) => replacement.effect.kind !== "prevention");
  rules.costModifiers = rules.costModifiers.filter((modifier) => modifier.duration !== "turn");
  rules.triggerUsage = {};
  setPhase(state, "reset", "End Phase • Reset Step", state.startingPlayer);
  entry(state, "game", "Turn-duration modifications were reset.");
}

function finishResetStep(state: MatchState) {
  const over = state.players.find((player) => player.hand.length > 7);
  if (over) setPhase(state, "handLimit", "End of turn • Discard to seven", over.id);
  else beginTurn(state);
}

function completeBrawlRetractions(state: MatchState) {
  const pending = [...new Set(state.pendingBrawlRetracts ?? [])];
  state.pendingBrawlRetracts = [];
  if (!pending.length) return;
  const ids = new Set(pending);
  for (const player of state.players) {
    for (const bakugan of player.bakugan) {
      if (ids.has(bakugan.id)) retractBakugan(state, bakugan);
    }
  }
}

const advanceEmptyBatch = (state: MatchState) => {
  if (state.phase === "preRoll") setPhase(state, "target", "Roll Phase • Secret target selection", state.startingPlayer);
  else if (state.phase === "power") declareVictor(state);
  else if (state.phase === "victor") beginDamage(state);
  else if (state.phase === "postDamage") {
    completeBrawlRetractions(state);
    setPhase(state, "endPlay", "End Phase • Play Step", state.startingPlayer);
  } else if (state.phase === "endPlay") beginChargeStep(state);
  else if (state.phase === "reset") finishResetStep(state);
};

export const passPriority = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (hasQueuedEffectDraw(state)) throw new Error("Complete every pending Draw action before passing priority.");
  if (state.pendingCoinFlip) throw new Error("Wait for the pending coin flip to finish before passing priority.");
  if (state.pendingChoice) throw new Error("Complete the pending player choice before passing priority.");
  if (state.triggerOrders.some((request) => !request.orderedIds)) throw new Error("Order every simultaneous trigger before passing priority.");
  const startEffectPriority = state.phase === "draw" && state.turn === 1 && state.batch.length > 0;
  if ((!startEffectPriority && !["preRoll", "power", "victor", "postDamage", "endPlay", "reset"].includes(state.phase)) || state.priority !== playerId) throw new Error("You do not have priority.");
  state.priorityEpoch += 1;
  state.undoWindow = undefined;
  state.passes.push(playerId); entry(state, "game", `${playerById(state, playerId).name} passed priority.`); const other = otherPlayer(state, playerId);
  if (state.passes.length < 2) { state.priority = other.id; state.deadline = deadlineFor(state.phase); return withVersion(state); }
  state.passes = [];
  if (state.batch.length) {
    const pending = state.batch.at(-1)!;
    const completed = pending.negated || applyEffect(state, pending);
    if (!completed) return withVersion(state);
    state.batch = state.batch.filter((candidate) => candidate.id !== pending.id);
    if (state.phase === "result") return withVersion(state);
    if (!hasQueuedEffectDraw(state)) {
      state.priority = state.startingPlayer;
      state.deadline = deadlineFor(state.phase);
    }
  } else advanceEmptyBatch(state);
  return withVersion(state);
};

export const discardToHandLimit = (input: MatchState, playerId: string, cardIds: string[]) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "handLimit" || state.priority !== playerId || cardIds.length !== player.hand.length - 7) throw new Error("Select exactly enough cards to keep seven.");
  discardFromHand(state, player, cardIds.length, cardIds); const next = state.players.find((candidate) => candidate.hand.length > 7);
  if (next) state.priority = next.id;
  else if (state.batch.length || state.triggerOrders.length) setPhase(state, "reset", "End Phase • Reset Step • Resolve discard triggers", state.startingPlayer);
  else beginTurn(state);
  return withVersion(state);
};

export function completeMatch(state: MatchState, winnerId: string, reason: string) {
  if (state.phase === "result") return;
  state.series[winnerId] = (state.series[winnerId] ?? 0) + 1; state.phase = "result"; state.stepLabel = "Game complete";
  state.winner = winnerId; state.resultReason = reason; state.deadline = deadlineFor("result"); entry(state, "system", `${playerById(state, winnerId).name} wins game ${state.gameNumber}: ${reason}.`);
  state.priority = ""; state.passes = []; state.batch = []; state.triggerOrders = [];
  state.pendingChoice = undefined; state.pendingReroll = undefined; state.revealedFlip = undefined;
  state.pendingEffectDamageResume = undefined; state.pendingRerollOpenEvent = undefined;
  state.undoWindow = undefined;
}

export const concedeMatch = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input); if (state.phase === "result" || !state.players.some((player) => player.id === playerId)) throw new Error("Concede is not legal now.");
  completeMatch(state, otherPlayer(state, playerId).id, "Opponent conceded"); return withVersion(state);
};

export const nextTurn = (input: MatchState) => {
  const state = cloneMatch(input);
  if (state.phase === "retract" || state.phase === "endPlay") {
    state.batch = [];
    advanceEmptyBatch(state);
    return withVersion(state);
  }
  if (state.phase === "charge") {
    beginResetStep(state);
    return withVersion(state);
  }
  if (state.phase === "reset") {
    if (state.pendingChoice || state.batch.length || state.triggerOrders.length) {
      throw new Error("Resolve every Reset Step trigger before advancing the turn.");
    }
    finishResetStep(state);
    return withVersion(state);
  }
  if (state.phase === "handLimit") {
    if (state.players.some((player) => player.hand.length > 7)) throw new Error("Complete every hand-limit discard before advancing the turn.");
    if (state.batch.length || state.triggerOrders.length) setPhase(state, "reset", "End Phase • Reset Step • Resolve discard triggers", state.startingPlayer);
    else beginTurn(state);
    return withVersion(state);
  }
  throw new Error("The turn advances through priority and the End Phase.");
};

export const startNextSeriesGame = (input: MatchState) => {
  const state = cloneMatch(input); const needed = state.format === "bo3" ? 2 : 1;
  if (state.phase !== "result" || Math.max(...Object.values(state.series)) >= needed) throw new Error("The match is complete.");
  state.gameNumber += 1; state.turn = 0; state.gameStartEventedGame = 0; state.placements = []; state.placementTurn = 0; state.selected = {}; state.targets = {}; state.rolls = {}; state.batch = [];
  state.pendingReroll = undefined; state.pendingEffectDamageResume = undefined; state.pendingRerollOpenEvent = undefined; state.rerollOpenedByEffect = {}; state.rerollTargetByEffect = {}; state.rerollUsage = {}; state.rerollSequence = 0; state.repeatRollAfterReroll = false; state.nextCardCostReduction = {}; state.nextCardEmpowerReduction = {}; state.nextCardEmpowerFree = {}; state.temporaryVictorDiscards = {};
  const selected = state.players[secureRandomInt(state.players.length)];
  state.startingPlayer = selected.id; state.initialStartingPlayer = selected.id; state.priority = selected.id;
  state.startingPlayerRevealedAt = Date.now() + 2_500; state.brawlWinner = ""; state.winner = ""; state.resultReason = "";
  for (const player of state.players) {
    const attachedCards = player.bakugan.flatMap((bakugan) => [...bakugan.evoStack, ...(bakugan.bakuGear ?? [])]);
    const all = [...player.deckCards, ...player.hand, ...player.discard, ...player.energyZone, ...player.heroes, ...attachedCards];
    player.deckCards = all.filter((card) => card.type !== "Character"); shuffle(player.deckCards); player.hand = []; player.discard = []; player.energyZone = []; player.heroes = [];
    player.energy = 0; player.unchargedEnergyIds = []; player.energyRechargeLocks = {}; player.tappedEnergyIds = []; player.energyTapTurn = state.turn; player.ready = true; player.bakugan.forEach((bakugan) => { bakugan.open = false; bakugan.heldCoreCells = []; bakugan.evoStack = []; bakugan.bakuGear = []; bakugan.fused = false; });
    drawCards(state, player, 5);
  }
  setPhase(state, "startingPlayer", `Game ${state.gameNumber} • Selecting the first BakuCore player`, selected.id);
  state.deadline = state.startingPlayerRevealedAt + 30_000;
  state.informationEpoch += 1;
  entry(state, "system", `Game ${state.gameNumber} begins with cryptographically shuffled decks and a fresh Hide Matrix.`);
  entry(state, "random", `Server starting-player selection: ${selected.name} will place the first BakuCore.`);
  return withVersion(state);
};

export const redactForPlayer = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (state.undoWindow) delete state.undoWindow.snapshot;
  if (state.pendingChoice) {
    delete state.pendingChoice.beforeState;
    for (const chooserId of Object.keys(state.pendingChoice.answers)) if (chooserId !== playerId) delete state.pendingChoice.answers[chooserId];
    state.pendingChoice.schema.fields = state.pendingChoice.schema.fields.map((field) => (
      field.visibility === "private" && field.chooserId !== playerId
        ? { ...field, options: [] }
        : field
    ));
  }
  if (state.phase === "target" || state.phase === "reroll") for (const id of Object.keys(state.targets)) if (id !== playerId) delete state.targets[id];
  if (state.phase === "reroll" && state.pendingReroll?.playerId !== playerId && state.pendingReroll) delete state.pendingReroll.targetCell;
  const hiddenCard = (id: string): GameCard => ({
    id, catalogId: "hidden", number: 0, name: "Hidden card", displayName: "Hidden card",
    faction: "Aquos", factions: [], type: "Action", cost: 0, rarity: "",
    effect: "", mechanics: [], bPower: null, damage: null, coreTypes: [], evolvesFrom: null,
    art: "/assets/cards/card-missing.svg",
  });
  const hiddenCharacter = (id: string): GameCard => ({
    ...hiddenCard(id),
    name: "Face-down Character",
    displayName: "Face-down Character",
    type: "Character",
  });
  const startTriggerIds = new Set([
    ...state.batch,
    ...state.triggerOrders.flatMap((request) => request.triggers),
  ].filter((effect) => effect.createdByEventId?.startsWith("game-start:")).map((effect) => effect.id));
  const startTriggerCardIds = new Set([
    ...state.batch,
    ...state.triggerOrders.flatMap((request) => request.triggers),
  ].filter((effect) => effect.createdByEventId?.startsWith("game-start:")).map((effect) => effect.card.id));
  const pendingStartTrigger = state.pendingChoice && (
    (state.pendingChoice.pendingEffectId && startTriggerIds.has(state.pendingChoice.pendingEffectId))
    || startTriggerCardIds.has(state.pendingChoice.cardId)
  );
  if (pendingStartTrigger && state.pendingChoice?.controllerId !== playerId) {
    state.pendingChoice.cardId = "hidden-start-of-game";
    state.pendingChoice.schema.sourceId = "hidden-start-of-game";
    state.pendingChoice.schema.sourceName = "Hidden start-of-game effect";
  }
  if (pendingStartTrigger && state.pendingChoice?.controllerId !== playerId) {
    state.stepLabel = "Start-of-game effect resolving";
  }
  for (const placement of state.placements) {
    if (!placement.attachedTo && !placement.revealed && placement.playerId !== playerId) {
      const type = placement.core.type;
      const backs: Record<CoreType, string> = {
        Fist: "/assets/core-backs/fist.png", "Flaming Fist": "/assets/core-backs/flaming-fist.png",
        Shield: "/assets/core-backs/shield.png", "Magic Shield": "/assets/core-backs/magic-shield.png", Helix: "/assets/core-backs/helix.png",
      };
      placement.core = {
        id: `hidden-core-${placement.cell}`,
        catalogId: "hidden",
        number: 0,
        name: "Face-down BakuCore",
        type,
        bonus: 0,
        damageBonus: 0,
        art: backs[type],
      };
    }
  }
  for (const player of state.players) {
    player.deckCards = [];
    if (player.id !== playerId) {
      player.hand = player.hand.map((card, index) => card.revealedToOpponents ? card : hiddenCard(`hidden-hand-${index}`));
      player.energyZone = player.energyZone.map((_, index) => hiddenCard(`hidden-energy-${index}`));
      if (state.batch.length || state.triggerOrders.length) {
        for (const bakugan of player.bakugan) {
          if (bakugan.open) continue;
          bakugan.character = hiddenCharacter(`hidden-character-${player.id}-${bakugan.id}`);
          bakugan.fusionCharacter = bakugan.fusionCharacter ? hiddenCharacter(`hidden-fusion-character-${player.id}-${bakugan.id}`) : undefined;
          bakugan.evoStack = [];
          bakugan.name = "Face-down Bakugan";
          bakugan.faction = "Aquos";
          bakugan.bPower = 0;
          bakugan.damage = 0;
          bakugan.art = "/assets/cards/card-missing.svg";
        }
      }
    }
  }
  const redactStartTrigger = (effect: PendingEffect) => (
    effect.createdByEventId?.startsWith("game-start:") && effect.controllerId !== playerId
      ? { ...effect, card: hiddenCard(`hidden-start-effect-${effect.id}`), effect: "Start-of-game effect", sourceId: undefined }
      : effect
  );
  state.batch = state.batch.map(redactStartTrigger);
  state.triggerOrders = state.triggerOrders.map((request) => ({
    ...request,
    triggers: request.triggers.map(redactStartTrigger),
  }));
  return state;
};
