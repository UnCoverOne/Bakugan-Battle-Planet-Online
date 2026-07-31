import {
  CENTER_CELL,
  HEX_CELLS,
  cloneMatch,
  placeCore,
  type Core,
  type MatchState,
  type Phase,
} from "./game";

export type PendingCoreReturn = {
  id: string;
  placerId: string;
  ownerId: string;
  core: Core;
  originalCell: string;
  sourceBakuganId: string;
  sequence: number;
};

type CoreReturnResume = {
  phase: Phase;
  stepLabel: string;
  priority: string;
  passes: string[];
  deadline: number;
};

export type CoreReturnMatchState = MatchState & {
  pendingCoreReturns?: PendingCoreReturn[];
  coreReturnResume?: CoreReturnResume;
};

const RETURN_WINDOW_MS = 45_000;
const RESUME_WINDOW_MS = 35_000;

const asCoreReturnState = (state: MatchState) => state as CoreReturnMatchState;

const returnKey = (item: Pick<PendingCoreReturn, "core" | "originalCell" | "sourceBakuganId">) =>
  `${item.core.id}:${item.originalCell}:${item.sourceBakuganId}`;

const hexDistance = (a: { q: number; r: number }, b: { q: number; r: number }) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs((a.q + a.r) - (b.q + b.r))) / 2;

function playerForBakugan(state: MatchState, bakuganId: string) {
  return state.players.find((player) => player.bakugan.some((bakugan) => bakugan.id === bakuganId));
}

function legalReturnCells(state: MatchState) {
  const fieldPlacements = state.placements.filter((placement) => !placement.attachedTo);
  if (!fieldPlacements.length) return [CENTER_CELL];
  const occupied = new Set(fieldPlacements.map((placement) => placement.cell));
  return HEX_CELLS.filter((cell) => (
    !occupied.has(cell.id)
    && fieldPlacements.some((placement) => {
      const neighbour = HEX_CELLS.find((candidate) => candidate.id === placement.cell);
      return Boolean(neighbour && hexDistance(cell, neighbour) === 1);
    })
  )).map((cell) => cell.id);
}

/**
 * A held Core is no longer physically occupying its old hex. If another Core
 * returns to that hex, move the held placement to an internal identity cell so
 * the engine can keep Core references unique without reserving an empty field
 * position.
 */
function releaseHeldCellReference(state: MatchState, fieldCell: string) {
  for (const placement of state.placements.filter((candidate) => (
    candidate.cell === fieldCell && Boolean(candidate.attachedTo)
  ))) {
    const heldCell = `held:${placement.core.id}`;
    const holder = state.players
      .flatMap((player) => player.bakugan)
      .find((bakugan) => bakugan.id === placement.attachedTo);
    if (holder) {
      let replaced = false;
      holder.heldCoreCells = holder.heldCoreCells.map((cell) => {
        if (cell !== fieldCell) return cell;
        replaced = true;
        return heldCell;
      });
      if (!replaced && !holder.heldCoreCells.includes(heldCell)) holder.heldCoreCells.push(heldCell);
    }
    placement.cell = heldCell;
  }
}

function preferredPlayerOrder(state: MatchState) {
  const ids = state.phase === "postDamage"
    ? [state.pendingLoser, state.brawlWinner, state.priority, state.startingPlayer]
    : [state.priority, state.startingPlayer, ...state.players.map((player) => player.id)];
  return [...new Set(ids.filter(Boolean))];
}

function addLog(state: MatchState, message: string) {
  state.log.push({
    id: `core-return-${state.version}-${state.log.length}-${Date.now()}`,
    at: Date.now(),
    kind: "game",
    message,
  });
}

