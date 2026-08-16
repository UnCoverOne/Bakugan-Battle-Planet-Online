import { normalizeMatchState, type MatchState } from "../../../../lib/game";
import { getDatabase, getSessionUser } from "../../../../lib/account-server";
import { accountIsAdministrator } from "../../../../lib/admin-ai-visibility";
import { normalizeEngineState, type EngineBackedMatchState } from "../../../../lib/engine";
import { replayStateHash } from "../../../../lib/engine/replay-codec";
import {
  applyReplayStatePatch,
  isReplayStatePatch,
  replayPresentationState,
  type ReplayStatePatchOperation,
} from "../../../../lib/engine/replay-transition";
import type { ReplayArchive } from "../../../../lib/engine/replay-types";
import { buildReplayArchiveFromEventStore } from "../../../../lib/replay-archive-server";
import { buildReplayArchiveFromSnapshotHistory } from "../../../../lib/replay-snapshot-recovery";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  serverErrorResponse,
} from "../../../../lib/server-errors";

export const dynamic = "force-dynamic";

type ReplayRow = {
  replay_id: string;
  match_code: string;
  archive_json: string;
  final_state_hash: string;
  engine_version: string;
  rules_version: string;
  catalogue_version: string;
  completed_at: number;
  created_at: number;
};

type MatchRow = {
  state_json: string;
  previous_state_json: string | null;
  updated_at: number;
};

type CommandRow = {
  command_id: string;
  actor_id: string;
  expected_version: number;
  result_version: number;
  request_hash: string;
  event_sequence_start: number;
  event_sequence_end: number;
  created_at: number;
};

type EventRow = {
  sequence: number;
  command_id: string;
  event_type: string;
  actor_id: string;
  visibility: string;
  visible_to: string | null;
  payload_json: string;
  engine_version: string;
  rules_version: string;
  created_at: number;
};

type SnapshotRow = {
  version: number;
  state_json: string;
  created_at: number;
};

