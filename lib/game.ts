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
};

export type Placement = { playerId: string; core: Core; cell: string; order: number; attachedTo?: string };
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
  coreCell?: string;
  discardCardIds?: string[];
  handCardIds?: string[];
  xValue?: number;
  mode?: "power" | "damage" | "yes" | "no";
};

export type PendingEffect = {
  id: string;
  controllerId: string;
  card: GameCard;
  choices: CardChoices;
  kind: "card" | "trigger" | "copy";
  negated?: boolean;
};

export type Phase =
  | "lobby" | "placement" | "energize" | "selection" | "preRoll" | "target"
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

// Radius-three axial board: a true hexagon containing 37 legal cells.
export const HEX_CELLS = Array.from({ length: 7 }, (_, qIndex) => qIndex - 3).flatMap((q) =>
  Array.from({ length: 7 }, (_, rIndex) => rIndex - 3)
    .filter((r) => Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= 3)
    .map((r) => ({ id: `h${q + 3}-${r + 3}`, q, r })),
);
export const CENTER_CELL = "h3-3";
export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const PHASE_TIMERS: Record<Phase, number> = {
  lobby: 60, placement: 45, energize: 35, selection: 35, preRoll: 30, target: 30,
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
const otherPlayer = (state: MatchState, playerId: string) => state.players.find((player) => player.id !== playerId)!;
const playerById = (state: MatchState, playerId: string) => state.players.find((player) => player.id === playerId)!;
const syncDeck = (player: PlayerState) => { player.deck = player.deckCards.length; };
const wordNumber = (word?: string) => ({ a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }[String(word).toLowerCase()] ?? (Number(word) || 1));

const drawCards = (state: MatchState, player: PlayerState, amount: number) => {
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
  const active=activeBakugan(state,player.id); const sources=[...(active?[topCard(active)]:[]),...player.heroes];
  for(const source of sources) if(/When you discard a card/i.test(source.effect)) queueTrigger(state,player.id,source,source.effect,{targetBakuganId:active?.id});
  for(const card of discarded) if(/If this is discarded, you may play it for free/i.test(card.effect)) {
    player.discard=player.discard.filter((candidate)=>candidate.id!==card.id); state.batch.push({id:uid(),controllerId:player.id,card,choices:{},kind:"trigger"});
  }
};

const shuffle = <T,>(values: T[]) => {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1)); [values[index], values[swap]] = [values[swap], values[index]];
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
    players, startingPlayer, priority: startingPlayer, placementTurn: 0, placements: [], selected: {}, targets: {}, rolls: {},
    powerBoost: {}, damageBoost: {}, frostStrike: {}, doubleStrike: {}, shadowStrike: {}, passes: [], batch: [], victorByDamage: false,
    pendingDamage: 0, pendingLoser: "", damageOrigin: "", teamAttack: false, delayedRetracts: [], copyNextAction: {}, brawlWinner: "", winner: "", resultReason: "",
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
    setPhase(state, "placement", "BakuCore placement 1 / 12", state.startingPlayer);
    entry(state, "game", "Hide Matrix placement began. The first Core must be placed in the centre of the hex grid.");
  }
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
  entry(state, "game", `${player.name} placed ${core.name}.`); state.placementTurn += 1;
  if (state.placements.length === 12) {
    beginTurn(state); entry(state, "game", "The twelve-Core Hide Matrix is complete.");
  } else {
    state.priority = state.players[state.placementTurn % 2].id; state.stepLabel = `BakuCore placement ${state.placements.length + 1} / 12`; state.deadline = deadlineFor("placement");
  }
  return withVersion(state);
};