function restoreInterruptedPhase(state: CoreReturnMatchState) {
  const resume = state.coreReturnResume;
  if (resume) {
    const now = Date.now();
    const refreshedDeadline = Math.max(resume.deadline, now + RESUME_WINDOW_MS);
    state.phase = resume.phase;
    state.stepLabel = resume.stepLabel;
    state.priority = resume.priority;
    state.passes = [...resume.passes];
    state.deadline = refreshedDeadline;
    if (resume.phase === "draw") {
      state.drawReadyAt = Math.min(state.drawReadyAt ?? now, now);
      state.drawDeadline = refreshedDeadline;
    }
  }
  delete state.pendingCoreReturns;
  delete state.coreReturnResume;
}

function nextReturnPlayer(state: CoreReturnMatchState) {
  const pending = [...(state.pendingCoreReturns ?? [])].sort((a, b) => a.sequence - b.sequence);
  return pending[0]?.placerId;
}

function placeReturnedCoreMutable(
  state: CoreReturnMatchState,
  playerId: string,
  coreId: string,
  cell: string,
) {
  if (state.phase !== "retract" || state.priority !== playerId) {
    throw new Error("It is not your BakuCore return turn.");
  }
  if (!legalReturnCells(state).includes(cell)) {
    throw new Error("That Core position is not legal on the connected hex grid.");
  }
  const pending = state.pendingCoreReturns ?? [];
  const item = pending.find((candidate) => candidate.placerId === playerId && candidate.core.id === coreId);
  if (!item) throw new Error("Choose a BakuCore that you must return.");
  if (state.placements.some((placement) => placement.core.id === item.core.id)) {
    throw new Error("That BakuCore is already on the field.");
  }

  releaseHeldCellReference(state, cell);
  const order = state.placements.reduce((highest, placement) => Math.max(highest, placement.order), 0) + 1;
  state.placements.push({
    playerId: item.ownerId,
    core: item.core,
    cell,
    order,
    revealed: false,
  });
  state.pendingCoreReturns = pending.filter((candidate) => candidate.id !== item.id);
  addLog(state, `${state.players.find((player) => player.id === playerId)?.name ?? "A player"} returned a BakuCore to a legal position in the Hide Matrix.`);

  if (!state.pendingCoreReturns.length) {
    restoreInterruptedPhase(state);
    return;
  }

  const samePlayerHasMore = state.pendingCoreReturns.some((candidate) => candidate.placerId === playerId);
  state.priority = samePlayerHasMore ? playerId : nextReturnPlayer(state) ?? playerId;
  state.stepLabel = `Retracting Step • ${state.pendingCoreReturns.length} BakuCore${state.pendingCoreReturns.length === 1 ? "" : "s"} to return`;
  state.passes = [];
  state.deadline = Date.now() + RETURN_WINDOW_MS;
}

function autoPlaceTrainingBotReturns(state: CoreReturnMatchState) {
  while (state.phase === "retract" && state.priority === "training-bot") {
    const item = (state.pendingCoreReturns ?? [])
      .filter((candidate) => candidate.placerId === "training-bot")
      .sort((a, b) => a.sequence - b.sequence)[0];
    const cell = legalReturnCells(state)[0];
    if (!item || !cell) break;
    placeReturnedCoreMutable(state, "training-bot", item.core.id, cell);
  }
  return state;
}

/**
 * Convert the legacy "detach in the old hex" behaviour into an explicit return
 * decision. The completed game action is retained as a suspended continuation,
 * so returning every Core resumes exactly where that action would have landed.
 */
