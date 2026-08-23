import type { CardChoices, MatchState } from "../game";

/** Players affected by an effect, independent of who makes any choices for it. */
export type PlayerScope =
  | "controller"
  | "opponent"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any-player";

/** Player(s) responsible for making a choice. */
export type ChooserOwner = "controller" | "opponent" | "chosen-player" | "each-player";

/** Owner of the zone/object pool from which a choice may select. */
export type ZoneOwner =
  | "controller"
  | "opponent"
  | "chooser"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any";

export type OwnershipContext = {
  controllerId: string;
  chooserId?: string;
  chosenPlayerId?: string;
  choices?: CardChoices;
};

function knownPlayerIds(match: MatchState) {
  return match.players.map((player) => player.id);
}

function uniqueKnownPlayers(match: MatchState, values: Array<string | undefined>) {
  const known = new Set(knownPlayerIds(match));
  return values.filter((value): value is string => Boolean(value && known.has(value)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function playerIdsForScope(
  match: MatchState,
  scope: PlayerScope,
  context: OwnershipContext,
): string[] {
  const chosen = context.chosenPlayerId ?? context.choices?.targetPlayerId;
  if (scope === "controller") return uniqueKnownPlayers(match, [context.controllerId]);
  if (scope === "opponent") return knownPlayerIds(match).filter((id) => id !== context.controllerId);
  if (scope === "chosen-player") return uniqueKnownPlayers(match, [chosen]);
  return knownPlayerIds(match);
}

export function chooserIdsFor(
  match: MatchState,
  chooser: ChooserOwner,
  context: OwnershipContext,
): string[] {
  if (chooser === "controller") return playerIdsForScope(match, "controller", context);
  if (chooser === "opponent") return playerIdsForScope(match, "opponent", context);
  if (chooser === "chosen-player") return playerIdsForScope(match, "chosen-player", context);
  return playerIdsForScope(match, "each-player", context);
}

export function zoneOwnerIdsFor(
  match: MatchState,
  owner: ZoneOwner,
  context: OwnershipContext,
): string[] {
  if (owner === "chooser") return uniqueKnownPlayers(match, [context.chooserId]);
  if (owner === "any" || owner === "all-players") return knownPlayerIds(match);
  if (owner === "each-player") {
    return context.chooserId
      ? uniqueKnownPlayers(match, [context.chooserId])
      : knownPlayerIds(match);
  }
  return playerIdsForScope(match, owner, context);
}

export function playerScopeForText(text: string): PlayerScope {
  if (/\beach player\b/i.test(text)) return "each-player";
  if (/\ball players\b|\bboth players\b/i.test(text)) return "all-players";
  if (/\b(?:your )?opponent\b|\bopposing player\b/i.test(text)) return "opponent";
  return "controller";
}

/**
 * Resolve the recipient of a draw independently from actors mentioned by a
 * trigger or condition. For example, in “When an opponent plays ..., you may
 * draw”, the opponent is the trigger actor rather than the draw recipient.
 */
export function drawPlayerScopeForText(text: string): PlayerScope {
  if (/\beach player\b/i.test(text)) return "each-player";
  if (/\ball players\b|\bboth players\b/i.test(text)) return "all-players";
  if (/\b(?:(?:your )?opponent|opposing player)\s+(?:may\s+|must\s+|can\s+|will\s+)?draws?\b/i.test(text)) {
    return "opponent";
  }
  return "controller";
}