const beginTurn = (state: MatchState) => {
  state.turn += 1; state.startingPlayer = state.brawlWinner || state.startingPlayer; state.priority = state.startingPlayer;
  state.selected = {}; state.targets = {}; state.rolls = {}; state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {};
  state.doubleStrike = {}; state.shadowStrike = {}; state.batch = []; state.victorByDamage = false; state.pendingDamage = 0;
  state.pendingLoser = ""; state.damageOrigin = ""; state.revealedFlip = undefined; state.teamAttack = false; state.delayedRetracts = []; state.winner = "";
  for (const player of state.players) {
    player.energizedThisTurn = false; player.cardsPlayedThisTurn = 0; drawCards(state, player, 1);
  }
  setPhase(state, "energize", `Turn ${state.turn} • Energize Step`, state.startingPlayer);
  entry(state, "game", `Turn ${state.turn} began. Both players drew a card and may Energize once.`);
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

const resolveOneRoll = (state: MatchState, player: PlayerState, forced = false): RollOutcome => {
  const bakugan = player.bakugan.find((candidate) => candidate.id === state.selected[player.id])!;
  const intended = state.targets[player.id]; const playerIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const rotationCore = relativePlacement(state, intended, playerIndex, 3); const resolvedTarget = rotationCore?.cell ?? intended;
  const accuracyRoll = Math.floor(Math.random() * 100) + 1; const doubleRoll = Math.floor(Math.random() * 100) + 1;
  const targetPlacement = state.placements.find((placement) => placement.cell === resolvedTarget && !placement.attachedTo);
  const adjacent = weightedAdjacent(state, resolvedTarget, playerIndex);
  let result: RollOutcome["result"] = "target-core"; let cores: string[] = targetPlacement ? [targetPlacement.cell] : [];
  if (!forced && accuracyRoll > bakugan.rollAccuracy) { result = accuracyRoll > 96 ? "open-no-core" : "miss"; cores = []; }
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

const performRolls = (state: MatchState) => {
  let attempts = 0; let outcomes: RollOutcome[] = [];
  do {
    outcomes = state.players.map((player) => resolveOneRoll(state, player, attempts >= 4)); attempts += 1;
    for (const roll of outcomes) entry(state, "random", `${playerById(state, roll.playerId).name}: accuracy ${roll.accuracyRoll}/100, double ${roll.doubleRoll}/100 → ${roll.result}. ${roll.note}`);
    if (outcomes.every((roll) => roll.result === "miss")) entry(state, "game", "Both Bakugan missed. The Rolling Step repeats immediately.");
  } while (outcomes.every((roll) => roll.result === "miss"));
  for (const roll of outcomes) {
    state.rolls[roll.playerId] = roll; const player = playerById(state, roll.playerId); const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;
    bakugan.open = roll.result !== "miss";
    if (bakugan.open) {
      for (const cell of roll.cores) { const placement = state.placements.find((candidate) => candidate.cell === cell); if (placement) placement.attachedTo = bakugan.id; }
      bakugan.heldCoreCells.push(...roll.cores.filter((cell) => !bakugan.heldCoreCells.includes(cell)));
    }
  }
  setPhase(state, "power", "Brawl Phase • Power Step", state.startingPlayer);
  queueOpenTriggers(state);
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
  return false;
};

const statValues = (text: string, pattern: RegExp, condition: boolean) => {
  const values = [...text.matchAll(pattern)].map((match) => Number(match[1]));
  if (!values.length) return 0; if (/instead/i.test(text) && values.length > 1) return condition ? values.at(-1)! : values[0];
  return values.reduce((sum, value) => sum + value, 0);
};

const scaleStat = (state: MatchState, player: PlayerState, text: string, value: number, stat: "power" | "damage" | "frost") => {
  const faction = text.match(/for each \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan on your team/i)?.[1] as Faction | undefined;
  if (faction) return value * player.bakugan.filter((bakugan) => bakugan.faction === faction).length;
  if (/for each Flip card in your discard pile/i.test(text)) return value * player.discard.filter((card) => card.type === "Flip").length;
  if (/for each Hero you have in play/i.test(text)) return value * player.heroes.length;
  if (/for each Energy card you have/i.test(text)) return value * player.maxEnergy;
  if (/for each BakuCore that your Bakugan hold/i.test(text)) return value * player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
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
  const effect = card.effect.toLowerCase(); const specs: string[] = [];
  if (card.type === "Evo" || /(?:a|your|enemy|opposing|non-\[[a-z]+\]) bakugan|on this/.test(effect)) specs.push("targetBakugan");
  if (/choose a player/.test(effect)) specs.push("targetPlayer");
  if (/destroy a hero|choose a hero|take control of a hero/.test(effect)) specs.push("targetHero");
  if (/destroy an evo/.test(effect)) specs.push("targetEvo");
  if (/destroy an (?:enemy )?energy|destroy two energy/.test(effect)) specs.push("targetEnergy");
  if (/attach a bakucore|remove an enemy bakugan's bakucore/.test(effect)) specs.push("core");
  if (/sacrifice|discard (?:a|two) card/.test(effect) && !/choose a player/.test(effect)) specs.push("discard");
  if (/any number of cards from your hand|draw two cards, then discard two|play a card from your hand for free/.test(effect)) specs.push("multiHand");
  if (card.cost === "X") specs.push("xValue");
  if (/or \+|for each \[energy\] used/.test(effect)) specs.push("mode");
  return [...new Set(specs)];
};

const triggeredCard = (source: GameCard, effect: string) => ({ ...source, id: `${source.id}-trigger-${uid()}`, effect });
const queueTrigger = (state: MatchState, controllerId: string, source: GameCard, effect: string, choices: CardChoices = {}) => {
  state.batch.push({ id: uid(), controllerId, card: triggeredCard(source, effect), choices, kind: "trigger" });
  entry(state, "game", `${source.name} triggered and entered the batch.`);
};

const queueOpenTriggers = (state: MatchState) => {
  const ordered = [...state.players].sort((a) => a.id === state.startingPlayer ? -1 : 1);
  for (const player of ordered) {
    const bakugan = activeBakugan(state, player.id); if (!bakugan?.open) continue;
    const sources = [topCard(bakugan), ...player.heroes];
    for (const source of sources) {
      if (/when this opens/i.test(source.effect) || /when you open a Bakugan/i.test(source.effect)) queueTrigger(state, player.id, source, source.effect, { targetBakuganId: bakugan.id });
    }
  }
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

const payEnergy = (player: PlayerState, amount: number) => {
  if (player.energy < amount) throw new Error(`Not enough charged Energy (need ${amount}).`); player.energy -= amount;
};

export const playCard = (input: MatchState, playerId: string, cardId: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) throw new Error("You do not have priority in a card-play window.");
  const index = player.hand.findIndex((card) => card.id === cardId); if (index < 0) throw new Error("That card is not in your hand.");
  const card = player.hand[index]; if (card.type === "Flip" || card.type === "Character") throw new Error("Flip cards are played only when revealed by damage; Characters begin outside the deck.");
  if (card.type === "Evo") {
    const target = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId) ?? activeBakugan(state, playerId);
    if (!target || target.name !== card.evolvesFrom || target.faction !== card.faction) throw new Error(`Choose your ${card.evolvesFrom} for this Evo.`);
    choices.targetBakuganId = target.id;
  }
  if (card.effect.toLowerCase().includes("sacrifice") && choices.discardCardIds?.length) discardFromHand(state, player, 1, choices.discardCardIds);
  const cost = effectiveCost(state, player, card, choices); payEnergy(player, cost); player.hand.splice(index, 1); player.cardsPlayedThisTurn += 1;
  state.batch.push({ id: uid(), controllerId: playerId, card, choices, kind: "card" }); state.passes = [];
  if (card.type === "Action") {
    const selected = activeBakugan(state, playerId); const activeSource = selected ? topCard(selected) : undefined;
    if (activeSource && /when you play an Action on this/i.test(activeSource.effect)) queueTrigger(state, playerId, activeSource, activeSource.effect, { targetBakuganId: selected!.id });
    const toshi = player.heroes.find((hero) => hero.name === "Toshi");
    if (toshi && player.cardsPlayedThisTurn === 1) state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:`${card.id}-toshi-copy` }, choices, kind:"copy" });
    if ((state.copyNextAction[playerId] ?? 0) > 0) { state.copyNextAction[playerId] -= 1; state.batch.push({ id: uid(), controllerId: playerId, card: { ...card, id:`${card.id}-next-copy` }, choices, kind:"copy" }); }
  }
  entry(state, "game", `${player.name} added ${card.name} to the batch for ${cost} Energy.`);
  return withVersion(state);
};

