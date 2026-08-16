import { normalizeMatchState, type MatchState } from "./game";
import {
  APPLICATION_VERSION,
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  ENGINE_VERSION,
  RULES_VERSION,
  normalizeEngineState,
  type EngineBackedMatchState,
  type GameVersionProfile,
} from "./engine";
import { replayStateHash } from "./engine/replay-codec";
import type { ReplayArchive } from "./engine/replay-types";
import { isCompletedSeriesResult } from "./match-result-navigation";
import type { MatchResultRecord } from "./persistence";
import {
  associateMatchSeatAccount,
  buildReplayArchiveFromEventStore,
  ensureReplayArchiveSchema,
  loadRecentReplaySummaries,
} from "./replay-archive-server-legacy";

export * from "./replay-archive-server-legacy";
export { associateMatchSeatAccount, buildReplayArchiveFromEventStore, ensureReplayArchiveSchema, loadRecentReplaySummaries };

export const MATCH_RECORD_RETENTION = 10;
export const PENDING_REPLAY_ARCHIVE_KIND = "pending-engine-history" as const;

type SeatAccountRow = { player_id: string; user_id: string };

export type PendingReplayArchive = {
  schemaVersion: 1;
  kind: typeof PENDING_REPLAY_ARCHIVE_KIND;
  replayId: string;
  capturedAt: number;
  startedAt: number;
  completedAt: number;
  finalVersion: number;
  finalStateHash: string;
  versions: GameVersionProfile;
  /** Compatibility shape for administrator diagnostics before first watch. */
  recording: { commands: [] };
};

export type StoredReplayForUser = {
  archive_json: string;
  player_id: string;
  summary_json: string;
  match_code: string;
  completed_at: number;
};

function replayVersions(state: EngineBackedMatchState): GameVersionProfile {
  const metadata = state.__engine;
  return metadata ? {
    applicationVersion: metadata.applicationVersion,
    engineVersion: metadata.engineVersion,
    rulesVersion: metadata.rulesVersion,
    cardCatalogueVersion: metadata.cardCatalogueVersion,
    digitalAdaptationVersion: metadata.digitalAdaptationVersion,
    contentSchemaVersion: metadata.contentSchemaVersion,
  } : {
    applicationVersion: APPLICATION_VERSION,
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    cardCatalogueVersion: CARD_CATALOGUE_VERSION,
    digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
    contentSchemaVersion: CONTENT_SCHEMA_VERSION,
  };
}

function pendingReplayArchive(state: EngineBackedMatchState, completedAt: number): PendingReplayArchive {
  return {
    schemaVersion: 1,
    kind: PENDING_REPLAY_ARCHIVE_KIND,
    replayId: state.id,
    capturedAt: completedAt,
    startedAt: state.log.find((entry) => Number.isFinite(entry.at))?.at ?? completedAt,
    completedAt,
    finalVersion: state.version,
    finalStateHash: replayStateHash(state),
    versions: replayVersions(state),
    recording: { commands: [] },
  };
}

export function isPendingReplayArchive(value: unknown): value is PendingReplayArchive {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingReplayArchive>;
  return candidate.schemaVersion === 1
    && candidate.kind === PENDING_REPLAY_ARCHIVE_KIND
    && typeof candidate.replayId === "string"
    && Number.isInteger(candidate.finalVersion)
    && typeof candidate.finalStateHash === "string"
    && typeof candidate.completedAt === "number";
}

function matchMode(state: MatchState): NonNullable<MatchResultRecord["mode"]> {
  return (state as MatchState & { ranked?: unknown }).ranked ? "ranked" : "casual";
}

function participantSummary(
  state: MatchState,
  playerId: string,
  replay: Pick<PendingReplayArchive, "replayId" | "completedAt" | "startedAt">,
  opponentUserId?: string,
): MatchResultRecord {
  const opponent = state.players.find((candidate) => candidate.id !== playerId);
  const localScore = Number(state.series[playerId] ?? 0);
  const opponentScore = Number(opponent ? state.series[opponent.id] ?? 0 : 0);
  return {
    id: replay.replayId,
    replayId: replay.replayId,
    result: !state.winner ? "Draw" : state.winner === playerId ? "Victor" : "Defeat",
    opponent: opponent?.name ?? "Opponent",
    opponentUserId,
    score: `${localScore}–${opponentScore}`,
    reason: state.resultReason,
    at: new Date(replay.completedAt).toISOString(),
    startedAt: new Date(replay.startedAt).toISOString(),
    format: state.format,
    mode: matchMode(state),
    schemaVersion: 3,
    replayStorage: "server",
    replayAvailable: true,
  };
}

function recomputeStats(database: D1Database, userId: string, now: number) {
  return database.prepare(`INSERT INTO account_match_stats (
      user_id, matches_played, wins, losses, draws,
      training_matches, casual_matches, ranked_matches, updated_at
    )
    SELECT ?, COUNT(*),
      SUM(CASE WHEN result = 'Victor' THEN 1 ELSE 0 END),
      SUM(CASE WHEN result = 'Defeat' THEN 1 ELSE 0 END),
      SUM(CASE WHEN result = 'Draw' THEN 1 ELSE 0 END),
      SUM(CASE WHEN mode = 'training' THEN 1 ELSE 0 END),
      SUM(CASE WHEN mode = 'casual' THEN 1 ELSE 0 END),
      SUM(CASE WHEN mode = 'ranked' THEN 1 ELSE 0 END), ?
    FROM match_stat_events WHERE user_id = ?
    ON CONFLICT(user_id) DO UPDATE SET
      matches_played = excluded.matches_played,
      wins = excluded.wins,
      losses = excluded.losses,
      draws = excluded.draws,
      training_matches = excluded.training_matches,
      casual_matches = excluded.casual_matches,
      ranked_matches = excluded.ranked_matches,
      updated_at = excluded.updated_at`)
    .bind(userId, now, userId);
}

