import { getSessionUserFromDatabase } from "./account-server";
import { digestMatchCapability, secureMatchCapability } from "./match-seat-auth";
import type { LobbyIdentity } from "./lobby-session";

export const LOBBY_GUEST_COOKIE = "bbp_lobby_guest";
const GUEST_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export function guestCredential(request: Request) {
  const values = (request.headers.get("cookie") ?? "").split(";")
    .map(part => part.trim()).filter(part => part.startsWith(LOBBY_GUEST_COOKIE + "="));
  if (values.length !== 1) return null;
  const token = values[0].slice(LOBBY_GUEST_COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export async function resolveGuestIdentity(database: D1Database, request: Request, now = Date.now()): Promise<LobbyIdentity | null> {
  const token = guestCredential(request);
  if (!token) return null;
  const row = await database.prepare("SELECT id FROM lobby_guest_identities WHERE token_hash = ? AND expires_at > ?")
    .bind(await digestMatchCapability(token), now).first<{ id: string }>();
  return row ? { kind: "guest", id: row.id } : null;
}

// Bootstrap only; a newly minted cookie cannot authorize a mutation in the
// same request. The browser must present it on the next request.
export async function issueGuestIdentity(database: D1Database, request: Request, now = Date.now()) {
  const token = secureMatchCapability(32);
  await database.prepare("INSERT INTO lobby_guest_identities (id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await digestMatchCapability(token), now, now + GUEST_TTL_MS).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${LOBBY_GUEST_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${GUEST_TTL_MS / 1000}${secure}`;
}
export async function resolveLobbyIdentities(database: D1Database, request: Request) {
  const [user, guest] = await Promise.all([getSessionUserFromDatabase(request, database), resolveGuestIdentity(database, request)]);
  const account: LobbyIdentity | null = user ? { kind: "account", id: user.id } : null;
  return { account, guest, primary: account ?? guest };
}
