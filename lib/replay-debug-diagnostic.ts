import { isReplayStatePatch } from "./engine/replay-transition";
import {
  isLocalEngineHistoryDraft,
  type LocalEngineHistoryTransition,
  type StoredLocalReplayJournal,
} from "./local-replay-history";

const TRANSITION_SAMPLE_SIZE = 3;

function summarizeTransition(transition: LocalEngineHistoryTransition, index: number) {
  const accepted = transition.events.find((event) => (
    event.type === "COMMAND_ACCEPTED" && event.commandId === transition.envelope.commandId
  ));
  return {
    index,
    commandId: transition.envelope.commandId,
    commandType: transition.envelope.command.type,
    actorId: transition.envelope.actorId,
    issuedAt: transition.envelope.issuedAt,
    expectedVersion: transition.envelope.expectedVersion,
    resultVersion: transition.resultVersion,
    beforeStateHash: transition.beforeStateHash ?? null,
    resultStateHash: transition.resultStateHash ?? null,
    hasReplayStatePatch: isReplayStatePatch(accepted?.payload?.replayStatePatch),
    eventTypes: transition.events.map((event) => event.type),
  };
}

/**
 * Keep the most useful local engine-history chain details near the top of an
 * administrator replay diagnostic while the complete raw journal remains
 * attached separately for deeper inspection.
 */
export function buildLocalReplayJournalDiagnostic(journal: StoredLocalReplayJournal | null) {
  if (!journal) return null;
  if (!isLocalEngineHistoryDraft(journal)) {
    return {
      kind: "legacy-command-journal" as const,
      schemaVersion: journal.schemaVersion ?? 1,
      transitionCount: journal.recording.commands.length,
      integrityFault: null,
      headStateHash: null,
      genesisVersion: journal.recording.genesis.v,
      finalVersion: journal.finalState?.version ?? null,
      completedAt: journal.completedAt ?? null,
      firstTransitions: [],
      lastTransitions: [],
    };
  }

  const transitionCount = journal.transitions.length;
  const lastStart = Math.max(0, transitionCount - TRANSITION_SAMPLE_SIZE);
  return {
    kind: "engine-history" as const,
    schemaVersion: journal.schemaVersion,
    transitionCount,
    integrityFault: journal.integrityFault ?? null,
    headStateHash: journal.headStateHash ?? null,
    genesisVersion: journal.genesis.version,
    finalVersion: journal.finalState?.version ?? null,
    completedAt: journal.completedAt ?? null,
    firstTransitions: journal.transitions
      .slice(0, TRANSITION_SAMPLE_SIZE)
      .map((transition, index) => summarizeTransition(transition, index)),
    lastTransitions: journal.transitions
      .slice(lastStart)
      .map((transition, index) => summarizeTransition(transition, lastStart + index)),
  };
}
