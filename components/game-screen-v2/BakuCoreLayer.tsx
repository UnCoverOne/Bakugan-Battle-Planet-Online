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
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  rollTargetCanConfirm,
  rollResultSignature,
} from "../../lib/rolling";
import { dispatchLocalGameAction } from "../../lib/engine/local-command-dispatcher";
import { useBakuCorePresentation } from "./BakuCorePresentation";
import { coreTransferDestination } from "./bakuCorePresentationState";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { RollResultLayer } from "./RollResultLayer";
import styles from "./BakuCoreLayer.module.css";
import { readMatchStore } from "./matchStore";
import {
  orientMatrixPath,
  orientMatrixPoint,
  playerUsesOppositeMatrixPerspective,
} from "./matrixPerspectiveState";

const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const MATRIX_CORE_SIZE = 80;
// The trace draws first, then remains on-screen long enough to read both
// outcome labels before the detailed result dialog replaces it.
const ROLL_TRACE_DURATION_MS = 4600;

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

function cellPosition(cellId: string, oppositePerspective = false) {
  const cell = HEX_CELLS.find((candidate) => candidate.id === cellId);
  if (!cell) return null;
  return orientMatrixPoint({
    x: GRID_CENTER_X + cell.q * HEX_X_STEP,
    y: GRID_CENTER_Y + (cell.r + cell.q / 2) * HEX_HEIGHT,
  }, oppositePerspective, GRID_WIDTH, GRID_HEIGHT);
}

function rollTracePath(points: readonly { x: number; y: number }[]) {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  const [start, control, end, secondary] = points;
  return `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`
    + (secondary ? ` L ${secondary.x} ${secondary.y}` : "");
}

function traceResultLabel(result: MatchState["rolls"][string]["result"]) {
  switch (result) {
    case "miss-closed": return "MISS • CLOSED";
    case "open-no-core": return "OPEN • NO CORE";
    case "intended-core": return "INTENDED CORE";
    case "overshoot": return "OVERSHOOT";
    case "undershoot": return "UNDERSHOOT";
    case "skew-left": return "SKEW LEFT";
    case "skew-right": return "SKEW RIGHT";
    case "path-intercept": return "MAGNET-PHASE INTERCEPT";
  }
}

