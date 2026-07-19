"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  concedeMatch,
  discardToHandLimit,
  energizeCard,
  passPriority,
  playCard,
  resolveDamage,
  selectBakugan,
  type CardChoices,
  type MatchState,
} from "../../lib/game";
import { tapEnergyCard } from "../../lib/energy";
import {
  availableRollTargets,
  confirmRoll,
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  selectRollTarget,
} from "../../lib/rolling";
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
import {
  MATCH_UPDATE_EVENT,
  writeCoordinatedMatch,
  writeExperimentalRoute,
  writeExperimentalSettings,
} from "./MatchStateCoordinator";
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
const PRIORITY_PHASES = new Set<MatchState["phase"]>([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
]);

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

function trainingBotCanAct(match: MatchState) {
  const bot = match.players.find((player) => player.id === "training-bot");
  if (!bot) return false;
  if (playerCanDrawTurnCard(match, bot.id)) return true;
  if (match.phase === "energize" && !bot.energizedThisTurn) return true;
  if (match.phase === "selection" && !match.selected[bot.id]) return true;
  if (
    match.phase === "target"
    && (playerCanSelectRollTarget(match, bot.id) || playerCanConfirmRoll(match, bot.id))
  ) return true;
  if (PRIORITY_PHASES.has(match.phase) && match.priority === bot.id) return true;
  if (match.phase === "damage" && match.pendingLoser === bot.id && match.revealedFlip) return true;
  return match.phase === "handLimit" && match.priority === bot.id;
}

function advanceTrainingBot(match: MatchState): MatchState | null {
  const bot = match.players.find((player) => player.id === "training-bot");
  if (!bot) return null;

  if (playerCanDrawTurnCard(match, bot.id)) {
    return drawTurnCard(match, bot.id);
  }

  if (match.phase === "energize" && !bot.energizedThisTurn) {
    return energizeCard(match, bot.id, bot.hand[0]?.id);
  }

  if (match.phase === "selection" && !match.selected[bot.id]) {
    const closed = bot.bakugan.filter((bakugan) => !bakugan.open);
    return selectBakugan(match, bot.id, (closed[0] ?? bot.bakugan[0]).id);
  }

  if (match.phase === "target") {
    if (playerCanSelectRollTarget(match, bot.id)) {
      const localTarget = Object.entries(match.targets)
        .find(([playerId]) => playerId !== bot.id)?.[1];
      const targets = availableRollTargets(match);
      const cell = targets.find((placement) => placement.cell !== localTarget)?.cell
        ?? targets[0]?.cell;
      return cell ? selectRollTarget(match, bot.id, cell) : null;
    }
    if (playerCanConfirmRoll(match, bot.id)) {
      return confirmRoll(match, bot.id);
    }
  }

  if (PRIORITY_PHASES.has(match.phase) && match.priority === bot.id) {
    return passPriority(match, bot.id);
  }

  if (match.phase === "damage" && match.pendingLoser === bot.id && match.revealedFlip) {
    const cost = typeof match.revealedFlip.cost === "number" ? match.revealedFlip.cost : 0;
    return resolveDamage(
      match,
      bot.id,
      cost <= bot.energy ? match.revealedFlip.id : undefined,
    );
  }

  if (match.phase === "handLimit" && match.priority === bot.id) {
    const amount = Math.max(0, bot.hand.length - 7);
    return discardToHandLimit(match, bot.id, bot.hand.slice(0, amount).map((card) => card.id));
  }

  return null;
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
  const botActionKey = useRef("");

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
    const interval = window.setInterval(update, 500);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    };
  }, []);

  const publishMatch = useCallback((next: MatchState) => {
    if (!writeCoordinatedMatch(next)) return false;
    previousRawState.current = "";
    setStoredState((stored) => ({ ...stored, match: next }));
    return true;
  }, []);

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
      cache: "no-store",
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
    writeExperimentalRoute("result");
    window.location.reload();
  };

  const updatePreference = (key: "automaticDraw" | "automaticPass", enabled: boolean) => {
    const settings = readSettings();
    writeExperimentalSettings({ ...settings, [key]: enabled });
    previousRawState.current = "";
    setStoredState((current) => ({ ...current, [key]: enabled }));
  };

  const openSettings = () => {
    writeExperimentalRoute("settings");
    window.location.reload();
  };

  useEffect(() => {
    const match = storedState.match;
    if (!match || storedState.online) return;
    const prepared = preparePendingDraw(match);
    if (prepared !== match) publishMatch(prepared);
  }, [storedState.match?.phase, storedState.match?.stepLabel, storedState.match?.turn, storedState.online, publishMatch]);

  // The experimental client no longer relies on the hidden legacy screen to
  // advance the Training AI. One version-keyed action runs at a time, and every
  // legal phase is revisited after the resulting version is published.
  useEffect(() => {
    const match = storedState.match;
    if (
      !storedState.enabled
      || storedState.route !== "match"
      || storedState.online
      || !match
      || !trainingBotCanAct(match)
    ) return;

    const key = `${match.id}:${match.version}:${match.phase}`;
    if (botActionKey.current === key) return;
    botActionKey.current = key;
    const timeout = window.setTimeout(() => {
      const latest = readStoredState().match;
      if (!latest || latest.id !== match.id || latest.version !== match.version) return;
      try {
        const next = advanceTrainingBot(latest);
        if (next) publishMatch(preparePendingDraw(next));
      } catch {
        // A concurrent player action can close the bot's window before this
        // timer executes. The next accepted version will schedule a fresh check.
      } finally {
        if (botActionKey.current === key) botActionKey.current = "";
      }
    }, 520);
    return () => window.clearTimeout(timeout);
  }, [
    storedState.enabled,
    storedState.route,
    storedState.online,
    storedState.match?.id,
    storedState.match?.phase,
    storedState.match?.priority,
    storedState.match?.version,
    publishMatch,
  ]);

  // Poll without overlapping requests. Responses are accepted only when their
  // version is newer, preventing delayed GETs from making the board jump back.
  useEffect(() => {
    const match = storedState.match;
    if (!storedState.enabled || storedState.route !== "match" || !storedState.online || !match?.code) return;

    let disposed = false;
    let timer = 0;
    let controller: AbortController | null = null;

    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(poll, document.hidden ? 2600 : 1100);
    };

    const poll = async () => {
      if (disposed) return;
      const current = readStoredState();
      const currentMatch = current.match;
      const actorId = current.playerId ?? currentMatch?.players[0]?.id;
      if (!currentMatch?.code || !actorId || !current.online) return schedule();

      controller = new AbortController();
      try {
        const response = await fetch("/api/game", {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "get",
            code: currentMatch.code,
            playerId: actorId,
            expectedVersion: currentMatch.version,
          }),
        });
        const data = await response.json() as { state?: MatchState };
        if (data.state) publishMatch(data.state);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // A later poll or focus event will retry without interrupting play.
        }
      } finally {
        controller = null;
        schedule();
      }
    };

    const refreshNow = () => {
      window.clearTimeout(timer);
      controller?.abort();
      void poll();
    };
    const onVisibility = () => { if (!document.hidden) refreshNow(); };

    void poll();
    window.addEventListener("focus", refreshNow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", refreshNow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    storedState.enabled,
    storedState.route,
    storedState.online,
    storedState.match?.code,
    storedState.playerId,
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
    writeExperimentalRoute("result");
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

  const toggle = () => {
    const settings = readSettings();
    writeExperimentalSettings({ ...settings, useNewGameScreen: !storedState.enabled });
    window.location.reload();
  };

  const exit = () => {
    writeExperimentalRoute("play");
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
