import { DIGITAL_ADAPTATION_VERSION } from "../content/versions";
import type {
  MatchState,
  PhysicalCollisionDecision,
  Placement,
  PlayerState,
  RollOutcome,
  RollPathPoint,
} from "../game";

export type PhysicalHexCell = { id: string; q: number; r: number };
export type PhysicalRandomSource = (maximum: number) => number;

export type PhysicalSimulationProfile = {
  id: string;
  geometry: {
    gridWidth: number;
    gridHeight: number;
    hexRadius: number;
    laneHalfWidth: number;
  };
  rotation: {
    openPeriodCoreLengths: number;
  };
  missWeights: {
    closed: number;
    openNoCore: number;
    undershoot: number;
    overshoot: number;
    skewLeft: number;
    skewRight: number;
  };
  doubleCore: {
    beforeWeight: number;
    afterWeight: number;
    sideWeight: number;
    sideThresholdRatio: number;
  };
  collision: {
    primaryPriority: "normalized-accuracy";
    tieBreak: "player-id";
    contestedPrimaryOutcome: "open-no-core";
    primaryBeatsSecondary: true;
  };
  repeat: {
    allClosed: "repeat-roll-step";
    maxAttempts: number;
  };
};

export const BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE: PhysicalSimulationProfile = Object.freeze({
  id: DIGITAL_ADAPTATION_VERSION,
  geometry: Object.freeze({
    gridWidth: 1_800,
    gridHeight: 1_000,
    hexRadius: 52 * 0.8,
    laneHalfWidth: 42,
  }),
  rotation: Object.freeze({
    openPeriodCoreLengths: 4,
  }),
  missWeights: Object.freeze({
    closed: 30,
    openNoCore: 20,
    undershoot: 15,
    overshoot: 10,
    skewLeft: 12.5,
    skewRight: 12.5,
  }),
  doubleCore: Object.freeze({
    beforeWeight: 40,
    afterWeight: 40,
    sideWeight: 20,
    sideThresholdRatio: 1.15,
  }),
  collision: Object.freeze({
    primaryPriority: "normalized-accuracy",
    tieBreak: "player-id",
    contestedPrimaryOutcome: "open-no-core",
    primaryBeatsSecondary: true,
  }),
  repeat: Object.freeze({
    allClosed: "repeat-roll-step",
    maxAttempts: 64,
  }),
});

export class PhysicalSimulationError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PROFILE"
      | "INVALID_RANDOM_VALUE"
      | "INVALID_ROLL_STATE"
      | "ROLL_ATTEMPT_LIMIT",
    message: string,
  ) {
    super(message);
    this.name = "PhysicalSimulationError";
  }
}

export function validatePhysicalSimulationProfile(profile: PhysicalSimulationProfile) {
  const errors: string[] = [];
  if (!profile.id.trim()) errors.push("The physical-simulation profile requires an ID.");
  for (const [name, value] of Object.entries(profile.geometry)) {
    if (!Number.isFinite(value) || value <= 0) errors.push(`geometry.${name} must be positive.`);
  }
  if (!Number.isInteger(profile.rotation.openPeriodCoreLengths) || profile.rotation.openPeriodCoreLengths < 1) {
    errors.push("rotation.openPeriodCoreLengths must be a positive integer.");
  }
  for (const [name, value] of Object.entries(profile.missWeights)) {
    if (!Number.isFinite(value) || value < 0) errors.push(`missWeights.${name} must be non-negative.`);
  }
  if (Object.values(profile.missWeights).every((value) => value === 0)) {
    errors.push("At least one miss outcome must have weight.");
  }
  for (const [name, value] of Object.entries(profile.doubleCore)) {
    if (!Number.isFinite(value) || value <= 0) errors.push(`doubleCore.${name} must be positive.`);
  }
  if (!Number.isInteger(profile.repeat.maxAttempts) || profile.repeat.maxAttempts < 1) {
    errors.push("repeat.maxAttempts must be a positive integer.");
  }
  return errors;
}