const chooseBakugan = (state: MatchState, controllerId: string, choices: CardChoices, preferEnemy = false) => {
  const owner = preferEnemy ? otherPlayer(state, controllerId) : playerById(state, controllerId);
  return state.players.flatMap((player) => player.bakugan).find((bakugan) => bakugan.id === choices.targetBakuganId)
    ?? activeBakugan(state, owner.id) ?? owner.bakugan.find((bakugan) => bakugan.open) ?? owner.bakugan[0];
};

const searchDeck = (state: MatchState, player: PlayerState, type?: CardType) => {
  const index = player.deckCards.findIndex((card) => !type || card.type === type); if (index < 0) return;
  const [card] = player.deckCards.splice(index, 1); player.hand.push(card); shuffle(player.deckCards); syncDeck(player);
  entry(state, "game", `${player.name} searched, revealed ${card.name}, put it into hand, then shuffled.`);
};

const destroyHero = (state: MatchState, controllerId: string, choices: CardChoices, all = false) => {
  const opponent = otherPlayer(state, controllerId); const targets = all ? [...opponent.heroes] : opponent.heroes.filter((hero) => !choices.targetHeroId || hero.id === choices.targetHeroId).slice(0, 1);
  opponent.heroes = opponent.heroes.filter((hero) => !targets.some((target) => target.id === hero.id)); opponent.discard.push(...targets);
};
const destroyEvo = (state: MatchState, controllerId: string, choices: CardChoices, all = false) => {
  const opponent = otherPlayer(state, controllerId);
  for (const bakugan of opponent.bakugan) {
    if (all || bakugan.evoStack.some((evo) => evo.id === choices.targetEvoId)) opponent.discard.push(...bakugan.evoStack.splice(all ? 0 : Math.max(0, bakugan.evoStack.length - 1)));
  }
};
const destroyEnergy = (state: MatchState, controllerId: string, count: number) => {
  const opponent = otherPlayer(state, controllerId); const destroyed = opponent.energyZone.splice(0, count); opponent.discard.push(...destroyed);
  opponent.maxEnergy = opponent.energyZone.length; opponent.energy = Math.min(opponent.energy, opponent.maxEnergy);
};

