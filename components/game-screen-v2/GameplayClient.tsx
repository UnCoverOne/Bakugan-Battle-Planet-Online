"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  beginCorePlacement,
  concedeMatch,
  energizeCard,
  passPriority,
  prepareCardPlay,
  selectBakugan,
  type CardChoices,
  type MatchState,
} from "../../lib/game";
import { advanceOpponentAi, opponentAiCanAct } from "../../lib/opponentAi";
import { canUndoLatest, undoLatestAction } from "../../lib/undo";
import { playCardWithAutoEnergy } from "../../lib/cardPayment";
import { tapEnergyCard } from "../../lib/energy";
import {
  flipDamageCard,
  resolveManualDamage,
} from "../../lib/manualDamage";
import {
  drawStepIsPending,
  drawTurnCard,
  playerCanDrawTurnCard,
  playerHasDrawnTurnCard,
  type TurnStartMatchState,
} from "../../lib/turnStart";
import { BakuCoreLayer } from "./BakuCoreLayer";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { CardHandLayer } from "./CardHandLayer";
import { CardPreviewLayer } from "./CardPreviewLayer";
import { CorePlacementLayer } from "./CorePlacementLayer";
import { DamageStepLayer } from "./DamageStepLayer";
import { EnergyAffordabilityLayer } from "./EnergyAffordabilityLayer";
import { GameMenuHud } from "./GameMenuHud";
import { GameScreen } from "./GameScreen";
import { MatchHudLayer } from "./MatchHudLayer";
import { PhaseTransitionLayer } from "./PhaseTransitionLayer";
import {
  writeCoordinatedMatch,
  writeGameRoute,
  writeGameSettings,
} from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";
import { SelectionInteractionLayer } from "./SelectionInteractionLayer";
import { TurnProgressTracker } from "./TurnProgressTracker";
import {
  cardRequiresSelection,
  shouldAutomaticallyPass,
  type HandActionMode,
} from "./matchHudState";

const SETTINGS_KEY = "bbp-settings";

