import {
  buildChoiceSchema,
  mergeChoiceAnswers,
  schemaHasLegalCompletion,
  schemaIsComplete,
  validateChoices,
} from "./rules/choices";
import { executeRuleProgram } from "./rules/executor";
import { compileCardEffect, type RuleAction, type RuleInstruction } from "./rules/effects";

export type Faction = "Pyrus" | "Aquos" | "Darkus" | "Haos" | "Ventus" | "Aurelus";
export type CoreType = "Fist" | "Flaming Fist" | "Shield" | "Magic Shield" | "Helix";
export type CardType = "Action" | "Flip" | "Hero" | "Evo" | "Character";

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
  /** Turn in which this physical card instance entered play. */
  playedTurn?: number;
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
  /** Turn in which this Bakugan most recently opened. */
  openedTurn?: number;
};

export type Core = {
  id: string;
  number: number;
  name: string;
  type: CoreType;
  bonus: number;
  damageBonus: number;
  frostStrike?: number;
  shadowStrike?: boolean;
  conditionalFactions?: Faction[];
  conditionalBonus?: number;
  conditionalDamage?: number;
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
  energy: number;
  maxEnergy: number;
  ready: boolean;
  connected: boolean;
  lastSeen: number;
  energizedThisTurn: boolean;
  cardsPlayedThisTurn: number;
  /** Publicly revealed top-deck card awaiting a linked free-play decision. */
  revealedDeckCardId?: string;
};

export type Placement = { playerId: string; core: Core; cell: string; order: number; attachedTo?: string; revealed?: boolean };
export type RollOutcome = {
  playerId: string;
  bakuganId: string;
  target: string;
  resolvedTarget: string;
  result: "miss" | "open-no-core" | "target-core" | "adjacent-core" | "double-core";
  cores: string[];
  accuracyRoll: number;
  doubleRoll: number;
  note: string;
};

export type CardChoices = {
  targetBakuganId?: string;
  targetPlayerId?: string;
  targetHeroId?: string;
  targetEvoId?: string;
  targetEnergyId?: string;
  targetEnergyIds?: string[];
  coreCell?: string;
  discardCardIds?: string[];
  handCardIds?: string[];
  orderedCardIds?: string[];
  deckCardId?: string;
  xValue?: number;
  mode?: string;
  confirmed?: boolean;
  simultaneousAnswers?: Record<string, CardChoices>;
};

export type PendingEffect = {
  id: string;
  controllerId: string;
  card: GameCard;
  choices: CardChoices;
  kind: "card" | "trigger" | "copy";
  effect?: string;
  sourceId?: string;
  negated?: boolean;
  /** Next compiled instruction to execute. Persisted so a choice can suspend resolution. */
  instructionIndex?: number;
  /** Clause-scoped answers keyed by compiled instruction index. */
  resolvedChoices?: Record<string, CardChoices>;
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
  | "lobby" | "startingPlayer" | "placement" | "draw" | "energize" | "selection" | "preRoll" | "target"
  | "power" | "victor" | "damage" | "postDamage" | "retract" | "endPlay"
  | "handLimit" | "result";

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
  delayedRetracts: string[];
  copyNextAction: Record<string, number>;
  brawlWinner: string;
  winner: string;
  resultReason: string;
  deadline: number;
  log: { id: string; at: number; kind: "game" | "random" | "system" | "connection"; message: string }[];
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
  lobby: 60, startingPlayer: 8, placement: 45, draw: 35, energize: 35, selection: 35, preRoll: 30, target: 30,
  power: 40, victor: 30, damage: 35, postDamage: 25, retract: 10, endPlay: 35,
  handLimit: 40, result: 120,
};
const deadlineFor = (phase: Phase) => Date.now() + PHASE_TIMERS[phase] * 1000;
const distance = (a: { q: number; r: number }, b: { q: number; r: number }) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;
const cellAt = (id: string) => HEX_CELLS.find((cell) => cell.id === id);
const entry = (state: MatchState, kind: MatchState["log"][number]["kind"], message: string) => {
  state.log.push({ id: `${Date.now()}-${state.log.length}-${Math.random().toString(36).slice(2, 5)}`, at: Date.now(), kind, message });
};
const withVersion = (state: MatchState) => { state.version += 1; return state; };
export const cloneMatch = (state: MatchState): MatchState => JSON.parse(JSON.stringify(state));

/** Upgrade resumable snapshots created before current engine fields existed. */
export const normalizeMatchState = (input: MatchState): MatchState => {
  const state = cloneMatch(input);
  state.triggerOrders = Array.isArray(state.triggerOrders) ? state.triggerOrders : [];
  state.collectedEventKeys = Array.isArray(state.collectedEventKeys) ? state.collectedEventKeys : [];
  state.informationEpoch = Number.isFinite(state.informationEpoch) ? Number(state.informationEpoch) : 0;
  state.priorityEpoch = Number.isFinite(state.priorityEpoch) ? Number(state.priorityEpoch) : 0;
  state.initialStartingPlayer = state.initialStartingPlayer || state.startingPlayer || state.players[0]?.id || "";
  state.startingPlayerRevealedAt = Number.isFinite(state.startingPlayerRevealedAt)
    ? Number(state.startingPlayerRevealedAt)
    : 0;
  state.batch = Array.isArray(state.batch) ? state.batch : [];
  state.passes = Array.isArray(state.passes) ? state.passes : [];
  state.placements = Array.isArray(state.placements) ? state.placements : [];
  state.selected = state.selected && typeof state.selected === "object" ? state.selected : {};
  state.targets = state.targets && typeof state.targets === "object" ? state.targets : {};
  state.rolls = state.rolls && typeof state.rolls === "object" ? state.rolls : {};
  state.log = Array.isArray(state.log) ? state.log : [];
  return state;
};
const otherPlayer = (state: MatchState, playerId: string) => state.players.find((player) => player.id !== playerId)!;
const playerById = (state: MatchState, playerId: string) => state.players.find((player) => player.id === playerId)!;
const syncDeck = (player: PlayerState) => { player.deck = player.deckCards.length; };
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
    if (index >= 0) { const [card]=player.hand.splice(index,1); player.discard.push(card); discarded.push(card); }
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
    powerBoost: {}, damageBoost: {}, frostStrike: {}, doubleStrike: {}, shadowStrike: {}, passes: [], batch: [], victorByDamage: false,
    pendingDamage: 0, pendingLoser: "", damageOrigin: "", teamAttack: false, delayedRetracts: [], copyNextAction: {}, brawlWinner: "", winner: "", resultReason: "",
    triggerOrders: [], collectedEventKeys: [], informationEpoch: 0, priorityEpoch: 0,
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
  state.selected = {}; state.targets = {}; state.rolls = {}; state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {};
  state.doubleStrike = {}; state.shadowStrike = {}; state.batch = []; state.victorByDamage = false; state.pendingDamage = 0;
  state.pendingLoser = ""; state.damageOrigin = ""; state.revealedFlip = undefined; state.teamAttack = false; state.delayedRetracts = []; state.winner = "";
  state.collectedEventKeys = [];
  for (const player of state.players) {
    player.energizedThisTurn = false; player.cardsPlayedThisTurn = 0;
  }
  const now = Date.now();
  const drawCount = 1 + state.players.reduce((total, player) => (
    total + player.heroes.filter((hero) => hero.name === "Strata" || /all players draw an additional card each turn/i.test(hero.effect)).length
  ), 0);
  state.drawPreparedTurn = state.turn;
  state.drawReadyAt = now + (state.turn === 1 ? 3_000 : 0);
  state.drawDeadline = state.drawReadyAt + PHASE_TIMERS.draw * 1_000;
  state.drawnPlayerIds = [];
  state.drawRemainingByPlayer = Object.fromEntries(state.players.map((player) => [player.id, drawCount]));
  setPhase(state, "draw", state.turn === 1 ? `Turn ${state.turn} • Draw Step begins in 3 seconds` : `Turn ${state.turn} • Draw Step`, state.startingPlayer);
  state.deadline = state.drawDeadline;
  entry(state, "game", `Turn ${state.turn} began. Both players have ${drawCount} explicit Draw action${drawCount === 1 ? "" : "s"}.`);
};

