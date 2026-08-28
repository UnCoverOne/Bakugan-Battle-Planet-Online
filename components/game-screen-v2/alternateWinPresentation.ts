import type { GameCard, MatchState, PlayerState } from "../../lib/game";

export const DRAGONOID_MAXIMUS_CARD_ID = "ex-2";
export const DRAGONOID_MAXIMUS_HERO_CARD_IDS = ["bb-207", "bb-215", "bb-202"] as const;
export const DRAGONOID_MAXIMUS_ANIMATION_MS = 2_800;
export const DRAGONOID_MAXIMUS_RESULT_DELAY_MS = 3_400;
export const DRAGONOID_MAXIMUS_PRESENTATION_MS = 3_800;
export const DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS = 700;
export const DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS = 900;
export const DRAGONOID_MAXIMUS_SKIP_EVENT = "bakugan:dragonoid-maximus-skip";

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

export function dragonoidMaximusWinner(match: MatchState | null | undefined): PlayerState | null {
  if (!match?.winner) return null;
  return match.players.find((player) => player.id === match.winner) ?? null;
}

export function dragonoidMaximusHeroCards(match: MatchState | null | undefined): GameCard[] {
  const winner = dragonoidMaximusWinner(match);
  if (!winner) return [];
  return DRAGONOID_MAXIMUS_HERO_CARD_IDS.flatMap((catalogId) => {
    const hero = winner.heroes.find((candidate) => candidate.catalogId === catalogId);
    return hero ? [hero] : [];
  });
}

export function dragonoidMaximusCard(match: MatchState | null | undefined): GameCard | null {
  const winner = dragonoidMaximusWinner(match);
  if (!match || !winner) return null;
  const selectedBakuganId = match.selected[winner.id];
  const selected = winner.bakugan.find((bakugan) => bakugan.id === selectedBakuganId);
  const orderedBakugan = selected
    ? [selected, ...winner.bakugan.filter((bakugan) => bakugan.id !== selected.id)]
    : winner.bakugan;
  for (const bakugan of orderedBakugan) {
    const top = bakugan.evoStack.at(-1);
    if (top?.catalogId === DRAGONOID_MAXIMUS_CARD_ID) return top;
  }
  return null;
}

export function dragonoidMaximusResultDelay(reducedMotion = false) {
  return reducedMotion
    ? DRAGONOID_MAXIMUS_REDUCED_MOTION_RESULT_DELAY_MS
    : DRAGONOID_MAXIMUS_RESULT_DELAY_MS;
}

export function dragonoidMaximusPresentationDuration(reducedMotion = false) {
  return reducedMotion
    ? DRAGONOID_MAXIMUS_REDUCED_MOTION_PRESENTATION_MS
    : DRAGONOID_MAXIMUS_PRESENTATION_MS;
}

export function dragonoidMaximusResultRemaining(
  match: MatchState | null | undefined,
  now = Date.now(),
  delayMs = DRAGONOID_MAXIMUS_RESULT_DELAY_MS,
) {
  if (!isDragonoidMaximusResult(match)) return 0;
  const resolvedAt = dragonoidMaximusResolvedAt(match);
  return resolvedAt ? Math.max(0, resolvedAt + delayMs - now) : 0;
}