type StoredGameScreenState = {
  route: string;
  automaticDraw: boolean;
  automaticPass: boolean;
  soundEnabled: boolean;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

type LocalMatchAction = (match: MatchState, actorId: string) => MatchState;

type GameplaySettings = {
  automaticDraw?: boolean;
  automaticPass?: boolean;
  soundEnabled?: boolean;
  [key: string]: unknown;
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
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [startupError, setStartupError] = useState("");
  const automaticActionKey = useRef("");
  const botActionKey = useRef("");
  const { rollPresentationPending } = useBakuCorePresentation();

  const publishMatch = useCallback((next: MatchState) => {
    return writeCoordinatedMatch(next);
  }, []);

  const submitMatchAction = async (
    action: string,
    payload: Record<string, unknown>,
    localAction: LocalMatchAction,
  ) => {
    const current = readMatchStore();
    const match = current.match;
    const actorId = current.playerId ?? match?.players[0]?.id;
    if (!match || !actorId) throw new Error("No active match is available.");

    if (!current.online) {
      publishMatch(localAction(match, actorId));
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        ...(current.capability ? { "x-match-capability": current.capability } : {}),
      },
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
  };

  const tapEnergy = (cardId: string) => submitMatchAction(
    "tap-energy",
    { cardId },
    (match, actorId) => tapEnergyCard(match, actorId, cardId),
  );

  const beginPlacement = () => submitMatchAction(
    "begin-placement",
    {},
    (match) => beginCorePlacement(match),
  );

  const undo = () => submitMatchAction(
    "undo",
    {},
    (match, actorId) => undoLatestAction(match, actorId),
  );

  const drawCard = () => submitMatchAction(
    "draw",
    {},
    (match, actorId) => {
      let next = drawTurnCard(match, actorId);
      const trainingBot = next.players.find((player) => player.id === "training-bot");
      if (trainingBot && playerCanDrawTurnCard(next, trainingBot.id)) {
        next = drawTurnCard(next, trainingBot.id);
      }
      return next;
    },
  );

  const playHandCard = (cardId: string, choices: CardChoices) => {
    const current = readMatchStore();
    const actorId = current.playerId ?? current.match?.players[0]?.id;
    const requiresChoice = Boolean(current.match && actorId && cardRequiresSelection(current.match, actorId, cardId));
    return submitMatchAction(
      requiresChoice && !Object.keys(choices).length ? "prepare-play" : "play",
      { cardId, choices },
      (match, localActorId) => requiresChoice && !Object.keys(choices).length
        ? prepareCardPlay(match, localActorId, cardId)
        : playCardWithAutoEnergy(match, localActorId, cardId, choices),
    );
  };

  const energizeHandCard = (cardId: string) => submitMatchAction(
    "energize",
    { cardId },
    (match, actorId) => energizeCard(match, actorId, cardId),
  );

  const skipEnergizing = () => submitMatchAction(
    "energize",
    {},
    (match, actorId) => energizeCard(match, actorId),
  );

  const passTurn = () => submitMatchAction(
    "pass",
    {},
    (match, actorId) => passPriority(match, actorId),
  );

  const flipDamage = () => submitMatchAction(
    "flip-damage",
    {},
    (match, actorId) => flipDamageCard(match, actorId),
  );

  const playFlip = (cardId: string, choices: CardChoices) => submitMatchAction(
    "damage",
    { cardId, choices },
    (match, actorId) => resolveManualDamage(match, actorId, cardId, choices),
  );

  const skipFlip = () => submitMatchAction(
    "damage",
    {},
    (match, actorId) => resolveManualDamage(match, actorId),
  );

  const selectCharacter = (bakuganId: string) => submitMatchAction(
    "select",
    { bakuganId },
    (match, actorId) => selectBakugan(match, actorId, bakuganId),
  );

  const concede = async () => {
    await submitMatchAction(
      "concede",
      {},
      (match, actorId) => concedeMatch(match, actorId),
    );
    writeGameRoute("result");
    window.location.reload();
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
  }, [storedState.route, storedState.match?.phase, storedState.match?.startingPlayerRevealedAt]);

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
    if (!waitingForDrawWindow && !opponentAiCanAct(match, "training-bot")) return;

    const key = `${match.id}:${match.version}:${match.phase}`;
    if (botActionKey.current === key) return;
    botActionKey.current = key;
    const drawDelay = waitingForDrawWindow
      ? Math.max(0, (match.drawReadyAt ?? 0) - Date.now())
      : 0;
    const timeout = window.setTimeout(() => {
      const latest = readMatchStore().match;
      if (!latest || latest.id !== match.id || latest.version !== match.version) return;
      try {
        const next = advanceOpponentAi(latest, "training-bot");
        if (next) publishMatch(next);
      } catch {
        // A concurrent player action can close the bot's window before this
        // timer executes. The next accepted version schedules a fresh check.
      } finally {
        if (botActionKey.current === key) botActionKey.current = "";
      }
    }, Math.max(520, drawDelay));
    return () => window.clearTimeout(timeout);
  }, [
    storedState.route,
    storedState.online,
    storedState.match?.id,
    storedState.match?.phase,
    storedState.match?.priority,
    storedState.match?.version,
    rollPresentationPending,
    publishMatch,
  ]);

  const localPlayer = storedState.match?.players.find((player) => (
    player.id === (storedState.playerId ?? storedState.match?.players[0]?.id)
  ));

  useEffect(() => {
    const energizing = storedState.match?.phase === "energize"
      && Boolean(localPlayer)
      && !localPlayer!.energizedThisTurn;
    setHandActionMode(energizing ? "energize" : null);
    setSelectedHandCardId("");
    setSelectedCharacterId("");
  }, [storedState.match?.phase, localPlayer?.energizedThisTurn]);

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
  ]);

  useEffect(() => {
    const match = storedState.match;
    const actorId = storedState.playerId ?? match?.players[0]?.id;
    if (
      !storedState.automaticPass
      || !match
      || !actorId
      || handActionMode
      || selectedHandCardId
      || selectedCharacterId
      || !shouldAutomaticallyPass(match, actorId)
    ) return;

    const key = `pass:${match.version}:${actorId}`;
    if (automaticActionKey.current === key) return;
    automaticActionKey.current = key;
    const timeout = window.setTimeout(() => {
      void passTurn().catch(() => {
        if (automaticActionKey.current === key) automaticActionKey.current = "";
      });
    }, 180);
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
  ]);

  useEffect(() => {
    if (storedState.online || storedState.match?.phase !== "result" || storedState.route !== "match") return;
    writeGameRoute("result");
    const timeout = window.setTimeout(() => window.location.reload(), 250);
    return () => window.clearTimeout(timeout);
  }, [storedState.online, storedState.match?.phase, storedState.route]);

  const clearSelections = useCallback(() => {
    setSelectedHandCardId("");
    setSelectedCharacterId("");
  }, []);

  const toggleHandCardSelection = useCallback((cardId: string) => {
    setSelectedHandCardId((current) => current === cardId ? "" : cardId);
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

  if (storedState.route === "match") {
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
          onExit={exit}
          onTapEnergyCard={tapEnergy}
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
        <MatchHudLayer
          match={storedState.match}
          playerId={storedState.playerId}
          handMode={handActionMode}
          selectedHandCardId={selectedHandCardId}
          selectedCharacterId={selectedCharacterId}
          onHandModeChange={setHandActionMode}
          onSelectedHandCardChange={setSelectedHandCardId}
          onSelectedCharacterChange={setSelectedCharacterId}
          onDrawCard={drawCard}
          onPlayCard={playHandCard}
          onEnergizeCard={energizeHandCard}
          onSkipEnergize={skipEnergizing}
          onPassTurn={passTurn}
          onPlayFlip={playFlip}
          onSkipFlip={skipFlip}
          onSelectCharacter={selectCharacter}
        />
        <DamageStepLayer
          match={storedState.match}
          playerId={storedState.playerId}
          onFlipDamageCard={flipDamage}
        />
        <EnergyAffordabilityLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <GameMenuHud
          automaticDraw={storedState.automaticDraw}
          automaticPass={storedState.automaticPass}
          soundEnabled={storedState.soundEnabled}
          onAutomaticDrawChange={(enabled) => updatePreference("automaticDraw", enabled)}
          onAutomaticPassChange={(enabled) => updatePreference("automaticPass", enabled)}
          onSoundEnabledChange={(enabled) => updatePreference("soundEnabled", enabled)}
          undoAvailable={canUndoLatest(storedState.match, storedState.playerId ?? storedState.match?.players[0]?.id)}
          onUndo={undo}
          onConcede={concede}
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
          onCardSelect={toggleHandCardSelection}
        />
        <CardPreviewLayer match={storedState.match} />
      </>
    );
  }
  return null;
}

