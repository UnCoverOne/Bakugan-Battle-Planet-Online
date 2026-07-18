import {
  cloneMatch,
  targetCore,
  type MatchState,
  type Placement,
  type RollOutcome,
} from "./game";

const ROLL_CONFIRMATION_MS = 30_000;

export function availableRollTargets(
  match: MatchState | null | undefined,
): readonly Placement[] {
  return match?.placements.filter((placement) => !placement.attachedTo) ?? [];
}

export function allRollTargetsSelected(
  match: MatchState | null | undefined,
) {
  return Boolean(
    match?.players.length
    && match.players.every((player) => Boolean(match.targets[player.id])),
  );
}

export function playerCanSelectRollTarget(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  return Boolean(
    match
    && playerId
    && match.phase === "target"
    && !match.targets[playerId]
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
  return match?.phase === "target" && allRollTargetsSelected(match)
    ? match.passes
    : [];
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
  state.passes = [];
  state.version += 1;
  state.deadline = Date.now() + ROLL_CONFIRMATION_MS;
  const player = state.players.find((candidate) => candidate.id === playerId);
  state.log.push({
    id: `${Date.now()}-target-${state.version}`,
    at: Date.now(),
    kind: "game",
    message: `${player?.name ?? "Player"} locked a secret BakuCore target.`,
  });

  state.stepLabel = allRollTargetsSelected(state)
    ? "Roll Phase • Rolling Step"
    : "Roll Phase • BakuCore Selection";
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

  if (state.passes.length < state.players.length) {
    state.version += 1;
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
    .map((roll) => `${roll.playerId}:${roll.result}:${roll.accuracyRoll}:${roll.doubleRoll}:${roll.cores.join(",")}`)
    .join("|")}`;
}

export function rollResultCells(
  match: MatchState | null | undefined,
) {
  if (!match) return [];
  return [...new Set(match.players.flatMap((player) => match.rolls[player.id]?.cores ?? []))];
}