export const energizeCard = (input: MatchState, playerId: string, cardId?: string) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "energize" || player.energizedThisTurn) throw new Error("Your Energize decision is already complete.");
  if (cardId) {
    const index = player.hand.findIndex((card) => card.id === cardId); if (index < 0) throw new Error("Choose a card in your hand.");
    const [card] = player.hand.splice(index, 1); player.energyZone.push(card); player.maxEnergy += 1; player.energy += 1;
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

const adjacentPlacements = (state: MatchState, cellId: string) => {
  const cell = cellAt(cellId); if (!cell) return [];
  return state.placements.filter((placement) => !placement.attachedTo && distance(cell, cellAt(placement.cell)!) === 1);
};

const directionVector = (playerIndex: number) => playerIndex === 0 ? { q: 0, r: -1 } : { q: 0, r: 1 };
const relativePlacement = (state: MatchState, cellId: string, playerIndex: number, distanceAhead: number) => {
  const cell = cellAt(cellId); if (!cell) return undefined; const vector = directionVector(playerIndex);
  const target = HEX_CELLS.find((candidate) => candidate.q === cell.q + vector.q * distanceAhead && candidate.r === cell.r + vector.r * distanceAhead);
  return target ? state.placements.find((placement) => placement.cell === target.id && !placement.attachedTo) : undefined;
};

const weightedAdjacent = (state: MatchState, cellId: string, playerIndex: number) => {
  const behind = relativePlacement(state, cellId, playerIndex, -1); const front = relativePlacement(state, cellId, playerIndex, 1);
  const rest = adjacentPlacements(state, cellId).filter((placement) => placement !== behind && placement !== front).sort((a, b) => a.order - b.order);
  return [behind, front, ...rest].filter(Boolean) as Placement[];
};

const resolveOneRoll = (state: MatchState, player: PlayerState): RollOutcome => {
  const bakugan = player.bakugan.find((candidate) => candidate.id === state.selected[player.id])!;
  const intended = state.targets[player.id]; const playerIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const rotationCore = relativePlacement(state, intended, playerIndex, 3); const resolvedTarget = rotationCore?.cell ?? intended;
  const accuracyRoll = secureRandomInt(100) + 1; const doubleRoll = secureRandomInt(100) + 1;
  const targetPlacement = state.placements.find((placement) => placement.cell === resolvedTarget && !placement.attachedTo);
  const adjacent = weightedAdjacent(state, resolvedTarget, playerIndex);
  let result: RollOutcome["result"] = "target-core"; let cores: string[] = targetPlacement ? [targetPlacement.cell] : [];
  if (accuracyRoll > bakugan.rollAccuracy) { result = accuracyRoll > 96 ? "open-no-core" : "miss"; cores = []; }
  else if (!targetPlacement) { result = "open-no-core"; cores = []; }
  else if (accuracyRoll > Math.max(45, bakugan.rollAccuracy - 18) && adjacent.length) { result = "adjacent-core"; cores = [adjacent[0].cell]; }
  if (cores.length && doubleRoll <= bakugan.doubleCoreChance) {
    const second = weightedAdjacent(state, cores[0], playerIndex).find((placement) => !cores.includes(placement.cell));
    if (second) { result = "double-core"; cores.push(second.cell); }
  }
  const note = rotationCore ? `Four-Core rotation moved the calculation three Core-distances forward.`
    : result === "double-core" ? "Second-Core weighting checked behind, front, then sides." : "Standard target calculation.";
  return { playerId: player.id, bakuganId: bakugan.id, target: intended, resolvedTarget, result, cores, accuracyRoll, doubleRoll, note };
};

const resolveCoreCollisions = (state: MatchState, outcomes: RollOutcome[]) => {
  const claimed = new Set<string>();
  const quality = (roll: RollOutcome) => {
    const player = playerById(state, roll.playerId);
    const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;
    return roll.accuracyRoll / Math.max(1, bakugan.rollAccuracy);
  };
  const ordered = [...outcomes].sort((a, b) => quality(a) - quality(b) || a.playerId.localeCompare(b.playerId));

  for (const roll of ordered) {
    if (roll.result === "miss" || roll.result === "open-no-core") continue;
    const playerIndex = state.players.findIndex((candidate) => candidate.id === roll.playerId);
    const player = playerById(state, roll.playerId);
    const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;
    const desired = roll.cores[0];
    if (desired && !claimed.has(desired)) {
      claimed.add(desired);
    } else {
      const alternates = weightedAdjacent(state, roll.resolvedTarget, playerIndex)
        .filter((placement) => !claimed.has(placement.cell));
      // A more accurate roll has a wider pickup window when the intended Core
      // is occupied. Directional weighting is behind, ahead, then side cells.
      const adjacentWindow = Math.max(35, bakugan.rollAccuracy - 15);
      const alternate = roll.accuracyRoll <= adjacentWindow ? alternates[0] : undefined;
      if (!alternate) {
        roll.result = "open-no-core";
        roll.cores = [];
        roll.note += " The intended Core was won by the more accurate roll; this Bakugan opened without a Core.";
        continue;
      }
      roll.cores[0] = alternate.cell;
      roll.result = "adjacent-core";
      roll.note += ` The intended Core was contested, so directional landing selected adjacent ${alternate.cell}.`;
      claimed.add(alternate.cell);
    }

    if (roll.cores.length > 1) {
      const second = roll.cores[1];
      if (claimed.has(second)) {
        roll.cores = roll.cores.slice(0, 1);
        roll.result = roll.cores[0] === roll.resolvedTarget ? "target-core" : "adjacent-core";
      } else claimed.add(second);
    }
  }
  return outcomes;
};

const performRolls = (state: MatchState) => {
  let outcomes: RollOutcome[] = [];
  do {
    outcomes = state.players.map((player) => resolveOneRoll(state, player));
    for (const roll of outcomes) entry(state, "random", `${playerById(state, roll.playerId).name}: accuracy ${roll.accuracyRoll}/100, double ${roll.doubleRoll}/100 → ${roll.result}. ${roll.note}`);
    if (outcomes.every((roll) => roll.result === "miss")) entry(state, "game", "Both Bakugan missed. The Rolling Step repeats immediately.");
  } while (outcomes.every((roll) => roll.result === "miss"));
  resolveCoreCollisions(state, outcomes);
  state.informationEpoch += 1;
  state.undoWindow = undefined;
  const openedPlayerIds: string[] = [];
  for (const roll of outcomes) {
    state.rolls[roll.playerId] = roll; const player = playerById(state, roll.playerId); const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;
    bakugan.open = roll.result !== "miss";
    if (bakugan.open) {
      openedPlayerIds.push(player.id);
      (bakugan as Bakugan & { openedTurn?: number }).openedTurn = state.turn;
      for (const cell of roll.cores) { const placement = state.placements.find((candidate) => candidate.cell === cell); if (placement) placement.attachedTo = bakugan.id; }
      bakugan.heldCoreCells.push(...roll.cores.filter((cell) => !bakugan.heldCoreCells.includes(cell)));
    }
  }
  setPhase(state, "power", "Brawl Phase • Power Step", state.startingPlayer);
  emitGameEvent(state, {
    id: `${state.turn}:open:${openedPlayerIds.sort().join("+")}`,
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
const topCard = (bakugan: Bakugan) => bakugan.evoStack.at(-1) ?? bakugan.character;
const heldCores = (state: MatchState, bakugan: Bakugan) => bakugan.heldCoreCells.map((cell) => state.placements.find((placement) => placement.cell === cell)?.core).filter(Boolean) as Core[];
const hasCoreType = (state: MatchState, bakugan: Bakugan, type: CoreType) => heldCores(state, bakugan).some((core) => core.type === type);
const coreCode: Record<string, CoreType> = { MS: "Magic Shield", FF: "Flaming Fist", FT: "Fist", SD: "Shield", HE: "Helix" };

const conditionActive = (state: MatchState, player: PlayerState, text: string, choices: CardChoices) => {
  const lower = text.toLowerCase(); const opponent = otherPlayer(state, player.id);
  if (lower.includes("flow")) return player.cardsPlayedThisTurn > 1;
  if (lower.includes("fury")) return player.hand.length === 0;
  if (lower.includes("turbo")) return player.maxEnergy > opponent.maxEnergy;
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
  if (/not a Flip card/i.test(text)) {
    const revealedId = (player as PlayerState & { revealedDeckCardId?: string }).revealedDeckCardId;
    const revealed = player.deckCards.find((card) => card.id === revealedId);
    return Boolean(revealed && revealed.type !== "Flip");
  }
  return false;
};

const statValues = (text: string, pattern: RegExp, condition: boolean) => {
  const values = [...text.matchAll(pattern)].map((match) => Number(match[1]));
  if (!values.length) return 0; if (/instead/i.test(text) && values.length > 1) return condition ? values.at(-1)! : values[0];
  return values.reduce((sum, value) => sum + value, 0);
};

const scaleStat = (state: MatchState, player: PlayerState, text: string, value: number, stat: "power" | "damage" | "frost" | "draw") => {
  const faction = text.match(/for each \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan on your team/i)?.[1] as Faction | undefined;
  if (faction) return value * player.bakugan.filter((bakugan) => bakugan.faction === faction).length;
  if (/for each Flip card in your discard pile/i.test(text)) return value * player.discard.filter((card) => card.type === "Flip").length;
  if (/for each Hero you have in play/i.test(text)) return value * player.heroes.length;
  if (/for each Energy card you have/i.test(text)) return value * player.maxEnergy;
  if (/for each BakuCore that your Bakugan hold/i.test(text)) return value * player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
  if (/sacrificed-card/i.test(text) || /sacrifice/i.test(text)) return value;
  if (/for every other card you played this turn/i.test(text)) return value * Math.max(1, player.cardsPlayedThisTurn - 1);
  if (stat === "power" && /for each 1 \[Damage Rating\] your Bakugan has/i.test(text)) {
    const bakugan = activeBakugan(state, player.id); return value * (bakugan ? staticModifier(state, bakugan, player).damage : 0);
  }
  if (stat === "damage" && /for each point of \[FrostStrike\]/i.test(text)) {
    const bakugan = activeBakugan(state, player.id); return value * (bakugan ? staticModifier(state, bakugan, player).frost : 0);
  }
  return value;
};

export const cardChoiceSpec = (state: MatchState, playerId: string, card: GameCard) => {
  const mapping: Record<string, string> = {
    bakugan: "targetBakugan",
    player: "targetPlayer",
    hero: "targetHero",
    evo: "targetEvo",
    energy: "targetEnergy",
    core: "core",
    "hand-cards": "multiHand",
    "deck-card": "deckCard",
    number: "xValue",
    mode: "mode",
    confirm: "mode",
  };
  return [...new Set(buildChoiceSchema(state, playerId, card).fields.map((item) => (
    item.id === "discardCardIds" ? "discard" : mapping[item.kind]
  )))];
};

const queueTrigger = (state: MatchState, controllerId: string, source: GameCard, effect: string, choices: CardChoices = {}) => {
  state.batch.push({ id: uid(), controllerId, card: source, sourceId: source.id, effect, choices, kind: "trigger" });
  entry(state, "game", `${source.name} triggered and entered the batch.`);
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
  type: "select" | "open" | "discard" | "card-play" | "victor" | "attack" | "damage-taken" | "hand-empty" | "end-turn";
  playerId: string;
  playerIds?: string[];
  cardType?: CardType;
  targetBakuganId?: string;
  sourceCards?: GameCard[];
};

const triggerMatchesEvent = (text: string, event: GameEvent) => {
  if (event.type === "select") return /when you select a Bakugan to roll/i.test(text);
  if (event.type === "open") return /when this opens|when you open a Bakugan/i.test(text);
  if (event.type === "discard") return /when you discard a card|if this is discarded/i.test(text);
  if (event.type === "card-play") {
    const typed = text.match(/when you play an? (Action|Hero|Evo|Flip)/i)?.[1];
    return typed ? typed === event.cardType : /when you play (?:a card|this(?: card)?)/i.test(text);
  }
  if (event.type === "victor") return /\bVictor\s*[-:]/i.test(text);
  if (event.type === "attack") return /when one of your Bakugan attacks|if you deal \d+ or more damage/i.test(text);
  if (event.type === "damage-taken") return /if you take damage/i.test(text);
  if (event.type === "hand-empty") return /when you have no cards in hand|when your hand is empty/i.test(text);
  return /at the end of (?:your |the )?turn|end of turn/i.test(text);
};

/** Collect every triggered instruction for one authoritative event before any enters the batch. */
export const collectTriggersForEvent = (state: MatchState, event: GameEvent) => {
  if (state.collectedEventKeys.includes(event.id)) return [];
  state.collectedEventKeys.push(event.id);
  const triggers: PendingEffect[] = [];
  for (const owner of state.players) {
    if (event.playerIds && !event.playerIds.includes(owner.id)) continue;
    if (event.playerId !== "*" && event.type !== "end-turn" && owner.id !== event.playerId) continue;
    const active = activeBakugan(state, owner.id);
    const sources = [...(active ? [topCard(active)] : []), ...owner.heroes, ...(event.sourceCards ?? [])];
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      const program = compileCardEffect(source);
      for (const instruction of program.instructions) {
        if (!instruction.actions.some((action) => action.kind === "trigger") || !triggerMatchesEvent(instruction.sourceText, event)) continue;
        if (event.type === "end-turn" && /end of your turn/i.test(instruction.sourceText) && owner.id !== event.playerId) continue;
        if (/if you deal \d+ or more damage/i.test(instruction.sourceText) && event.type === "attack" && state.pendingDamage < 10) continue;
        triggers.push({
          id: uid(),
          controllerId: owner.id,
          card: source,
          sourceId: source.id,
          effect: source.name === "Dan Kouzo" ? source.effect : instruction.sourceText,
          choices: { targetBakuganId: event.targetBakuganId ?? active?.id },
          kind: "trigger",
        });
      }
    }
  }
  return triggers;
};

export const emitGameEvent = (state: MatchState, event: GameEvent) => {
  const triggers = collectTriggersForEvent(state, event);
  stageSimultaneousTriggers(state, event.type, triggers);
  return triggers;
};

const effectiveCost = (state: MatchState, player: PlayerState, card: GameCard, choices: CardChoices) => {
  let cost = card.cost === "X" ? Math.max(0, Math.min(player.energy, choices.xValue ?? 0)) : card.cost;
  const text = card.effect.toLowerCase(); const opponent = otherPlayer(state, player.id);
  if (card.type === "Evo") cost -= player.heroes.filter((hero) => hero.name === "Shun Kazami").length;
  if (card.type === "Flip") cost -= player.heroes.filter((hero) => hero.name === "Lightning").length;
  if (text.includes("costs 2 [energy] less") && player.cardsPlayedThisTurn) cost -= 2 * player.cardsPlayedThisTurn;
  if (text.includes("costs 3 [energy] less") && player.bakugan.reduce((sum, b) => sum + b.heldCoreCells.length, 0) > opponent.bakugan.reduce((sum, b) => sum + b.heldCoreCells.length, 0)) cost -= 3;
  if ((text.includes("this is free") || text.includes("play this for free")) && conditionActive(state, player, text, choices)) cost = 0;
  if (card.type === "Flip" && state.damageOrigin) cost += state.frostStrike[state.damageOrigin] ?? 0;
  return Math.max(0, cost);
};

const payEnergy = (state: MatchState, player: PlayerState, amount: number) => {
  const tracked = player as PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };
  if (tracked.energyTapTurn !== state.turn) {
    tracked.energyTapTurn = state.turn;
    // Migrate resumable pre-manual-tapping snapshots without discarding their
    // already-generated pool. New states always carry energyTapTurn.
    const legacyGenerated = Math.min(Math.max(0, player.energy), player.energyZone.length);
    tracked.tappedEnergyIds = player.energyZone.slice(0, legacyGenerated).map((card) => card.id);
    player.energy = legacyGenerated;
  }
  const tapped = new Set(tracked.tappedEnergyIds ?? []);
  const shortfall = Math.max(0, amount - player.energy);
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id));
  if (untapped.length < shortfall) throw new Error(`Not enough Energy (need ${amount}, ${player.energy + untapped.length} available).`);
  const generated = untapped.slice(0, shortfall);
  tracked.tappedEnergyIds = [...tapped, ...generated.map((card) => card.id)];
  player.energy += generated.length;
  player.energy -= amount;
  if (generated.length) entry(state, "game", `${player.name} tapped ${generated.length} Energy card${generated.length === 1 ? "" : "s"} to complete payment.`);
};

