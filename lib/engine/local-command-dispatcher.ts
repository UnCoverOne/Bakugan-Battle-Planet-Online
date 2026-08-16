import type { MatchState } from "../game";
import { journalLocalEngineTransition } from "../replay-journal";
import { apiActionToCommand, type ApiAction } from "./commands";
import { reduceMatch } from "./reducer";
import { createReplayStatePatch } from "./replay-transition";
import type { CommandEnvelope, GameCommand } from "./types";

function token() {
  return globalThis.crypto.randomUUID();
}

export function dispatchLocalGameCommand(
  input: MatchState,
  actorId: string,
  command: GameCommand,
  ownerId = input.players.find((player) => player.id !== "training-bot")?.id ?? actorId,
) {
  const issuedAt = Date.now();
  const envelope: CommandEnvelope = {
    commandId: `local:${input.id}:${input.version}:${token()}`,
    gameId: input.id,
    actorId,
    expectedVersion: input.version,
    issuedAt,
    randomSeed: token(),
    requestHash: `local:${input.version}:${command.type}:${token()}`,
    command,
  };
  const result = reduceMatch(input, envelope);
  if (result.changed) {
    // The local engine history stores the same accepted transition event shape
    // as the server event store. Refresh the patch from the authoritative
    // before/after states so even engine-fault transitions remain replayable.
    const replayStatePatch = createReplayStatePatch(input, result.state);
    const events = result.events.map((event) => event.type === "COMMAND_ACCEPTED"
      ? { ...event, payload: { ...event.payload, replayStatePatch } }
      : event);
    journalLocalEngineTransition(input, envelope, result.state.version, events, ownerId);
  }
  return result.state;
}

export function dispatchLocalGameAction(
  input: MatchState,
  actorId: string,
  action: ApiAction,
  payload: Record<string, unknown> = {},
) {
  return dispatchLocalGameCommand(input, actorId, apiActionToCommand(action, payload));
}
