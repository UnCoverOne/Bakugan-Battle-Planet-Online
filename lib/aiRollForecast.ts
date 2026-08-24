import {
  cloneMatch,
  resolveRollOutcome,
  totalDamage,
  totalPower,
  type Bakugan,
  type MatchState,
  type Placement,
  type RollOutcome,
} from "./game";
import { availableRollTargets } from "./rolling";
import { evaluateBakuganCharacteristics } from "./rules/modifiers";

const ROLL_FORECAST_SAMPLES = 20;

type RollObjective = "development" | "power" | "damage";

type ProjectedBakuganMetrics = {
  power: number;
  damage: number;
  genericValue: number;
};

export type AiRollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
  combatWinProbability: number;
  combatUtility: number;
};

export type AiRerollOpportunity = {
  target: Placement;
  decidingStat: "power" | "damage";
  currentUtility: number;
  expectedUtility: number;
  utilityGain: number;
  winProbability: number;
  openProbability: number;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function projectedBakuganMetrics(
  match: MatchState,
  playerId: string,
  bakuganId: string,
  outcome: RollOutcome,
): ProjectedBakuganMetrics {
  if (outcome.result === "miss-closed") {
    return { power: 0, damage: 0, genericValue: -1.25 };
  }

  const projected = cloneMatch(match);
  const player = playerById(projected, playerId);
  const bakugan = player?.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!player || !bakugan) {
    return { power: 0, damage: 0, genericValue: -1.25 };
  }

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
  return {
    power: characteristics.power,
    damage: characteristics.damage,
    genericValue: characteristics.power * 0.01
      + characteristics.damage * 0.9
      + characteristics.frostStrike * 0.55
      + (characteristics.shadowStrike ? 1.2 : 0)
      + (characteristics.doubleStrike ? characteristics.damage * 0.9 : 0),
  };
}

function combatObjective(match: MatchState, playerId: string, forceCombat = false): RollObjective {
  const opponent = opponentOf(match, playerId);
  if (!opponent) return "development";
  if (forceCombat || match.phase === "target" || match.phase === "reroll") {
    return match.victorByDamage ? "damage" : "power";
  }
  const opponentRoll = match.rolls[opponent.id];
  if (!opponentRoll || opponentRoll.result === "miss-closed") return "development";
  return "development";
}

function combatStateUtility(
  match: MatchState,
  playerId: string,
  objective: Exclude<RollObjective, "development">,
  participates: boolean,
  power: number,
  damage: number,
) {
  if (!participates) return -9;
  const opponent = opponentOf(match, playerId);
  const opponentRoll = opponent ? match.rolls[opponent.id] : undefined;
  if (!opponent || !opponentRoll || opponentRoll.result === "miss-closed") {
    // Secret initial targets are simultaneous, so the opponent's resolved roll
    // is unavailable here. Optimize the stat that will decide the Brawl rather
    // than the generic development mix, which can otherwise trade away B-Power
    // for Damage before a normal B-Power Victor check.
    const own = objective === "damage" ? damage : power;
    const scale = objective === "damage" ? 3 : 400;
    return 8 + clamp(own / scale, 0, 4);
  }
  const own = objective === "damage" ? damage : power;
  const enemy = objective === "damage"
    ? totalDamage(match, opponent.id)
    : totalPower(match, opponent.id);
  const gap = own - enemy;
  const base = gap > 0 ? 8 : gap === 0 ? -1 : -8;
  const scale = objective === "damage" ? 3 : 400;
  return base + clamp(gap / scale, -2.5, 2.5);
}

function forecastAiRollForObjective(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  target: Placement,
  objective: RollObjective,
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
      combatWinProbability: 0,
      combatUtility: Number.NEGATIVE_INFINITY,
    };
  }

  const primaryCounts = new Map<string, number>();
  const seed = stableHash([playerId, bakugan.id, target.cell].join(":"));
  let totalValue = 0;
  let totalCombatUtility = 0;
  let combatWins = 0;
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
    const didOpen = outcome.result !== "miss-closed";
    if (didOpen) opened += 1;
    if (outcome.cores.length) collected += 1;
    const metrics = projectedBakuganMetrics(state, playerId, bakugan.id, outcome);
    if (objective === "development") {
      totalValue += metrics.genericValue;
    } else {
      const utility = combatStateUtility(
        state,
        playerId,
        objective,
        didOpen,
        metrics.power,
        metrics.damage,
      );
      totalCombatUtility += utility;
      totalValue += utility + metrics.genericValue * 0.12;
      const opponent = opponentOf(state, playerId);
      const enemy = opponent
        ? objective === "damage" ? totalDamage(state, opponent.id) : totalPower(state, opponent.id)
        : Number.POSITIVE_INFINITY;
      const own = objective === "damage" ? metrics.damage : metrics.power;
      if (didOpen && own > enemy) combatWins += 1;
    }
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
    combatWinProbability: objective === "development" ? 0 : combatWins / ROLL_FORECAST_SAMPLES,
    combatUtility: objective === "development"
      ? 0
      : totalCombatUtility / ROLL_FORECAST_SAMPLES,
  };
}

