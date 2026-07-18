"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  concedeMatch,
  energizeCard,
  passPriority,
  playCard,
  selectBakugan,
  type CardChoices,
  type MatchState,
} from "../../lib/game";
import { tapEnergyCard } from "../../lib/energy";
import {
  drawStepIsPending,
  drawTurnCard,
  playerCanDrawTurnCard,
  playerHasDrawnTurnCard,
  preparePendingDraw,
  type TurnStartMatchState,
} from "../../lib/turnStart";
import { BakuCoreLayer } from "./BakuCoreLayer";
import { CardHandLayer } from "./CardHandLayer";
import { CardPreviewLayer } from "./CardPreviewLayer";
import { GameMenuHud } from "./GameMenuHud";
import { GameScreen } from "./GameScreen";
import { MatchHudLayer } from "./MatchHudLayer";
import { SelectionInteractionLayer } from "./SelectionInteractionLayer";
import { TurnProgressTracker } from "./TurnProgressTracker";
import {
  shouldAutomaticallyPass,
  type HandActionMode,
} from "./matchHudState";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const PLAYER_KEY = "bbp-player-id";
const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

type StoredGameScreenState = {
  route: string;
  enabled: boolean;
  automaticDraw: boolean;
  automaticPass: boolean;
  match: MatchState | null;
  online: boolean;
  playerId?: string;
};

type LocalMatchAction = (match: MatchState, actorId: string) => MatchState;

type ExperimentalSettings = {
  useNewGameScreen?: boolean;
  automaticDraw?: boolean;
  automaticPass?: boolean;
  [key: string]: unknown;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readSettings(): ExperimentalSettings {
  return parseStoredValue<ExperimentalSettings>(localStorage.getItem(SETTINGS_KEY), {});
}

function readStoredState(): StoredGameScreenState {
  const settings = readSettings();
  return {
    route: parseStoredValue(localStorage.getItem(ROUTE_KEY), "entry"),
    enabled: Boolean(settings.useNewGameScreen),
    automaticDraw: Boolean(settings.automaticDraw),
    automaticPass: Boolean(settings.automaticPass),
    match: parseStoredValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    online: parseStoredValue(localStorage.getItem(ONLINE_KEY), false),
    playerId: parseStoredValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

export function NewGameScreenTester() {
  const [storedState, setStoredState] = useState<StoredGameScreenState>({
    route: "entry",
    enabled: false,
    automaticDraw: false,
    automaticPass: false,
    match: null,
    online: false,
    playerId: undefined,
  });
  const [handActionMode, setHandActionMode] = useState<HandActionMode>(null);
  const [selectedHandCardId, setSelectedHandCardId] = useState("");
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const previousRawState = useRef("");
  const automaticActionKey = useRef("");

  useEffect(() => {
    const update = () => {
      const rawState = [
        localStorage.getItem(ROUTE_KEY),
        localStorage.getItem(SETTINGS_KEY),
        localStorage.getItem(MATCH_KEY),
        localStorage.getItem(ONLINE_KEY),
        localStorage.getItem(PLAYER_KEY),
      ].join("\u0000");

      if (rawState === previousRawState.current) return;
      previousRawState.current = rawState;
      setStoredState(readStoredState());
    };

    update();
    const interval = window.setInterval(update, 200);
    window.addEventListener("storage", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
    };
  }, []);

  const publishMatch = (next: MatchState) => {
    localStorage.setItem(MATCH_KEY, JSON.stringify(next));
    previousRawState.current = "";
    setStoredState((current) => ({ ...current, match: next }));
    window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: next }));
  };

  const submitMatchAction = async (
    action: string,
    payload: Record<string, unknown>,
    localAction: LocalMatchAction,
  ) => {
    const current = readStoredState();
    const match = current.match;
    const actorId = current.playerId ?? match?.players[0]?.id;
    if (!match || !actorId) throw new Error("No active match is available.");

    if (!current.online) {
      publishMatch(preparePendingDraw(localAction(match, actorId)));
      return;
    }

    const response = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  const playHandCard = (cardId: string, choices: CardChoices) => submitMatchAction(
    "play",
    { cardId, choices },
    (match, actorId) => playCard(match, actorId, cardId, choices),
  );

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
    localStorage.setItem(ROUTE_KEY, JSON.stringify("result"));
    window.location.reload();
  };

  const updatePreference = (key: "automaticDraw" | "automaticPass", enabled: boolean) => {
    const settings = readSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, [key]: enabled }));
    previousRawState.current = "";
    setStoredState((current) => ({ ...current, [key]: enabled }));
  };

  const openSettings = () => {
    localStorage.setItem(ROUTE_KEY, JSON.stringify("settings"));
    window.location.reload();
  };

  useEffect(() => {
    const match = storedState.match;
    if (!match || storedState.online) return;
    const prepared = preparePendingDraw(match);
    if (prepared !== match) publishMatch(prepared);
  }, [storedState.match?.phase, storedState.match?.stepLabel, storedState.match?.turn, storedState.online]);

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

  const toggle = () => {
    const settings = readSettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, useNewGameScreen: !storedState.enabled }));
    window.location.reload();
  };

  const exit = () => {
    localStorage.setItem(ROUTE_KEY, JSON.stringify("play"));
    window.location.reload();
  };

  if (storedState.enabled && storedState.route === "match") {
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
          onSelectCharacter={selectCharacter}
        />
        <GameMenuHud
          automaticDraw={storedState.automaticDraw}
          automaticPass={storedState.automaticPass}
          onAutomaticDrawChange={(enabled) => updatePreference("automaticDraw", enabled)}
          onAutomaticPassChange={(enabled) => updatePreference("automaticPass", enabled)}
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
  if (storedState.route !== "play") return null;

  return <aside aria-label="Experimental game screen" style={{
    position: "fixed", right: 20, bottom: 20, zIndex: 200,
    display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16,
    width: "min(520px, calc(100vw - 40px))", padding: "14px 16px",
    border: "1px solid rgba(246,181,27,.7)", background: "rgba(2,8,13,.96)",
    boxShadow: "0 16px 40px rgba(0,0,0,.65)", color: "#fff",
  }}>
    <div style={{ display: "grid", gap: 4 }}>
      <small style={{ color: "#f6b51b", fontWeight: 900, letterSpacing: ".12em" }}>EXPERIMENTAL CLIENT</small>
      <strong>NEW GAME SCREEN</strong>
      <span style={{ color: "#a8c0c9", fontSize: 12, lineHeight: 1.35 }}>Use the standalone battlefield after lobby and BakuCore placement. Press Esc to return to Play.</span>
    </div>
    <button type="button" role="switch" aria-checked={storedState.enabled} onClick={toggle} style={{
      minWidth: 104, padding: "10px 12px", border: `1px solid ${storedState.enabled ? "#f6b51b" : "#6b8088"}`,
      background: storedState.enabled ? "#f6b51b" : "#071216", color: storedState.enabled ? "#111" : "#fff", fontWeight: 900,
    }}>
      {storedState.enabled ? "ENABLED" : "DISABLED"}
    </button>
  </aside>;
}
