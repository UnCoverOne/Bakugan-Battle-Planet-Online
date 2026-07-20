"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { HEX_CELLS, type CoreType, type MatchState } from "../../lib/game";
import {
  allRollTargetsSelected,
  availableRollTargets,
  confirmRoll,
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  rollTargetCanConfirm,
  selectRollTarget,
} from "../../lib/rolling";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { coreTransferDestination } from "./bakuCorePresentationState";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { RollResultLayer } from "./RollResultLayer";
import styles from "./BakuCoreLayer.module.css";

const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const MATRIX_CORE_SIZE = 80;
const ONLINE_KEY = "bbp-active-match-online-v1";

const CORE_BACK_ART: Record<CoreType, string> = {
  Fist: "/assets/core-backs/fist.png",
  "Flaming Fist": "/assets/core-backs/flaming-fist.png",
  Shield: "/assets/core-backs/shield.png",
  "Magic Shield": "/assets/core-backs/magic-shield.png",
  Helix: "/assets/core-backs/helix.png",
};

type PortalTargets = {
  playArea: HTMLElement | null;
  actionSlot: HTMLElement | null;
};

type LocalMatchAction = (match: MatchState, actorId: string) => MatchState;

type TransferGeometry = {
  sourceX: number;
  sourceY: number;
  destinationX: number;
  destinationY: number;
};

const EMPTY_TARGETS: PortalTargets = {
  playArea: null,
  actionSlot: null,
};

function cellPosition(cellId: string) {
  const cell = HEX_CELLS.find((candidate) => candidate.id === cellId);
  if (!cell) return null;
  return {
    x: GRID_CENTER_X + cell.q * HEX_X_STEP,
    y: GRID_CENTER_Y + (cell.r + cell.q / 2) * HEX_HEIGHT,
  };
}

function storedBoolean(key: string) {
  try { return Boolean(JSON.parse(localStorage.getItem(key) ?? "false")); }
  catch { return false; }
}

function samePortalTargets(previous: PortalTargets, next: PortalTargets) {
  return previous.playArea === next.playArea && previous.actionSlot === next.actionSlot;
}

function sameTransferGeometry(previous: TransferGeometry | null, next: TransferGeometry) {
  return Boolean(
    previous
    && Math.abs(previous.sourceX - next.sourceX) < 0.5
    && Math.abs(previous.sourceY - next.sourceY) < 0.5
    && Math.abs(previous.destinationX - next.destinationX) < 0.5
    && Math.abs(previous.destinationY - next.destinationY) < 0.5
  );
}

function CoreTransferSprite({
  match,
  playerId,
  playArea,
  cell,
}: {
  match: MatchState;
  playerId?: string;
  playArea: HTMLElement;
  cell: string;
}) {
  const [geometry, setGeometry] = useState<TransferGeometry | null>(null);
  const placement = match.placements.find((candidate) => candidate.cell === cell);
  const destination = coreTransferDestination(match, playerId, cell);

  useLayoutEffect(() => {
    if (!placement || !destination) {
      setGeometry(null);
      return;
    }

    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    const mutationObserver = new MutationObserver(() => measure());

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const source = cellPosition(cell);
        const target = document.querySelector<HTMLElement>(
          `[data-core-zone-id="${destination.owner}-bakucore-${destination.slot}"]`,
        );
        if (!source || !target || !target.isConnected || !playArea.isConnected) {
          setGeometry(null);
          return;
        }

        const playRect = playArea.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        if (!playRect.width || !playRect.height || !playArea.clientWidth || !playArea.clientHeight) {
          setGeometry(null);
          return;
        }

        const scaleX = playArea.clientWidth / playRect.width;
        const scaleY = playArea.clientHeight / playRect.height;
        const next = {
          sourceX: source.x / GRID_WIDTH * playArea.clientWidth,
          sourceY: source.y / GRID_HEIGHT * playArea.clientHeight,
          destinationX: (targetRect.left + targetRect.width / 2 - playRect.left) * scaleX,
          destinationY: (targetRect.top + targetRect.height / 2 - playRect.top) * scaleY,
        };
        setGeometry((previous) => sameTransferGeometry(previous, next) ? previous : next);

        if (!resizeObserver && typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(measure);
          resizeObserver.observe(playArea);
          resizeObserver.observe(target);
        }
      });
    };

    measure();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [cell, destination?.owner, destination?.slot, placement, playArea]);

  if (!placement || !geometry) return null;
  const style = {
    "--transfer-source-x": `${geometry.sourceX}px`,
    "--transfer-source-y": `${geometry.sourceY}px`,
    "--transfer-destination-x": `${geometry.destinationX}px`,
    "--transfer-destination-y": `${geometry.destinationY}px`,
  } as CSSProperties;

  return (
    <img
      className={styles.transferCore}
      src={placement.core.art}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-core-cell={cell}
      style={style}
    />
  );
}

