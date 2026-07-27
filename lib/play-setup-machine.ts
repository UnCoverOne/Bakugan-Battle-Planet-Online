import type { DeckValidationIssue } from "./deck-validation";

export type PlaySetupStep = "mode" | "loadout" | "ready";
export type PlaySetupMode = "solo" | "online" | "join";
export type PlaySetupFormat = "bo1" | "bo3";
export type PlaySetupStatus = "editing" | "launching" | "failed";
export type PlaySetupFailureKind = "validation" | "connection" | "authentication" | "room" | "launch";

export type PlaySetupFailure = {
  kind: PlaySetupFailureKind;
  message: string;
};

export type PlaySetupState = {
  step: PlaySetupStep;
  mode: PlaySetupMode;
  format: PlaySetupFormat;
  selectedDeckId: string;
  joinCode: string;
  status: PlaySetupStatus;
  failure: PlaySetupFailure | null;
};

export type PlaySetupEnvironment = {
  selectedDeck: {
    id: string;
    isLegal: boolean;
    issues: ReadonlyArray<Pick<DeckValidationIssue, "code" | "message">>;
  } | null;
  connection: "online" | "offline";
  authentication: "checking" | "authenticated" | "guest" | "failed";
};

export type PlaySetupBlocker = {
  code: string;
  message: string;
  kind: PlaySetupFailureKind;
};

export type PlaySetupEvent =
  | { type: "SELECT_MODE"; mode: PlaySetupMode }
  | { type: "SELECT_FORMAT"; format: PlaySetupFormat }
  | { type: "SELECT_DECK"; deckId: string }
  | { type: "SET_JOIN_CODE"; code: string }
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "NAVIGATE"; step: PlaySetupStep }
  | { type: "LAUNCH" }
  | { type: "LAUNCH_FAILURE"; failure: PlaySetupFailure }
  | { type: "CLEAR_FAILURE" }
  | { type: "RESTORE"; state: PlaySetupState };

export type PlaySetupEnvelope = {
  event: PlaySetupEvent;
  environment: PlaySetupEnvironment;
};

const steps: PlaySetupStep[] = ["mode", "loadout", "ready"];
const allowedRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

export function parsePlaySetupStep(value: string | null | undefined): PlaySetupStep | null {
  return value === "mode" || value === "loadout" || value === "ready" ? value : null;
}

