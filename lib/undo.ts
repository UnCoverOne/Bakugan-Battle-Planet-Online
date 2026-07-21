import { cloneMatch, type MatchState } from "./game";

export function canUndoLatest(match: MatchState | null | undefined, playerId?: string) {
  const window = match?.undoWindow;
  return Boolean(
    match
    && playerId
    && window
    && window.actorId === playerId
    && match.priority === playerId
    && match.informationEpoch === window.informationEpoch
    && match.priorityEpoch === window.priorityEpoch
    && !window.irreversibleInformation
    && match.batch.some((effect) => effect.id === window.batchObjectId)
    && window.snapshot,
  );
}

export function undoLatestAction(input: MatchState, playerId: string) {
  if (!canUndoLatest(input, playerId)) {
    throw new Error("Undo is available only for your latest card play, before priority passes or information is revealed.");
  }
  const snapshot = input.undoWindow!.snapshot!;
  const restored = JSON.parse(snapshot) as MatchState;
  const state = cloneMatch(restored);
  state.version = input.version + 1;
  state.undoWindow = undefined;
  state.informationEpoch = input.informationEpoch;
  state.priorityEpoch = input.priorityEpoch;
  state.log.push({
    id: `${Date.now()}-undo-${state.version}`,
    at: Date.now(),
    kind: "system",
    message: `${state.players.find((player) => player.id === playerId)?.name ?? "Player"} returned their latest card from the batch before passing priority.`,
  });
  return state;
}

export function closeUndoForPriority(input: MatchState) {
  input.priorityEpoch += 1;
  input.undoWindow = undefined;
  return input;
}

export function revealHiddenInformation(input: MatchState) {
  input.informationEpoch += 1;
  if (input.undoWindow) input.undoWindow.irreversibleInformation = true;
  input.undoWindow = undefined;
  return input;
}
