import type { MatchState } from "../game";
import type { CommandActorId, GameEvent, UnsequencedGameEvent } from "./types";

type StoredLogEntry = {
  id: string;
  at: number;
  kind: string;
  message: string;
  [key: string]: unknown;
};

type LogPresentation = {
  template: "literal";
  values: { message: string };
};

function isStoredLogEntry(value: unknown): value is StoredLogEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.at === "number"
    && typeof entry.kind === "string";
}

function renderPresentation(value: unknown, fallback = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const presentation = value as Partial<LogPresentation>;
  if (presentation.template !== "literal") return fallback;
  return typeof presentation.values?.message === "string" ? presentation.values.message : fallback;
}

/**
 * Convert the reducer's transient log entry into an authoritative structured
 * engine event. The presentation is versionable independently from MatchState.
 */
export function logEntryAddedEvent(
  source: MatchState["log"][number] | StoredLogEntry,
  actorId: CommandActorId,
): UnsequencedGameEvent {
  const entry = structuredClone(source) as unknown as StoredLogEntry;
  const { message, ...metadata } = entry;
  return {
    type: "LOG_ENTRY_ADDED",
    actorId,
    visibility: "public",
    payload: {
      logId: entry.id,
      kind: entry.kind,
      at: entry.at,
      // Retained for event-stream compatibility; new projections render the
      // versioned presentation object below instead of treating this as state.
      message,
      entry: metadata,
      presentation: {
        template: "literal",
        values: { message },
      } satisfies LogPresentation,
    },
  };
}

/**
 * Materialize the MatchState.log compatibility cache from engine events.
 * Gameplay code may still emit transient entries while resolving a command,
 * but the authoritative post-command state is projected from its event stream.
 */
export function projectMatchLog(
  previous: readonly MatchState["log"][number][],
  events: readonly Pick<GameEvent, "type" | "payload">[],
): MatchState["log"] {
  const projected = structuredClone(previous) as unknown as StoredLogEntry[];
  const ids = new Set(projected.map((entry) => entry.id));

  for (const event of events) {
    if (event.type !== "LOG_ENTRY_ADDED") continue;
    const payload = event.payload as Record<string, unknown>;
    const metadata = payload.entry;
    let entry: StoredLogEntry | undefined;
    if (isStoredLogEntry(metadata)) {
      entry = {
        ...structuredClone(metadata),
        message: renderPresentation(payload.presentation, typeof payload.message === "string" ? payload.message : ""),
      };
    } else {
      const id = typeof payload.logId === "string" ? payload.logId : "";
      const at = typeof payload.at === "number" ? payload.at : 0;
      const kind = typeof payload.kind === "string" ? payload.kind : "game";
      const message = renderPresentation(payload.presentation, typeof payload.message === "string" ? payload.message : "");
      if (id) entry = { id, at, kind, message };
    }
    if (!entry || ids.has(entry.id)) continue;
    ids.add(entry.id);
    projected.push(entry);
  }

  return projected as unknown as MatchState["log"];
}