export function normalizeRoomCode(value: string) {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

export function createPlaySetupState(
  values: Partial<Pick<PlaySetupState, "step" | "mode" | "format" | "selectedDeckId" | "joinCode">> = {},
): PlaySetupState {
  return {
    step: parsePlaySetupStep(values.step) ?? "mode",
    mode: values.mode === "online" || values.mode === "join" ? values.mode : "solo",
    format: values.format === "bo3" ? "bo3" : "bo1",
    selectedDeckId: typeof values.selectedDeckId === "string" ? values.selectedDeckId : "",
    joinCode: normalizeRoomCode(values.joinCode ?? ""),
    status: "editing",
    failure: null,
  };
}

export function restorePlaySetupState(value: unknown, fallback: PlaySetupState) {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<PlaySetupState>;
  return createPlaySetupState({
    step: parsePlaySetupStep(candidate.step) ?? fallback.step,
    mode: candidate.mode ?? fallback.mode,
    format: candidate.format ?? fallback.format,
    selectedDeckId: typeof candidate.selectedDeckId === "string"
      ? candidate.selectedDeckId
      : fallback.selectedDeckId,
    joinCode: typeof candidate.joinCode === "string" ? candidate.joinCode : fallback.joinCode,
  });
}

function deckBlockers(environment: PlaySetupEnvironment): PlaySetupBlocker[] {
  if (!environment.selectedDeck) {
    return [{
      code: "loadout.deck_required",
      message: "Select a deck before continuing.",
      kind: "validation",
    }];
  }
  if (environment.selectedDeck.isLegal) return [];
  return environment.selectedDeck.issues.map((candidate) => ({
    code: candidate.code,
    message: candidate.message,
    kind: "validation" as const,
  }));
}

export function playSetupStartBlockers(
  state: PlaySetupState,
  environment: PlaySetupEnvironment,
): PlaySetupBlocker[] {
  const blockers = deckBlockers(environment);
  if (state.mode === "join" && !allowedRoomCode.test(state.joinCode)) {
    blockers.push({
      code: "room.code_required",
      message: "Enter the complete six-character room code.",
      kind: "room",
    });
  }
  if (state.mode !== "solo" && environment.connection === "offline") {
    blockers.push({
      code: "connection.offline",
      message: "Reconnect to the internet before starting an online match.",
      kind: "connection",
    });
  }
  if (state.mode !== "solo" && environment.authentication === "checking") {
    blockers.push({
      code: "authentication.checking",
      message: "Account status is still being checked.",
      kind: "authentication",
    });
  }
  if (state.mode !== "solo" && environment.authentication === "failed") {
    blockers.push({
      code: "authentication.failed",
      message: "Restore the account session or continue as a guest before starting online play.",
      kind: "authentication",
    });
  }
  return blockers;
}

export function playSetupStepBlockers(
  state: PlaySetupState,
  environment: PlaySetupEnvironment,
): PlaySetupBlocker[] {
  if (state.step === "mode") return [];
  if (state.step === "loadout") return deckBlockers(environment);
  return playSetupStartBlockers(state, environment);
}

function blocked(state: PlaySetupState, blocker: PlaySetupBlocker): PlaySetupState {
  return {
    ...state,
    status: "failed",
    failure: { kind: blocker.kind, message: blocker.message },
  };
}

function editable(state: PlaySetupState): PlaySetupState {
  return { ...state, status: "editing", failure: null };
}

export function transitionPlaySetup(
  state: PlaySetupState,
  event: PlaySetupEvent,
  environment: PlaySetupEnvironment,
): PlaySetupState {
  if (event.type === "RESTORE") return editable(event.state);
  if (event.type === "SELECT_MODE") {
    return editable({ ...state, mode: event.mode, joinCode: event.mode === "join" ? state.joinCode : "" });
  }
  if (event.type === "SELECT_FORMAT") return editable({ ...state, format: event.format });
  if (event.type === "SELECT_DECK") return editable({ ...state, selectedDeckId: event.deckId });
  if (event.type === "SET_JOIN_CODE") {
    return editable({ ...state, joinCode: normalizeRoomCode(event.code) });
  }
  if (event.type === "CLEAR_FAILURE") return editable(state);
  if (event.type === "LAUNCH_FAILURE") {
    return { ...state, status: "failed", failure: event.failure };
  }
  if (event.type === "BACK") {
    const index = Math.max(0, steps.indexOf(state.step) - 1);
    return editable({ ...state, step: steps[index] });
  }
  if (event.type === "NEXT") {
    if (state.step === "mode") return editable({ ...state, step: "loadout" });
    if (state.step === "loadout") {
      const blocker = deckBlockers(environment)[0];
      return blocker ? blocked(state, blocker) : editable({ ...state, step: "ready" });
    }
    return editable(state);
  }
  if (event.type === "NAVIGATE") {
    if (event.step === "mode" || event.step === "loadout") {
      return editable({ ...state, step: event.step });
    }
    const blocker = deckBlockers(environment)[0];
    return blocker
      ? blocked({ ...state, step: "loadout" }, blocker)
      : editable({ ...state, step: "ready" });
  }
  if (event.type === "LAUNCH") {
    const blocker = playSetupStartBlockers(state, environment)[0];
    if (state.step !== "ready") {
      return blocked(state, {
        code: "setup.ready_required",
        message: "Complete Mode and Loadout before starting the match.",
        kind: "validation",
      });
    }
    return blocker
      ? blocked(state, blocker)
      : { ...state, status: "launching", failure: null };
  }
  return state;
}

export function playSetupReducer(state: PlaySetupState, envelope: PlaySetupEnvelope) {
  return transitionPlaySetup(state, envelope.event, envelope.environment);
}

export function classifyPlaySetupFailure(message: string): PlaySetupFailure {
  const normalized = message.trim() || "The match could not be started.";
  if (/(auth|unauthor|forbidden|capability|session|sign.?in)/i.test(normalized)) {
    return { kind: "authentication", message: normalized };
  }
  if (/(network|fetch|offline|connection|unavailable|timeout)/i.test(normalized)) {
    return { kind: "connection", message: normalized };
  }
  if (/(room|code|full|not found)/i.test(normalized)) {
    return { kind: "room", message: normalized };
  }
  return { kind: "launch", message: normalized };
}