export const prepareCardPlay = (input: MatchState, playerId: string, cardId: string) => {
  const state = cloneMatch(input);
  if (state.pendingChoice) throw new Error("Complete the current choice before starting another action.");
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) {
    throw new Error("You do not have priority in a card-play window.");
  }
  const player = playerById(state, playerId);
  const card = player.hand.find((candidate) => candidate.id === cardId);
  if (!card) throw new Error("That card is not in your hand.");
  if (card.type === "Flip" || card.type === "Character") throw new Error("That card cannot be played from hand.");
  // Targets, modes, optional clauses and opponent decisions are chosen only
  // when the relevant instruction resolves. X is a payment parameter and is
  // therefore the sole choice made before the card enters the batch.
  const paymentCard = card.cost === "X" ? { ...card, type: "Action" as const } : card;
  const schema = buildChoiceSchema(state, playerId, paymentCard, card.cost === "X" ? "Choose a value for X." : "");
  if (!schema.fields.length) return playCard(state, playerId, cardId, {});
  state.pendingChoice = {
    id: uid(),
    kind: "card-play",
    controllerId: playerId,
    cardId,
    schema,
    answers: {},
    createdVersion: state.version,
    beforeState: JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined }),
    irreversibleInformation: false,
  };
  const firstChooser = schema.fields[0]?.chooserId ?? playerId;
  state.priority = firstChooser;
  state.stepLabel = `${card.displayName || card.name} • Player choice`;
  state.deadline = Date.now() + 35_000;
  entry(state, "game", `${player.name} began choosing for ${card.name}.`);
  return withVersion(state);
};

