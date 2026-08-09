import { cloneMatch, setReady, type MatchState, type PlayerState } from "./game";
import {
  applyLobbyConfig,
  lobbyConfig,
  playerLobbyDeckFormat,
  requiredDeckFormat,
  type LobbyMeta,
  type LobbyRulesFormat,
} from "./lobby-config";
import { rankedSeries } from "./ranked-lobby";

/** The player who created the room always occupies the first seat. */
export function roomOwnerId(state: MatchState) {
  return state.players[0]?.id ?? "";
}

/**
 * Online lobby SET_READY semantics retained for older clients:
 * - first press marks a player ready and always keeps the room in the lobby;
 * - after both players are ready, a second press from the room owner starts play.
 *
 * New lobby clients use setLobbyReady + startLobbyMatch so Ready/Unready and
 * Start Match are independent controls.
 */
export function setLobbyReadyOrStart(input: MatchState, playerId: string) {
  if (input.phase !== "lobby") throw new Error("Ready is not legal now.");
  if (rankedSeries(input) && rankedSeries(input)?.stage !== "ready") throw new Error("Complete Ranked deck bans and round selection before readying.");
  const player = input.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  if (!player.ready) {
    const otherReady = input.players.find((candidate) => candidate.id !== playerId && candidate.ready);
    if (input.players.length === 2 && otherReady) {
      // game.setReady historically starts as soon as the second player readies.
      // Temporarily mask the other ready seat so we can reuse all validation,
      // logging, versioning, and deck checks without advancing the phase.
      const guarded = cloneMatch(input);
      const guardedOther = guarded.players.find((candidate) => candidate.id === otherReady.id);
      if (guardedOther) guardedOther.ready = false;
      const next = setReady(guarded, playerId);
      const restoredOther = next.players.find((candidate) => candidate.id === otherReady.id);
      if (restoredOther) restoredOther.ready = true;
      return next;
    }
    return setReady(input, playerId);
  }

  if (roomOwnerId(input) !== playerId) {
    throw new Error("Only the room owner can start the match.");
  }
  if (input.players.length !== 2) {
    throw new Error("Wait for another Brawler to join before starting the match.");
  }
  if (!input.players.every((candidate) => candidate.ready)) {
    throw new Error("Both players must be ready before the room owner can start the match.");
  }

  const next = setReady(input, playerId);
  const duplicateReadyLogIndex = input.log.length;
  if (next.log[duplicateReadyLogIndex]?.message === `${player.name} locked a legal deck.`) {
    next.log.splice(duplicateReadyLogIndex, 1);
  }
  return next;
}

export function updateLobbySettings(
  input: MatchState,
  playerId: string,
  rulesFormat: LobbyRulesFormat,
  meta: LobbyMeta,
) {
  if (input.phase !== "lobby") throw new Error("Lobby settings can only be changed before the match starts.");
  if (roomOwnerId(input) !== playerId) throw new Error("Only the room owner can change lobby settings.");
  if (!(["standard", "singleton", "competitive"] as const).includes(rulesFormat)) throw new Error("Unknown match format.");
  if (meta !== "battle-brawlers") throw new Error("That meta is not currently available.");
  const current = lobbyConfig(input);
  if (rulesFormat === "competitive" && current.mode !== "ranked") {
    throw new Error("Competitive format is only available in Ranked mode.");
  }
  if (current.mode === "ranked" && rulesFormat !== "competitive") {
    throw new Error("Ranked mode requires Competitive format.");
  }
  if (current.rulesFormat === rulesFormat && current.meta === meta) throw new Error("Those lobby settings are already selected.");

  const state = cloneMatch(input);
  applyLobbyConfig(state, { ...current, rulesFormat, meta });
  for (const player of state.players) player.ready = false;
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-lobby-settings-${state.version}`,
    at: Date.now(),
    kind: "system",
    message: `${state.players[0]?.name ?? "Room owner"} set ${rulesFormat === "singleton" ? "Singleton" : rulesFormat === "competitive" ? "Competitive" : "Standard"} • Battle Brawlers. Ready status was cleared.`,
  });
  return state;
}

export function replaceLobbyDeck(input: MatchState, playerId: string, replacement: PlayerState) {
  if (input.phase !== "lobby") throw new Error("Decks can only be changed before the match starts.");
  if (replacement.id !== playerId) throw new Error("A player can only change their own lobby deck.");
  const index = input.players.findIndex((candidate) => candidate.id === playerId);
  if (index < 0) throw new Error("Unknown player.");
  const config = lobbyConfig(input);
  const required = requiredDeckFormat(config.rulesFormat);
  if (playerLobbyDeckFormat(replacement) !== required) {
    throw new Error(`${config.rulesFormat === "singleton" ? "Singleton" : config.rulesFormat === "competitive" ? "Competitive" : "Standard"} requires a ${required === "singleton" ? "Singleton" : required === "competitive" ? "Competitive" : "Standard"} deck.`);
  }

  const state = cloneMatch(input);
  replacement.ready = false;
  replacement.connected = state.players[index].connected;
  replacement.lastSeen = Math.max(state.players[index].lastSeen, replacement.lastSeen);
  state.players[index] = replacement;
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-lobby-deck-${state.version}`,
    at: Date.now(),
    kind: "system",
    message: `${replacement.name} selected a ${required === "singleton" ? "Singleton" : "Standard"} deck and is not ready.`,
  });
  return state;
}

