import {
  cloneMatch,
  targetCore,
  type MatchState,
  type Placement,
  type RollOutcome,
} from "./game";

const ROLL_CONFIRMATION_MS = 30_000;
const ROLL_TARGET_LOCK_PREFIX = "roll-target-locked:";
const CHOOSE_ROLL_TARGETS_LABEL = "Roll Phase • Rolling Step • Choose BakuCore targets";
const CONFIRM_ROLLS_LABEL = "Roll Phase • Rolling Step • Confirm rolls";
const WAITING_FOR_ROLLS_LABEL = "Roll Phase • Rolling Step • Waiting for all players to roll";

function targetLockMarker(playerId: string) {
  return `${ROLL_TARGET_LOCK_PREFIX}${playerId}`;
}

function rollTargetLockedPlayers(
  match: MatchState | null | undefined,
): ReadonlySet<string> {
  if (!match || match.phase !== "target") return new Set();
  return new Set(match.players.flatMap((player) => (
    match.targets[player.id] || match.passes.includes(targetLockMarker(player.id))
      ? [player.id]
      : []
  )));
}

export function availableRollTargets(
  match: MatchState | null | undefined,
): readonly Placement[] {
  return match?.placements.filter((placement) => !placement.attachedTo) ?? [];
}

export function allRollTargetsSelected(
  match: MatchState | null | undefined,
) {
  if (!match?.players.length || match.phase !== "target") return false;
  const locked = rollTargetLockedPlayers(match);
  return match.players.every((player) => locked.has(player.id));
}

export function playerCanSelectRollTarget(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  return Boolean(
    match
    && playerId
    && match.phase === "target"
    && !rollTargetLockedPlayers(match).has(playerId)
    && availableRollTargets(match).length,
  );
}

export function rollTargetCanConfirm(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  cell: string,
) {
  return Boolean(
    cell
    && playerCanSelectRollTarget(match, playerId)
    && availableRollTargets(match).some((placement) => placement.cell === cell),
  );
}

export function rollReadyPlayers(
  match: MatchState | null | undefined,
): readonly string[] {
  if (match?.phase !== "target" || !allRollTargetsSelected(match)) return [];
  const playerIds = new Set(match.players.map((player) => player.id));
  return match.passes.filter((entry) => playerIds.has(entry));
}

export function playerCanConfirmRoll(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  return Boolean(
    match
    && playerId
    && match.phase === "target"
    && allRollTargetsSelected(match)
    && !rollReadyPlayers(match).includes(playerId),
  );
}

export function selectRollTarget(
  input: MatchState,
  playerId: string,
  cell: string,
): MatchState {
  const state = cloneMatch(input);
  if (!playerCanSelectRollTarget(state, playerId)) {
    throw new Error("BakuCore selection is not legal now.");
  }
  if (!availableRollTargets(state).some((placement) => placement.cell === cell)) {
    throw new Error("Choose an available BakuCore in the Hide Matrix.");
  }

  state.targets[playerId] = cell;
  // Opposing target values are removed from each online player's redacted
  // snapshot. Publish only lock markers through the existing target-phase pass
  // storage so both clients can know when Roll is legal without learning which
  // BakuCore the opponent chose.
  state.passes = state.players
    .filter((player) => Boolean(state.targets[player.id]))
    .map((player) => targetLockMarker(player.id));
  state.version += 1;
  state.deadline = Date.now() + ROLL_CONFIRMATION_MS;
  const player = state.players.find((candidate) => candidate.id === playerId);
  state.log.push({
    id: `${Date.now()}-target-${state.version}`,
    at: Date.now(),
    kind: "game",
    message: `${player?.name ?? "Player"} locked a secret BakuCore target.`,
  });

  // Target choice is an action inside the Rolling Step. Avoid ambiguous status
  // copy such as "BakuCore Selection", which previously made label-based UI
  // progress incorrectly jump back to the Selection Step.
  state.stepLabel = allRollTargetsSelected(state)
    ? CONFIRM_ROLLS_LABEL
    : CHOOSE_ROLL_TARGETS_LABEL;
  return state;
}

export function confirmRoll(
  input: MatchState,
  playerId: string,
): MatchState {
  if (!playerCanConfirmRoll(input, playerId)) {
    throw new Error("Roll confirmation is not legal now.");
  }

  const state = cloneMatch(input);
  state.passes.push(playerId);
  const player = state.players.find((candidate) => candidate.id === playerId);
  state.log.push({
    id: `${Date.now()}-roll-ready-${state.version}`,
    at: Date.now(),
    kind: "game",
    message: `${player?.name ?? "Player"} is ready to roll.`,
  });

  if (rollReadyPlayers(state).length < state.players.length) {
    state.version += 1;
    state.stepLabel = WAITING_FOR_ROLLS_LABEL;
    state.deadline = Date.now() + ROLL_CONFIRMATION_MS;
    return state;
  }

  // targetCore owns the existing random roll resolution. Temporarily remove the
  // final confirmer's target so it can re-enter through that authoritative path
  // only after every player has pressed Roll.
  const cell = state.targets[playerId];
  delete state.targets[playerId];
  state.passes = [];
  return targetCore(state, playerId, cell);
}

export function rollResultSignature(
  match: MatchState | null | undefined,
) {
  if (!match || !match.players.length) return "";
  const outcomes = match.players
    .map((player) => match.rolls[player.id])
    .filter((roll): roll is RollOutcome => Boolean(roll));
  if (outcomes.length !== match.players.length) return "";
  return `${match.gameNumber}:${match.turn}:${outcomes
    .map((roll) => `${roll.playerId}:${roll.result}:${roll.accuracyRoll}:${roll.deviationRoll}:${roll.doubleRoll}:${roll.secondCoreRoll}:${roll.cores.join(",")}`)
    .join("|")}`;
}

export function rollResultCells(
  match: MatchState | null | undefined,
) {
  if (!match) return [];
  return [...new Set(match.players.flatMap((player) => match.rolls[player.id]?.cores ?? []))];
}