export function describePhysicalSimulationProfile(
  profile: PhysicalSimulationProfile = BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
) {
  return [
    `Profile ${profile.id}`,
    `Accuracy uses each Bakugan's configured 1–100 threshold.`,
    `A downward magnet phase repeats every ${profile.rotation.openPeriodCoreLengths} BakuCore lengths.`,
    `Miss deviations use weighted closed, open-without-Core, undershoot, overshoot, and left/right outcomes.`,
    `Double Core direction weights are ${profile.doubleCore.beforeWeight}/${profile.doubleCore.afterWeight}/${profile.doubleCore.sideWeight} for before/after/side.`,
    "Contested primary pickups go to the better normalized accuracy result; the other Bakugan opens without a Core.",
    `All-closed attempts repeat, with a fail-closed limit of ${profile.repeat.maxAttempts} attempts.`,
  ];
}

type ProjectedPlacement = {
  placement: Placement;
  point: RollPathPoint;
  along: number;
  lateral: number;
};

type WeightedRollOption = {
  result: RollOutcome["result"];
  weight: number;
  placement?: Placement;
};

export type PhysicalRollAttempt = {
  attempt: number;
  outcomes: RollOutcome[];
  repeated: boolean;
};

export type PhysicalRollStepResult = {
  profileId: string;
  attempts: PhysicalRollAttempt[];
  outcomes: RollOutcome[];
  collisionDecisions: PhysicalCollisionDecision[];
};

export type PhysicalSimulationHooks = {
  onAttempt?: (attempt: number) => void;
};

const distance = (a: PhysicalHexCell, b: PhysicalHexCell) => (
  Math.abs(a.q - b.q)
  + Math.abs(a.r - b.r)
  + Math.abs((a.q + a.r) - (b.q + b.r))
) / 2;

const cellAt = (cells: readonly PhysicalHexCell[], id: string) => cells.find((cell) => cell.id === id);
const vectorBetween = (from: RollPathPoint, to: RollPathPoint) => ({ x: to.x - from.x, y: to.y - from.y });
const vectorLength = (vector: RollPathPoint) => Math.hypot(vector.x, vector.y);
const dot = (a: RollPathPoint, b: RollPathPoint) => a.x * b.x + a.y * b.y;
const cross = (a: RollPathPoint, b: RollPathPoint) => a.x * b.y - a.y * b.x;
const roundedPoint = (point: RollPathPoint): RollPathPoint => ({
  x: Math.round(point.x * 10) / 10,
  y: Math.round(point.y * 10) / 10,
});
const interpolatePoint = (from: RollPathPoint, to: RollPathPoint, amount: number): RollPathPoint => ({
  x: from.x + (to.x - from.x) * amount,
  y: from.y + (to.y - from.y) * amount,
});

function assertProfile(profile: PhysicalSimulationProfile) {
  const errors = validatePhysicalSimulationProfile(profile);
  if (errors.length) throw new PhysicalSimulationError("INVALID_PROFILE", errors.join(" "));
}

function draw(randomRoll: PhysicalRandomSource, maximum: number) {
  const value = randomRoll(maximum);
  if (!Number.isInteger(value) || value < 0 || value >= maximum) {
    throw new PhysicalSimulationError(
      "INVALID_RANDOM_VALUE",
      `Physical random source returned ${value}; expected an integer from 0 through ${maximum - 1}.`,
    );
  }
  return value;
}

function rollCellPoint(
  cells: readonly PhysicalHexCell[],
  cellId: string,
  profile: PhysicalSimulationProfile,
): RollPathPoint | undefined {
  const cell = cellAt(cells, cellId);
  if (!cell) return undefined;
  const centerX = profile.geometry.gridWidth / 2;
  const centerY = profile.geometry.gridHeight / 2;
  const hexHeight = Math.sqrt(3) * profile.geometry.hexRadius;
  const xStep = profile.geometry.hexRadius * 1.5;
  return {
    x: centerX + cell.q * xStep,
    y: centerY + (cell.r + cell.q / 2) * hexHeight,
  };
}

function rollStartPoint(playerIndex: number, profile: PhysicalSimulationProfile): RollPathPoint {
  return {
    x: profile.geometry.gridWidth / 2,
    y: playerIndex === 0 ? profile.geometry.gridHeight + 90 : -90,
  };
}

