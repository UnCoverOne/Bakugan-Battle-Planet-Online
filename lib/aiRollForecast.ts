import {
  cloneMatch,
  resolveRollOutcome,
  type Bakugan,
  type MatchState,
  type Placement,
  type RollOutcome,
} from "./game";
import { availableRollTargets } from "./rolling";
import { evaluateBakuganCharacteristics } from "./rules/modifiers";

const ROLL_FORECAST_SAMPLES = 20;

export type AiRollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
};

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function opponentOf(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id !== playerId);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function projectedBakuganValue(
  match: MatchState,
  playerId: string,
  bakuganId: string,
  outcome: RollOutcome,
) {
  if (outcome.result === "miss-closed") return -1.25;

  const projected = cloneMatch(match);
  const player = playerById(projected, playerId);
  const bakugan = player?.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!player || !bakugan) return -1.25;

  for (const placement of projected.placements) {
    if (placement.attachedTo === bakugan.id) delete placement.attachedTo;
  }
  bakugan.open = true;
  bakugan.heldCoreCells = [...outcome.cores];
  for (const cell of outcome.cores) {
    const placement = projected.placements.find((candidate) => candidate.cell === cell);
    if (placement) placement.attachedTo = bakugan.id;
  }
  projected.rolls[playerId] = outcome;

  const characteristics = evaluateBakuganCharacteristics(projected, bakugan, player);
  return characteristics.power * 0.01
    + characteristics.damage * 0.9
    + characteristics.frostStrike * 0.55
    + (characteristics.shadowStrike ? 1.2 : 0)
    + (characteristics.doubleStrike ? characteristics.damage * 0.9 : 0);
}

/**
 * Forecast through the authoritative roll resolver and then evaluate the
 * resulting Bakugan through the authoritative continuous-modifier system.
 * This lets printed Character/Evo abilities that depend on held BakuCore types
 * influence the same target score as the BakuCore's own printed bonuses.
 */
export function forecastAiRoll(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  target: Placement,
): AiRollForecast {
  const state = {
    ...match,
    selected: { ...match.selected, [playerId]: bakugan.id },
    targets: { ...match.targets, [playerId]: target.cell },
  };
  const player = playerById(state, playerId);
  if (!player) {
    return {
      target,
      value: Number.NEGATIVE_INFINITY,
      openProbability: 0,
      coreProbability: 0,
      primaryProbability: new Map(),
    };
  }

  const primaryCounts = new Map<string, number>();
  const seed = stableHash([playerId, bakugan.id, target.cell].join(":"));
  let totalValue = 0;
  let opened = 0;
  let collected = 0;

  for (let sample = 0; sample < ROLL_FORECAST_SAMPLES; sample += 1) {
    const values = [
      sample * 5 + 2,
      (seed + sample * 487) % 10_000,
      sample * 5 + 2,
      (seed * 3 + sample * 3253) % 10_000,
    ];
    let cursor = 0;
    const outcome = resolveRollOutcome(
      state,
      player,
      (maximum) => values[cursor++] % maximum,
    );
    if (outcome.result !== "miss-closed") opened += 1;
    if (outcome.cores.length) collected += 1;
    totalValue += projectedBakuganValue(state, playerId, bakugan.id, outcome);
    const primary = outcome.cores[0];
    if (primary) primaryCounts.set(primary, (primaryCounts.get(primary) ?? 0) + 1);
  }

  return {
    target,
    value: totalValue / ROLL_FORECAST_SAMPLES,
    openProbability: opened / ROLL_FORECAST_SAMPLES,
    coreProbability: collected / ROLL_FORECAST_SAMPLES,
    primaryProbability: new Map(
      [...primaryCounts].map(([cell, count]) => [cell, count / ROLL_FORECAST_SAMPLES]),
    ),
  };
}

function forecastCollision(a: AiRollForecast, b: AiRollForecast | undefined) {
  if (!b) return 0;
  let probability = 0;
  for (const [cell, chance] of a.primaryProbability) {
    probability += chance * (b.primaryProbability.get(cell) ?? 0);
  }
  return probability;
}

export function bestAiRollTarget(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const bakugan = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  if (!player || !bakugan) return undefined;

  const opponent = opponentOf(match, playerId);
  const opponentBakugan = opponent?.bakugan.find(
    (candidate) => candidate.id === match.selected[opponent.id],
  );
  const opponentTarget = opponent && match.targets[opponent.id]
    ? match.placements.find((placement) => placement.cell === match.targets[opponent.id])
    : undefined;
  const opponentForecast = opponent && opponentBakugan && opponentTarget
    ? forecastAiRoll(match, opponent.id, opponentBakugan, opponentTarget)
    : undefined;

  return availableRollTargets(match)
    .map((target) => {
      const forecast = forecastAiRoll(match, playerId, bakugan, target);
      return {
        ...forecast,
        value: forecast.value
          - forecastCollision(forecast, opponentForecast) * 2.5
          - (target.cell === opponentTarget?.cell ? 0.25 : 0),
      };
    })
    .sort((a, b) => b.value - a.value || b.openProbability - a.openProbability)[0]?.target;
}
