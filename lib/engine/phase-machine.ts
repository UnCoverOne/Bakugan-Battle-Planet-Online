import type { MatchState, Phase } from "../game";
import { EngineCommandError, EngineInvariantError, type GameCommand, type StructuredPhase } from "./types";

const STRICT_COMMAND_PHASES: Partial<Record<GameCommand["type"], readonly Phase[]>> = {
  SET_READY: ["lobby"],
  BEGIN_CORE_PLACEMENT: ["startingPlayer"],
  PLACE_CORE: ["placement"],
  DRAW_TURN_CARD: ["draw"],
  ENERGIZE: ["energize"],
  SELECT_BAKUGAN: ["selection"],
  SELECT_ROLL_TARGET: ["target"],
  CONFIRM_ROLL: ["target"],
  REVEAL_DAMAGE_FLIP: ["damage"],
  PLAY_DAMAGE_FLIP: ["damage"],
  DISCARD_TO_HAND_LIMIT: ["handLimit"],
  START_NEXT_SERIES_GAME: ["result"],
  JOIN_PLAYER: ["lobby"],
  NEXT_TURN: ["postDamage", "retract", "endPlay", "handLimit"],
};

const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  lobby: ["lobby", "startingPlayer", "result"],
  startingPlayer: ["startingPlayer", "placement", "result"],
  placement: ["placement", "draw", "result"],
  draw: ["draw", "energize", "selection", "result"],
  energize: ["energize", "selection", "result"],
  selection: ["selection", "preRoll", "result"],
  preRoll: ["preRoll", "target", "power", "result"],
  target: ["target", "power", "result"],
  power: ["power", "victor", "damage", "postDamage", "retract", "endPlay", "result"],
  victor: ["victor", "damage", "postDamage", "retract", "endPlay", "result"],
  damage: ["damage", "postDamage", "retract", "endPlay", "handLimit", "result"],
  postDamage: ["postDamage", "retract", "endPlay", "handLimit", "draw", "result"],
  retract: ["retract", "endPlay", "handLimit", "draw", "result"],
  endPlay: ["endPlay", "handLimit", "draw", "result"],
  handLimit: ["handLimit", "draw", "result"],
  result: ["result", "lobby", "startingPlayer", "placement", "draw"],
};

export function structuredPhaseFor(phase: Phase): StructuredPhase {
  switch (phase) {
    case "lobby": return { area: "lobby", step: "ready", legacy: phase };
    case "startingPlayer": return { area: "setup", step: "starting-player", legacy: phase };
    case "placement": return { area: "setup", step: "core-placement", legacy: phase };
    case "draw": return { area: "setup", step: "draw", legacy: phase };
    case "energize": return { area: "setup", step: "energize", legacy: phase };
    case "selection": return { area: "roll", step: "selection", legacy: phase };
    case "preRoll": return { area: "roll", step: "pre-roll-priority", legacy: phase };
    case "target": return { area: "roll", step: "targeting-and-rolling", legacy: phase };
    case "power": return { area: "brawl", step: "power", legacy: phase };
    case "victor": return { area: "brawl", step: "victor", legacy: phase };
    case "damage": return { area: "brawl", step: "damage", legacy: phase };
    case "postDamage": return { area: "brawl", step: "post-damage", legacy: phase };
    case "retract": return { area: "brawl", step: "retract", legacy: phase };
    case "endPlay": return { area: "brawl", step: "end-play", legacy: phase };
    case "handLimit": return { area: "brawl", step: "hand-limit", legacy: phase };
    case "result": return { area: "result", step: "match-result", legacy: phase };
  }
}

export function assertCommandAllowedInPhase(state: MatchState, command: GameCommand) {
  const allowed = STRICT_COMMAND_PHASES[command.type];
  if (allowed && !allowed.includes(state.phase)) {
    throw new EngineCommandError(
      "COMMAND_NOT_ALLOWED_IN_PHASE",
      `${command.type} is not legal during ${state.phase}.`,
    );
  }
}

export function assertValidPhaseTransition(
  before: MatchState,
  after: MatchState,
  command: GameCommand,
) {
  if (command.type === "RESOLVE_DEADLINE") return;
  if (TRANSITIONS[before.phase].includes(after.phase)) return;
  throw new EngineInvariantError(
    "INVALID_PHASE_TRANSITION",
    `Command ${command.type} attempted an invalid phase transition from ${before.phase} to ${after.phase}.`,
  );
}
