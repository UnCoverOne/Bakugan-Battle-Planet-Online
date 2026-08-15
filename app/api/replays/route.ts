import { normalizeMatchState, type MatchState } from "../../../lib/game";
import { getDatabase, getSessionUser } from "../../../lib/account-server";
import {
  CARD_CATALOGUE_VERSION,
  CONTENT_SCHEMA_VERSION,
  DIGITAL_ADAPTATION_VERSION,
  ENGINE_VERSION,
  RULES_VERSION,
  normalizeEngineState,
  type EngineBackedMatchState,
} from "../../../lib/engine";
import { buildProjectedReplayBundle, encodeReplayTransport } from "../../../lib/engine/replay-playback";
import type { ReplayArchive } from "../../../lib/engine/replay-types";
import {
  buildReplayArchiveFromEventStore,
  loadRecentReplaySummaries,
  loadReplayForUser,
} from "../../../lib/replay-archive-server";
import { buildReplayArchiveFromSnapshotHistory } from "../../../lib/replay-snapshot-recovery";
import { AuthenticationError, ConflictError, ValidationError, serverErrorResponse } from "../../../lib/server-errors";

export const dynamic = "force-dynamic";

const json = (value: unknown, status = 200) => Response.json(value, {
  status,
  headers: { "cache-control": "private, no-store, max-age=0" },
});

function assertCompatible(archive: ReplayArchive) {
  // Frozen playback contains complete board states and never executes the
  // current reducer/catalogue, so it remains valid across later deployments.
  if (archive.playback?.schemaVersion === 1) return;

  const expected = {
    engineVersion: ENGINE_VERSION,
    rulesVersion: RULES_VERSION,
    cardCatalogueVersion: CARD_CATALOGUE_VERSION,
    digitalAdaptationVersion: DIGITAL_ADAPTATION_VERSION,
    contentSchemaVersion: CONTENT_SCHEMA_VERSION,
  };
  const mismatch = Object.entries(expected).find(([key, value]) => (
    archive.versions[key as keyof typeof expected] !== value
  ));
  if (mismatch) {
    throw new ConflictError(
      "This replay was recorded with a game version that is not available in this build.",
      `Replay ${mismatch[0]} ${String(archive.versions[mismatch[0] as keyof typeof expected])} does not match ${String(mismatch[1])}.`,
    );
  }
}

function isRecoveredFinalBattlefieldArchive(archive: ReplayArchive) {
  return archive.playback?.schemaVersion === 1
    && archive.playback.steps.length === 0
    && archive.playback.initialFrame.label === "Recovered final battlefield";
}

async function repairReplayFromEventStore(
  database: D1Database,
  replayId: string,
  archive: ReplayArchive,
  requireHistory = false,
) {
  const row = await database.prepare(`SELECT matches.state_json
    FROM match_replays
    JOIN matches ON matches.code = match_replays.match_code
    WHERE match_replays.replay_id = ?`)
    .bind(replayId)
    .first<{ state_json: string }>();
  if (!row?.state_json) return null;

  let state: EngineBackedMatchState;
  try {
    state = normalizeEngineState(normalizeMatchState(JSON.parse(row.state_json) as MatchState));
  } catch {
    return null;
  }
  if (state.id !== replayId || state.phase !== "result") return null;

  let repaired = await buildReplayArchiveFromEventStore(database, state, archive.completedAt);
  if ((repaired.playback?.steps.length ?? 0) === 0) {
    // Older journals can be incomplete or impossible to re-run after rules and
    // catalogue changes. The match store still retains periodic authoritative
    // full-state checkpoints, so use them rather than freezing only frame 1/1.
    const snapshotRecovered = await buildReplayArchiveFromSnapshotHistory(database, state, archive.completedAt);
    if (snapshotRecovered) repaired = snapshotRecovered;
  }
  if (requireHistory && (repaired.playback?.steps.length ?? 0) === 0) return null;
  await database.prepare(`UPDATE match_replays
    SET archive_json = ?, final_state_hash = ?, engine_version = ?, rules_version = ?, catalogue_version = ?
    WHERE replay_id = ?`)
    .bind(
      JSON.stringify(repaired),
      repaired.finalStateHash,
      repaired.versions.engineVersion,
      repaired.versions.rulesVersion,
      repaired.versions.cardCatalogueVersion,
      replayId,
    )
    .run();
  return repaired;
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    const replayId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    const database = await getDatabase();
    if (!replayId) return json({ records: await loadRecentReplaySummaries(database, user.id), correlationId });
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(replayId)) throw new ValidationError("Replay ID is invalid.");
    const row = await loadReplayForUser(database, replayId, user.id);
    if (!row) return json({ error: "Replay not found.", code: "NOT_FOUND", correlationId }, 404);
    let archive: ReplayArchive;
    try { archive = JSON.parse(row.archive_json) as ReplayArchive; } catch { throw new ConflictError("This replay archive is damaged."); }

    // The previous recovery path permanently froze a valid-but-historyless
    // final battlefield. When the event store is still retained, make one
    // best-effort pass to restore the real command timeline before serving it.
    if (isRecoveredFinalBattlefieldArchive(archive)) {
      try {
        const repaired = await repairReplayFromEventStore(database, replayId, archive, true);
        if (repaired) archive = repaired;
      } catch (repairError) {
        console.error(JSON.stringify({
          event: "match_replay_history_repair_failed",
          replayId,
          message: repairError instanceof Error ? repairError.message : String(repairError),
        }));
      }
    }

    try {
      assertCompatible(archive);
      const bundle = encodeReplayTransport(buildProjectedReplayBundle(archive, row.player_id));
      return json({ bundle, correlationId });
    } catch (playbackError) {
      // Old command-only archives can become unreplayable after an engine,
      // catalogue, or runtime card-override change. Rebuild from the retained
      // authoritative event store; if the command journal itself cannot be
      // reconstructed, periodic snapshots provide a coarse historical replay.
      const repaired = await repairReplayFromEventStore(database, replayId, archive);
      if (!repaired) throw playbackError;
      const bundle = encodeReplayTransport(buildProjectedReplayBundle(repaired, row.player_id));
      return json({ bundle, correlationId, repaired: true });
    }
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Could not load replay.", { route: "/api/replays", method: "GET" });
  }
}