function RollTraceLayer({
  match,
  localPlayerId,
  signature,
  oppositePerspective,
}: {
  match: MatchState;
  localPlayerId: string;
  signature: string;
  oppositePerspective: boolean;
}) {
  const currentRerollPlayers = new Set(match.players
    .filter((player) => match.rolls[player.id]?.rerollSequence === match.rerollSequence)
    .map((player) => player.id));
  const ordered = [
    match.players.find((player) => player.id === localPlayerId) ?? match.players[0],
    ...match.players.filter((player) => player.id !== localPlayerId),
  ].filter((player) => !currentRerollPlayers.size || currentRerollPlayers.has(player.id));
  return (
    <svg
      className={styles.rollTraceLayer}
      viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Animated Bakugan roll paths"
    >
      <rect
        className={styles.rollTraceVeil}
        x={-GRID_WIDTH}
        y={-GRID_HEIGHT * 2}
        width={GRID_WIDTH * 3}
        height={GRID_HEIGHT * 5}
      />
      {ordered.map((player, index) => {
        const roll = match.rolls[player.id];
        if (!roll?.path?.length) return null;
        const target = cellPosition(roll.target, oppositePerspective);
        const path = orientMatrixPath(roll.path, oppositePerspective, GRID_WIDTH, GRID_HEIGHT);
        const endpoint = path.at(-1)!;
        const local = player.id === localPlayerId;
        return (
          <g
            className={styles.rollTrace}
            data-owner={local ? "player" : "opponent"}
            style={{ "--trace-order": index } as CSSProperties}
            key={`${signature}:${player.id}`}
          >
            {target ? (
              <circle
                className={styles.rollTraceTarget}
                cx={target.x}
                cy={target.y}
                r={MATRIX_CORE_SIZE * 0.62}
              />
            ) : null}
            <path
              className={styles.rollTraceGlow}
              d={rollTracePath(path)}
              pathLength={1}
            />
            <path
              className={styles.rollTracePath}
              d={rollTracePath(path)}
              pathLength={1}
            />
            <circle
              className={styles.rollTraceEndpoint}
              cx={endpoint.x}
              cy={endpoint.y}
              r={13}
            />
            <text
              className={styles.rollTraceLabel}
              x={Math.min(GRID_WIDTH - 250, Math.max(250, endpoint.x))}
              y={Math.min(GRID_HEIGHT - 42, Math.max(42, endpoint.y - 62))}
              textAnchor="middle"
            >
              {traceResultLabel(roll.result)}{roll.doubleCore ? " • DOUBLE CORE" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
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
  oppositePerspective,
  active,
}: {
  match: MatchState;
  playerId?: string;
  playArea: HTMLElement;
  cell: string;
  oppositePerspective: boolean;
  active: boolean;
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
    let attempts = 0;
    let retryFrame = 0;

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const source = cellPosition(cell, oppositePerspective);
        const target = document.querySelector<HTMLElement>(
          `[data-core-zone-id="${destination.owner}-bakucore-${destination.slot}"]`,
        );
        if (!source || !target || !target.isConnected || !playArea.isConnected) {
          if (attempts < 8) {
            attempts += 1;
            retryFrame = window.requestAnimationFrame(measure);
          }
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
        const matrixScale = window.innerWidth <= 760
          && window.matchMedia("(orientation: portrait)").matches
          ? 1.4
          : 1;
        const scaledSource = {
          x: GRID_CENTER_X + (source.x - GRID_CENTER_X) * matrixScale,
          y: GRID_CENTER_Y + (source.y - GRID_CENTER_Y) * matrixScale,
        };
        const next = {
          sourceX: scaledSource.x / GRID_WIDTH * playArea.clientWidth,
          sourceY: scaledSource.y / GRID_HEIGHT * playArea.clientHeight,
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
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(retryFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [cell, destination?.owner, destination?.slot, oppositePerspective, placement, playArea]);

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
      data-active={active ? "true" : "false"}
      style={style}
    />
  );
}

export function BakuCoreLayer({
  match,
  playerId,
  readOnly = false,
}: {
  match: MatchState | null;
  playerId?: string;
  readOnly?: boolean;
}) {
  const [targets, setTargets] = useState<PortalTargets>(EMPTY_TARGETS);
  const [selectedCoreCell, setSelectedCoreCell] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completedTraceSignature, setCompletedTraceSignature] = useState("");
  const {
    rollResultOpen,
    deferredCoreCells,
    transferringCoreCells,
    dismissRollResult,
  } = useBakuCorePresentation();
  const resultSignature = rollResultSignature(match);
  const hasRollPaths = Boolean(
    resultSignature
    && match?.players.some((player) => (match.rolls[player.id]?.path?.length ?? 0) >= 2),
  );

  // Derive the trace synchronously from a new authoritative result signature.
  // The result dialog therefore never receives an open frame before the trace starts.
  const tracingRoll = Boolean(
    rollResultOpen
    && hasRollPaths
    && resultSignature
    && completedTraceSignature !== resultSignature
  );

  useEffect(() => {
    if (!tracingRoll || !resultSignature) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeout = window.setTimeout(
      () => setCompletedTraceSignature(resultSignature),
      reducedMotion ? 40 : ROLL_TRACE_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [tracingRoll, resultSignature]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = {
          playArea: document.querySelector<HTMLElement>(
            '[data-gameplay-surface="true"]',
          ),
          actionSlot: document.querySelector<HTMLElement>(
            '[aria-label="Available player actions"] [data-slot="primary"]',
          ),
        };
        setTargets((previous) => samePortalTargets(previous, next) ? previous : next);
      });
    };

    measure();
    const secondFrame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", measure);
    };
  }, [match?.id, match?.version, playerId]);

  useEffect(() => {
    const resolvedActorId = playerId ?? match?.players[0]?.id;
    if (!["target", "reroll"].includes(match?.phase ?? "") || (resolvedActorId && match?.targets[resolvedActorId])) {
      setSelectedCoreCell("");
    }
  }, [match?.phase, match?.players, match?.version, match?.targets, playerId]);

  useEffect(() => {
    const onBlankPlaymat = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('[data-gameplay-surface="true"]')) return;
      if (event.target.closest("[data-core-cell], button, [role=button], input, select, textarea, a")) return;
      setSelectedCoreCell("");
    };
    document.addEventListener("pointerdown", onBlankPlaymat);
    return () => document.removeEventListener("pointerdown", onBlankPlaymat);
  }, []);

  const localPlayer = match?.players.find((candidate) => candidate.id === playerId)
    ?? match?.players[0];
  const actorId = playerId ?? localPlayer?.id;
  const oppositePerspective = playerUsesOppositeMatrixPerspective(match, actorId);
  const selectable = !readOnly && playerCanSelectRollTarget(match, actorId);
  const availableCells = useMemo(
    () => new Set(availableRollTargets(match).map((placement) => placement.cell)),
    [match],
  );
  const selectReady = rollTargetCanConfirm(match, actorId, selectedCoreCell);
  const rollReady = playerCanConfirmRoll(match, actorId);
  const primaryAction = readOnly ? null : selectReady ? "select" : rollReady ? "roll" : null;
  const deferredSet = new Set(deferredCoreCells);
  const transferringSet = new Set(transferringCoreCells);
  const preparedTransferCells = [...new Set([...deferredCoreCells, ...transferringCoreCells])];
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
  ) => {
    if (!match || !actorId || busy) return;
    setBusy(true);
    setError("");
    try {
      const stored = readMatchStore();
      if (!stored.online) {
        let next = dispatchLocalGameAction(match, actorId, action, payload);
        const bot = next.players.find((player) => player.id === "training-bot");
        if (action === "target" && bot && playerCanSelectRollTarget(next, bot.id)) {
          const selectedCell = String(payload.cell ?? "");
          const choices = availableRollTargets(next);
          const botCell = choices.find((placement) => placement.cell !== selectedCell)?.cell
            ?? choices[0]?.cell;
          if (botCell) next = dispatchLocalGameAction(next, bot.id, "target", { cell: botCell });
        }
        if (action === "roll" && bot && playerCanConfirmRoll(next, bot.id)) {
          next = dispatchLocalGameAction(next, bot.id, "roll");
        }
        writeCoordinatedMatch(next);
      } else {
        const response = await fetch("/api/game", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", ...(stored.capability ? { "x-match-capability": stored.capability } : {}) },
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
    void submit("target", { cell: selectedCoreCell });
  };

  const confirmPlayerRoll = () => {
    void submit("roll", {});
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
            data-perspective={oppositePerspective ? "opposite" : "local"}
          >
            {visiblePlacements.map((placement) => {
              const position = cellPosition(placement.cell, oppositePerspective);
              if (!position) return null;
              const canSelect = selectable && availableCells.has(placement.cell);
              const selected = selectedCoreCell === placement.cell && canSelect;
              const playerLanded = localRollCells.has(placement.cell);
              const opponentLanded = opponentRollCells.has(placement.cell);
              const revealed = Boolean(placement.revealed) || playerLanded || opponentLanded || deferredSet.has(placement.cell);
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
          {match && tracingRoll ? (
            <RollTraceLayer
              match={match}
              localPlayerId={playerId ?? match.players[0]?.id}
              signature={resultSignature}
              oppositePerspective={oppositePerspective}
            />
          ) : null}
          {match && preparedTransferCells.length ? (
            <div className={styles.transferLayer} aria-hidden="true">
              {preparedTransferCells.map((cell) => (
                <CoreTransferSprite
                  match={match}
                  playerId={playerId}
                  playArea={targets.playArea!}
                  cell={cell}
                  oppositePerspective={oppositePerspective}
                  active={transferringSet.has(cell)}
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
        open={!readOnly && rollResultOpen && !tracingRoll}
        onDismiss={dismissRollResult}
      />
      {error ? <p className={styles.visuallyHidden} role="alert">{error}</p> : null}
      {["target", "reroll"].includes(match?.phase ?? "") && allRollTargetsSelected(match) && !rollReady && !primaryAction ? (
        <span className={styles.visuallyHidden}>{match?.phase === "reroll" ? "Waiting for the Reroll." : "Waiting for the opponent to roll."}</span>
      ) : null}
    </>
  );
}