function projectedPlacements(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  playerIndex: number,
  targetCell: string,
  profile: PhysicalSimulationProfile,
): ProjectedPlacement[] {
  const start = rollStartPoint(playerIndex, profile);
  const target = rollCellPoint(cells, targetCell, profile);
  if (!target) return [];
  const lane = vectorBetween(start, target);
  const laneLength = Math.max(1, vectorLength(lane));
  const laneLengthSquared = laneLength * laneLength;
  return state.placements
    .filter((placement) => !placement.attachedTo)
    .map((placement) => {
      const point = rollCellPoint(cells, placement.cell, profile);
      if (!point) return undefined;
      const offset = vectorBetween(start, point);
      return {
        placement,
        point,
        along: dot(offset, lane) / laneLengthSquared,
        lateral: cross(lane, offset) / laneLength,
      };
    })
    .filter((candidate): candidate is ProjectedPlacement => Boolean(candidate));
}

function rollLane(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  playerIndex: number,
  targetCell: string,
  profile: PhysicalSimulationProfile,
) {
  return projectedPlacements(state, cells, playerIndex, targetCell, profile)
    .filter((candidate) => candidate.along > 0 && Math.abs(candidate.lateral) <= profile.geometry.laneHalfWidth)
    .sort((a, b) => a.along - b.along || a.placement.order - b.placement.order);
}

export function physicalRotationPhaseOpenCell(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  playerId: string,
  targetCell: string,
  profile: PhysicalSimulationProfile = BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
) {
  assertProfile(profile);
  const playerIndex = state.players.findIndex((player) => player.id === playerId);
  const target = cellAt(cells, targetCell);
  if (playerIndex < 0 || !target) return targetCell;
  const intercept = rollLane(state, cells, playerIndex, targetCell, profile).find((candidate) => {
    if (candidate.placement.cell === targetCell || candidate.along >= 0.999) return false;
    const candidateCell = cellAt(cells, candidate.placement.cell);
    if (!candidateCell) return false;
    const coreLengths = distance(candidateCell, target);
    return coreLengths > 0 && coreLengths % profile.rotation.openPeriodCoreLengths === 0;
  });
  return intercept?.placement.cell ?? targetCell;
}

function adjacentAvailablePlacements(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  cellId: string,
) {
  const cell = cellAt(cells, cellId);
  if (!cell) return [];
  return state.placements.filter((placement) => {
    const other = cellAt(cells, placement.cell);
    return !placement.attachedTo && other && placement.cell !== cellId && distance(cell, other) === 1;
  });
}

function chooseWeightedRollOption(options: WeightedRollOption[], roll: number) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  if (total <= 0) throw new PhysicalSimulationError("INVALID_PROFILE", "The physical roll has no weighted outcome.");
  let cursor = ((Math.max(1, roll) - 1) % 10_000) / 10_000 * total;
  for (const option of options) {
    cursor -= option.weight;
    if (cursor < 0) return option;
  }
  return options.at(-1)!;
}

function missOptions(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  playerIndex: number,
  targetCell: string,
  profile: PhysicalSimulationProfile,
): WeightedRollOption[] {
  const projected = projectedPlacements(state, cells, playerIndex, targetCell, profile);
  const target = projected.find((candidate) => candidate.placement.cell === targetCell);
  if (!target) return [
    { result: "miss-closed", weight: profile.missWeights.closed },
    { result: "open-no-core", weight: profile.missWeights.openNoCore },
  ];
  const lane = projected
    .filter((candidate) => Math.abs(candidate.lateral) <= profile.geometry.laneHalfWidth)
    .sort((a, b) => a.along - b.along || a.placement.order - b.placement.order);
  const undershoot = [...lane]
    .filter((candidate) => candidate.along < target.along - 0.001)
    .sort((a, b) => b.along - a.along)[0]?.placement;
  const overshoot = lane
    .filter((candidate) => candidate.along > target.along + 0.001)
    .sort((a, b) => a.along - b.along)[0]?.placement;
  const adjacent = adjacentAvailablePlacements(state, cells, targetCell)
    .map((placement) => projected.find((candidate) => candidate.placement.cell === placement.cell))
    .filter((candidate): candidate is ProjectedPlacement => Boolean(candidate));
  const left = adjacent
    .filter((candidate) => candidate.lateral < -profile.geometry.laneHalfWidth * 0.35)
    .sort((a, b) => Math.abs(a.lateral) - Math.abs(b.lateral) || a.placement.order - b.placement.order)[0]?.placement;
  const right = adjacent
    .filter((candidate) => candidate.lateral > profile.geometry.laneHalfWidth * 0.35)
    .sort((a, b) => Math.abs(a.lateral) - Math.abs(b.lateral) || a.placement.order - b.placement.order)[0]?.placement;
  return [
    { result: "miss-closed", weight: profile.missWeights.closed },
    { result: "open-no-core", weight: profile.missWeights.openNoCore },
    ...(undershoot ? [{ result: "undershoot" as const, weight: profile.missWeights.undershoot, placement: undershoot }] : []),
    ...(overshoot ? [{ result: "overshoot" as const, weight: profile.missWeights.overshoot, placement: overshoot }] : []),
    ...(left ? [{ result: "skew-left" as const, weight: profile.missWeights.skewLeft, placement: left }] : []),
    ...(right ? [{ result: "skew-right" as const, weight: profile.missWeights.skewRight, placement: right }] : []),
  ].filter((option) => option.weight > 0);
}

