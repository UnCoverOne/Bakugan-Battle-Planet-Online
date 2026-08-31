"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type CardChoices, type MatchState } from "../../lib/game";
import { accountIsAdministrator } from "../../lib/admin-ai-visibility";
import { dispatchLocalGameAction, dispatchLocalGameCommand } from "../../lib/engine/local-command-dispatcher";
import type { ApiAction } from "../../lib/engine/commands";
import type { GameCommand } from "../../lib/engine/types";
import {
  opponentAiCanAct,
  recoverOpponentAiCommand,
} from "../../lib/opponentAiCanAct";
import { canUndoLatest } from "../../lib/undo";
import { isCompletedSeriesResult } from "../../lib/match-result-navigation";
import { loadLocalReplayHistory } from "../../lib/replay-local-store";
import { flushLocalReplayJournalAndWait } from "../../lib/replay-journal";
import {
  playerCanFlipTieBreak,
  shouldStartManualTieBreak,
} from "../../lib/manualTieBreak";
import {
  drawStepIsPending,
  playerCanDrawTurnCard,
  playerHasDrawnTurnCard,
  type TurnStartMatchState,
} from "../../lib/turnStart";
import { useApp } from "../application/AppProvider";
import { BakuCoreLayer } from "./BakuCoreLayer";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { CardHandLayer } from "./CardHandLayer";
import { CardPreviewLayer } from "./CardPreviewLayer";
import { CoinFlipLayer } from "./CoinFlipLayer";
import { CorePlacementLayer } from "./CorePlacementLayer";
import { DamageStepLayer } from "./DamageStepLayer";
import { EnergyAffordabilityLayer } from "./EnergyAffordabilityLayer";
import { EnergyArrivalLayer } from "./EnergyArrivalLayer";
import { GameMenuHud } from "./GameMenuHud";
import { GameScreen } from "./GameScreen";
import { MatchHudLayer } from "./MatchHudLayer";
import { PhaseTransitionLayer } from "./PhaseTransitionLayer";
import {
  writeCoordinatedMatch,
  writeGameRoute,
  writeGameSettings,
} from "./MatchStateCoordinator";
import { finalizeCompletedMatchExit, matchCommandHeaders, readMatchStore, useMatchSelector } from "./matchStore";
import { SelectionInteractionLayer } from "./SelectionInteractionLayer";
import { TieBreakLayer } from "./TieBreakLayer";
import { TurnProgressTracker } from "./TurnProgressTracker";
import {
  cardRequiresSelection,
  handDiscardRequirement,
  shouldAutomaticallyPass,
  type HandActionMode,
} from "./matchHudState";

const SETTINGS_KEY = "bbp-settings";
const OPPONENT_AI_DECISION_TIMEOUT_MS = 8_000;

function downloadJsonFile(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function engineHistoryFilename(match: MatchState, exportedAt: number) {
  const identity = (match.code || match.id).replace(/[^A-Za-z0-9_-]+/g, "-");
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, "-");
  return `bakugan-engine-history-${identity}-${timestamp}.json`;
}

