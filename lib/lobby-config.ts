import type { MatchState, PlayerState } from "./game";

export type LobbyMode = "training" | "casual" | "ranked";
export type LobbyRulesFormat = "standard" | "singleton" | "competitive";
export type LobbyMeta = "battle-brawlers";
export type LobbyDeckFormat = "standard" | "singleton";

export type LobbyConfig = {
  mode: LobbyMode;
  rulesFormat: LobbyRulesFormat;
  meta: LobbyMeta;
};

type ConfiguredMatch = MatchState & {
  lobbyMode?: LobbyMode;
  lobbyRulesFormat?: LobbyRulesFormat;
  lobbyMeta?: LobbyMeta;
};

type ConfiguredPlayer = PlayerState & {
  lobbyDeckFormat?: LobbyDeckFormat;
  lobbyDeckName?: string;
};

const validMode = (value: unknown): value is LobbyMode =>
  value === "training" || value === "casual" || value === "ranked";

const validRulesFormat = (value: unknown): value is LobbyRulesFormat =>
  value === "standard" || value === "singleton" || value === "competitive";

export function lobbyConfig(state: MatchState): LobbyConfig {
  const configured = state as ConfiguredMatch;
  return {
    mode: validMode(configured.lobbyMode) ? configured.lobbyMode : "casual",
    rulesFormat: validRulesFormat(configured.lobbyRulesFormat) ? configured.lobbyRulesFormat : "standard",
    meta: configured.lobbyMeta === "battle-brawlers" ? configured.lobbyMeta : "battle-brawlers",
  };
}

export function applyLobbyConfig(state: MatchState, config: LobbyConfig) {
  const configured = state as ConfiguredMatch;
  configured.lobbyMode = config.mode;
  configured.lobbyRulesFormat = config.rulesFormat;
  configured.lobbyMeta = config.meta;
  return state;
}

export function requiredDeckFormat(rulesFormat: LobbyRulesFormat): LobbyDeckFormat {
  return rulesFormat === "singleton" ? "singleton" : "standard";
}

export function tagLobbyPlayerDeck<T extends PlayerState>(
  player: T,
  deck: { format?: LobbyDeckFormat; name?: string },
): T {
  const configured = player as T & ConfiguredPlayer;
  configured.lobbyDeckFormat = deck.format === "singleton" ? "singleton" : "standard";
  configured.lobbyDeckName = typeof deck.name === "string" ? deck.name : "";
  return player;
}

export function playerLobbyDeckFormat(player: PlayerState): LobbyDeckFormat {
  return (player as ConfiguredPlayer).lobbyDeckFormat === "singleton" ? "singleton" : "standard";
}

export function playerLobbyDeckName(player: PlayerState) {
  return (player as ConfiguredPlayer).lobbyDeckName ?? "";
}
