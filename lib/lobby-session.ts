/** Shared domain contract. No dependency on React, transport or the game engine. */
export const LOBBY_MEMBERSHIP_TTL_MS = 60 * 60 * 1000;
export const LOBBY_DISCONNECTED_AFTER_MS = 30 * 1000;
export type LobbyMode = "training" | "casual" | "ranked";
export type LobbyStructure = "bo1" | "bo3";
export type LobbyFormat = "standard" | "singleton" | "competitive";
export type LobbyMeta = "battle-brawlers" | "armored-alliance" | "geogan-rising" | "unlimited";
export type LobbyConfiguration = { structure: LobbyStructure; format: LobbyFormat; meta: LobbyMeta };
export type LobbyIdentity = { kind: "account" | "guest"; id: string };
export type LobbyDeparture = "left" | "expired";
export type LobbyMembership = {
  id: string; lobbyId: string; joinedAt: number; lastSeenAt: number; expiresAt: number;
};
export type LobbySession = {
  id: string; code: string; mode: LobbyMode; configuration: LobbyConfiguration;
  version: number; createdAt: number; closedAt: number | null;
  currentSeriesId: string | null; previousSeriesId: string | null;
  hostMemberId: string | null; members: LobbyMembership[];
};
export function lobbyPresence(member: LobbyMembership, now: number) {
  if (now >= member.expiresAt) return "expired";
  return now - member.lastSeenAt >= LOBBY_DISCONNECTED_AFTER_MS ? "disconnected" : "connected";
}
export function lobbyPrimaryAction(hasActiveSeries: boolean, isHost: boolean) {
  return hasActiveSeries ? "return-to-game" : isHost ? "start-game" : "waiting-for-host";
}