export const cancelCardChoice = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (!state.pendingChoice || state.pendingChoice.kind === "resolution" || state.pendingChoice.controllerId !== playerId || Object.keys(state.pendingChoice.answers).length) {
    throw new Error("This card choice can no longer be cancelled.");
  }
  const card = playerById(state, playerId).hand.find((candidate) => candidate.id === state.pendingChoice!.cardId);
  state.pendingChoice = undefined;
  state.priority = playerId;
  state.stepLabel = `${state.phase} • Priority`;
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
  if (pending.kind === "resolution") {
    const effect = state.batch.find((candidate) => candidate.id === pending.pendingEffectId);
    if (!effect || pending.instructionIndex == null) throw new Error("The resolving batch object is no longer available.");
    effect.resolvedChoices = { ...(effect.resolvedChoices ?? {}), [String(pending.instructionIndex)]: merged };
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
  const state = cloneMatch(input); const player = playerById(state, playerId);
  const preparationWasIrreversible = Boolean(state.pendingChoice?.irreversibleInformation);
  const undoSnapshot = state.pendingChoice?.beforeState
    ?? JSON.stringify({ ...input, pendingChoice: undefined, undoWindow: undefined });
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) throw new Error("You do not have priority in a card-play window.");
  const index = player.hand.findIndex((card) => card.id === cardId); if (index < 0) throw new Error("That card is not in your hand.");
  const card = player.hand[index]; if (card.type === "Flip" || card.type === "Character") throw new Error("Flip cards are played only when revealed by damage; Characters begin outside the deck.");
  if (card.cost === "X" && !Number.isFinite(choices.xValue)) throw new Error("Choose X before paying for this card.");
  state.pendingChoice = undefined;
  card.playedTurn = state.turn;
  const cost = effectiveCost(state, player, card, choices); payEnergy(state, player, cost); player.hand.splice(index, 1); player.cardsPlayedThisTurn += 1;
  const split = splitWhenPlayedEffect(card.effect);
  const batchObject: PendingEffect = { id: uid(), controllerId: playerId, card, effect: split.cardEffect, choices, kind: "card" };
  state.batch.push(batchObject); state.passes = [];
  if (split.triggerEffect) queueTrigger(state, playerId, card, split.triggerEffect, choices);
  if (card.type === "Action") {
    const toshi = player.heroes.find((hero) => hero.name === "Toshi");
    if (toshi && player.cardsPlayedThisTurn === 1) state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:`${card.id}-toshi-copy` }, choices, kind:"copy" });
    if ((state.copyNextAction[playerId] ?? 0) > 0) { state.copyNextAction[playerId] -= 1; state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:`${card.id}-next-copy` }, choices, kind:"copy" }); }
  }
  emitGameEvent(state, {
    id: `${state.turn}:card-play:${card.id}`,
    type: "card-play",
    playerId,
    cardType: card.type,
    targetBakuganId: activeBakugan(state, playerId)?.id,
  });
  entry(state, "game", `${player.name} added ${card.name} to the batch for ${cost} Energy.`);
  state.undoWindow = {
    actorId: playerId,
    action: "play-card",
    beforeVersion: input.version,
    afterVersion: input.version + 1,
    batchObjectId: batchObject.id,
    informationEpoch: state.informationEpoch,
    priorityEpoch: state.priorityEpoch,
    irreversibleInformation: preparationWasIrreversible,
    snapshot: undoSnapshot,
  };
  return withVersion(state);
};

const chooseBakugan = (state: MatchState, controllerId: string, choices: CardChoices, preferEnemy = false) => {
  const owner = preferEnemy ? otherPlayer(state, controllerId) : playerById(state, controllerId);
  return state.players.flatMap((player) => player.bakugan).find((bakugan) => bakugan.id === choices.targetBakuganId)
    ?? activeBakugan(state, owner.id) ?? owner.bakugan.find((bakugan) => bakugan.open) ?? owner.bakugan[0];
};