function selectSecondCore(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  primaryCell: string,
  start: RollPathPoint,
  target: RollPathPoint,
  roll: number,
  profile: PhysicalSimulationProfile,
) {
  const direction = vectorBetween(start, target);
  const directionLength = Math.max(1, vectorLength(direction));
  const unit = { x: direction.x / directionLength, y: direction.y / directionLength };
  const primary = rollCellPoint(cells, primaryCell, profile);
  if (!primary) return undefined;
  const categories: Record<"before" | "after" | "side", Placement[]> = {
    before: [],
    after: [],
    side: [],
  };
  for (const placement of adjacentAvailablePlacements(state, cells, primaryCell)) {
    const point = rollCellPoint(cells, placement.cell, profile)!;
    const offset = vectorBetween(primary, point);
    const along = dot(offset, unit);
    const lateral = cross(unit, offset);
    if (Math.abs(lateral) > Math.abs(along) * profile.doubleCore.sideThresholdRatio) categories.side.push(placement);
    else if (along < 0) categories.before.push(placement);
    else categories.after.push(placement);
  }
  const choices = [
    ...(categories.before.length ? [{ category: "before" as const, weight: profile.doubleCore.beforeWeight }] : []),
    ...(categories.after.length ? [{ category: "after" as const, weight: profile.doubleCore.afterWeight }] : []),
    ...(categories.side.length ? [{ category: "side" as const, weight: profile.doubleCore.sideWeight }] : []),
  ];
  if (!choices.length) return undefined;
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let cursor = ((Math.max(1, roll) - 1) % 10_000) / 10_000 * total;
  let selected = choices.at(-1)!;
  for (const choice of choices) {
    cursor -= choice.weight;
    if (cursor < 0) {
      selected = choice;
      break;
    }
  }
  const candidates = categories[selected.category].sort((a, b) => a.order - b.order);
  return candidates[(Math.max(1, roll) - 1) % candidates.length];
}

function buildRollPath(
  cells: readonly PhysicalHexCell[],
  start: RollPathPoint,
  intended: RollPathPoint,
  result: RollOutcome["result"],
  deviationRoll: number,
  profile: PhysicalSimulationProfile,
  primary?: RollPathPoint,
  secondary?: RollPathPoint,
) {
  void cells;
  const direction = vectorBetween(start, intended);
  const length = Math.max(1, vectorLength(direction));
  const perpendicular = { x: -direction.y / length, y: direction.x / length };
  const varianceDirection = deviationRoll % 2 === 0 ? 1 : -1;
  const endpoint = primary ?? (
    result === "miss-closed"
      ? {
          ...interpolatePoint(start, intended, 0.72),
          x: interpolatePoint(start, intended, 0.72).x + perpendicular.x * 82 * varianceDirection,
          y: interpolatePoint(start, intended, 0.72).y + perpendicular.y * 82 * varianceDirection,
        }
      : {
          x: intended.x + perpendicular.x * 76 * varianceDirection,
          y: intended.y + perpendicular.y * 76 * varianceDirection,
        }
  );
  const curve = result === "skew-left" ? -54
    : result === "skew-right" ? 54
      : ((deviationRoll % 17) - 8) * 1.4;
  const midpoint = interpolatePoint(start, endpoint, 0.54);
  const points = [
    roundedPoint(start),
    roundedPoint({
      x: midpoint.x + perpendicular.x * curve,
      y: midpoint.y + perpendicular.y * curve,
    }),
    roundedPoint(endpoint),
  ];
  if (secondary) points.push(roundedPoint(secondary));
  return points;
}