const applyEffect = (state: MatchState, pending: PendingEffect) => {
  const { card, controllerId, choices } = pending; const player = playerById(state, controllerId); const opponent = otherPlayer(state, controllerId);
  const text = card.effect; const lower = text.toLowerCase();
  const preferEnemy = /^-|enemy|opposing|non-\[/.test(lower) && !/one of your/.test(lower); const target = chooseBakugan(state, controllerId, choices, preferEnemy);
  const factionCondition = [...text.matchAll(/If \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)].some((match) => target?.faction === match[1]);
  const condition = conditionActive(state, player, text, choices) || factionCondition;
  if (card.type === "Hero") player.heroes.push(card);
  if (card.type === "Evo") {
    const evoTarget = player.bakugan.find((bakugan) => bakugan.id === choices.targetBakuganId); if (evoTarget) evoTarget.evoStack.push(card);
  }
  if (/negate an action card/i.test(text)) {
    const index = state.batch.map((effect) => effect.card.type).lastIndexOf("Action");
    if (index >= 0) { const [negated] = state.batch.splice(index, 1); playerById(state, negated.controllerId).discard.push(negated.card); if (/copy its effect/i.test(text)) state.batch.push({ ...negated, id: uid(), controllerId, kind: "copy", choices }); }
  }
  if (/negate a hero card/i.test(text)) {
    const index = state.batch.map((effect) => effect.card.type).lastIndexOf("Hero"); if (index >= 0) playerById(state, state.batch[index].controllerId).discard.push(state.batch.splice(index, 1)[0].card);
  }
  const resolvesStats = ["Action","Flip"].includes(card.type) || pending.kind !== "card" || /^When you play this/i.test(text);
  let bPower = resolvesStats ? scaleStat(state, player, text, statValues(text, /([+-]\d+)\s*\[B\]/gi, condition), "power") : 0;
  let damage = resolvesStats ? scaleStat(state, player, text, statValues(text, /([+-]\d+)\s*\[Damage (?:Rating|Power)\]/gi, condition), "damage") : 0;
  if (card.name === "Gravity Shift") { if (choices.mode === "damage") bPower = 0; else damage = 0; }
  if (card.name === "Shock and Awe") { const enemy = activeBakugan(state, opponent.id); if (enemy) state.powerBoost[enemy.id] = (state.powerBoost[enemy.id] ?? 0) - 300; }
  if (target && bPower) state.powerBoost[target.id] = (state.powerBoost[target.id] ?? 0) + bPower;
  if (target && damage) state.damageBoost[target.id] = (state.damageBoost[target.id] ?? 0) + damage;
  const setPower = text.match(/\[B\] becomes (\d+)/i); if (target && setPower) state.powerBoost[target.id] = Number(setPower[1]) - topCard(target).bPower!;
  const frost = scaleStat(state, player, text, statValues(text, /\+?(\d+)\s*\[FrostStrike\]/gi, condition), "frost"); if (target && frost) state.frostStrike[target.id] = (state.frostStrike[target.id] ?? 0) + frost;
  const tagged = /(Flow|Fury|Turbo|Domination|Sacrifice)/i.test(text);
  if (target && /\[Double ?Strike\]/i.test(text) && (!tagged || condition)) state.doubleStrike[target.id] = true;
  if (target && /\[ShadowStrike\]/i.test(text) && (!tagged || condition)) state.shadowStrike[target.id] = true;
  const draw = text.match(/draw (a|an|one|two|three|\d+) card/i); const drawCondition = !/if the Bakugan's \[Damage Rating\] becomes 10 or greater/i.test(text) || (target ? staticModifier(state,target,player).damage >= 10 : false);
  if (draw && drawCondition && (!tagged || condition || !/(Flow|Fury|Turbo|Domination)/i.test(text))) drawCards(state, player, wordNumber(draw[1]));
  if (/all players draw an additional card/i.test(text)) state.players.forEach((candidate) => drawCards(state, candidate, 1));
  if (/choose a player to discard two cards/i.test(text)) discardFromHand(state, choices.targetPlayerId === player.id ? player : opponent, 2);
  else if (/choose a player to discard a card|your opponent discards a card/i.test(text)) discardFromHand(state, choices.targetPlayerId === player.id ? player : opponent, 1);
  if (/search your deck for an action/i.test(text)) searchDeck(state, player, "Action"); else if (/search your deck for a hero/i.test(text)) searchDeck(state, player, "Hero");
  if (/destroy all enemy heroes/i.test(text)) destroyHero(state, controllerId, choices, true); else if (/destroy a hero/i.test(text)) destroyHero(state, controllerId, choices);
  if (/destroy all enemy evos/i.test(text)) destroyEvo(state, controllerId, choices, true); else if (/destroy an evo/i.test(text)) destroyEvo(state, controllerId, choices);
  if (/destroy two energy/i.test(text) && condition) destroyEnergy(state, controllerId, 2); else if (/destroy an (?:enemy )?energy/i.test(text)) destroyEnergy(state, controllerId, 1);
  if (/take control of a hero/i.test(text)) {
    const index = opponent.heroes.findIndex((hero) => !choices.targetHeroId || hero.id === choices.targetHeroId); if (index >= 0) player.heroes.push(...opponent.heroes.splice(index,1));
  }
  if (/victor is decided by highest \[damage rating\]/i.test(text)) state.victorByDamage = true;
  if (/retract (?:a|one of your) bakugan/i.test(text) && target) retractBakugan(state, target);
  if (/attach a bakucore from the field/i.test(text) && target) {
    const placement = state.placements.find((candidate) => candidate.cell === choices.coreCell && !candidate.attachedTo); if (placement) { placement.attachedTo = target.id; target.heldCoreCells.push(placement.cell); }
  }
  if (/remove all bakucores enemy bakugan hold/i.test(text)) opponent.bakugan.forEach((bakugan) => { if (bakugan.open) { for (const cell of bakugan.heldCoreCells) { const p = state.placements.find((candidate) => candidate.cell === cell); if (p) delete p.attachedTo; } bakugan.heldCoreCells = []; } });
  if (/remove an enemy bakugan's bakucore/i.test(text)) {
    const enemy = chooseBakugan(state, controllerId, choices, true); const cell = choices.coreCell ?? enemy?.heldCoreCells[0]; if (enemy && cell) { enemy.heldCoreCells = enemy.heldCoreCells.filter((candidate) => candidate !== cell); const p = state.placements.find((candidate) => candidate.cell === cell); if (p) delete p.attachedTo; }
  }
  if (/retract your Bakugan at the end of the turn/i.test(text) && target) state.delayedRetracts.push(target.id);
  const gainEnergy = text.match(/\+(\d+) \[Energy\]/i); if (gainEnergy) player.energy += Number(gainEnergy[1]);
  const topEnergy = text.match(/energize the top (one|two|\d+)? ?cards? of (?:your|their) deck/i); if (topEnergy) {
    for (let index = 0; index < wordNumber(topEnergy[1]); index += 1) { const energyCard = player.deckCards.shift(); if (energyCard) player.energyZone.push(energyCard); }
    player.maxEnergy = player.energyZone.length; syncDeck(player);
  }
  if (/each player may energize the top two/i.test(text)) for (const candidate of state.players) {
    for (let index=0; index<2; index+=1) { const energyCard=candidate.deckCards.shift(); if(energyCard) candidate.energyZone.push(energyCard); }
    candidate.maxEnergy=candidate.energyZone.length; syncDeck(candidate);
  }
  if (/choose a Hero\. Its controller must Energize it/i.test(text)) {
    const owners=state.players; for(const owner of owners){ const index=owner.heroes.findIndex((hero)=>!choices.targetHeroId||hero.id===choices.targetHeroId); if(index>=0){ owner.energyZone.push(...owner.heroes.splice(index,1)); owner.maxEnergy=owner.energyZone.length; break; } }
  }
  if (/energize this uncharged/i.test(text) && card.type !== "Hero" && card.type !== "Evo") { player.energyZone.push(card); player.maxEnergy = player.energyZone.length; }
  if ((/return this to (?:your )?hand|put this into your hand/i.test(text)) && (!tagged || condition)) player.hand.push(card);
  else if (/bottom of your deck/i.test(text)) { player.deckCards.push(card); syncDeck(player); }
  else if (card.type === "Action") player.discard.push(card);
  if (card.name === "Blackhole") { state.pendingDamage = 0; state.revealedFlip = undefined; finishDamage(state); return; }
  if (card.name === "Brain Geyser" && state.pendingDamage > 0) {
    while (state.pendingDamage > 0 && player.deckCards.length) { player.hand.push(player.deckCards.shift()!); state.pendingDamage -= 1; } syncDeck(player);
  }
  if (card.name === "Luck Aura" && choices.handCardIds?.[0]) {
    const index=player.hand.findIndex((candidate)=>candidate.id===choices.handCardIds![0]); if(index>=0){ const [free]=player.hand.splice(index,1); state.batch.push({id:uid(),controllerId,card:free,choices:{},kind:"card"}); }
  }
  if (/Shuffle (a|one|two|three|\d+) cards? from your discard pile into your deck/i.test(text)) {
    const amount=wordNumber(text.match(/Shuffle (a|one|two|three|\d+)/i)?.[1]); player.deckCards.push(...player.discard.splice(0,amount)); shuffle(player.deckCards); syncDeck(player);
  }
  if (/Copy the next Action you play/i.test(text)) state.copyNextAction[controllerId]=(state.copyNextAction[controllerId]??0)+1;
  if (card.name === "Sifting Ashes") discardFromHand(state, player, 2, choices.handCardIds);
  if (card.name === "Cyndeus Stand" && choices.handCardIds?.length) {
    const moved = player.hand.filter((candidate) => choices.handCardIds!.includes(candidate.id)); player.hand = player.hand.filter((candidate) => !choices.handCardIds!.includes(candidate.id)); player.deckCards.push(...moved); shuffle(player.deckCards); state.damageBoost[target.id] = (state.damageBoost[target.id] ?? 0) + moved.length;
  }
  if (card.name === "Endless Growth") {
    const x = choices.xValue ?? 0; if (choices.mode === "damage") state.damageBoost[target.id] = (state.damageBoost[target.id] ?? 0) + x; else state.powerBoost[target.id] = (state.powerBoost[target.id] ?? 0) + x * 100;
  }
  entry(state, "game", `${card.name} resolved: ${card.effect || "no printed effect"}`);
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
  const winner = playerById(state, winnerId); const bakugan = activeBakugan(state, winnerId);
  if (bakugan) for (const source of [topCard(bakugan), ...winner.heroes]) if (/Victor\s*[-:]/i.test(source.effect)) queueTrigger(state, winnerId, source, source.effect, { targetBakuganId: bakugan.id });
};

const beginDamage = (state: MatchState) => {
  const winner = playerById(state, state.brawlWinner); const loser = otherPlayer(state, winner.id); const attacking = activeBakugan(state, winner.id)!;
  const openTeam = winner.bakugan.filter((bakugan) => bakugan.open); state.teamAttack = openTeam.length === 3;
  const stats = staticModifier(state, attacking, winner); let damage = state.teamAttack ? openTeam.reduce((sum, bakugan) => sum + staticModifier(state, bakugan, winner).damage, 0) : stats.damage;
  if (stats.double) damage *= 2;
  state.pendingLoser = loser.id; state.pendingDamage = Math.max(0, damage); state.damageOrigin = attacking.id; state.damageFaction = attacking.faction;
  setPhase(state, "damage", `Damage Step • ${damage} incoming`, loser.id); entry(state, "game", `${winner.name} attacks for ${damage}${state.teamAttack ? " as a Team Attack" : ""}.`);
  for(const hero of winner.heroes){
    if(/When one of your Bakugan attacks, draw a card/i.test(hero.effect)) drawCards(state,winner,1);
    if(damage>=10&&/If you deal 10 or more damage/i.test(hero.effect)) drawCards(state,winner,3);
  }
  revealDamage(state);
};

const flipStopsDamage = (state: MatchState, card: GameCard) => {
  const text = card.effect; const faction = state.damageFaction!;
  if (/\[Stop\] an attack/i.test(text)) return true;
  const non = text.match(/\[Stop\] non-\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i); if (non) return faction !== non[1];
  const listed = [...text.matchAll(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)].map((match) => match[1]); return /\[Stop\]/i.test(text) && listed.includes(faction);
};

const revealDamage = (state: MatchState) => {
  const player = playerById(state, state.pendingLoser);
  while (state.pendingDamage > 0) {
    const card = player.deckCards.shift(); syncDeck(player);
    if (!card) { winGame(state, otherPlayer(state, player.id).id, "Deck-out damage"); return; }
    state.pendingDamage -= 1;
    if (card.type === "Flip") { state.revealedFlip = card; state.deadline = deadlineFor("damage"); entry(state, "game", `${player.name} revealed Flip: ${card.name}.`); return; }
    player.discard.push(card); entry(state, "game", `${player.name} flipped ${card.name} as damage (${state.pendingDamage} remaining).`);
  }
  finishDamage(state);
};

const finishDamage = (state: MatchState) => {
  state.revealedFlip = undefined; setPhase(state, "postDamage", "Damage Step • Post-damage priority", state.startingPlayer);
};

export const resolveDamage = (input: MatchState, playerId: string, flipCardId?: string, choices: CardChoices = {}) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "damage" || state.pendingLoser !== playerId || !state.revealedFlip) throw new Error("There is no revealed Flip decision for you.");
  const flip = state.revealedFlip; state.revealedFlip = undefined;
  if (flipCardId) {
    if (flip.id !== flipCardId) throw new Error("Only the currently revealed Flip may be played.");
    const cost = effectiveCost(state, player, flip, choices); payEnergy(player, cost);
    if (flipStopsDamage(state, flip)) state.pendingDamage = 0;
    applyEffect(state, { id: uid(), controllerId: playerId, card: flip, choices, kind: "card" });
    if (!player.hand.some((card) => card.id === flip.id) && !player.energyZone.some((card) => card.id === flip.id)) player.discard.push(flip);
    entry(state, "game", `${player.name} played ${flip.name} for ${cost} Energy.`);
  } else { player.discard.push(flip); entry(state, "game", `${player.name} declined ${flip.name}.`); }
  revealDamage(state); return withVersion(state);
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
    for (const player of state.players) for (const bakugan of player.bakugan) if (state.delayedRetracts.includes(bakugan.id)) retractBakugan(state,bakugan);
    for (const player of state.players) if(player.hand.length===0&&player.heroes.some((hero)=>hero.name==="Barbara Kouzo")) drawCards(state,player,1);
    for (const player of state.players) { player.energy = player.maxEnergy; }
    state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {}; state.doubleStrike = {}; state.shadowStrike = {};
    const over = state.players.find((player) => player.hand.length > 7);
    if (over) setPhase(state, "handLimit", "End Phase • Discard to seven", over.id); else beginTurn(state);
  }
};

