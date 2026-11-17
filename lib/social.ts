export const SOCIAL_SHARD_COUNT = 8;
export const SOCIAL_INVITE_TTL_MS = 5 * 60 * 1000;

export type SocialRelationship = "friend" | "incoming" | "outgoing" | "none";
export type SocialActivity = "offline" | "online" | "lobby" | "game";

export type SocialAccountSummary = {
  userId: string;
  displayName: string;
  faction: string;
  avatar: string;
  titleId: string;
  rank: string;
  bp: number;
  wins: number;
  losses: number;
  winRate: number;
  online: boolean;
  activity?: SocialActivity;
  relationship: SocialRelationship;
};

export type LobbyInviteSummary = {
  id: string;
  lobbyCode: string;
  inviter: SocialAccountSummary;
  format: "bo1" | "bo3" | null;
  rulesFormat: "standard" | "singleton" | "competitive" | null;
  available: boolean;
  unavailableReason?: string;
  createdAt: number;
  expiresAt: number;
};

export type LobbySystemMessage = {
  id: string;
  lobbyCode: string;
  at: number;
  message: string;
};

export type ActiveSocialLobby = {
  code: string;
  format: "bo1" | "bo3";
  rulesFormat: "standard" | "singleton" | "competitive";
  openSlots: number;
};

export type SocialSnapshot = {
  friends: SocialAccountSummary[];
  incomingRequests: SocialAccountSummary[];
  outgoingRequests: SocialAccountSummary[];
  onlineBrawlers: SocialAccountSummary[];
  offlineBrawlers: SocialAccountSummary[];
  invitations: LobbyInviteSummary[];
  lobbyMessages: LobbySystemMessage[];
  activeLobby: ActiveSocialLobby | null;
  unreadCount: number;
};

export function canonicalSocialPair(left: string, right: string) {
  if (!left || !right || left === right) throw new Error("Choose another Brawler.");
  return left < right ? [left, right] as const : [right, left] as const;
}

export function socialPresenceShard(userId: string) {
  let hash = 2166136261;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `social-${(hash >>> 0) % SOCIAL_SHARD_COUNT}`;
}

export function socialTitleLabel(titleId: string) {
  return titleId
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function sortSocialAccounts<T extends Pick<SocialAccountSummary, "displayName" | "online">>(accounts: T[]) {
  return [...accounts].sort((left, right) => (
    Number(right.online) - Number(left.online)
    || left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" })
  ));
}