function selectedBakugan(state: MatchState, player: PlayerState) {
  const selectedId = state.selected[player.id];
  const bakugan = player.bakugan.find((candidate) => candidate.id === selectedId);
  const intended = state.targets[player.id];
  if (!bakugan || !intended) {
    throw new PhysicalSimulationError(
      "INVALID_ROLL_STATE",
      `${player.name} requires one selected closed Bakugan and one locked target before physical simulation.`,
    );
  }
  return { bakugan, intended };
}

export function resolvePhysicalRollOutcome(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  player: PlayerState,
  randomRoll: PhysicalRandomSource,
  profile: PhysicalSimulationProfile = BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
  attempt = 1,
): RollOutcome {
  assertProfile(profile);
  const { bakugan, intended } = selectedBakugan(state, player);
  const playerIndex = state.players.findIndex((candidate) => candidate.id === player.id);
  const start = rollStartPoint(playerIndex, profile);
  const intendedPoint = rollCellPoint(cells, intended, profile);
  if (!intendedPoint) throw new PhysicalSimulationError("INVALID_ROLL_STATE", `Unknown target cell ${intended}.`);
  const accuracyRoll = draw(randomRoll, 100) + 1;
  const deviationRoll = draw(randomRoll, 10_000) + 1;
  const doubleRoll = draw(randomRoll, 100) + 1;
  const secondCoreRoll = draw(randomRoll, 10_000) + 1;
  let result: RollOutcome["result"];
  let primary: Placement | undefined;

  if (accuracyRoll <= bakugan.rollAccuracy) {
    const openedCell = physicalRotationPhaseOpenCell(state, cells, player.id, intended, profile);
    primary = state.placements.find((placement) => placement.cell === openedCell && !placement.attachedTo);
    result = openedCell === intended ? "intended-core" : "path-intercept";
  } else {
    const option = chooseWeightedRollOption(missOptions(state, cells, playerIndex, intended, profile), deviationRoll);
    result = option.result;
    primary = option.placement;
  }

  const cores = primary ? [primary.cell] : [];
  let secondary: Placement | undefined;
  if (primary && doubleRoll <= bakugan.doubleCoreChance) {
    secondary = selectSecondCore(state, cells, primary.cell, start, intendedPoint, secondCoreRoll, profile);
    if (secondary) cores.push(secondary.cell);
  }
  const doubleCore = Boolean(secondary);
  const resolvedTarget = primary?.cell ?? intended;
  const primaryPoint = primary ? rollCellPoint(cells, primary.cell, profile) : undefined;
  const secondaryPoint = secondary ? rollCellPoint(cells, secondary.cell, profile) : undefined;
  const notes: Record<RollOutcome["result"], string> = {
    "miss-closed": "The roll left the pickup lane and the Bakugan remained closed.",
    "open-no-core": "The Bakugan opened outside every available BakuCore pickup window.",
    "intended-core": "The roll stayed inside the intended lane and opened on the selected BakuCore.",
    overshoot: "The roll carried beyond the selected BakuCore and opened on the next farther Core.",
    undershoot: "The roll stopped short and opened on the nearest closer Core.",
    "skew-left": "The roll skewed left and opened on an adjacent BakuCore.",
    "skew-right": "The roll skewed right and opened on an adjacent BakuCore.",
    "path-intercept": "The magnet's four-Core rotation phase faced down on an earlier Core in the lane.",
  };
  const note = notes[result] + (doubleCore
    ? ` The second-Core check used ${profile.doubleCore.beforeWeight}/${profile.doubleCore.afterWeight}/${profile.doubleCore.sideWeight} before/after/side weighting.`
    : "");
  return {
    playerId: player.id,
    bakuganId: bakugan.id,
    target: intended,
    resolvedTarget,
    result,
    cores,
    accuracyRoll,
    deviationRoll,
    doubleRoll,
    secondCoreRoll,
    doubleCore,
    path: buildRollPath(cells, start, intendedPoint, result, deviationRoll, profile, primaryPoint, secondaryPoint),
    note,
    simulationProfileId: profile.id,
    attempt,
    collisionDecisions: [],
  };
}

function cloneOutcome(outcome: RollOutcome): RollOutcome {
  return {
    ...outcome,
    cores: [...outcome.cores],
    path: outcome.path.map((point) => ({ ...point })),
    collisionDecisions: [...(outcome.collisionDecisions ?? [])],
  };
}

function attachDecision(outcome: RollOutcome, decision: PhysicalCollisionDecision) {
  outcome.collisionDecisions ??= [];
  outcome.collisionDecisions.push(decision);
}