const destroyHero = (state: MatchState, controllerId: string, choices: CardChoices, allEnemy: boolean) => {
  const owners = allEnemy ? [otherPlayer(state, controllerId)] : state.players;
  for (const owner of owners) {
    const selected = allEnemy ? owner.heroes : owner.heroes.filter((hero) => hero.id === choices.targetHeroId);
    if (!selected.length) continue;
    const ids = new Set(selected.map((hero) => hero.id));
    owner.heroes = owner.heroes.filter((hero) => !ids.has(hero.id));
    owner.discard.push(...selected);
  }
};

const destroyEvo = (state: MatchState, controllerId: string, choices: CardChoices, allEnemy: boolean) => {
  const owners = allEnemy ? [otherPlayer(state, controllerId)] : state.players;
  for (const owner of owners) for (const bakugan of owner.bakugan) {
    const selected = allEnemy ? [...bakugan.evoStack] : bakugan.evoStack.filter((evo) => evo.id === choices.targetEvoId);
    if (!selected.length) continue;
    const ids = new Set(selected.map((evo) => evo.id));
    bakugan.evoStack = bakugan.evoStack.filter((evo) => !ids.has(evo.id));
    owner.discard.push(...selected);
  }
};

const destroyEnergy = (state: MatchState, controllerId: string, amount: number, selectedIds: string[]) => {
  const opponent = otherPlayer(state, controllerId);
  const ids = new Set(selectedIds.slice(0, amount));
  const selected = opponent.energyZone.filter((card) => ids.has(card.id));
  if (selected.length !== Math.min(amount, opponent.energyZone.length)) return;
  opponent.energyZone = opponent.energyZone.filter((card) => !ids.has(card.id));
  opponent.discard.push(...selected);
  opponent.maxEnergy = opponent.energyZone.length;
  opponent.energy = Math.min(opponent.energy, opponent.maxEnergy);
  state.informationEpoch += 1;
  state.undoWindow = undefined;
};

const instructionChoices = (pending: PendingEffect, instructionIndex: number) => Object.entries(pending.resolvedChoices ?? {})
  .filter(([index]) => Number(index) <= instructionIndex)
  .sort(([left], [right]) => Number(left) - Number(right))
  .reduce<CardChoices>((merged, [, answers]) => ({ ...merged, ...answers }), { ...pending.choices });

type EffectDrawState = MatchState & {
  pendingDrawQueue?: Array<{ id: string; playerId: string; remaining: number; total: number; sourceName: string }>;
  pendingDrawResumePriority?: string;
  pendingDrawResumeDeadline?: number;
  pendingDrawResumeStepLabel?: string;
};

const enqueueEffectDraw = (state: MatchState, player: PlayerState, amount: number, sourceName: string) => {
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
) => {
  if (instruction.condition.kind === "always") return true;
  if (instruction.condition.kind === "victor") return pending.kind === "trigger";
  if (pending.kind === "trigger" && instruction.actions.some((action) => action.kind === "trigger")) return true;
  const player = playerById(state, pending.controllerId);
  const choices = instructionChoices(pending, pending.instructionIndex ?? 0);
  if (instruction.condition.kind === "faction") {
    return chooseBakugan(state, pending.controllerId, choices)?.faction === instruction.condition.faction;
  }
  return conditionActive(state, player, instruction.sourceText, choices);
};

