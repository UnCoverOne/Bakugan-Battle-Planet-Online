import type { CardChoices, MatchState } from "./game";

export type OpponentAiPlannerMetrics = {
  playerId: string;
  matchVersion: number;
  elapsedMs: number;
  cacheHits: number;
  cacheMisses: number;
  optionalWork: number;
  optionalBudget: number;
  optionalBudgetExhausted: boolean;
  lastStage: string;
  byCategory: Record<string, { hits: number; misses: number }>;
};

type MutableMetrics = Omit<OpponentAiPlannerMetrics, "elapsedMs" | "byCategory"> & {
  startedAt: number;
  byCategory: Map<string, { hits: number; misses: number }>;
};

type DecisionScope = {
  metrics: MutableMetrics;
  values: WeakMap<MatchState, Map<string, unknown>>;
};

const OPTIONAL_WORK_BUDGET = 50_000;
let activeScope: DecisionScope | null = null;

function categoryMetrics(scope: DecisionScope, category: string) {
  let entry = scope.metrics.byCategory.get(category);
  if (!entry) {
    entry = { hits: 0, misses: 0 };
    scope.metrics.byCategory.set(category, entry);
  }
  return entry;
}

function snapshot(scope: DecisionScope): OpponentAiPlannerMetrics {
  return {
    playerId: scope.metrics.playerId,
    matchVersion: scope.metrics.matchVersion,
    elapsedMs: Date.now() - scope.metrics.startedAt,
    cacheHits: scope.metrics.cacheHits,
    cacheMisses: scope.metrics.cacheMisses,
    optionalWork: scope.metrics.optionalWork,
    optionalBudget: scope.metrics.optionalBudget,
    optionalBudgetExhausted: scope.metrics.optionalBudgetExhausted,
    lastStage: scope.metrics.lastStage,
    byCategory: Object.fromEntries(scope.metrics.byCategory),
  };
}

export function opponentAiChoicesKey(choices: CardChoices) {
  return JSON.stringify(
    Object.entries(choices)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
  );
}

export function memoOpponentAiDecision<T>(
  match: MatchState,
  category: string,
  key: string,
  compute: () => T,
): T {
  const scope = activeScope;
  if (!scope) return compute();

  let matchValues = scope.values.get(match);
  if (!matchValues) {
    matchValues = new Map();
    scope.values.set(match, matchValues);
  }
  const compositeKey = `${category}:${key}`;
  const stats = categoryMetrics(scope, category);
  if (matchValues.has(compositeKey)) {
    scope.metrics.cacheHits += 1;
    stats.hits += 1;
    return matchValues.get(compositeKey) as T;
  }

  scope.metrics.cacheMisses += 1;
  stats.misses += 1;
  scope.metrics.lastStage = category;
  const value = compute();
  matchValues.set(compositeKey, value);
  return value;
}

/**
 * Optional look-ahead is bounded independently from mandatory legality and
 * immediate tactical evaluation. The current depth-2 planner is comfortably
 * below this ceiling; it exists to prevent future combinatorial growth from
 * stranding a Training match.
 */
export function takeOpponentAiOptionalWork(stage: string, units = 1) {
  const scope = activeScope;
  if (!scope) return true;
  scope.metrics.lastStage = stage;
  if (scope.metrics.optionalWork + units > scope.metrics.optionalBudget) {
    scope.metrics.optionalBudgetExhausted = true;
    return false;
  }
  scope.metrics.optionalWork += units;
  return true;
}

export function runOpponentAiDecision<T>(
  match: MatchState,
  playerId: string,
  decide: () => T,
): { result: T; metrics: OpponentAiPlannerMetrics } {
  if (activeScope) {
    const result = decide();
    return { result, metrics: snapshot(activeScope) };
  }

  const scope: DecisionScope = {
    values: new WeakMap(),
    metrics: {
      playerId,
      matchVersion: match.version,
      startedAt: Date.now(),
      cacheHits: 0,
      cacheMisses: 0,
      optionalWork: 0,
      optionalBudget: OPTIONAL_WORK_BUDGET,
      optionalBudgetExhausted: false,
      lastStage: "start",
      byCategory: new Map(),
    },
  };
  activeScope = scope;
  try {
    const result = decide();
    return { result, metrics: snapshot(scope) };
  } finally {
    activeScope = null;
  }
}
