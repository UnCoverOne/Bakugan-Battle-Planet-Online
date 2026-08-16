import type { MatchState } from "../game";
import {
  createLocalEngineHistoryTransition,
} from "../local-replay-history";
import { journalLocalEngineTransition } from "../replay-journal";
import { apiActionToCommand, type ApiAction } from "./commands";
import { reduceMatch } from "./reducer";
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
    // Capture the transition from the same normalized replay-state shape used
    // by the persisted genesis, then let the worker validate its before hash
    // against the durable chain head before appending it.
    const transition = createLocalEngineHistoryTransition(
      input,
      result.state,
      envelope,
      result.events,
    );
    journalLocalEngineTransition(input, transition, ownerId);
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
