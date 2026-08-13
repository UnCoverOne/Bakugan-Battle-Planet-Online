import { getDatabase, getSessionUser } from "../../../../lib/account-server";
import type { AccountMatchSessionSummary } from "../../../../lib/account-match-session";
import { normalizeMatchState, type MatchState } from "../../../../lib/game";
import { isCompletedSeriesResult } from "../../../../lib/match-result-navigation";
import { ensureMatchSessionSchema } from "../../../../lib/match-session-schema";
import { enforceD1RateLimit, requestClientKey } from "../../../../lib/request-security";
import { AuthenticationError, serverErrorResponse } from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

type ActiveSeatRow = {
  code: string;
  player_id: string;
  capability_version: number;
  connected: number | null;
  state_json: string;
  updated_at: number;
};

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const database = await getDatabase();
    await ensureMatchSessionSchema(database);
    await enforceD1RateLimit(database, `match-active:${user.id}:${requestClientKey(request)}`, 120, 60_000);
    const response = await database.prepare(`SELECT
        match_seat_accounts.code,
        match_seat_accounts.player_id,
        match_seats.capability_version,
        match_presence.connected,
        matches.state_json,
        matches.updated_at
      FROM match_seat_accounts
      JOIN match_seats
        ON match_seats.code = match_seat_accounts.code
        AND match_seats.player_id = match_seat_accounts.player_id
      JOIN matches ON matches.code = match_seat_accounts.code
      LEFT JOIN match_presence
        ON match_presence.code = match_seat_accounts.code
        AND match_presence.player_id = match_seat_accounts.player_id
      WHERE match_seat_accounts.user_id = ?
      ORDER BY matches.updated_at DESC
      LIMIT 12`)
      .bind(user.id).all<ActiveSeatRow>();

    const sessions: AccountMatchSessionSummary[] = [];
    for (const row of response.results ?? []) {
      let state: MatchState;
      try {
        state = normalizeMatchState(JSON.parse(row.state_json) as MatchState);
      } catch {
        continue;
      }
      if (isCompletedSeriesResult(state)) continue;
      const player = state.players.find((candidate) => candidate.id === row.player_id);
      if (!player) continue;
      const opponent = state.players.find((candidate) => candidate.id !== row.player_id);
      sessions.push({
        code: row.code,
        playerId: row.player_id,
        phase: state.phase === "lobby" ? "lobby" : state.phase === "result" ? "intermission" : "match",
        format: state.format,
        opponentName: opponent?.name ?? "Waiting for opponent",
        stepLabel: state.stepLabel ?? "",
        updatedAt: Number(row.updated_at),
        capabilityVersion: Number(row.capability_version),
        controllerActive: Boolean(row.connected),
      });
    }

    return Response.json({ sessions, correlationId }, {
      headers: { "cache-control": "no-store, max-age=0" },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Active matches could not be loaded.", {
      route: "/api/game/active",
      method: "GET",
    });
  }
}
