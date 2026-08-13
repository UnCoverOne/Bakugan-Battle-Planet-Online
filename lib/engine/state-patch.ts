import type { MatchState } from "../game";
import { projectMatchForPlayer } from "./projection";

export type StatePatchOperation =
  | { op: "replace"; path: `/${string}`; value: unknown }
  | { op: "remove"; path: `/${string}` };

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createStatePatch(
  before: MatchState,
  after: MatchState,
): StatePatchOperation[] {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const operations: StatePatchOperation[] = [];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!(key in next)) operations.push({ op: "remove", path: `/${key}` });
    else if (!(key in previous) || !same(previous[key], next[key])) operations.push({ op: "replace", path: `/${key}`, value: next[key] });
  }
  return operations;
}

export function createSeatStatePatch(
  before: MatchState | null,
  after: MatchState,
  playerId: string,
): StatePatchOperation[] {
  const previous = before ? projectMatchForPlayer(before, playerId) as Record<string, unknown> : {};
  const next = projectMatchForPlayer(after, playerId) as Record<string, unknown>;
  return createStatePatch(previous as MatchState, next as MatchState);
}

export function applyStatePatch<T extends Record<string, unknown>>(state: T, patch: readonly StatePatchOperation[]): T {
  const next = structuredClone(state);
  for (const operation of patch) {
    const key = operation.path.slice(1);
    if (operation.op === "remove") delete next[key];
    else next[key] = structuredClone(operation.value);
  }
  return next;
}