type AcceptedCommandDiagnostic = {
  sequence: number;
  commandId: string;
  actorId: string;
  expectedVersion: number | null;
  resultVersion: number | null;
  createdAt: number;
  hasReplayStatePatch: boolean;
  replayStatePatchOperationCount: number | null;
  payload: unknown;
  patch?: readonly ReplayStatePatchOperation[];
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function decodeJson(raw: string | null | undefined) {
  if (raw == null) return { value: null as unknown, error: null as string | null, raw: null as string | null };
  try {
    return { value: JSON.parse(raw) as unknown, error: null, raw: null };
  } catch (error) {
    return { value: null, error: errorMessage(error), raw };
  }
}

function reportJson(raw: string | null | undefined) {
  const decoded = decodeJson(raw);
  return decoded.error ? { parseError: decoded.error, raw: decoded.raw } : decoded.value;
}

function parseMatchState(raw: string | null | undefined): MatchState | null {
  if (!raw) return null;
  try {
    return normalizeMatchState(JSON.parse(raw) as MatchState);
  } catch {
    return null;
  }
}

function safeReplayHash(state: MatchState | null) {
  if (!state) return null;
  try {
    return replayStateHash(state);
  } catch (error) {
    return `ERROR: ${errorMessage(error)}`;
  }
}

function summarizeArchive(archive: ReplayArchive | null) {
  if (!archive) return null;
  return {
    replayId: archive.replayId,
    startedAt: archive.startedAt,
    completedAt: archive.completedAt,
    finalVersion: archive.finalVersion,
    finalStateHash: archive.finalStateHash,
    recordingCommandCount: archive.recording.commands.length,
    playback: archive.playback ? {
      frameCount: 1 + archive.playback.steps.length,
      stepCount: archive.playback.steps.length,
      initialLabel: archive.playback.initialFrame.label,
      recoveredGapSteps: archive.playback.steps
        .filter((step) => step.label.includes("Replay gap"))
        .map((step) => ({ index: step.index, label: step.label })),
      finalStateHash: archive.playback.finalStateHash,
    } : null,
  };
}

function parseArchive(raw: string): ReplayArchive | null {
  try {
    return JSON.parse(raw) as ReplayArchive;
  } catch {
    return null;
  }
}

function buildPatchTrace(
  genesis: MatchState | null,
  accepted: readonly AcceptedCommandDiagnostic[],
  finalState: MatchState | null,
) {
  if (!genesis) {
    return {
      status: "unavailable",
      reason: "No parseable non-lobby gameplay snapshot was available.",
    };
  }

  let current = replayPresentationState(genesis);
  let appliedPatchCount = 0;
  let firstFailure: Record<string, unknown> | null = null;
  const relevant = accepted.filter((step) => (
    step.resultVersion != null && step.resultVersion > genesis.version
  ));

  for (const step of relevant) {
    if (step.expectedVersion == null || step.resultVersion == null) {
      firstFailure = {
        kind: "MISSING_COMMAND_RECEIPT",
        commandId: step.commandId,
        sequence: step.sequence,
      };
      break;
    }
    if (step.expectedVersion !== current.version) {
      firstFailure = {
        kind: "EXPECTED_VERSION_MISMATCH",
        commandId: step.commandId,
        sequence: step.sequence,
        expectedVersion: step.expectedVersion,
        reconstructedVersion: current.version,
        resultVersion: step.resultVersion,
      };
      break;
    }
    if (!step.patch) {
      firstFailure = {
        kind: "MISSING_OR_INVALID_REPLAY_STATE_PATCH",
        commandId: step.commandId,
        sequence: step.sequence,
        expectedVersion: step.expectedVersion,
        resultVersion: step.resultVersion,
      };
      break;
    }
    try {
      current = applyReplayStatePatch(current, step.patch);
    } catch (error) {
      firstFailure = {
        kind: "REPLAY_STATE_PATCH_APPLY_FAILED",
        commandId: step.commandId,
        sequence: step.sequence,
        expectedVersion: step.expectedVersion,
        resultVersion: step.resultVersion,
        message: errorMessage(error),
      };
      break;
    }
    if (current.version !== step.resultVersion) {
      firstFailure = {
        kind: "RESULT_VERSION_MISMATCH",
        commandId: step.commandId,
        sequence: step.sequence,
        expectedVersion: step.expectedVersion,
        recordedResultVersion: step.resultVersion,
        reconstructedVersion: current.version,
      };
      break;
    }
    appliedPatchCount += 1;
  }

  const finalPresentation = finalState ? replayPresentationState(finalState) : null;
  const reconstructedHash = safeReplayHash(current);
  const finalHash = safeReplayHash(finalPresentation);
  const matchesFinal = finalPresentation
    ? current.version === finalPresentation.version && reconstructedHash === finalHash
    : null;

  if (!firstFailure && finalPresentation && !matchesFinal) {
    firstFailure = {
      kind: "FINAL_STATE_MISMATCH",
      reconstructedVersion: current.version,
      finalVersion: finalPresentation.version,
      reconstructedHash,
      finalHash,
    };
  }

  return {
    status: firstFailure ? "failed" : "complete",
    genesisVersion: genesis.version,
    candidateCommandCount: relevant.length,
    appliedPatchCount,
    firstFailure,
    reconstructedVersion: current.version,
    reconstructedHash,
    finalVersion: finalPresentation?.version ?? null,
    finalHash,
    matchesFinal,
  };
}

async function reconstructionSummary(
  database: D1Database,
  state: EngineBackedMatchState | null,
  completedAt: number,
) {
  if (!state) {
    return {
      eventStore: { status: "unavailable", reason: "The retained final match state could not be parsed." },
      snapshots: { status: "unavailable", reason: "The retained final match state could not be parsed." },
    };
  }

  let eventStore: Record<string, unknown>;
  try {
    eventStore = {
      status: "ok",
      archive: summarizeArchive(await buildReplayArchiveFromEventStore(database, state, completedAt)),
    };
  } catch (error) {
    eventStore = { status: "failed", message: errorMessage(error) };
  }

  let snapshots: Record<string, unknown>;
  try {
    const archive = await buildReplayArchiveFromSnapshotHistory(database, state, completedAt);
    snapshots = archive
      ? { status: "ok", archive: summarizeArchive(archive) }
      : { status: "insufficient-history", archive: null };
  } catch (error) {
    snapshots = { status: "failed", message: errorMessage(error) };
  }

  return { eventStore, snapshots };
}

export async function GET(request: Request) {
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  try {
    const user = await getSessionUser(request);
    if (!user) throw new AuthenticationError();
    if (!accountIsAdministrator(user)) {
      throw new AuthorizationError("Replay debug data is restricted to administrators.");
    }

    const replayId = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!replayId) throw new ValidationError("Replay ID is required.");
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(replayId)) throw new ValidationError("Replay ID is invalid.");

    const database = await getDatabase();
    const replay = await database.prepare(`SELECT
        replay_id, match_code, archive_json, final_state_hash, engine_version,
        rules_version, catalogue_version, completed_at, created_at
      FROM match_replays WHERE replay_id = ?`)
      .bind(replayId)
      .first<ReplayRow>();
    if (!replay) {
      return Response.json({ error: "Replay not found.", code: "NOT_FOUND", correlationId }, {
        status: 404,
        headers: { "cache-control": "private, no-store, max-age=0" },
      });
    }

    const [match, commandResult, eventResult, snapshotResult] = await Promise.all([
      database.prepare("SELECT state_json, previous_state_json, updated_at FROM matches WHERE code = ?")
        .bind(replay.match_code).first<MatchRow>(),
      database.prepare(`SELECT command_id, actor_id, expected_version, result_version, request_hash,
          event_sequence_start, event_sequence_end, created_at
        FROM match_commands WHERE code = ? ORDER BY result_version ASC, created_at ASC`)
        .bind(replay.match_code).all<CommandRow>(),
      database.prepare(`SELECT sequence, command_id, event_type, actor_id, visibility, visible_to,
          payload_json, engine_version, rules_version, created_at
        FROM match_events WHERE code = ? ORDER BY sequence ASC`)
        .bind(replay.match_code).all<EventRow>(),
      database.prepare("SELECT version, state_json, created_at FROM match_snapshots WHERE code = ? ORDER BY version ASC")
        .bind(replay.match_code).all<SnapshotRow>(),
    ]);

    const commands = commandResult.results ?? [];
    const events = eventResult.results ?? [];
    const snapshots = snapshotResult.results ?? [];
    const commandById = new Map(commands.map((command) => [command.command_id, command]));
    const accepted: AcceptedCommandDiagnostic[] = events
      .filter((event) => event.event_type === "COMMAND_ACCEPTED")
      .map((event) => {
        const command = commandById.get(event.command_id);
        const decoded = decodeJson(event.payload_json);
        const payload = decoded.error
          ? { parseError: decoded.error, raw: decoded.raw }
          : decoded.value;
        const replayStatePatch = payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).replayStatePatch
          : undefined;
        const patch = isReplayStatePatch(replayStatePatch) ? replayStatePatch : undefined;
        return {
          sequence: event.sequence,
          commandId: event.command_id,
          actorId: event.actor_id,
          expectedVersion: command?.expected_version ?? null,
          resultVersion: command?.result_version ?? null,
          createdAt: event.created_at,
          hasReplayStatePatch: Boolean(patch),
          replayStatePatchOperationCount: patch?.length ?? null,
          payload,
          patch,
        };
      });

    const snapshotDiagnostics = snapshots.map((snapshot) => {
      const state = parseMatchState(snapshot.state_json);
      return {
        version: snapshot.version,
        createdAt: snapshot.created_at,
        phase: state?.phase ?? null,
        parsedVersion: state?.version ?? null,
        state: reportJson(snapshot.state_json),
        parsedState: state,
      };
    });
    const gameplaySnapshot = snapshotDiagnostics.find((snapshot) => (
      snapshot.parsedState && snapshot.parsedState.phase !== "lobby"
    ));

    const finalState = parseMatchState(match?.state_json);
    const engineState = finalState ? normalizeEngineState(finalState) : null;
    const archived = parseArchive(replay.archive_json);
    const relevantAccepted = gameplaySnapshot?.parsedState
      ? accepted.filter((entry) => entry.resultVersion != null && entry.resultVersion > gameplaySnapshot.parsedState!.version)
      : accepted;
    const commandsWithPatch = relevantAccepted.filter((entry) => entry.hasReplayStatePatch).length;
    const acceptedCommandIds = new Set(accepted.map((entry) => entry.commandId));
    const eventTypeCounts = events.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});
    const reconstructions = await reconstructionSummary(database, engineState, replay.completed_at);
    const firstRelevantAccepted = relevantAccepted[0];
    const lastRelevantAccepted = relevantAccepted.at(-1);

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      generatedAtMs: Date.now(),
      correlationId,
      notice: "Administrator-only replay diagnostic. This file contains unprojected match state, hidden card information, and internal engine history.",
      replay: {
        replayId: replay.replay_id,
        matchCode: replay.match_code,
        completedAt: replay.completed_at,
        createdAt: replay.created_at,
        storedFinalStateHash: replay.final_state_hash,
        engineVersion: replay.engine_version,
        rulesVersion: replay.rules_version,
        catalogueVersion: replay.catalogue_version,
        archiveSummary: summarizeArchive(archived),
        archive: reportJson(replay.archive_json),
      },
      diagnostics: {
        retainedMatchPresent: Boolean(match),
        finalVersion: finalState?.version ?? archived?.finalVersion ?? null,
        finalStateHashFromRetainedState: safeReplayHash(finalState),
        snapshotCount: snapshots.length,
        snapshotVersions: snapshots.map((snapshot) => snapshot.version),
        gameplaySnapshotVersion: gameplaySnapshot?.version ?? null,
        commandCount: commands.length,
        eventCount: events.length,
        eventTypeCounts,
        acceptedCommandCount: accepted.length,
        acceptedCommandsAfterGameplaySnapshot: relevantAccepted.length,
        commandsWithReplayStatePatch: commandsWithPatch,
        commandsWithoutReplayStatePatch: relevantAccepted.length - commandsWithPatch,
        acceptedEventsWithoutCommandReceipt: relevantAccepted.filter((entry) => entry.expectedVersion == null).length,
        commandRowsWithoutAcceptedEvent: commands
          .filter((command) => !acceptedCommandIds.has(command.command_id))
          .map((command) => command.command_id),
        firstAcceptedCommandAfterGameplaySnapshot: firstRelevantAccepted ? {
          commandId: firstRelevantAccepted.commandId,
          expectedVersion: firstRelevantAccepted.expectedVersion,
          resultVersion: firstRelevantAccepted.resultVersion,
          sequence: firstRelevantAccepted.sequence,
        } : null,
        lastAcceptedCommandAfterGameplaySnapshot: lastRelevantAccepted ? {
          commandId: lastRelevantAccepted.commandId,
          expectedVersion: lastRelevantAccepted.expectedVersion,
          resultVersion: lastRelevantAccepted.resultVersion,
          sequence: lastRelevantAccepted.sequence,
        } : null,
        patchTrace: buildPatchTrace(gameplaySnapshot?.parsedState ?? null, accepted, finalState),
        reconstructionAttempts: reconstructions,
      },
      retainedMatch: match ? {
        updatedAt: match.updated_at,
        currentState: reportJson(match.state_json),
        previousState: reportJson(match.previous_state_json),
      } : null,
      engineHistory: {
        commands,
        acceptedCommands: accepted.map(({ patch: _patch, ...entry }) => entry),
        events: events.map((event) => ({
          sequence: event.sequence,
          commandId: event.command_id,
          eventType: event.event_type,
          actorId: event.actor_id,
          visibility: event.visibility,
          visibleTo: event.visible_to,
          engineVersion: event.engine_version,
          rulesVersion: event.rules_version,
          createdAt: event.created_at,
          payload: reportJson(event.payload_json),
        })),
      },
      snapshots: snapshotDiagnostics.map(({ parsedState: _parsedState, ...snapshot }) => snapshot),
    };

    const safeReplayId = replayId.replace(/[^A-Za-z0-9._-]/g, "_");
    return new Response(`${JSON.stringify(report, null, 2)}\n`, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="replay-debug-${safeReplayId}.txt"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return serverErrorResponse(error, correlationId, "Could not export replay debug data.", {
      route: "/api/replays/debug",
      method: "GET",
    });
  }
}