export function resolvePhysicalCoreCollisions(
  state: MatchState,
  outcomes: readonly RollOutcome[],
  profile: PhysicalSimulationProfile = BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
) {
  assertProfile(profile);
  const resolved = outcomes.map(cloneOutcome);
  const claimed = new Map<string, RollOutcome>();
  const decisions: PhysicalCollisionDecision[] = [];
  const quality = (roll: RollOutcome) => {
    const player = state.players.find((candidate) => candidate.id === roll.playerId);
    const bakugan = player?.bakugan.find((candidate) => candidate.id === roll.bakuganId);
    if (!bakugan) throw new PhysicalSimulationError("INVALID_ROLL_STATE", `Unknown Bakugan ${roll.bakuganId}.`);
    return roll.accuracyRoll / Math.max(1, bakugan.rollAccuracy);
  };
  const ordered = [...resolved].sort((left, right) => (
    quality(left) - quality(right) || left.playerId.localeCompare(right.playerId)
  ));

  for (const roll of ordered) {
    if (roll.result === "miss-closed" || roll.result === "open-no-core") continue;
    const desired = roll.cores[0];
    if (desired && !claimed.has(desired)) {
      claimed.set(desired, roll);
      continue;
    }
    if (!desired) continue;
    const winner = claimed.get(desired)!;
    const decision: PhysicalCollisionDecision = {
      kind: "primary-contested",
      coreCell: desired,
      winnerPlayerId: winner.playerId,
      affectedPlayerId: roll.playerId,
      policy: `${profile.collision.primaryPriority}/${profile.collision.tieBreak}`,
    };
    decisions.push(decision);
    attachDecision(winner, decision);
    attachDecision(roll, decision);
    roll.result = profile.collision.contestedPrimaryOutcome;
    roll.cores = [];
    roll.doubleCore = false;
    roll.path = roll.path.slice(0, 3);
    roll.note += " The primary pickup was contested; the better normalized roll collected the Core, so this Bakugan opened without one.";
  }

  for (const roll of ordered) {
    if (roll.cores.length <= 1) continue;
    const second = roll.cores[1];
    const primaryOwner = claimed.get(second);
    if (primaryOwner) {
      const decision: PhysicalCollisionDecision = {
        kind: "secondary-yielded",
        coreCell: second,
        winnerPlayerId: primaryOwner.playerId,
        affectedPlayerId: roll.playerId,
        policy: "primary-pickup-before-secondary",
      };
      decisions.push(decision);
      attachDecision(primaryOwner, decision);
      attachDecision(roll, decision);
      roll.cores = roll.cores.slice(0, 1);
      roll.doubleCore = false;
      roll.path = roll.path.slice(0, 3);
      roll.note += " The second BakuCore was already collected by a primary pickup.";
    } else {
      claimed.set(second, roll);
    }
  }
  return { outcomes: resolved, collisionDecisions: decisions };
}

export function simulatePhysicalRollStep(
  state: MatchState,
  cells: readonly PhysicalHexCell[],
  randomRoll: PhysicalRandomSource,
  profile: PhysicalSimulationProfile = BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,
  hooks: PhysicalSimulationHooks = {},
): PhysicalRollStepResult {
  assertProfile(profile);
  const attempts: PhysicalRollAttempt[] = [];
  for (let attempt = 1; attempt <= profile.repeat.maxAttempts; attempt += 1) {
    hooks.onAttempt?.(attempt);
    const raw = state.players.map((player) => resolvePhysicalRollOutcome(
      state,
      cells,
      player,
      randomRoll,
      profile,
      attempt,
    ));
    const allClosed = raw.every((roll) => roll.result === "miss-closed");
    if (allClosed) {
      attempts.push({ attempt, outcomes: raw, repeated: true });
      continue;
    }
    const collision = resolvePhysicalCoreCollisions(state, raw, profile);
    attempts.push({ attempt, outcomes: collision.outcomes, repeated: false });
    return {
      profileId: profile.id,
      attempts,
      outcomes: collision.outcomes,
      collisionDecisions: collision.collisionDecisions,
    };
  }
  throw new PhysicalSimulationError(
    "ROLL_ATTEMPT_LIMIT",
    `All Bakugan remained closed for ${profile.repeat.maxAttempts} consecutive physical-simulation attempts.`,
  );
}
