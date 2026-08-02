import type { MatchState } from "../../lib/game";

export const DRAGONOID_MAXIMUS_CARD_ID = "ex-2";
export const DRAGONOID_MAXIMUS_ANIMATION_MS = 3_000;
export const DRAGONOID_MAXIMUS_RESULT_DELAY_MS = 5_000;

export function isDragonoidMaximusResult(match: MatchState | null | undefined) {
  return Boolean(
    match
    && match.phase === "result"
    && /Dragonoid Maximus/i.test(match.resultReason ?? ""),
  );
}

export function dragonoidMaximusResolvedAt(match: MatchState | null | undefined) {
  if (!match) return 0;
  const event = [...match.log].reverse().find((entry) => (
    entry.kind === "system" && /Dragonoid Maximus/i.test(entry.message)
  ));
  return event?.at ?? match.log.at(-1)?.at ?? 0;
}

export function dragonoidMaximusResultRemaining(
  match: MatchState | null | undefined,
  now = Date.now(),
) {
  if (!isDragonoidMaximusResult(match)) return 0;
  const resolvedAt = dragonoidMaximusResolvedAt(match);
  return resolvedAt ? Math.max(0, resolvedAt + DRAGONOID_MAXIMUS_RESULT_DELAY_MS - now) : 0;
}