type StoredGameScreenState = {
  route: string;
  automaticDraw: boolean;
  automaticPass: boolean;
  soundEnabled: boolean;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

type GameplaySettings = {
  automaticDraw?: boolean;
  automaticPass?: boolean;
  soundEnabled?: boolean;
  [key: string]: unknown;
};

type OpponentAiWorkerResponse = {
  requestId: number;
  command?: GameCommand | null;
  error?: string;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readSettings(): GameplaySettings {
  return parseStoredValue<GameplaySettings>(localStorage.getItem(SETTINGS_KEY), {});
}

export function GameplayClient() {
  const router = useRouter();
  const { authUser } = useApp();
  const administrator = accountIsAdministrator(authUser);
  const storedState = useMatchSelector((state): StoredGameScreenState => ({
    route: state.route,
    automaticDraw: Boolean(state.settings.automaticDraw),
    automaticPass: Boolean(state.settings.automaticPass),
    soundEnabled: state.settings.soundEnabled == null
      ? state.settings.sound !== false
      : state.settings.soundEnabled !== false,
    match: state.match,
    online: state.online,
    playerId: state.playerId,
  }));
  const [handActionMode, setHandActionMode] = useState<HandActionMode>(null);
  const [selectedHandCardId, setSelectedHandCardId] = useState("");
  const [selectedDiscardCardIds, setSelectedDiscardCardIds] = useState<string[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [startupError, setStartupError] = useState("");
  const [resumeEpoch, setResumeEpoch] = useState(0);
  const automaticActionKey = useRef("");
  const automaticPassSchedule = useRef<{ key: string; dueAt: number } | null>(null);
  const botActionKey = useRef("");
  const botWorkerRef = useRef<Worker | null>(null);
  const botWorkerRequestId = useRef(0);
  const botWorkerPending = useRef(new Map<number, {
    resolve: (command: GameCommand | null) => void;
    reject: (cause: Error) => void;
    timeoutId: number;
  }>());
  const { rollPresentationPending } = useBakuCorePresentation();

  const requestOpponentAiDecision = useCallback((match: MatchState, playerId: string) => {
    if (typeof Worker === "undefined") {
      return import("../../lib/opponentAi").then(({ chooseOpponentAiCommand }) => (
        chooseOpponentAiCommand(match, playerId)
      ));
    }
    let worker = botWorkerRef.current;
    if (!worker) {
      worker = new Worker(new URL("./opponentAi.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<OpponentAiWorkerResponse>) => {
        const pending = botWorkerPending.current.get(event.data.requestId);
        if (!pending) return;
        botWorkerPending.current.delete(event.data.requestId);
        window.clearTimeout(pending.timeoutId);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data.command ?? null);
      });
      worker.addEventListener("error", (event) => {
        const cause = new Error(event.message || "The opponent AI worker stopped unexpectedly.");
        for (const pending of botWorkerPending.current.values()) {
          window.clearTimeout(pending.timeoutId);
          pending.reject(cause);
        }
        botWorkerPending.current.clear();
        worker?.terminate();
        botWorkerRef.current = null;
      });
      botWorkerRef.current = worker;
    }
    const requestId = ++botWorkerRequestId.current;
    return new Promise<GameCommand | null>((resolve, reject) => {
      const activeWorker = worker!;
      const timeoutId = window.setTimeout(() => {
        const pending = botWorkerPending.current.get(requestId);
        if (!pending) return;
        botWorkerPending.current.delete(requestId);
        pending.reject(new Error("The opponent AI decision timed out."));
        if (botWorkerRef.current === activeWorker) {
          activeWorker.terminate();
          botWorkerRef.current = null;
        }
      }, OPPONENT_AI_DECISION_TIMEOUT_MS);
      botWorkerPending.current.set(requestId, { resolve, reject, timeoutId });
      activeWorker.postMessage({ requestId, match, playerId });
    });
  }, []);

  useEffect(() => () => {
    botWorkerRef.current?.terminate();
    botWorkerRef.current = null;
    const cause = new Error("The gameplay screen closed before the opponent AI finished.");
    for (const pending of botWorkerPending.current.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(cause);
    }
    botWorkerPending.current.clear();
  }, []);

  useEffect(() => {
    const resume = () => {
      automaticActionKey.current = "";
      setResumeEpoch(Date.now());
    };
    const resumeVisibleTab = () => {
      if (document.visibilityState === "visible") resume();
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resumeVisibleTab);
    return () => {
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resumeVisibleTab);
    };
  }, []);

  const publishMatch = useCallback((next: MatchState) => {
    return writeCoordinatedMatch(next);
  }, []);

  const submitMatchAction = useCallback(async (
    action: ApiAction,
    payload: Record<string, unknown>,
  ) => {
    const current = readMatchStore();
    const match = current.match;
    const actorId = current.playerId ?? match?.players[0]?.id;
    if (!match || !actorId) throw new Error("No active match is available.");

    if (!current.online) {
      let next = dispatchLocalGameAction(match, actorId, action, payload);
      if (action === "draw") {
        const trainingBot = next.players.find((player) => player.id === "training-bot");
        if (trainingBot && playerCanDrawTurnCard(next, trainingBot.id)) {
          next = dispatchLocalGameAction(next, trainingBot.id, "draw");
        }
      }
      publishMatch(next);
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      cache: "no-store",
      headers: matchCommandHeaders(current),
      body: JSON.stringify({
        action,
        code: match.code,
        playerId: actorId,
        expectedVersion: match.version,
        payload,
      }),
    });
    const data = await response.json() as { state?: MatchState; error?: string };
    if (data.state) publishMatch(data.state);
    if (!response.ok) throw new Error(data.error ?? "The match action could not be completed.");
  }, [publishMatch]);

  const tapEnergy = (cardId: string) => submitMatchAction(
    "tap-energy",
    { cardId },
  );

  const beginPlacement = useCallback(() => submitMatchAction(
    "begin-placement",
    {},
  ), [submitMatchAction]);

  const undo = () => submitMatchAction(
    "undo",
    {},
  );

  const drawCard = useCallback(() => submitMatchAction(
    "draw",
    {},
  ), [submitMatchAction]);

  const playHandCard = (cardId: string, choices: CardChoices) => {
    const current = readMatchStore();
    const actorId = current.playerId ?? current.match?.players[0]?.id;
    const requiresChoice = Boolean(current.match && actorId && cardRequiresSelection(current.match, actorId, cardId));
    return submitMatchAction(
      requiresChoice && !Object.keys(choices).length ? "prepare-play" : "play",
      { cardId, choices },
    );
  };

  const energizeHandCard = (cardId: string) => submitMatchAction(
    "energize",
    { cardId },
  );

  const discardSelectedCards = (cardIds: string[]) => {
    const current = readMatchStore();
    const actorId = current.playerId ?? current.match?.players[0]?.id;
    const pendingDiscard = current.match?.pendingChoice?.schema.fields.some((field) => (
      field.id === "discardCardIds" && field.chooserId === actorId
    ));
    return submitMatchAction(
      pendingDiscard ? "choice" : "hand-limit",
      pendingDiscard ? { choices: { discardCardIds: cardIds } } : { cardIds },
    );
  };

  const skipEnergizing = () => submitMatchAction(
    "energize",
    {},
  );

  const activateReroll = () => submitMatchAction(
    "reroll",
    {},
  );

  const activateFusion = (bakuganId: string, requirementId: string) => submitMatchAction(
    "fuse",
    { bakuganId, requirement: requirementId },
  );

  const passTurn = useCallback(() => submitMatchAction(
    "pass",
    {},
  ), [submitMatchAction]);

  const completeCoinFlip = () => submitMatchAction(
    "complete-coin-flip",
    {},
  );

  const advanceEndPhase = useCallback(() => submitMatchAction(
    "next-turn",
    {},
  ), [submitMatchAction]);

  const flipDamage = () => submitMatchAction(
    "flip-damage",
    {},
  );

  const flipTieBreak = () => submitMatchAction(
    "flip-damage",
    {},
  );

  const playFlip = (cardId: string, choices: CardChoices) => submitMatchAction(
    "damage",
    { cardId, choices },
  );

  const skipFlip = () => submitMatchAction(
    "damage",
    {},
  );

  const selectCharacter = (bakuganId: string) => submitMatchAction(
    "select",
    { bakuganId },
  );

  const concede = async () => {
    await submitMatchAction(
      "concede",
      {},
    );
  };

  const updatePreference = (key: "automaticDraw" | "automaticPass" | "soundEnabled", enabled: boolean) => {
    const settings = readSettings();
    writeGameSettings({
      ...settings,
      [key]: enabled,
      ...(key === "soundEnabled" ? { sound: enabled } : {}),
    });
  };

  const openSettings = () => {
    writeGameRoute("settings");
    window.location.reload();
  };

  const downloadMatchEngineHistory = useCallback(async () => {
    if (!administrator) throw new Error("Administrator access is required.");
    const current = readMatchStore();
    const match = current.match;
    if (!match) throw new Error("No active match is available.");
    const exportedAt = Date.now();
    let history: unknown;

    if (current.online) {
      const response = await fetch(
        `/api/admin?section=match-engine-history&code=${encodeURIComponent(match.code)}`,
        { cache: "no-store" },
      );
      const result = await response.json() as { history?: unknown; error?: string };
      if (!response.ok || !result.history) {
        throw new Error(result.error ?? "The engine history could not be downloaded.");
      }
      history = result.history;
    } else {
      await flushLocalReplayJournalAndWait();
      const journal = await loadLocalReplayHistory(match.id);
      history = {
        format: "bakugan-engine-history",
        schemaVersion: 1,
        source: "local",
        exportedAt,
        exportedByAdministratorId: authUser?.id,
        match: {
          id: match.id,
          code: match.code,
          updatedAt: exportedAt,
          currentState: match,
        },
        journal,
      };
    }

    downloadJsonFile(engineHistoryFilename(match, exportedAt), history);
  }, [administrator, authUser?.id]);

  useEffect(() => {
    const match = storedState.match;
    if (storedState.route !== "match" || match?.phase !== "startingPlayer") return;
    const delay = Math.max(0, match.startingPlayerRevealedAt - Date.now());
    let cancelled = false;
    let retryTimer = 0;
    const attempt = async (remainingAttempts: number) => {
      if (cancelled || readMatchStore().match?.phase !== "startingPlayer") return;
      try {
        await beginPlacement();
        if (!cancelled) setStartupError("");
      } catch (cause) {
        if (cancelled || readMatchStore().match?.phase !== "startingPlayer") return;
        if (remainingAttempts > 0) {
          retryTimer = window.setTimeout(() => void attempt(remainingAttempts - 1), 900);
          return;
        }
        setStartupError(cause instanceof Error ? cause.message : "The server did not advance the match.");
      }
    };
    setStartupError("");
    const timeout = window.setTimeout(() => void attempt(2), delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [beginPlacement, resumeEpoch, storedState.match, storedState.route]);

  useEffect(() => {
    const match = storedState.match;
    const actorId = storedState.playerId ?? match?.players[0]?.id;
    const triggerOrderPending = match?.triggerOrders.some((request) => !request.orderedIds);
    const resetResolutionPending = match?.phase === "reset" && Boolean(
      match.pendingChoice || match.batch.length || triggerOrderPending,
    );
    if (
      storedState.route !== "match"
      || !match
      || !actorId
      || !["charge", "reset"].includes(match.phase)
      || resetResolutionPending
      || (storedState.online && actorId !== match.startingPlayer)
    ) return;

    const key = `end-phase:${match.id}:${match.version}:${match.phase}`;
    const delay = Math.max(0, match.deadline - Date.now());
    const timeout = window.setTimeout(() => {
      if (automaticActionKey.current === key) return;
      automaticActionKey.current = key;
      void advanceEndPhase().catch(() => {
        if (automaticActionKey.current === key) automaticActionKey.current = "";
      });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    storedState.route,
    storedState.online,
    storedState.match?.id,
    storedState.match?.phase,
    storedState.match?.version,
    storedState.match?.deadline,
    storedState.match?.batch.length,
    storedState.match?.pendingChoice?.id,
    storedState.match?.triggerOrders.length,
    storedState.playerId,
    storedState.match,
    advanceEndPhase,
    resumeEpoch,
  ]);

  useEffect(() => {
    const match = storedState.match;
    if (
      storedState.route !== "match"
      || storedState.online
      || !match
      || rollPresentationPending
    ) return;

    const waitingForDrawWindow = match.phase === "draw"
      && (match.drawRemainingByPlayer?.["training-bot"] ?? 0) > 0;
    const waitingForTieBreak = playerCanFlipTieBreak(match, "training-bot");
    const startingTieBreak = shouldStartManualTieBreak(match, "training-bot");
    if (
      !waitingForDrawWindow
      && !waitingForTieBreak
      && !startingTieBreak
      && !opponentAiCanAct(match, "training-bot")
    ) return;

    const key = `${match.id}:${match.version}:${match.phase}:${match.pendingChoice?.id ?? ""}:${match.pendingCoinFlip?.id ?? ""}`;
    if (botActionKey.current === key) return;
    botActionKey.current = key;
    const drawDelay = waitingForDrawWindow
      ? Math.max(0, (match.drawReadyAt ?? 0) - Date.now())
      : 0;
    const coinFlipDelay = match.pendingCoinFlip?.controllerId === "training-bot"
      ? Math.max(0, match.pendingCoinFlip.resolveAt - Date.now())
      : 0;
    let requestStarted = false;
    const timeout = window.setTimeout(() => {
      requestStarted = true;
      void (async () => {
        try {
          const latest = readMatchStore().match;
          if (!latest || latest.id !== match.id || latest.version !== match.version) return;
          const decision: GameCommand | null = playerCanFlipTieBreak(latest, "training-bot")
            ? { type: "REVEAL_DAMAGE_FLIP" }
            : shouldStartManualTieBreak(latest, "training-bot")
              ? { type: "PASS_PRIORITY" }
              : await requestOpponentAiDecision(latest, "training-bot");
          const current = readMatchStore().match;
          if (current?.id !== latest.id || current.version !== latest.version) return;
          const command = decision ?? recoverOpponentAiCommand(latest, "training-bot");
          if (command) {
            publishMatch(dispatchLocalGameCommand(
              latest,
              "training-bot",
              command,
              storedState.playerId ?? latest.players[0]?.id,
            ));
          }
        } catch {
          const latest = readMatchStore().match;
          if (latest?.id === match.id && latest.version === match.version) {
            const recovered = recoverOpponentAiCommand(latest, "training-bot");
            if (recovered) {
              publishMatch(dispatchLocalGameCommand(
                latest,
                "training-bot",
                recovered,
                storedState.playerId ?? latest.players[0]?.id,
              ));
            }
          }
        } finally {
          if (botActionKey.current === key) botActionKey.current = "";
        }
      })();
    }, Math.max(520, drawDelay, coinFlipDelay));
    return () => {
      window.clearTimeout(timeout);
      if (!requestStarted && botActionKey.current === key) {
        botActionKey.current = "";
      }
    };
  }, [
    storedState.route,
    storedState.online,
    storedState.match?.id,
    storedState.match?.phase,
    storedState.match?.priority,
    storedState.match?.version,
    storedState.match?.pendingChoice?.id,
    storedState.match?.pendingCoinFlip?.id,
    storedState.match?.pendingCoinFlip?.resolveAt,
    rollPresentationPending,
    publishMatch,
    requestOpponentAiDecision,
    storedState.playerId,
    storedState.match,
  ]);

  const localPlayer = storedState.match?.players.find((player) => (
    player.id === (storedState.playerId ?? storedState.match?.players[0]?.id)
  ));

  const localPlayerEnergizedThisTurn = localPlayer?.energizedThisTurn;
  useEffect(() => {
    const energizing = storedState.match?.phase === "energize"
      && localPlayerEnergizedThisTurn === false;
    setHandActionMode(energizing ? "energize" : null);
    setSelectedHandCardId("");
    setSelectedDiscardCardIds([]);
    setSelectedCharacterId("");
  }, [storedState.match?.phase, storedState.match?.pendingChoice?.id, localPlayerEnergizedThisTurn]);

  useEffect(() => {
    const match = storedState.match as TurnStartMatchState | null;
    const actorId = storedState.playerId ?? match?.players[0]?.id;
    if (
      !storedState.automaticDraw
      || !match
      || !actorId
      || !drawStepIsPending(match)
      || playerHasDrawnTurnCard(match, actorId)
    ) return;

    const delay = Math.max(0, (match.drawReadyAt ?? Date.now()) - Date.now());
    const key = `draw:${match.version}:${actorId}`;
    const timeout = window.setTimeout(() => {
      if (automaticActionKey.current === key) return;
      automaticActionKey.current = key;
      void drawCard().catch(() => {
        if (automaticActionKey.current === key) automaticActionKey.current = "";
      });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    storedState.automaticDraw,
    storedState.match?.phase,
    storedState.match?.version,
    storedState.playerId,
    storedState.match,
    drawCard,
    resumeEpoch,
  ]);

  useEffect(() => {
    const match = storedState.match;
    const actorId = storedState.playerId ?? match?.players[0]?.id;
    const eligible = (
      storedState.automaticPass
      && Boolean(match)
      && Boolean(actorId)
      && !handActionMode
      && !selectedHandCardId
      && !selectedCharacterId
      && shouldAutomaticallyPass(match, actorId)
    );
    if (!eligible || !match || !actorId) {
      automaticPassSchedule.current = null;
      return;
    }

    const key = `pass:${match.version}:${actorId}`;
    if (automaticPassSchedule.current?.key !== key) {
      automaticPassSchedule.current = { key, dueAt: Date.now() + 180 };
    }
    const delay = Math.max(0, automaticPassSchedule.current.dueAt - Date.now());
    const timeout = window.setTimeout(() => {
      if (automaticActionKey.current === key) return;
      automaticActionKey.current = key;
      void passTurn().catch(() => {
        if (automaticActionKey.current === key) automaticActionKey.current = "";
      });
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [
    storedState.automaticPass,
    storedState.match?.phase,
    storedState.match?.priority,
    storedState.match?.version,
    storedState.playerId,
    handActionMode,
    selectedHandCardId,
    selectedCharacterId,
    storedState.match,
    passTurn,
    resumeEpoch,
  ]);

  const clearSelections = useCallback(() => {
    setSelectedHandCardId("");
    setSelectedDiscardCardIds([]);
    setSelectedCharacterId("");
  }, []);

  const toggleHandCardSelection = useCallback((cardId: string) => {
    setSelectedHandCardId((current) => current === cardId ? "" : cardId);
    setSelectedCharacterId("");
  }, []);

  const toggleDiscardCardSelection = useCallback((cardId: string) => {
    const current = readMatchStore();
    const currentMatch = current.match;
    const actorId = current.playerId ?? currentMatch?.players[0]?.id;
    const maximum = handDiscardRequirement(currentMatch, actorId)?.maximum ?? 0;
    setSelectedDiscardCardIds((current) => (
      current.includes(cardId)
        ? current.filter((candidate) => candidate !== cardId)
        : current.length < maximum ? [...current, cardId] : current
    ));
    setSelectedHandCardId("");
    setSelectedCharacterId("");
  }, []);

  const toggleCharacterSelection = useCallback((bakuganId: string) => {
    setSelectedCharacterId(bakuganId);
    setSelectedHandCardId("");
  }, []);

  const exit = () => {
    writeGameRoute("play");
    window.location.reload();
  };

  const exitCompletedMatch = () => {
    const match = readMatchStore().match;
    if (!match || match.phase !== "result" || !match.winner) return;
    if (isCompletedSeriesResult(match)) {
      if (!finalizeCompletedMatchExit()) return;
    } else {
      writeGameRoute("result");
    }
    router.replace("/play/result");
  };

  if (storedState.route === "match") {
    const completed = storedState.match?.phase === "result";
    const placementActive = storedState.match != null
      && (storedState.match.phase === "startingPlayer" || storedState.match.phase === "placement");

    if (placementActive) {
      return (
        <CorePlacementLayer
          match={storedState.match}
          playerId={storedState.playerId}
          startupError={startupError}
          onRetryStart={() => {
            setStartupError("");
            void beginPlacement().catch((cause) => {
              setStartupError(cause instanceof Error ? cause.message : "The server did not advance the match.");
            });
          }}
        />
      );
    }

    return (
      <>
        <GameScreen
          match={storedState.match}
          playerId={storedState.playerId}
          onExit={storedState.match?.phase === "result" ? exitCompletedMatch : exit}
          onDrawCard={completed ? undefined : drawCard}
          onTapEnergyCard={completed ? undefined : tapEnergy}
        />
        <EnergyArrivalLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <SelectionInteractionLayer
          match={storedState.match}
          playerId={storedState.playerId}
          selectedCharacterId={selectedCharacterId}
          onCharacterSelectionChange={toggleCharacterSelection}
          onClearSelections={clearSelections}
        />
        <TurnProgressTracker match={storedState.match} />
        <PhaseTransitionLayer match={storedState.match} />
        <CoinFlipLayer
          match={storedState.match}
          playerId={storedState.playerId}
          onCompleteCoinFlip={completeCoinFlip}
        />
        <MatchHudLayer
          match={storedState.match}
          playerId={storedState.playerId}
          handMode={handActionMode}
          selectedHandCardId={selectedHandCardId}
          selectedDiscardCardIds={selectedDiscardCardIds}
          selectedCharacterId={selectedCharacterId}
          onHandModeChange={setHandActionMode}
          onSelectedHandCardChange={setSelectedHandCardId}
          onSelectedDiscardCardsChange={setSelectedDiscardCardIds}
          onSelectedCharacterChange={setSelectedCharacterId}
          onDrawCard={drawCard}
          onFlipTieBreakCard={flipTieBreak}
          onActivateReroll={activateReroll}
          onActivateFusion={activateFusion}
          onPlayCard={playHandCard}
          onEnergizeCard={energizeHandCard}
          onDiscardCards={discardSelectedCards}
          onSkipEnergize={skipEnergizing}
          onPassTurn={passTurn}
          onPlayFlip={playFlip}
          onSkipFlip={skipFlip}
          onSelectCharacter={selectCharacter}
          onExit={exitCompletedMatch}
        />
        <DamageStepLayer
          match={storedState.match}
          playerId={storedState.playerId}
          onFlipDamageCard={flipDamage}
        />
        <TieBreakLayer
          match={storedState.match}
          playerId={storedState.playerId}
          onFlipTieBreakCard={flipTieBreak}
        />
        <EnergyAffordabilityLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <GameMenuHud
          automaticDraw={storedState.automaticDraw}
          automaticPass={storedState.automaticPass}
          soundEnabled={storedState.soundEnabled}
          completed={completed}
          administrator={administrator}
          onAutomaticDrawChange={(enabled) => updatePreference("automaticDraw", enabled)}
          onAutomaticPassChange={(enabled) => updatePreference("automaticPass", enabled)}
          onSoundEnabledChange={(enabled) => updatePreference("soundEnabled", enabled)}
          undoAvailable={canUndoLatest(storedState.match, storedState.playerId ?? storedState.match?.players[0]?.id)}
          onUndo={undo}
          onConcede={concede}
          onDownloadLog={administrator ? downloadMatchEngineHistory : undefined}
          onOpenSettings={openSettings}
        />
        <BakuCoreLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <CardHandLayer
          match={storedState.match}
          playerId={storedState.playerId}
          actionMode={handActionMode}
          selectedCardId={selectedHandCardId}
          selectedDiscardCardIds={selectedDiscardCardIds}
          onCardSelect={toggleHandCardSelection}
          onDiscardCardSelect={toggleDiscardCardSelection}
        />
        <CardPreviewLayer match={storedState.match} />
      </>
    );
  }
  return null;
}
