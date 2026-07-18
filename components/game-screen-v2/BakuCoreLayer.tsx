"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { HEX_CELLS, type CoreType, type MatchState } from "../../lib/game";
import {
  allRollTargetsSelected,
  availableRollTargets,
  confirmRoll,
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  rollResultCells,
  rollResultSignature,
  rollTargetCanConfirm,
  selectRollTarget,
} from "../../lib/rolling";
import {
  heldCorePlacements,
  type ZoneOwner,
} from "./gameScreenState";
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
const MATCH_KEY = "bbp-active-match-v1";
const ONLINE_KEY = "bbp-active-match-online-v1";
const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

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
  characterZones: Record<string, HTMLElement>;
};

type LocalMatchAction = (match: MatchState, actorId: string) => MatchState;

type CoreTransferOffset = {
  x: number;
  y: number;
};

const EMPTY_TARGETS: PortalTargets = {
  playArea: null,
  actionSlot: null,
  characterZones: {},
};

function zoneKey(owner: ZoneOwner, slot: number) {
  return `${owner}-character-card-${slot}`;
}

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

function publishMatch(next: MatchState) {
  localStorage.setItem(MATCH_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: next }));
}

function ownerPlayers(match: MatchState | null, playerId?: string) {
  if (!match?.players.length) return [];
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];
  const opponent = match.players.find((candidate) => candidate.id !== player.id);
  return [
    { owner: "player" as const, player },
    { owner: "opponent" as const, player: opponent },
  ];
}

function transferOffset(
  playArea: HTMLElement | null,
  zone: HTMLElement,
  cell: string,
): CoreTransferOffset {
  const position = cellPosition(cell);
  if (!playArea || !position) return { x: 0, y: 0 };
  const playRect = playArea.getBoundingClientRect();
  const zoneRect = zone.getBoundingClientRect();
  const sourceX = playRect.left + position.x / GRID_WIDTH * playRect.width;
  const sourceY = playRect.top + position.y / GRID_HEIGHT * playRect.height;
  const destinationX = zoneRect.left + zoneRect.width / 2;
  const destinationY = zoneRect.top - zoneRect.height * 0.16;
  return {
    x: sourceX - destinationX,
    y: sourceY - destinationY,
  };
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
  const [rollResultOpen, setRollResultOpen] = useState(false);
  const [deferredCoreCells, setDeferredCoreCells] = useState<string[]>([]);
  const [transferringCoreCells, setTransferringCoreCells] = useState<string[]>([]);
  const lastRollSignature = useRef("");
  const transferDelay = useRef<number | null>(null);
  const transferEnd = useRef<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const playArea = document.querySelector<HTMLElement>(
        '[aria-label="Experimental game play area"]',
      );
      const actionSlot = document.querySelector<HTMLElement>(
        '[aria-label="Available player actions"] [data-slot="primary"]',
      );
      const characterZones: Record<string, HTMLElement> = {};
      for (const owner of ["player", "opponent"] as const) {
        for (const slot of [1, 2, 3]) {
          const key = zoneKey(owner, slot);
          const zone = document.querySelector<HTMLElement>(`[data-zone-id="${key}"]`);
          if (zone) characterZones[key] = zone;
        }
      }
      setTargets({ playArea, actionSlot, characterZones });
    };

    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
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

  useEffect(() => {
    const signature = rollResultSignature(match);
    if (!signature || signature === lastRollSignature.current) return;
    lastRollSignature.current = signature;
    if (transferDelay.current != null) window.clearTimeout(transferDelay.current);
    if (transferEnd.current != null) window.clearTimeout(transferEnd.current);
    const cells = rollResultCells(match);
    setDeferredCoreCells(cells);
    setTransferringCoreCells([]);
    setRollResultOpen(true);
  }, [match]);

  useEffect(() => () => {
    if (transferDelay.current != null) window.clearTimeout(transferDelay.current);
    if (transferEnd.current != null) window.clearTimeout(transferEnd.current);
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
  const transferringSet = new Set(transferringCoreCells);
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
        publishMatch(localAction(match, actorId));
      } else {
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

  const dismissRollResult = () => {
    setRollResultOpen(false);
    if (!deferredCoreCells.length) return;
    const cells = [...deferredCoreCells];
    transferDelay.current = window.setTimeout(() => {
      setDeferredCoreCells([]);
      setTransferringCoreCells(cells);
      transferEnd.current = window.setTimeout(() => setTransferringCoreCells([]), 920);
    }, 1000);
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

  const players = ownerPlayers(match, playerId);

  return (
    <>
      {targets.playArea && createPortal(
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
        </svg>,
        targets.playArea,
      )}

      {players.flatMap(({ owner, player }) => (
        player?.bakugan.map((bakugan, index) => {
          const held = heldCorePlacements(match, bakugan.id)
            .filter((placement) => !deferredSet.has(placement.cell));
          const target = targets.characterZones[zoneKey(owner, index + 1)];
          if (!target) return null;
          const spacing = held.length <= 1 ? 0 : Math.min(24, 62 / (held.length - 1));
          return createPortal(
            <div
              className={styles.heldCoreZone}
              data-core-count={held.length}
              aria-label={`${bakugan.name} BakuCore zone, ${held.length} BakuCore${held.length === 1 ? "" : "s"}`}
            >
              <span className={styles.heldCoreZoneLabel} aria-hidden="true">BAKUCORE</span>
              {held.map((placement, heldIndex) => {
                const centredIndex = heldIndex - (held.length - 1) / 2;
                const offset = transferOffset(targets.playArea, target, placement.cell);
                const moving = transferringSet.has(placement.cell);
                const style = {
                  "--held-core-x": `${centredIndex * spacing}%`,
                  "--held-core-rotation": `${centredIndex * Math.min(6, 18 / Math.max(1, held.length - 1))}deg`,
                  "--held-core-order": heldIndex,
                  "--transfer-x": `${offset.x}px`,
                  "--transfer-y": `${offset.y}px`,
                } as CSSProperties;
                return (
                  <img
                    className={`${styles.heldCore} ${moving ? styles.heldCoreTransferring : ""}`}
                    src={placement.core.art}
                    alt={placement.core.name}
                    draggable={false}
                    style={style}
                    key={placement.cell}
                  />
                );
              })}
            </div>,
            target,
            `${owner}-${bakugan.id}-held-core-zone`,
          );
        }) ?? []
      ))}

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
