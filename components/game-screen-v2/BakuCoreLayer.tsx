"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { HEX_CELLS, type CoreType, type MatchState } from "../../lib/game";
import {
  heldCorePlacements,
  hideMatrixPlacements,
  type ZoneOwner,
} from "./gameScreenState";
import styles from "./BakuCoreLayer.module.css";

const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const MATRIX_CORE_SIZE = 80;

const CORE_BACK_ART: Record<CoreType, string> = {
  Fist: "/assets/core-backs/fist.png",
  "Flaming Fist": "/assets/core-backs/flaming-fist.png",
  Shield: "/assets/core-backs/shield.png",
  "Magic Shield": "/assets/core-backs/magic-shield.png",
  Helix: "/assets/core-backs/helix.png",
};

type PortalTargets = {
  playArea: HTMLElement | null;
  characterZones: Record<string, HTMLElement>;
};

const EMPTY_TARGETS: PortalTargets = {
  playArea: null,
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

export function BakuCoreLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const [targets, setTargets] = useState<PortalTargets>(EMPTY_TARGETS);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const playArea = document.querySelector<HTMLElement>(
        '[aria-label="Experimental game play area"]',
      );
      const characterZones: Record<string, HTMLElement> = {};
      for (const owner of ["player", "opponent"] as const) {
        for (const slot of [1, 2, 3]) {
          const key = zoneKey(owner, slot);
          const zone = document.querySelector<HTMLElement>(`[data-zone-id="${key}"]`);
          if (zone) characterZones[key] = zone;
        }
      }
      setTargets({ playArea, characterZones });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [match?.id, playerId]);

  const matrixPlacements = useMemo(() => hideMatrixPlacements(match), [match]);
  const ownerPlayers = useMemo(() => {
    if (!match?.players.length) return [];
    const player = match.players.find((candidate) => candidate.id === playerId)
      ?? match.players[0];
    const opponent = match.players.find((candidate) => candidate.id !== player.id);
    return [
      { owner: "player" as const, player },
      { owner: "opponent" as const, player: opponent },
    ];
  }, [match, playerId]);

  return (
    <>
      {targets.playArea && createPortal(
        <svg
          className={styles.matrixLayer}
          viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="Face-down BakuCores in the Hide Matrix"
        >
          {matrixPlacements.map((placement) => {
            const position = cellPosition(placement.cell);
            if (!position) return null;
            return (
              <g key={placement.cell} data-core-cell={placement.cell}>
                <title>{`Face-down ${placement.core.type} BakuCore`}</title>
                <image
                  className={styles.matrixCore}
                  href={CORE_BACK_ART[placement.core.type]}
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

      {ownerPlayers.flatMap(({ owner, player }) => (
        player?.bakugan.map((bakugan, index) => {
          const held = heldCorePlacements(match, bakugan.id);
          const target = targets.characterZones[zoneKey(owner, index + 1)];
          if (!target || !held.length) return null;
          return createPortal(
            <div
              className={styles.heldCoreFan}
              aria-label={`${bakugan.name} holds ${held.length} BakuCore${held.length === 1 ? "" : "s"}`}
            >
              {held.map((placement, heldIndex) => {
                const centredIndex = heldIndex - (held.length - 1) / 2;
                const style = {
                  "--held-core-x": `${centredIndex * 18}%`,
                  "--held-core-rotation": `${centredIndex * 5}deg`,
                  "--held-core-order": heldIndex,
                } as CSSProperties;
                return (
                  <img
                    className={styles.heldCore}
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
            `${owner}-${bakugan.id}-held-cores`,
          );
        }) ?? []
      ))}
    </>
  );
}