export const passPriority = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (!["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase) || state.priority !== playerId) throw new Error("You do not have priority.");
  state.passes.push(playerId); entry(state, "game", `${playerById(state, playerId).name} passed priority.`); const other = otherPlayer(state, playerId);
  if (state.passes.length < 2) { state.priority = other.id; state.deadline = deadlineFor(state.phase); return withVersion(state); }
  state.passes = [];
  if (state.batch.length) {
    const pending = state.batch.pop()!; if (!pending.negated) applyEffect(state, pending); state.priority = state.startingPlayer; state.deadline = deadlineFor(state.phase);
  } else advanceEmptyBatch(state);
  return withVersion(state);
};

export const discardToHandLimit = (input: MatchState, playerId: string, cardIds: string[]) => {
  const state = cloneMatch(input); const player = playerById(state, playerId);
  if (state.phase !== "handLimit" || state.priority !== playerId || cardIds.length !== player.hand.length - 7) throw new Error("Select exactly enough cards to keep seven.");
  discardFromHand(state, player, cardIds.length, cardIds); const next = state.players.find((candidate) => candidate.hand.length > 7);
  if (next) state.priority = next.id; else beginTurn(state); return withVersion(state);
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
  state.startingPlayer = state.players[(state.gameNumber - 1) % 2].id; state.brawlWinner = ""; state.winner = ""; state.resultReason = "";
  for (const player of state.players) {
    const all = [...player.deckCards, ...player.hand, ...player.discard, ...player.energyZone, ...player.heroes];
    player.deckCards = all.filter((card) => card.type !== "Character"); shuffle(player.deckCards); player.hand = []; player.discard = []; player.energyZone = []; player.heroes = [];
    player.energy = 0; player.maxEnergy = 0; player.ready = true; player.bakugan.forEach((bakugan) => { bakugan.open = false; bakugan.heldCoreCells = []; bakugan.evoStack = []; });
    drawCards(state, player, 5);
  }
  setPhase(state, "placement", "BakuCore placement 1 / 12", state.startingPlayer); entry(state, "system", `Game ${state.gameNumber} begins with shuffled decks and a fresh Hide Matrix.`);
  return withVersion(state);
};

export const redactForPlayer = (input: MatchState, playerId: string) => {
  const state = cloneMatch(input);
  if (state.phase === "target" && !state.players.every((player) => state.targets[player.id])) for (const id of Object.keys(state.targets)) if (id !== playerId) delete state.targets[id];
  for (const player of state.players) if (player.id !== playerId) {
    player.hand = player.hand.map((card, index) => ({ ...card, id: `hidden-hand-${index}`, name: "Hidden card", displayName: "Hidden card", effect: "", art: "/assets/cards/card-missing.svg" }));
    player.deckCards = [];
  }
  return state;
};