export function captureCoreReturns(before: MatchState | null, after: MatchState): MatchState {
  if (!before || before.id !== after.id || before.gameNumber !== after.gameNumber) return after;
  if (["startingPlayer", "placement"].includes(after.phase)) return after;

  const current = asCoreReturnState(after);
  const existingKeys = new Set((current.pendingCoreReturns ?? []).map(returnKey));
  const candidates: Omit<PendingCoreReturn, "id" | "sequence">[] = [];

  for (const placement of before.placements) {
    if (!placement.attachedTo) continue;
    const afterPlacement = after.placements.find((candidate) => candidate.core.id === placement.core.id)
      ?? after.placements.find((candidate) => candidate.cell === placement.cell);
    if (afterPlacement?.attachedTo) continue;

    const holder = playerForBakugan(before, placement.attachedTo);
    if (!holder) continue;
    const candidate = {
      placerId: holder.id,
      ownerId: placement.playerId,
      core: placement.core,
      originalCell: placement.cell,
      sourceBakuganId: placement.attachedTo,
    };
    if (!existingKeys.has(returnKey(candidate))) candidates.push(candidate);
  }

  if (!candidates.length) return after;

  const order = preferredPlayerOrder(before);
  candidates.sort((a, b) => {
    const playerDifference = (order.indexOf(a.placerId) < 0 ? Number.MAX_SAFE_INTEGER : order.indexOf(a.placerId))
      - (order.indexOf(b.placerId) < 0 ? Number.MAX_SAFE_INTEGER : order.indexOf(b.placerId));
    if (playerDifference) return playerDifference;
    const aPlacement = before.placements.find((placement) => placement.core.id === a.core.id)?.order ?? 0;
    const bPlacement = before.placements.find((placement) => placement.core.id === b.core.id)?.order ?? 0;
    return aPlacement - bPlacement;
  });

  const state = asCoreReturnState(cloneMatch(after));
  const removedCoreIds = new Set(candidates.map((candidate) => candidate.core.id));
  state.placements = state.placements.filter((placement) => !removedCoreIds.has(placement.core.id));
  for (const player of state.players) for (const bakugan of player.bakugan) {
    bakugan.heldCoreCells = bakugan.heldCoreCells.filter((cell) => (
      !candidates.some((candidate) => candidate.sourceBakuganId === bakugan.id && candidate.originalCell === cell)
    ));
  }

  const previousPending = state.pendingCoreReturns ?? [];
  const firstSequence = previousPending.reduce((highest, item) => Math.max(highest, item.sequence), 0) + 1;
  state.pendingCoreReturns = [
    ...previousPending,
    ...candidates.map((candidate, index) => ({
      ...candidate,
      id: `core-return:${state.gameNumber}:${state.turn}:${candidate.core.id}:${candidate.originalCell}:${state.version}`,
      sequence: firstSequence + index,
    })),
  ];

  if (!state.coreReturnResume) {
    state.coreReturnResume = {
      phase: after.phase,
      stepLabel: after.stepLabel,
      priority: after.priority,
      passes: [...after.passes],
      deadline: after.deadline,
    };
  }
  state.phase = "retract";
  state.priority = previousPending.length ? state.priority : nextReturnPlayer(state) ?? candidates[0].placerId;
  state.stepLabel = `Retracting Step • ${state.pendingCoreReturns.length} BakuCore${state.pendingCoreReturns.length === 1 ? "" : "s"} to return`;
  state.passes = [];
  state.deadline = Date.now() + RETURN_WINDOW_MS;
  addLog(state, "Retracted BakuCores must now be placed back one at a time in legal positions.");
  return autoPlaceTrainingBotReturns(state);
}

export function pendingCoreReturnsForPlayer(match: MatchState | null, playerId?: string) {
  if (!match || !playerId) return [];
  return [...(asCoreReturnState(match).pendingCoreReturns ?? [])]
    .filter((item) => item.placerId === playerId)
    .sort((a, b) => a.sequence - b.sequence);
}

export function legalCoreReturnCells(match: MatchState | null) {
  return match?.phase === "retract" ? legalReturnCells(match) : [];
}

export function placeCoreOrReturnCore(
  input: MatchState,
  playerId: string,
  coreId: string,
  cell: string,
) {
  if (input.phase !== "retract") return placeCore(input, playerId, coreId, cell);
  const state = asCoreReturnState(cloneMatch(input));
  placeReturnedCoreMutable(state, playerId, coreId, cell);
  autoPlaceTrainingBotReturns(state);
  state.version += 1;
  return state;
}
