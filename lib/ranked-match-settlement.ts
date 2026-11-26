import type { EngineBackedMatchState } from "./engine/types";
import { rankedSeries, rankedSeriesScore } from "./ranked-lobby";
import { settleRankedSeries } from "./ranked-server";
import { ServiceUnavailableError, ConflictError } from "./server-errors";

export async function settleCompletedRankedState(database: D1Database, state: EngineBackedMatchState) {
  const ranked = rankedSeries(state);
  if (!ranked || ranked.settlement || state.phase !== "result" || Math.max(...Object.values(state.series)) < 2) return false;
  const winnerId = state.winner;
  const winner = winnerId ? ranked.players[winnerId] : undefined;
  const loserEntry = Object.entries(ranked.players).find(([playerId]) => playerId !== winnerId);
  if (!winner || !loserEntry) throw new ServiceUnavailableError("Ranked BP could not be settled.");
  ranked.stage = "complete";
  ranked.settlement = await settleRankedSeries(database, {
    seriesId: state.id,
    rulesetVersion: ranked.rulesetVersion,
    playerOneUserId: Object.values(ranked.players)[0].userId,
    playerTwoUserId: Object.values(ranked.players)[1].userId,
    winnerUserId: winner.userId,
    loserUserId: loserEntry[1].userId,
    score: rankedSeriesScore(state),
  });
  return true;
}

export async function persistRankedSettlementSnapshot(database: D1Database, state: EngineBackedMatchState) {
  const result = await database.prepare(`UPDATE matches SET state_json = ?, updated_at = ?
    WHERE code = ? AND CAST(json_extract(state_json, '$.version') AS INTEGER) = ?`)
    .bind(JSON.stringify(state), Date.now(), state.code, state.version).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new ConflictError("The completed Ranked result changed while BP was being settled.");
  }
}