export function BakuCoreLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const [targets, setTargets] = useState<PortalTargets>(EMPTY_TARGETS);
  const [selectedCoreCell, setSelectedCoreCell] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const {
    rollResultOpen,
    deferredCoreCells,
    transferringCoreCells,
    dismissRollResult,
  } = useBakuCorePresentation();

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = {
          playArea: document.querySelector<HTMLElement>(
            '[aria-label="Experimental game play area"]',
          ),
          actionSlot: document.querySelector<HTMLElement>(
            '[aria-label="Available player actions"] [data-slot="primary"]',
          ),
        };
        setTargets((previous) => samePortalTargets(previous, next) ? previous : next);
      });
    };

    measure();
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [match?.id, playerId]);

  useEffect(() => {
    const resolvedActorId = playerId ?? match?.players[0]?.id;
    if (match?.phase !== "target" || (resolvedActorId && match.targets[resolvedActorId])) {
      setSelectedCoreCell("");
    }
  }, [match?.phase, match?.version, match?.targets, playerId]);

  useEffect(() => {
    const onBlankPlaymat = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[aria-label="Experimental game play area"]')) return;
      if (event.target.closest("[data-core-cell], button, [role=button], input, select, textarea, a")) return;
      setSelectedCoreCell("");
    };
    document.addEventListener("pointerdown", onBlankPlaymat);
    return () => document.removeEventListener("pointerdown", onBlankPlaymat);
  }, []);

  const localPlayer = match?.players.find((candidate) => candidate.id === playerId)
    ?? match?.players[0];
  const actorId = playerId ?? localPlayer?.id;
  const selectable = playerCanSelectRollTarget(match, actorId);
  const availableCells = useMemo(
    () => new Set(availableRollTargets(match).map((placement) => placement.cell)),
    [match],
  );
  const selectReady = rollTargetCanConfirm(match, actorId, selectedCoreCell);
  const rollReady = playerCanConfirmRoll(match, actorId);
  const primaryAction = selectReady ? "select" : rollReady ? "roll" : null;
  const deferredSet = new Set(deferredCoreCells);
  const visiblePlacements = match?.placements.filter((placement) => (
    !placement.attachedTo || deferredSet.has(placement.cell)
  )) ?? [];
  const localRollCells = new Set(
    rollResultOpen && localPlayer ? match?.rolls[localPlayer.id]?.cores ?? [] : [],
  );
  const opponent = match?.players.find((candidate) => candidate.id !== localPlayer?.id);
  const opponentRollCells = new Set(
    rollResultOpen && opponent ? match?.rolls[opponent.id]?.cores ?? [] : [],
  );

  useEffect(() => {
    const slot = targets.actionSlot;
    if (!slot) return;
    const previous = slot.dataset.filled;
    if (primaryAction) slot.dataset.filled = "true";
    return () => {
      if (previous == null) delete slot.dataset.filled;
      else slot.dataset.filled = previous;
    };
  }, [targets.actionSlot, primaryAction]);

  const submit = async (
    action: "target" | "roll",
    payload: Record<string, unknown>,
    localAction: LocalMatchAction,
  ) => {
    if (!match || !actorId || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!storedBoolean(ONLINE_KEY)) {
        writeCoordinatedMatch(localAction(match, actorId));
      } else {
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
        if (data.state) writeCoordinatedMatch(data.state);
        if (!response.ok) throw new Error(data.error ?? "The BakuCore action could not be completed.");
      }
      setSelectedCoreCell("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The BakuCore action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const confirmCoreSelection = () => {
    if (!selectedCoreCell) return;
    void submit("target", { cell: selectedCoreCell }, (state, localActorId) => {
      let next = selectRollTarget(state, localActorId, selectedCoreCell);
      const bot = next.players.find((player) => player.id === "training-bot");
      if (bot && playerCanSelectRollTarget(next, bot.id)) {
        const choices = availableRollTargets(next);
        const botCell = choices.find((placement) => placement.cell !== selectedCoreCell)?.cell
          ?? choices[0]?.cell;
        if (botCell) next = selectRollTarget(next, bot.id, botCell);
      }
      return next;
    });
  };

  const confirmPlayerRoll = () => {
    void submit("roll", {}, (state, localActorId) => {
      let next = confirmRoll(state, localActorId);
      const bot = next.players.find((player) => player.id === "training-bot");
      if (bot && playerCanConfirmRoll(next, bot.id)) next = confirmRoll(next, bot.id);
      return next;
    });
  };

  const toggleCore = (cell: string) => {
    if (!selectable || !availableCells.has(cell)) return;
    setSelectedCoreCell((current) => current === cell ? "" : cell);
  };

  const coreKeyDown = (event: ReactKeyboardEvent<SVGGElement>, cell: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleCore(cell);
  };

  return (
    <>
      {targets.playArea && createPortal(
        <>
          <svg
            className={styles.matrixLayer}
            viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="BakuCores in the Hide Matrix"
          >
            {visiblePlacements.map((placement) => {
              const position = cellPosition(placement.cell);
              if (!position) return null;
              const canSelect = selectable && availableCells.has(placement.cell);
              const selected = selectedCoreCell === placement.cell && canSelect;
              const playerLanded = localRollCells.has(placement.cell);
              const opponentLanded = opponentRollCells.has(placement.cell);
              const revealed = playerLanded || opponentLanded || deferredSet.has(placement.cell);
              return (
                <g
                  key={placement.cell}
                  data-core-cell={placement.cell}
                  data-bakucore-interactive={canSelect ? "true" : "false"}
                  role={canSelect ? "button" : undefined}
                  tabIndex={canSelect ? 0 : undefined}
                  aria-pressed={canSelect ? selected : undefined}
                  aria-label={`${revealed ? placement.core.name : `Face-down ${placement.core.type} BakuCore`}${canSelect ? ", select as roll target" : ""}`}
                  onClick={() => toggleCore(placement.cell)}
                  onKeyDown={(event) => coreKeyDown(event, placement.cell)}
                >
                  <title>{revealed ? placement.core.name : `Face-down ${placement.core.type} BakuCore`}</title>
                  <image
                    className={`${styles.matrixCore} ${canSelect ? styles.matrixCoreSelectable : ""} ${selected ? styles.matrixCoreSelected : ""} ${playerLanded ? styles.matrixCorePlayerLanded : ""} ${opponentLanded ? styles.matrixCoreOpponentLanded : ""}`}
                    href={revealed ? placement.core.art : CORE_BACK_ART[placement.core.type]}
                    x={position.x - MATRIX_CORE_SIZE / 2}
                    y={position.y - MATRIX_CORE_SIZE / 2}
                    width={MATRIX_CORE_SIZE}
                    height={MATRIX_CORE_SIZE}
                    preserveAspectRatio="xMidYMid meet"
                  />
                </g>
              );
            })}
          </svg>
          {match && transferringCoreCells.length ? (
            <div className={styles.transferLayer} aria-hidden="true">
              {transferringCoreCells.map((cell) => (
                <CoreTransferSprite
                  match={match}
                  playerId={playerId}
                  playArea={targets.playArea!}
                  cell={cell}
                  key={`${match.id}:${match.turn}:${cell}`}
                />
              ))}
            </div>
          ) : null}
        </>,
        targets.playArea,
      )}

      {targets.actionSlot && primaryAction ? createPortal(
        <button
          type="button"
          className={styles.rollActionButton}
          data-action={primaryAction}
          data-active="true"
          disabled={busy}
          onClick={primaryAction === "select" ? confirmCoreSelection : confirmPlayerRoll}
        >
          {primaryAction === "select" ? "Select" : "Roll"}
        </button>,
        targets.actionSlot,
      ) : null}

      <RollResultLayer
        match={match}
        playerId={playerId}
        open={rollResultOpen}
        onDismiss={dismissRollResult}
      />
      {error ? <p className={styles.visuallyHidden} role="alert">{error}</p> : null}
      {match?.phase === "target" && allRollTargetsSelected(match) && !rollReady && !primaryAction ? (
        <span className={styles.visuallyHidden}>Waiting for the opponent to roll.</span>
      ) : null}
    </>
  );
}
