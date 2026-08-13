import type { MatchState } from "./game";
import {
  archiveReplayRecording,
  compactReplayCommand,
  createReplayRecording,
} from "./engine/replay-codec";
import type { ReplayArchive } from "./engine/replay-types";
import type { CommandEnvelope, EngineBackedMatchState, GameCommand } from "./engine/types";
import { isCompletedSeriesResult } from "./match-result-navigation";
import type { MatchResultRecord } from "./persistence";

export const MATCH_RECORD_RETENTION = 10;

let replaySchemaReady: Promise<void> | undefined;

export async function ensureReplayArchiveSchema(database: D1Database) {
  if (!replaySchemaReady) {
    replaySchemaReady = database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS match_seat_accounts (
        code TEXT NOT NULL,
        player_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (code, player_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS match_seat_accounts_user_idx ON match_seat_accounts(user_id, created_at DESC)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS match_replays (
        replay_id TEXT PRIMARY KEY NOT NULL,
        match_code TEXT NOT NULL,
        archive_json TEXT NOT NULL,
        final_state_hash TEXT NOT NULL,
        engine_version TEXT NOT NULL,
        rules_version TEXT NOT NULL,
        catalogue_version TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS match_replays_completed_idx ON match_replays(completed_at DESC)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS match_replay_participants (
        replay_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (replay_id, user_id),
        FOREIGN KEY (replay_id) REFERENCES match_replays(replay_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS match_replay_participant_recent_idx ON match_replay_participants(user_id, occurred_at DESC)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS match_stat_events (
        replay_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        result TEXT NOT NULL,
        mode TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        PRIMARY KEY (replay_id, user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
      database.prepare("CREATE INDEX IF NOT EXISTS match_stat_events_user_idx ON match_stat_events(user_id, occurred_at DESC)"),
      database.prepare(`CREATE TABLE IF NOT EXISTS account_match_stats (
        user_id TEXT PRIMARY KEY NOT NULL,
        matches_played INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        draws INTEGER NOT NULL DEFAULT 0,
        training_matches INTEGER NOT NULL DEFAULT 0,
        casual_matches INTEGER NOT NULL DEFAULT 0,
        ranked_matches INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`),
    ]).then(() => undefined).catch((error) => {
      replaySchemaReady = undefined;
      throw error;
    });
  }
  await replaySchemaReady;
}

export async function associateMatchSeatAccount(
  database: D1Database,
  code: string,
  playerId: string,
  userId: string | undefined,
  createdAt: number,
) {
  if (!userId) return;
  await ensureReplayArchiveSchema(database);
  await database.prepare(`INSERT INTO match_seat_accounts (code, player_id, user_id, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(code, player_id) DO UPDATE SET user_id = excluded.user_id, created_at = excluded.created_at`)
    .bind(code, playerId, userId, createdAt).run();
}

type SeatAccountRow = { player_id: string; user_id: string };

function matchMode(state: MatchState): NonNullable<MatchResultRecord["mode"]> {
  return (state as MatchState & { ranked?: unknown }).ranked ? "ranked" : "casual";
}

function participantSummary(
  state: MatchState,
  playerId: string,
  archive: ReplayArchive,
): MatchResultRecord {
  const opponent = state.players.find((candidate) => candidate.id !== playerId);
  const localScore = Number(state.series[playerId] ?? 0);
  const opponentScore = Number(opponent ? state.series[opponent.id] ?? 0 : 0);
  return {
    id: archive.replayId,
    replayId: archive.replayId,
    result: !state.winner ? "Draw" : state.winner === playerId ? "Victor" : "Defeat",
    opponent: opponent?.name ?? "Opponent",
    score: `${localScore}–${opponentScore}`,
    reason: state.resultReason,
    at: new Date(archive.completedAt).toISOString(),
    startedAt: new Date(archive.startedAt).toISOString(),
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

type ReplaySnapshotRow = { version: number; state_json: string };
type ReplayCommandRow = {
  command_id: string;
  actor_id: string;
  expected_version: number;
  result_version: number;
  payload_json: string;
  created_at: number;
};

function parseAcceptedCommand(row: ReplayCommandRow, gameId: string): CommandEnvelope | null {
  try {
    const payload = JSON.parse(row.payload_json) as {
      command?: GameCommand;
      randomSeed?: string;
      requestHash?: string;
    };
    if (!payload.command || typeof payload.command.type !== "string" || !payload.randomSeed) return null;
    return {
      commandId: row.command_id,
      gameId,
      actorId: row.actor_id,
      expectedVersion: row.expected_version,
      issuedAt: row.created_at,
      randomSeed: payload.randomSeed,
      requestHash: payload.requestHash ?? `archive:${row.command_id}`,
      command: payload.command,
    };
  } catch {
    return null;
  }
}

export function buildReplayArchiveFromRows(
  genesis: MatchState,
  snapshotVersion: number,
  rows: readonly ReplayCommandRow[],
  state: EngineBackedMatchState,
  completedAt = Date.now(),
) {
  const recording = createReplayRecording(genesis);
  recording.commands = rows
    .filter((row) => row.result_version > snapshotVersion)
    .map((row) => {
      const envelope = parseAcceptedCommand(row, state.id);
      if (!envelope) throw new Error(`Accepted command ${row.command_id} cannot be reconstructed.`);
      return compactReplayCommand(envelope);
    });
  return archiveReplayRecording(recording, state, completedAt);
}

/**
 * Builds a replay from the event store after the request path is complete.
 * The first gameplay snapshot is the sole genesis; accepted commands after it
 * are already present in D1 and are compacted only once during finalization.
 */
export async function buildReplayArchiveFromEventStore(
  database: D1Database,
  state: EngineBackedMatchState,
  completedAt = Date.now(),
) {
  const snapshot = await database.prepare(`SELECT version, state_json FROM match_snapshots
    WHERE code = ? AND json_extract(state_json, '$.phase') <> 'lobby'
    ORDER BY version ASC LIMIT 1`)
    .bind(state.code).first<ReplaySnapshotRow>();
  if (!snapshot) return null;
  const genesis = JSON.parse(snapshot.state_json) as MatchState;
  const response = await database.prepare(`SELECT
      match_events.command_id,
      match_events.actor_id,
      match_commands.expected_version,
      match_commands.result_version,
      match_events.payload_json,
      match_events.created_at
    FROM match_events
    JOIN match_commands
      ON match_commands.code = match_events.code
      AND match_commands.command_id = match_events.command_id
    WHERE match_events.code = ?
      AND match_events.event_type = 'COMMAND_ACCEPTED'
      AND match_commands.result_version > ?
    ORDER BY match_events.sequence ASC`)
    .bind(state.code, snapshot.version).all<ReplayCommandRow>();
  return buildReplayArchiveFromRows(
    genesis,
    snapshot.version,
    response.results ?? [],
    state,
    completedAt,
  );
}

/** Archives a completed series once, links each signed-in participant, and prunes visible records to ten. */
export async function archiveCompletedMatch(database: D1Database, state: EngineBackedMatchState) {
  if (!isCompletedSeriesResult(state)) return false;
  const completedAt = Date.now();
  const archive = await buildReplayArchiveFromEventStore(database, state, completedAt);
  if (!archive) return false;
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
    return userId ? [{ playerId: player.id, userId, summary: participantSummary(state, player.id, archive) }] : [];
  });
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT OR IGNORE INTO match_replays (
      replay_id, match_code, archive_json, final_state_hash, engine_version,
      rules_version, catalogue_version, completed_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        archive.replayId,
        state.code,
        JSON.stringify(archive),
        archive.finalStateHash,
        archive.versions.engineVersion,
        archive.versions.rulesVersion,
        archive.versions.cardCatalogueVersion,
        archive.completedAt,
        completedAt,
      ),
  ];
  for (const participant of participants) {
    const result = participant.summary.result;
    statements.push(
      database.prepare(`INSERT OR IGNORE INTO match_replay_participants (
        replay_id, user_id, player_id, summary_json, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(archive.replayId, participant.userId, participant.playerId, JSON.stringify(participant.summary), participant.summary.at, completedAt),
      database.prepare(`INSERT OR IGNORE INTO match_stat_events (
        replay_id, user_id, result, mode, occurred_at
      ) VALUES (?, ?, ?, ?, ?)`)
        .bind(archive.replayId, participant.userId, result, participant.summary.mode, participant.summary.at),
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
  return database.prepare(`SELECT match_replays.archive_json, match_replay_participants.player_id,
      match_replay_participants.summary_json
    FROM match_replays
    JOIN match_replay_participants ON match_replay_participants.replay_id = match_replays.replay_id
    WHERE match_replays.replay_id = ? AND match_replay_participants.user_id = ?`)
    .bind(replayId, userId)
    .first<{ archive_json: string; player_id: string; summary_json: string }>();
}

export async function loadRecentReplaySummaries(database: D1Database, userId: string) {
  await ensureReplayArchiveSchema(database);
  const response = await database.prepare(`SELECT summary_json FROM match_replay_participants
    WHERE user_id = ? ORDER BY occurred_at DESC, replay_id DESC LIMIT ?`)
    .bind(userId, MATCH_RECORD_RETENTION).all<{ summary_json: string }>();
  return (response.results ?? []).flatMap((row) => {
    try { return [JSON.parse(row.summary_json) as MatchResultRecord]; } catch { return []; }
  });
}
