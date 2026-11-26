import { getDatabase } from "../../../../lib/account-server";
import { resolveLobbyIdentities, issueGuestIdentity } from "../../../../lib/lobby-identity-server";
import { executeLobbyCommand, lobbyRecovery } from "../../../../lib/lobby-session-commands";
import { assertSameOrigin, enforceD1RateLimit, requestClientKey } from "../../../../lib/request-security";
import { serverErrorResponse, ServiceUnavailableError, ValidationError } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";
// A single intentional cutover gate, not a per-mode flag. Do not remove until
// legacy entry points, game authorization, migration and settlement are bridged.
function assertSessionCutover(): void {
  throw new ServiceUnavailableError("Persistent lobby integration is not yet enabled.");
}
const json = (body: unknown, cookie?: string) => Response.json(body, { headers: {
  "cache-control": "no-store, max-age=0", ...(cookie ? { "set-cookie": cookie } : {}),
} });
async function handle(request: Request) {
  const correlationId = crypto.randomUUID();
  try {
    assertSessionCutover();
    assertSameOrigin(request);
    const database = await getDatabase();
    const identities = await resolveLobbyIdentities(database, request);
    await enforceD1RateLimit(database, `lobby-session:${requestClientKey(request)}`, 120, 60000);
    if (request.method === "GET") return json(await lobbyRecovery(database, identities));
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 1_048_576) throw new ValidationError("Lobby command too large.");
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { throw new ValidationError("Invalid lobby command."); }
    if (!["checkpoint-training","complete-training"].includes(String(body.action)) && new TextEncoder().encode(raw).byteLength > 196608) throw new ValidationError("Lobby command too large.");
    if (body.action === "bootstrap") {
      if (identities.primary) return json(await lobbyRecovery(database, identities));
      return json({ status: "identity-required", retry: true }, await issueGuestIdentity(database, request));
    }
    return json(await executeLobbyCommand(database, identities, body));
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Lobby session unavailable.", { route: "/api/lobby/session", method: request.method });
  }
}
export const GET = handle;
export const POST = handle;
