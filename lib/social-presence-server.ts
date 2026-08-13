import {
  SOCIAL_SHARD_COUNT,
  socialPresenceShard,
  type SocialAccountSummary,
} from "./social";

type SocialPresenceEvent = {
  type: "social.changed" | "lobby.invited" | "lobby.invite-responded";
  actorId?: string;
  inviteId?: string;
};

async function namespace() {
  const { env } = await import("cloudflare:workers");
  return env.SOCIAL_PRESENCE as DurableObjectNamespace;
}

export async function onlineSocialAccounts() {
  const socialPresence = await namespace();
  const responses = await Promise.all(Array.from({ length: SOCIAL_SHARD_COUNT }, async (_, index) => {
    const shard = `social-${index}`;
    const response = await socialPresence.getByName(shard).fetch("https://social.internal/snapshot");
    if (!response.ok) throw new Error(`Social presence shard ${shard} returned ${response.status}.`);
    const payload = await response.json() as { accounts?: SocialAccountSummary[] };
    return payload.accounts ?? [];
  }));
  const byId = new Map<string, SocialAccountSummary>();
  for (const account of responses.flat()) byId.set(account.userId, { ...account, online: true });
  return [...byId.values()];
}

export async function notifySocialUser(userId: string, event: SocialPresenceEvent) {
  const shard = socialPresenceShard(userId);
  const response = await (await namespace()).getByName(shard).fetch(
    new Request(`https://social.internal/notify?userId=${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }),
  );
  if (!response.ok) throw new Error(`Social presence notification returned ${response.status}.`);
}

export async function notifySocialUsers(userIds: string[], event: SocialPresenceEvent) {
  await Promise.all([...new Set(userIds)].map((userId) => notifySocialUser(userId, event)));
}
