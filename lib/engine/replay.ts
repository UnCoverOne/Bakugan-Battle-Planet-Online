import type { MatchState } from "../game";
import { normalizeEngineState } from "./events";
import { projectEventsForPlayer } from "./projection";
import { reduceMatch } from "./reducer";
import type { CommandEnvelope, EngineBackedMatchState, GameEvent } from "./types";

export type ReplayResult = {
  state: EngineBackedMatchState;
  events: GameEvent[];
  appliedCommandIds: string[];
};

export function replayCommands(initial: MatchState, commands: readonly CommandEnvelope[]): ReplayResult {
  let state = normalizeEngineState(initial);
  const events: GameEvent[] = [];
  const appliedCommandIds: string[] = [];
  for (const command of commands) {
    const result = reduceMatch(state, command);
    state = result.state;
    events.push(...result.events);
    if (!result.duplicate) appliedCommandIds.push(command.commandId);
  }
  return { state, events, appliedCommandIds };
}

export function replayForPlayer(result: ReplayResult, playerId: string) {
  return {
    events: projectEventsForPlayer(result.events, playerId),
    appliedCommandIds: [...result.appliedCommandIds],
  };
}
