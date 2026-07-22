import type { MatchState } from "../../lib/game";
import type { ZoneOwner } from "./gameScreenState";

export const CORE_TRANSFER_DELAY_MS = 1000;
export const CORE_TRANSFER_DURATION_MS = 920;

export type RollPresentationRecord = {
  signature: string;
  dismissedAt: number | null;
};

export type RollPresentationStage = {
  open: boolean;
  deferredCoreCells: readonly string[];
  transferringCoreCells: readonly string[];
  transferDelayMs: number | null;
  transferEndMs: number | null;
};

export type CoreTransferDestination = {
  owner: ZoneOwner;
  slot: 1 | 2 | 3;
  bakuganId: string;
};

const EMPTY_STAGE: RollPresentationStage = {
  open: false,
  deferredCoreCells: [],
  transferringCoreCells: [],
  transferDelayMs: null,
  transferEndMs: null,
};

export function rollPresentationStorageKey(matchId: string, playerId?: string) {
  return `bbp-roll-presentation-v1:${matchId}:${playerId ?? "local"}`;
}

/**
 * Reconstruct the complete visual stage from a persisted dismissal timestamp.
 * A component remount therefore cannot strand an attached Core in an invisible
 * deferred state or replay an already completed transfer indefinitely.
 */
export function rollPresentationStage(
  signature: string,
  cells: readonly string[],
  record: RollPresentationRecord | null,
  now: number,
): RollPresentationStage {
  if (!signature) return EMPTY_STAGE;
  const uniqueCells = [...new Set(cells)];
  if (!record || record.signature !== signature || record.dismissedAt == null) {
    return {
      open: true,
      deferredCoreCells: uniqueCells,
      transferringCoreCells: [],
      transferDelayMs: null,
      transferEndMs: null,
    };
  }

  const elapsed = Math.max(0, now - record.dismissedAt);
  if (elapsed < CORE_TRANSFER_DELAY_MS) {
    return {
      open: false,
      deferredCoreCells: uniqueCells,
      transferringCoreCells: [],
      transferDelayMs: CORE_TRANSFER_DELAY_MS - elapsed,
      transferEndMs: null,
    };
  }

  const transferElapsed = elapsed - CORE_TRANSFER_DELAY_MS;
  if (transferElapsed < CORE_TRANSFER_DURATION_MS) {
    return {
      open: false,
      deferredCoreCells: [],
      transferringCoreCells: uniqueCells,
      transferDelayMs: null,
      transferEndMs: CORE_TRANSFER_DURATION_MS - transferElapsed,
    };
  }

  return EMPTY_STAGE;
}

export function rollPresentationIsPending(
  signature: string,
  record: RollPresentationRecord | null,
  stage: Pick<RollPresentationStage, "open" | "deferredCoreCells" | "transferringCoreCells">,
) {
  return Boolean(
    signature
    && (
      record?.signature !== signature
      || record.dismissedAt == null
      || stage.open
      || stage.deferredCoreCells.length
      || stage.transferringCoreCells.length
    )
  );
}

export function coreTransferDestination(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  cell: string,
): CoreTransferDestination | null {
  if (!match?.players.length) return null;
  const placement = match.placements.find((candidate) => candidate.cell === cell);
  if (!placement?.attachedTo) return null;
  const localPlayer = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];

  for (const player of match.players) {
    const slotIndex = player.bakugan.findIndex((bakugan) => bakugan.id === placement.attachedTo);
    if (slotIndex < 0 || slotIndex > 2) continue;
    return {
      owner: player.id === localPlayer.id ? "player" : "opponent",
      slot: (slotIndex + 1) as 1 | 2 | 3,
      bakuganId: placement.attachedTo,
    };
  }

  return null;
}