/**
 * Records only replay identity, participant summaries, and statistics when a
 * match completes. The canonical engine event store remains the history; the
 * visual replay archive is compiled lazily when a participant first watches it.
 */
export async function archiveCompletedMatch(database: D1Database, state: EngineBackedMatchState) {
  if (!isCompletedSeriesResult(state)) return false;
  const completedAt = Date.now();
  const pending = pendingReplayArchive(state, completedAt);
  await ensureReplayArchiveSchema(database);

  const seats = await database.prepare(
    "SELECT player_id, user_id FROM match_seat_accounts WHERE code = ?",
  ).bind(state.code).all<SeatAccountRow>();
  const byPlayer = new Map((seats.results ?? []).map((seat) => [seat.player_id, seat.user_id]));
  const rankedPlayers = ((state as EngineBackedMatchState & {
    ranked?: { players?: Record<string, { userId?: string }> };
  }).ranked?.players ?? {});
  for (const [playerId, rankedPlayer] of Object.entries(rankedPlayers)) {
    if (rankedPlayer.userId) byPlayer.set(playerId, rankedPlayer.userId);
  }

  const participants = state.players.flatMap((player) => {
    const userId = byPlayer.get(player.id);
    const opponent = state.players.find((candidate) => candidate.id !== player.id);
    return userId ? [{
      playerId: player.id,
      userId,
      summary: participantSummary(state, player.id, pending, opponent ? byPlayer.get(opponent.id) : undefined),
    }] : [];
  });

  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT OR IGNORE INTO match_replays (
      replay_id, match_code, archive_json, final_state_hash, engine_version,
      rules_version, catalogue_version, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        pending.replayId,
        state.code,
        JSON.stringify(pending),
        pending.finalStateHash,
        pending.versions.engineVersion,
        pending.versions.rulesVersion,
        pending.versions.cardCatalogueVersion,
        pending.completedAt,
        completedAt,
      ),
  ];

  for (const participant of participants) {
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO match_replay_participants (
        replay_id, user_id, player_id, summary_json, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(
          pending.replayId,
          participant.userId,
          participant.playerId,
          JSON.stringify(participant.summary),
          participant.summary.at,
          completedAt,
        ),
      database.prepare(`INSERT OR IGNORE INTO match_stat_events (
        replay_id, user_id, result, mode, occurred_at
      ) VALUES (?, ?, ?, ?, ?)`)
        .bind(
          pending.replayId,
          participant.userId,
          participant.summary.result,
          participant.summary.mode,
          participant.summary.at,
        ),
      recomputeStats(database, participant.userId, completedAt),
      database.prepare(`DELETE FROM match_replay_participants
        WHERE user_id = ? AND replay_id NOT IN (
          SELECT replay_id FROM match_replay_participants
          WHERE user_id = ? ORDER BY occurred_at DESC, replay_id DESC LIMIT ?
        )`).bind(participant.userId, participant.userId, MATCH_RECORD_RETENTION),
    );
  }

  statements.push(database.prepare(`DELETE FROM match_replays
    WHERE NOT EXISTS (
      SELECT 1 FROM match_replay_participants
      WHERE match_replay_participants.replay_id = match_replays.replay_id
    )`));
  await database.batch(statements);
  return true;
}

export async function loadReplayForUser(database: D1Database, replayId: string, userId: string) {
  await ensureReplayArchiveSchema(database);
  return database.prepare(`SELECT match_replays.archive_json, match_replays.match_code,
      match_replays.completed_at, match_replay_participants.player_id,
      match_replay_participants.summary_json
    FROM match_replays
    JOIN match_replay_participants ON match_replay_participants.replay_id = match_replays.replay_id
    WHERE match_replays.replay_id = ? AND match_replay_participants.user_id = ?`)
    .bind(replayId, userId)
    .first<StoredReplayForUser>();
}

/** Compile and cache a pending server replay from the canonical engine history. */
export async function materializeReplayArchive(
  database: D1Database,
  row: Pick<StoredReplayForUser, "archive_json" | "match_code" | "completed_at">,
): Promise<ReplayArchive> {
  let stored: unknown;
  try {
    stored = JSON.parse(row.archive_json) as unknown;
  } catch {
    throw new Error("Replay archive metadata is damaged.");
  }
  if (!isPendingReplayArchive(stored)) return stored as ReplayArchive;

  const match = await database.prepare("SELECT state_json FROM matches WHERE code = ?")
    .bind(row.match_code)
    .first<{ state_json: string }>();
  if (!match?.state_json) {
    throw new Error("Replay engine history is no longer available for this match.");
  }

  const state = normalizeEngineState(normalizeMatchState(JSON.parse(match.state_json) as MatchState));
  if (state.id !== stored.replayId || state.phase !== "result") {
    throw new Error("Replay engine history does not match the completed replay record.");
  }

  const archive = await buildReplayArchiveFromEventStore(database, state, stored.completedAt || row.completed_at);
  await database.prepare(`UPDATE match_replays
    SET archive_json = ?, final_state_hash = ?, engine_version = ?, rules_version = ?, catalogue_version = ?
    WHERE replay_id = ? AND archive_json = ?`)
    .bind(
      JSON.stringify(archive),
      archive.finalStateHash,
      archive.versions.engineVersion,
      archive.versions.rulesVersion,
      archive.versions.cardCatalogueVersion,
      archive.replayId,
      row.archive_json,
    )
    .run();
  return archive;
}