const executeRuleAction = (
  state: MatchState,
  pending: PendingEffect,
  instruction: RuleInstruction,
  action: RuleAction,
  instructionIndex: number,
) => {
  const { card, controllerId } = pending;
  const choices = instructionChoices(pending, instructionIndex);
  const player = playerById(state, controllerId);
  const opponent = otherPlayer(state, controllerId);
  const text = instruction.sourceText;
  const lower = text.toLowerCase();
  const preferEnemy = /^-|enemy|opposing|non-\[/.test(lower) && !/one of your/.test(lower);
  const target = chooseBakugan(state, controllerId, choices, preferEnemy);

  switch (action.kind) {
    case "choice":
    case "trigger":
    case "continuous":
    case "cost":
      return;
    case "modify-stat": {
      if (pending.kind === "card" && ["Hero", "Evo"].includes(card.type) && action.duration === "while-source-in-play") return;
      if (card.name === "Gravity Shift" && (
        (choices.mode === "damage" && action.stat === "power")
        || (choices.mode === "power" && action.stat === "damage")
      )) return;
      let amount = scaleStat(state, player, text, action.amount, action.stat);
      if (action.scale === "sacrificed-card") amount *= choices.discardCardIds?.length ?? 0;
      const targets = action.scope === "all-enemy" ? opponent.bakugan
        : action.scope === "all-friendly" ? player.bakugan
          : target ? [target] : [];
      for (const selected of targets) {
        if (action.stat === "power") state.powerBoost[selected.id] = (state.powerBoost[selected.id] ?? 0) + amount;
        else if (action.stat === "damage") state.damageBoost[selected.id] = (state.damageBoost[selected.id] ?? 0) + amount;
        else state.frostStrike[selected.id] = (state.frostStrike[selected.id] ?? 0) + amount;
      }
      return;
    }
    case "grant-keyword":
      if (!target) return;
      if (action.keyword === "DoubleStrike") state.doubleStrike[target.id] = true;
      else if (action.keyword === "ShadowStrike") state.shadowStrike[target.id] = true;
      else if (action.keyword === "FrostStrike") state.frostStrike[target.id] = (state.frostStrike[target.id] ?? 0) + (action.value ?? 1);
      else if (action.keyword === "Stop" && flipStopsDamage(state, card)) {
        state.pendingDamage = 0;
        state.revealedFlip = undefined;
      }
      return;
    case "draw": {
      const amount = action.scale ? Math.max(0, scaleStat(state, player, text, action.amount, "draw")) : action.amount;
      enqueueEffectDraw(state, player, amount, card.displayName || card.name);
      return;
    }
    case "discard": {
      const affected = choices.targetPlayerId
        ? playerById(state, choices.targetPlayerId)
        : /your opponent|opponent discards/i.test(text) ? opponent : player;
      const selected = choices.discardCardIds ?? choices.handCardIds ?? [];
      discardFromHand(state, affected, Math.min(action.maximum, selected.length || action.amount), selected);
      return;
    }
    case "energize":
      if (action.source === "deck") {
        for (let index = 0; index < action.amount; index += 1) {
          const energyCard = player.deckCards.shift();
          if (energyCard) player.energyZone.push(energyCard);
        }
        player.maxEnergy = player.energyZone.length;
        syncDeck(player);
      } else if (action.source === "hero") {
        for (const owner of state.players) {
          const index = owner.heroes.findIndex((hero) => hero.id === choices.targetHeroId);
          if (index >= 0) {
            owner.energyZone.push(...owner.heroes.splice(index, 1));
            owner.maxEnergy = owner.energyZone.length;
            break;
          }
        }
      } else if (action.source === "self" && !player.energyZone.some((candidate) => candidate.id === card.id)) {
        for (const owner of state.players) owner.heroes = owner.heroes.filter((candidate) => candidate.id !== card.id);
        player.discard = player.discard.filter((candidate) => candidate.id !== card.id);
        player.energyZone.push(card);
        player.maxEnergy = player.energyZone.length;
      }
      return;
    case "generate-energy":
      player.energy += Math.max(0, scaleStat(state, player, text, action.amount, "draw"));
      return;
    case "set-stat":
      if (target) {
        if (action.stat === "power") state.powerBoost[target.id] = action.value - (topCard(target).bPower ?? target.bPower);
        else state.damageBoost[target.id] = action.value - (topCard(target).damage ?? target.damage);
      }
      return;
    case "set-rule":
      if (action.rule === "victor-stat") state.victorByDamage = action.value === "damage";
      return;
    case "damage-to-hand": {
      const amount = state.pendingDamage;
      for (let index = 0; index < amount; index += 1) {
        const damageCard = player.deckCards.shift();
        if (!damageCard) break;
        player.hand.push(damageCard);
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
      beginTurn(state);
      entry(state, "game", `${card.name} ended the turn${action.recharge ? "" : " without recharging Energy"}.`);
      return;
    case "shuffle-deck":
      shuffle(player.deckCards);
      syncDeck(player);
      return;
    case "move": {
      if (action.verb === "destroy" && action.object === "hero" && /destroy this/i.test(text)) {
        for (const owner of state.players) {
          const destroyed = owner.heroes.filter((hero) => hero.id === pending.sourceId || hero.id === card.id);
          owner.heroes = owner.heroes.filter((hero) => !destroyed.some((candidate) => candidate.id === hero.id));
          owner.discard.push(...destroyed);
        }
      } else if (action.verb === "destroy" && action.object === "hero") destroyHero(state, controllerId, choices, action.amount > 2);
      else if (action.verb === "destroy" && action.object === "evo") destroyEvo(state, controllerId, choices, action.amount > 2);
      else if (action.verb === "destroy" && action.object === "energy") {
        destroyEnergy(state, controllerId, action.amount, choices.targetEnergyIds ?? []);
      } else if (action.verb === "control" && action.object === "hero") {
        const index = opponent.heroes.findIndex((hero) => hero.id === choices.targetHeroId);
        if (index >= 0) player.heroes.push(...opponent.heroes.splice(index, 1));
      } else if (action.verb === "retract" && action.object === "bakugan" && target) retractBakugan(state, target);
      else if (action.verb === "attach" && action.object === "bakucore" && target) {
        const placement = state.placements.find((candidate) => candidate.cell === choices.coreCell && !candidate.attachedTo);
        if (placement) {
          placement.attachedTo = target.id;
          target.heldCoreCells.push(placement.cell);
        }
      } else if (action.verb === "remove" && action.object === "bakucore") {
        const owners = action.amount > 2 ? [opponent] : state.players;
        for (const owner of owners) for (const bakugan of owner.bakugan) {
          const cells = action.amount > 2 ? [...bakugan.heldCoreCells] : bakugan.heldCoreCells.filter((cell) => cell === choices.coreCell);
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
      } else if (action.verb === "return" && action.object === "card") {
        if (!player.hand.some((candidate) => candidate.id === card.id)) player.hand.push(card);
      } else if (action.verb === "shuffle" && action.object === "card") {
        const ids = choices.handCardIds ?? choices.discardCardIds ?? [];
        const moved = player.discard.filter((candidate) => ids.includes(candidate.id)).slice(0, action.amount);
        player.discard = player.discard.filter((candidate) => !moved.some((card) => card.id === candidate.id));
        player.deckCards.push(...moved);
        shuffle(player.deckCards);
        syncDeck(player);
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
        const revealed = player.deckCards[0];
        if (revealed) {
          (player as PlayerState & { revealedDeckCardId?: string }).revealedDeckCardId = revealed.id;
          state.informationEpoch += 1;
          state.undoWindow = undefined;
          entry(state, "game", `${player.name} revealed ${revealed.name} from the top of their deck.`);
        }
      }
      return;
    }
    case "reorder-deck": {
      const ids = choices.orderedCardIds ?? [];
      const top = player.deckCards.slice(0, action.amount);
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
      if (action.source === "hand") {
        const selectedId = choices.handCardIds?.[0];
        const index = player.hand.findIndex((candidate) => candidate.id === selectedId);
        if (index < 0) return;
        const [selected] = player.hand.splice(index, 1);
        selected.playedTurn = state.turn;
        player.cardsPlayedThisTurn += 1;
        state.batch.push({ id: uid(), controllerId, card: selected, choices: {}, kind: "card" });
        emitGameEvent(state, { id: `${state.turn}:card-play:${selected.id}`, type: "card-play", playerId: controllerId, cardType: selected.type });
        entry(state, "game", `${player.name} played ${selected.name} from hand for free.`);
        return;
      }
      if (action.source === "self") {
        for (const owner of state.players) owner.discard = owner.discard.filter((candidate) => candidate.id !== card.id);
        card.playedTurn = state.turn;
        player.cardsPlayedThisTurn += 1;
        state.batch.push({ id: uid(), controllerId, card, choices, kind: "card" });
        emitGameEvent(state, { id: `${state.turn}:card-play:${card.id}`, type: "card-play", playerId: controllerId, cardType: card.type });
        entry(state, "game", `${player.name} played discarded ${card.name} for free.`);
        return;
      }
      const tracked = player as PlayerState & { revealedDeckCardId?: string };
      const index = player.deckCards.findIndex((candidate) => candidate.id === tracked.revealedDeckCardId);
      if (choices.confirmed === false || index < 0 || player.deckCards[index].type === "Flip") {
        delete tracked.revealedDeckCardId;
        return;
      }
      const [revealed] = player.deckCards.splice(index, 1);
      syncDeck(player);
      revealed.playedTurn = state.turn;
      player.cardsPlayedThisTurn += 1;
      state.batch.push({ id: uid(), controllerId, card: revealed, choices: {}, kind: "card" });
      delete tracked.revealedDeckCardId;
      emitGameEvent(state, { id: `${state.turn}:card-play:${revealed.id}`, type: "card-play", playerId: controllerId, cardType: revealed.type });
      entry(state, "game", `${player.name} played the revealed ${revealed.name} for free.`);
      return;
    }
    case "attack": {
      state.pendingLoser = opponent.id;
      state.pendingDamage = action.amount;
      state.damageOrigin = pending.sourceId ?? pending.card.id;
      state.damageFaction = action.faction as Faction;
      setPhase(state, "damage", `Damage Step • ${action.amount} incoming`, opponent.id);
      entry(state, "game", `${pending.card.name} made a ${action.faction ?? "separate"} attack for ${action.amount}.`);
      return;
    }
    case "negate": {
      const index = state.batch.map((effect, candidateIndex) => (
        effect.id !== pending.id && (action.cardType === "any" || effect.card.type === action.cardType)
          ? candidateIndex
          : -1
      )).filter((candidate) => candidate >= 0).at(-1) ?? -1;
      if (index >= 0) {
        const [negated] = state.batch.splice(index, 1);
        playerById(state, negated.controllerId).discard.push(negated.card);
        if (action.copy) state.batch.push({ ...negated, id: uid(), controllerId, kind: "copy" });
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
        player.hand.push(found);
        shuffle(player.deckCards);
        syncDeck(player);
        state.informationEpoch += 1;
        state.undoWindow = undefined;
        entry(state, "game", `${player.name} searched, revealed ${found.name}, put it into hand, then shuffled.`);
      }
      return;
    }
    case "copy":
      if (action.target === "next-action") state.copyNextAction[controllerId] = (state.copyNextAction[controllerId] ?? 0) + 1;
      return;
    case "rules-text": {
      const setPower = text.match(/\[B\] becomes (\d+)/i);
      if (target && setPower) state.powerBoost[target.id] = Number(setPower[1]) - (topCard(target).bPower ?? target.bPower);
      if (/victor is decided by highest \[damage rating\]/i.test(text)) state.victorByDamage = true;
      if (/retract your Bakugan at the end of the turn/i.test(text) && target) state.delayedRetracts.push(target.id);
      if (/return this to (?:your )?hand|put this into your hand/i.test(text)) player.hand.push(card);
      else if (/bottom of your deck/i.test(text)) {
        player.deckCards.push(card);
        syncDeck(player);
      }
      return;
    }
  }
};

function resolvePendingEffect(state: MatchState, pending: PendingEffect) {
  const program = compileCardEffect(pending.card, pending.effect ?? pending.card.effect);
  const result = executeRuleProgram(program, {
    conditionIsActive: (instruction) => ruleConditionIsActive(state, pending, instruction),
    beforeInstruction: (instruction, instructionIndex) => {
      const existing = pending.resolvedChoices?.[String(instructionIndex)];
      if (existing) return existing.confirmed === false ? "skip" : "continue";
      const schema = buildChoiceSchema(
        state,
        pending.controllerId,
        pending.card,
        instruction.sourceText,
        instructionChoices(pending, instructionIndex),
      );
      schema.fields = schema.fields.filter((field) => !(field.id === "xValue" && pending.choices.xValue != null));
      if (!schema.fields.length) return "continue";
      if (!schemaHasLegalCompletion(schema)) {
        entry(state, "game", `${pending.card.name}: the clause had no legal choice and did nothing.`);
        return "skip";
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
      return "suspend";
    },
    execute: (action, instruction, cursor) => {
      executeRuleAction(state, pending, instruction, action, cursor.instructionIndex);
      pending.instructionIndex = cursor.instructionIndex;
    },
  }, pending.instructionIndex ?? 0);

  if (!result.completed) return false;
  pending.instructionIndex = result.instructionIndex;
  const player = playerById(state, pending.controllerId);
  const choices = {
    ...pending.choices,
    ...Object.values(pending.resolvedChoices ?? {}).reduce<CardChoices>((merged, answer) => ({ ...merged, ...answer }), {}),
  };
  if (pending.kind === "card" && pending.card.type === "Hero"
    && !player.heroes.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    player.heroes.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Evo") {
    const target = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId);
    const normalizedName = (value: string | null | undefined) => String(value ?? "")
      .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (target
      && normalizedName(target.name) === normalizedName(pending.card.evolvesFrom)
      && target.faction === pending.card.faction) {
      target.evoStack.push(pending.card);
      const wasFaceDown = !target.open && !(target as Bakugan & { characterFaceUp?: boolean }).characterFaceUp;
      (target as Bakugan & { characterFaceUp?: boolean }).characterFaceUp = true;
      if (wasFaceDown) entry(state, "game", `${target.name}'s Character card was turned face up before its Evo entered play.`);
    } else player.discard.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Action"
    && !player.hand.some((card) => card.id === pending.card.id)
    && !player.discard.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    player.discard.push(pending.card);
  } else if (pending.kind === "card" && pending.card.type === "Flip"
    && !player.hand.some((card) => card.id === pending.card.id)
    && !player.discard.some((card) => card.id === pending.card.id)
    && !player.energyZone.some((card) => card.id === pending.card.id)) {
    player.discard.push(pending.card);
  }
  entry(state, "game", `${pending.card.name} finished resolving its structured RuleAction program.`);
  return true;
}

const applyEffect = (state: MatchState, pending: PendingEffect) => resolvePendingEffect(state, pending);

/** Start an already-paid effect without mutating and then reconstructing state. */
export const resolveStructuredEffect = (input: MatchState, pending: PendingEffect) => {
  const state = cloneMatch(input);
  if (!state.batch.some((candidate) => candidate.id === pending.id)) state.batch.push(pending);
  const live = state.batch.find((candidate) => candidate.id === pending.id)!;
  if (resolvePendingEffect(state, live)) state.batch = state.batch.filter((candidate) => candidate.id !== live.id);
  return withVersion(state);
};

const staticModifier = (state: MatchState, bakugan: Bakugan, owner: PlayerState) => {
  const card = topCard(bakugan); let power = card.bPower ?? bakugan.bPower; let damage = card.damage ?? bakugan.damage; let frost = 0; let double = false; let shadow = false;
  const sources = [card, ...owner.heroes];
  for (const source of sources) {
    const text = source.effect; const lower = text.toLowerCase();
    for (const [code, coreType] of Object.entries(coreCode)) if (new RegExp(`\\[${code}\\]`, "i").test(text) && hasCoreType(state, bakugan, coreType)) {
      power += statValues(text, /([+-]\d+)\s*\[B\]/gi, true); damage += statValues(text, /([+-]\d+)\s*\[Damage Rating\]/gi, true);
      frost += statValues(text, /\+?(\d+)\s*\[FrostStrike\]/gi, true); double ||= /Double ?Strike/i.test(text); shadow ||= /ShadowStrike/i.test(text);
    }
    const staticCondition = !/(Fury|Turbo|Domination)/i.test(text) || conditionActive(state,owner,text,{}) || /\.\s*\+\d/.test(text);
    if (source.type === "Hero" && staticCondition && (/your bakugan have|to your attacks/.test(lower)) && (!/\[(aquos|pyrus|darkus|haos|ventus|aurelus)\]/i.test(text) || text.toLowerCase().includes(`[${bakugan.faction.toLowerCase()}]`))) {
      power += statValues(text, /([+-]\d+)\s*\[B\]/gi, true); damage += statValues(text, /([+-]\d+)\s*\[Damage Rating\]/gi, true);
      frost += statValues(text, /\+?(\d+)\s*\[FrostStrike\]/gi, true); double ||= /Double ?Strike/i.test(text); shadow ||= /ShadowStrike/i.test(text);
    }
  }
  const opponent=otherPlayer(state,owner.id);
  for(const hero of opponent.heroes){
    const text=hero.effect; const lower=text.toLowerCase();
    if(lower.includes("opposing bakugan")){ power+=statValues(text,/([+-]\d+)\s*\[B\]/gi,true); damage+=statValues(text,/([+-]\d+)\s*\[Damage Rating\]/gi,true); }
    const non=text.match(/Non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan get ([+-]\d+) \[B\]/i); if(non&&bakugan.faction!==non[1]) power+=Number(non[2]);
  }
  for (const core of heldCores(state, bakugan)) {
    const conditional = !core.conditionalFactions?.length || core.conditionalFactions.includes(bakugan.faction);
    power += core.bonus + (conditional ? core.conditionalBonus ?? 0 : 0); damage += core.damageBonus + (conditional ? core.conditionalDamage ?? 0 : 0);
    frost += core.frostStrike ?? 0; shadow ||= core.shadowStrike ?? false;
  }
  const powerTemp = state.powerBoost[bakugan.id] ?? 0; const damageTemp = state.damageBoost[bakugan.id] ?? 0;
  shadow ||= state.shadowStrike[bakugan.id] ?? false; double ||= state.doubleStrike[bakugan.id] ?? false; frost += state.frostStrike[bakugan.id] ?? 0;
  power += shadow && powerTemp < 0 ? 0 : powerTemp; damage += shadow && damageTemp < 0 ? 0 : damageTemp;
  return { power: Math.max(0, power), damage: Math.max(0, damage), frost, double, shadow };
};

export const totalPower = (state: MatchState, playerId: string) => {
  const bakugan = activeBakugan(state, playerId); const roll = state.rolls[playerId];
  return !bakugan || roll?.result === "miss" ? 0 : staticModifier(state, bakugan, playerById(state, playerId)).power;
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
};

const beginDamage = (state: MatchState) => {
  const winner = playerById(state, state.brawlWinner); const loser = otherPlayer(state, winner.id); const attacking = activeBakugan(state, winner.id)!;
  const openTeam = winner.bakugan.filter((bakugan) => bakugan.open); state.teamAttack = openTeam.length === 3;
  const stats = staticModifier(state, attacking, winner); let damage = state.teamAttack ? openTeam.reduce((sum, bakugan) => sum + staticModifier(state, bakugan, winner).damage, 0) : stats.damage;
  if (stats.double) damage *= 2;
  state.pendingLoser = loser.id; state.pendingDamage = Math.max(0, damage); state.damageOrigin = attacking.id; state.damageFaction = attacking.faction;
  setPhase(state, "damage", `Damage Step • ${damage} incoming`, loser.id); entry(state, "game", `${winner.name} attacks for ${damage}${state.teamAttack ? " as a Team Attack" : ""}.`);
  emitGameEvent(state, { id: `${state.turn}:attack:${attacking.id}`, type: "attack", playerId: winner.id, targetBakuganId: attacking.id });
  if (damage > 0) emitGameEvent(state, { id: `${state.turn}:damage-taken:${loser.id}`, type: "damage-taken", playerId: loser.id });
};

const flipStopsDamage = (state: MatchState, card: GameCard) => {
  const text = card.effect; const faction = state.damageFaction!;
  if (/\[Stop\] an attack/i.test(text)) return true;
  const non = text.match(/\[Stop\] non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i); if (non) return faction !== non[1];
  const listed = [...text.matchAll(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)].map((match) => match[1]); return /\[Stop\]/i.test(text) && listed.includes(faction);
};

const finishDamage = (state: MatchState) => {
  state.revealedFlip = undefined; setPhase(state, "postDamage", "Damage Step • Post-damage priority", state.startingPlayer);
};

const advanceEmptyBatch = (state: MatchState) => {
  if (state.phase === "preRoll") setPhase(state, "target", "Roll Phase • Secret target selection", state.startingPlayer);
  else if (state.phase === "power") declareVictor(state);
  else if (state.phase === "victor") beginDamage(state);
  else if (state.phase === "postDamage") {
    const loser = playerById(state, state.pendingLoser); const loserBakugan = activeBakugan(state, loser.id); if (loserBakugan) retractBakugan(state, loserBakugan);
    if (state.teamAttack) playerById(state, state.brawlWinner).bakugan.forEach((bakugan) => retractBakugan(state, bakugan));
    setPhase(state, "endPlay", "End Phase • Play Step", state.startingPlayer);
  } else if (state.phase === "endPlay") {
    emitGameEvent(state, { id: `${state.turn}:end-turn`, type: "end-turn", playerId: state.startingPlayer });
    if (state.batch.length || state.triggerOrders.length) return;
    for (const player of state.players) for (const bakugan of player.bakugan) if (state.delayedRetracts.includes(bakugan.id)) retractBakugan(state,bakugan);
    for (const player of state.players) { player.energy = player.maxEnergy; }
    state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {}; state.doubleStrike = {}; state.shadowStrike = {};
    const over = state.players.find((player) => player.hand.length > 7);
    if (over) setPhase(state, "handLimit", "End Phase • Discard to seven", over.id); else beginTurn(state);
  }
};

export const passPriority = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (hasQueuedEffectDraw(state)) throw new Error("Complete every pending Draw action before passing priority.");
  if (state.pendingChoice) throw new Error("Complete the pending player choice before passing priority.");
  if (state.triggerOrders.some((request) => !request.orderedIds)) throw new Error("Order every simultaneous trigger before passing priority.");
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) throw new Error("You do not have priority.");
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
  else if (state.batch.length || state.triggerOrders.length) setPhase(state, "endPlay", "End Phase • Resolve discard triggers", state.startingPlayer);
  else beginTurn(state);
  return withVersion(state);
};

const winGame = (state: MatchState, winnerId: string, reason: string) => {
  state.series[winnerId] = (state.series[winnerId] ?? 0) + 1; state.phase = "result"; state.stepLabel = "Game complete";
  state.winner = winnerId; state.resultReason = reason; state.deadline = deadlineFor("result"); entry(state, "system", `${playerById(state, winnerId).name} wins game ${state.gameNumber}: ${reason}.`);
};

export const concedeMatch = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input); if (state.phase === "result" || !state.players.some((player) => player.id === playerId)) throw new Error("Concede is not legal now.");
  winGame(state, otherPlayer(state, playerId).id, "Opponent conceded"); return withVersion(state);
};

