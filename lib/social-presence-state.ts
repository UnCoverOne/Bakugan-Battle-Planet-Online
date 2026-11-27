import type { AccountDatabase } from "./account-server";
import { resolveSocialPresence, type SocialAccountSummary, type SocialMode } from "./social";

// The membership and current series are authoritative for all three game modes,
// including locally played Training (which checkpoints through the lobby API).
export async function enrichSocialPresence(db: AccountDatabase, accounts: SocialAccountSummary[], now = Date.now()) {
  const ids = [...new Set(accounts.filter(account => account.online).map(account => "account:" + account.userId))];
  const lobbies = new Map<string, { mode: SocialMode; inGame: boolean }>();
  for (let offset = 0; offset < ids.length; offset += 80) {
    const batch = ids.slice(offset, offset + 80);
    const result = await db.prepare(`SELECT m.identity_key, l.mode, l.current_series_id
      FROM lobby_memberships m JOIN lobby_sessions l ON l.id = m.lobby_id
      WHERE m.identity_key IN (${batch.map(() => "?").join(",")})
        AND m.left_at IS NULL AND m.expires_at > ? AND l.closed_at IS NULL`)
      .bind(...batch, now).all<{ identity_key: string; mode: SocialMode; current_series_id: string | null }>();
    for (const row of result.results ?? []) lobbies.set(row.identity_key, { mode: row.mode, inGame: Boolean(row.current_series_id) });
  }
  return accounts.map(account => ({ ...account, presence: resolveSocialPresence(
    account.online, account.presence?.kind === "away", lobbies.get("account:" + account.userId),
  ) }));
}