export function setLobbyReady(input: MatchState, playerId: string, ready: boolean) {
  if (input.phase !== "lobby") throw new Error("Ready is not legal now.");
  if (rankedSeries(input) && rankedSeries(input)?.stage !== "ready") throw new Error("Complete Ranked deck bans and round selection before readying.");
  const player = input.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  if (player.ready === ready) throw new Error(ready ? "You are already ready." : "You are already not ready.");

  if (ready) {
    const config = lobbyConfig(input);
    const required = requiredDeckFormat(config.rulesFormat);
    if (playerLobbyDeckFormat(player) !== required) {
      throw new Error(`Select a ${required === "singleton" ? "Singleton" : required === "competitive" ? "Competitive" : "Standard"} deck before readying.`);
    }
    const otherReady = input.players.find((candidate) => candidate.id !== playerId && candidate.ready);
    if (input.players.length === 2 && otherReady) {
      const guarded = cloneMatch(input);
      const guardedOther = guarded.players.find((candidate) => candidate.id === otherReady.id);
      if (guardedOther) guardedOther.ready = false;
      const next = setReady(guarded, playerId);
      const restoredOther = next.players.find((candidate) => candidate.id === otherReady.id);
      if (restoredOther) restoredOther.ready = true;
      return next;
    }
    return setReady(input, playerId);
  }

  const state = cloneMatch(input);
  const nextPlayer = state.players.find((candidate) => candidate.id === playerId)!;
  nextPlayer.ready = false;
  nextPlayer.lastSeen = Date.now();
  state.version += 1;
  state.log.push({
    id: `${Date.now()}-lobby-unready-${state.version}`,
    at: Date.now(),
    kind: "system",
    message: `${nextPlayer.name} is no longer ready.`,
  });
  return state;
}

export function startLobbyMatch(input: MatchState, playerId: string) {
  if (input.phase !== "lobby") throw new Error("The match has already started.");
  if (rankedSeries(input) && rankedSeries(input)?.stage !== "ready") throw new Error("Complete Ranked deck bans and round selection before starting.");
  if (roomOwnerId(input) !== playerId) throw new Error("Only the room owner can start the match.");
  if (input.players.length !== 2) throw new Error("Wait for another Brawler to join before starting the match.");
  if (!input.players.every((candidate) => candidate.ready)) throw new Error("Both players must be ready before the match can start.");

  const owner = input.players[0];
  const next = setReady(input, playerId);
  const duplicateReadyLogIndex = input.log.length;
  if (next.log[duplicateReadyLogIndex]?.message === `${owner.name} locked a legal deck.`) {
    next.log.splice(duplicateReadyLogIndex, 1);
  }
  const ranked = rankedSeries(next);
  if (ranked) ranked.stage = "playing";
  return next;
}