export const nextTurn = (input: MatchState) => {
  const state = cloneMatch(input);
  if (state.phase === "retract" || state.phase === "endPlay") { state.batch = []; advanceEmptyBatch(state); return withVersion(state); }
  throw new Error("The turn advances through priority and the End Phase.");
};

export const startNextSeriesGame = (input: MatchState) => {
  const state = cloneMatch(input); const needed = state.format === "bo3" ? 2 : 1;
  if (state.phase !== "result" || Math.max(...Object.values(state.series)) >= needed) throw new Error("The match is complete.");
  state.gameNumber += 1; state.turn = 0; state.placements = []; state.placementTurn = 0; state.selected = {}; state.targets = {}; state.rolls = {}; state.batch = [];
  const selected = state.players[secureRandomInt(state.players.length)];
  state.startingPlayer = selected.id; state.initialStartingPlayer = selected.id; state.priority = selected.id;
  state.startingPlayerRevealedAt = Date.now() + 2_500; state.brawlWinner = ""; state.winner = ""; state.resultReason = "";
  for (const player of state.players) {
    const all = [...player.deckCards, ...player.hand, ...player.discard, ...player.energyZone, ...player.heroes];
    player.deckCards = all.filter((card) => card.type !== "Character"); shuffle(player.deckCards); player.hand = []; player.discard = []; player.energyZone = []; player.heroes = [];
    player.energy = 0; player.maxEnergy = 0; player.ready = true; player.bakugan.forEach((bakugan) => { bakugan.open = false; bakugan.heldCoreCells = []; bakugan.evoStack = []; });
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
  if (state.phase === "target") for (const id of Object.keys(state.targets)) if (id !== playerId) delete state.targets[id];
  const hiddenCard = (id: string): GameCard => ({
    id, catalogId: "hidden", number: 0, name: "Hidden card", displayName: "Hidden card",
    faction: "Aquos", factions: [], type: "Action", cost: 0, rarity: "",
    effect: "", mechanics: [], bPower: null, damage: null, coreTypes: [], evolvesFrom: null,
    art: "/assets/cards/card-missing.svg",
  });
  for (const placement of state.placements) {
    if (!placement.attachedTo && !placement.revealed && placement.playerId !== playerId) {
      const type = placement.core.type;
      const backs: Record<CoreType, string> = {
        Fist: "/assets/core-backs/fist.png", "Flaming Fist": "/assets/core-backs/flaming-fist.png",
        Shield: "/assets/core-backs/shield.png", "Magic Shield": "/assets/core-backs/magic-shield.png", Helix: "/assets/core-backs/helix.png",
      };
      placement.core = {
        id: `hidden-core-${placement.cell}`,
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
      player.hand = player.hand.map((_, index) => hiddenCard(`hidden-hand-${index}`));
      player.energyZone = player.energyZone.map((_, index) => hiddenCard(`hidden-energy-${index}`));
    }
  }
  return state;
};
