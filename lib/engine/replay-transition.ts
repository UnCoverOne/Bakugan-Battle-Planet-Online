import { cloneMatch, type MatchState } from "../game";
import { ENGINE_METADATA_KEY, type EngineBackedMatchState } from "./types";

export type ReplayStatePatchOperation =
  | { op: "replace"; path: `/${string}`; value: unknown }
  | { op: "remove"; path: `/${string}` }
  | { op: "splice"; path: `/${string}`; index: number; deleteCount: number; items: unknown[] };

function same(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePathSegment(value: string | number) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function unescapePathSegment(value: string) {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function childPath(path: string, key: string | number): `/${string}` {
  return `${path}/${escapePathSegment(key)}` as `/${string}`;
}

function stableIdentity(value: unknown) {
  if (!isRecord(value)) return undefined;
  const id = value.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : undefined;
}

function arraysCanRecurse(before: readonly unknown[], after: readonly unknown[]) {
  if (before.length !== after.length) return false;
  return before.every((left, index) => {
    const right = after[index];
    const leftId = stableIdentity(left);
    const rightId = stableIdentity(right);
    if (leftId !== undefined || rightId !== undefined) return leftId !== undefined && leftId === rightId;
    return (!isRecord(left) && !Array.isArray(left)) && (!isRecord(right) && !Array.isArray(right));
  });
}

function createPatchAt(
  before: unknown,
  after: unknown,
  path: string,
  operations: ReplayStatePatchOperation[],
) {
  if (same(before, after)) return;

  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const nextPath = childPath(path, key);
      if (!(key in after)) operations.push({ op: "remove", path: nextPath });
      else if (!(key in before)) operations.push({ op: "replace", path: nextPath, value: after[key] });
      else createPatchAt(before[key], after[key], nextPath, operations);
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    if (arraysCanRecurse(before, after)) {
      for (let index = 0; index < before.length; index += 1) {
        createPatchAt(before[index], after[index], childPath(path, index), operations);
      }
      return;
    }

    let prefix = 0;
    while (prefix < before.length && prefix < after.length && same(before[prefix], after[prefix])) prefix += 1;
    let suffix = 0;
    while (
      suffix < before.length - prefix
      && suffix < after.length - prefix
      && same(before[before.length - 1 - suffix], after[after.length - 1 - suffix])
    ) suffix += 1;
    operations.push({
      op: "splice",
      path: path as `/${string}`,
      index: prefix,
      deleteCount: before.length - prefix - suffix,
      items: structuredClone(after.slice(prefix, after.length - suffix)),
    });
    return;
  }

  operations.push({ op: "replace", path: path as `/${string}`, value: structuredClone(after) });
}

/**
 * Canonical full match state used by permanent replay playback. Engine receipts,
 * the derived readable log, connection presence, and post-game account
 * settlement are deliberately excluded because they are not battlefield state.
 */
export function replayPresentationState(input: MatchState): MatchState {
  const copy = cloneMatch(input) as EngineBackedMatchState;
  delete copy[ENGINE_METADATA_KEY];
  copy.log = [];
  const ranked = (copy as MatchState & {
    ranked?: { stage?: string; settlement?: unknown };
  }).ranked;
  if (ranked) {
    delete ranked.settlement;
    if (copy.phase === "result" && Math.max(...Object.values(copy.series).map(Number)) >= 2) ranked.stage = "complete";
  }
  for (const player of copy.players) {
    player.connected = true;
    player.lastSeen = 0;
  }
  return copy;
}

/**
 * Record the exact replay-relevant transition produced by the authoritative
 * reducer. A deep patch avoids duplicating the complete MatchState after every
 * command while remaining independent from future rule/catalogue execution.
 */
export function createReplayStatePatch(before: MatchState, after: MatchState): ReplayStatePatchOperation[] {
  const previous = replayPresentationState(before);
  const next = replayPresentationState(after);
  const operations: ReplayStatePatchOperation[] = [];
  createPatchAt(previous, next, "", operations);
  return operations;
}

function pathSegments(path: `/${string}`) {
  if (!path.startsWith("/")) throw new Error(`Invalid replay state patch path ${path}.`);
  return path.slice(1).split("/").map(unescapePathSegment);
}

function assertSafeSegment(segment: string) {
  if (segment === "__proto__" || segment === "prototype" || segment === "constructor") {
    throw new Error(`Unsafe replay state patch path segment ${segment}.`);
  }
}

function valueAtPath(root: unknown, segments: readonly string[]) {
  let current = root;
  for (const segment of segments) {
    assertSafeSegment(segment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error(`Invalid array replay state patch path /${segments.join("/")}.`);
      }
      current = current[index];
    } else if (isRecord(current)) {
      if (!(segment in current)) throw new Error(`Missing replay state patch path /${segments.join("/")}.`);
      current = current[segment];
    } else {
      throw new Error(`Replay state patch path /${segments.join("/")} does not resolve to an object.`);
    }
  }
  return current;
}

function parentAtPath(root: unknown, segments: readonly string[]) {
  if (segments.length === 0) throw new Error("Replay state patches cannot replace the document root.");
  return {
    parent: valueAtPath(root, segments.slice(0, -1)),
    key: segments.at(-1)!,
  };
}

export function isReplayStatePatch(value: unknown): value is ReplayStatePatchOperation[] {
  if (!Array.isArray(value)) return false;
  return value.every((operation) => {
    if (!isRecord(operation) || typeof operation.path !== "string" || !operation.path.startsWith("/")) return false;
    if (operation.op === "remove") return true;
    if (operation.op === "replace") return "value" in operation;
    const index = Number(operation.index);
    const deleteCount = Number(operation.deleteCount);
    return operation.op === "splice"
      && Number.isInteger(index) && index >= 0
      && Number.isInteger(deleteCount) && deleteCount >= 0
      && Array.isArray(operation.items);
  });
}

export function applyReplayStatePatch<T extends object>(
  state: T,
  patch: readonly ReplayStatePatchOperation[],
): T {
  const next = structuredClone(state) as unknown;
  for (const operation of patch) {
    const segments = pathSegments(operation.path);
    if (operation.op === "splice") {
      const target = valueAtPath(next, segments);
      if (!Array.isArray(target)) throw new Error(`Replay state patch splice target ${operation.path} is not an array.`);
      if (operation.index > target.length || operation.deleteCount > target.length - operation.index) {
        throw new Error(`Replay state patch splice ${operation.path} is outside the target array.`);
      }
      target.splice(operation.index, operation.deleteCount, ...structuredClone(operation.items));
      continue;
    }

    const { parent, key } = parentAtPath(next, segments);
    assertSafeSegment(key);
    if (Array.isArray(parent)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new Error(`Invalid array replay state patch path ${operation.path}.`);
      }
      if (operation.op === "remove") parent.splice(index, 1);
      else parent[index] = structuredClone(operation.value);
      continue;
    }
    if (!isRecord(parent)) throw new Error(`Replay state patch parent ${operation.path} is not an object.`);
    if (operation.op === "remove") delete parent[key];
    else parent[key] = structuredClone(operation.value);
  }
  return next as T;
}
