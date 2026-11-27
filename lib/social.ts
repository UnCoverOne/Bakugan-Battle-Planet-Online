export const SOCIAL_SHARD_COUNT = 8;
export const SOCIAL_INVITE_TTL_MS = 10 * 60 * 1000;

export const SOCIAL_AWAY_MS = 5 * 60_000;
export const SOCIAL_ACTIVITY_REPORT_MS = 15_000;
export type SocialMode = "casual" | "ranked" | "training";
export type SocialPresence =
  | { kind: "offline" | "online" | "away" }
  | { kind: "lobby"; mode: SocialMode; away: boolean }
  | { kind: "game"; mode: SocialMode };

export function socialIsAway(lastActiveAt: number, now = Date.now()) {
  return now - lastActiveAt >= SOCIAL_AWAY_MS;
}

export function resolveSocialPresence(online: boolean, away: boolean, lobby?: { mode: SocialMode; inGame: boolean }): SocialPresence {
  if (!online) return { kind: "offline" };
  if (lobby?.inGame) return { kind: "game", mode: lobby.mode };
  if (lobby) return { kind: "lobby", mode: lobby.mode, away };
  return { kind: away ? "away" : "online" };
}

const MODE_LABELS: Record<SocialMode, string> = { casual: "Casual", ranked: "Ranked", training: "Training" };

export function socialPresenceDisplay(account: Pick<SocialAccountSummary, "online" | "presence">) {
  const presence: SocialPresence = account.online ? account.presence ?? { kind: "online" } : { kind: "offline" };
  switch (presence.kind) {
    case "game": return { label: "In Game – " + MODE_LABELS[presence.mode], tone: "game", away: false };
    case "lobby": return { label: "In Lobby – " + MODE_LABELS[presence.mode], tone: presence.away ? "away" : "active", away: presence.away };
    case "away": return { label: "Away", tone: "away", away: true };
    case "online": return { label: "Online", tone: "active", away: false };
    default: return { label: "Offline", tone: "offline", away: false };
  }
}

export type SocialRelationship = "friend" | "incoming" | "outgoing" | "none";

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
  presence?: SocialPresence;
  relationship: SocialRelationship;
};

export type LobbyInviteSummary = {
  id: string;
  lobbyCode: string;
  inviter: SocialAccountSummary;
  format: "bo1" | "bo3";
  rulesFormat: "standard" | "singleton" | "competitive";
  createdAt: number;
  expiresAt: number;
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