/**
 * Forecast through the authoritative roll resolver and then evaluate the
 * resulting Bakugan through the authoritative continuous-modifier system.
 * Initial secret target selection and established-Brawl rerolls optimize the
 * stat that actually decides Victor; generic board value remains a secondary
 * tiebreaker. Other non-combat forecasts retain the development score.
 */
export function forecastAiRoll(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  target: Placement,
): AiRollForecast {
  return forecastAiRollForObjective(
    match,
    playerId,
    bakugan,
    target,
    combatObjective(match, playerId),
  );
}

function forecastCollision(a: AiRollForecast, b: AiRollForecast | undefined) {
  if (!b) return 0;
  let probability = 0;
  for (const [cell, chance] of a.primaryProbability) {
    probability += chance * (b.primaryProbability.get(cell) ?? 0);
  }
  return probability;
}

function rankedForecasts(
  match: MatchState,
  playerId: string,
  bakugan: Bakugan,
  objective: RollObjective,
) {
  const opponent = opponentOf(match, playerId);
  const opponentBakugan = opponent?.bakugan.find(
    (candidate) => candidate.id === match.selected[opponent.id],
  );
  const opponentTarget = opponent && match.targets[opponent.id]
    ? match.placements.find((placement) => placement.cell === match.targets[opponent.id])
    : undefined;
  const opponentForecast = objective === "development" && opponent && opponentBakugan && opponentTarget
    ? forecastAiRollForObjective(match, opponent.id, opponentBakugan, opponentTarget, "development")
    : undefined;

  return availableRollTargets(match)
    .map((target) => {
      const forecast = forecastAiRollForObjective(match, playerId, bakugan, target, objective);
      return {
        ...forecast,
        value: forecast.value
          - forecastCollision(forecast, opponentForecast) * 2.5
          - (target.cell === opponentTarget?.cell ? 0.25 : 0),
      };
    })
    .sort((a, b) => (
      b.value - a.value
      || b.combatWinProbability - a.combatWinProbability
      || b.openProbability - a.openProbability
    ));
}

export function bestAiRollTarget(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const bakugan = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  if (!player || !bakugan) return undefined;
  return rankedForecasts(
    match,
    playerId,
    bakugan,
    combatObjective(match, playerId),
  )[0]?.target;
}

/**
 * Counterfactual used while deciding whether an Action-card reroll is worth
 * spending. It compares the current Brawl against the best available reroll
 * target using the active Victor stat rather than the generic development
 * score. This deliberately does not include any extra text on the source card;
 * callers can add card-specific value and cost separately.
 */
export function bestAiRerollOpportunity(
  match: MatchState,
  playerId: string,
): AiRerollOpportunity | undefined {
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  const bakugan = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  const roll = match.rolls[playerId];
  const opponentRoll = opponent ? match.rolls[opponent.id] : undefined;
  if (!player || !opponent || !bakugan || !roll || !opponentRoll
    || opponentRoll.result === "miss-closed" || !availableRollTargets(match).length) {
    return undefined;
  }

  const decidingStat: "power" | "damage" = match.victorByDamage ? "damage" : "power";
  const currentUtility = combatStateUtility(
    match,
    playerId,
    decidingStat,
    roll.result !== "miss-closed",
    totalPower(match, playerId),
    totalDamage(match, playerId),
  );
  const best = rankedForecasts(match, playerId, bakugan, decidingStat)[0];
  if (!best) return undefined;
  return {
    target: best.target,
    decidingStat,
    currentUtility,
    expectedUtility: best.combatUtility,
    utilityGain: best.combatUtility - currentUtility,
    winProbability: best.combatWinProbability,
    openProbability: best.openProbability,
  };
}
