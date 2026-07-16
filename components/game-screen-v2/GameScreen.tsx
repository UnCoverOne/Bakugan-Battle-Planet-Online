"use client";

import { useEffect } from "react";
import styles from "./GameScreen.module.css";

const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const COLUMN_RADIUS = Math.ceil(GRID_WIDTH / (HEX_X_STEP * 2)) + 2;
const ROW_RADIUS = Math.ceil(GRID_HEIGHT / (HEX_HEIGHT * 2)) + 3;

function hexPoints(cx: number, cy: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = index * Math.PI / 3;
    return `${cx + Math.cos(angle) * HEX_RADIUS},${cy + Math.sin(angle) * HEX_RADIUS}`;
  }).join(" ");
}

/**
 * Build the grid outwards from axial coordinate 0,0. This guarantees that a
 * complete hexagon is centred precisely on the middle of the 1800 x 1000
 * play-area coordinate system, which future Hide Matrix positions can share.
 */
const HEX_GRID = Array.from(
  { length: COLUMN_RADIUS * 2 + 1 },
  (_, columnIndex) => columnIndex - COLUMN_RADIUS,
).flatMap((q) => Array.from(
  { length: ROW_RADIUS * 2 + 1 },
  (_, rowIndex) => rowIndex - ROW_RADIUS,
).map((r) => {
  const cx = GRID_CENTER_X + q * HEX_X_STEP;
  const cy = GRID_CENTER_Y + (r + q / 2) * HEX_HEIGHT;
  return {
    key: `${q}:${r}`,
    cx,
    cy,
    points: hexPoints(cx, cy),
  };
})).filter((hex) => (
  hex.cx >= -HEX_RADIUS
  && hex.cx <= GRID_WIDTH + HEX_RADIUS
  && hex.cy >= -HEX_HEIGHT
  && hex.cy <= GRID_HEIGHT + HEX_HEIGHT
));

/**
 * Standalone replacement game-screen scaffold.
 *
 * The play area is presentation-only for now, keeping the new screen isolated
 * from the existing match state and game engine while the layout is developed.
 */
export function GameScreen({ onExit }: { onExit?: () => void }) {
  useEffect(() => {
    if (!onExit) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExit();
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [onExit]);

  return (
    <div className={styles.screen}>
      <div className={styles.playArea} aria-label="Experimental game play area">
        <svg
          className={styles.hexGrid}
          viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="game-screen-hex-fade" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="48%" stopColor="white" stopOpacity="0.72" />
              <stop offset="74%" stopColor="white" stopOpacity="0.3" />
              <stop offset="100%" stopColor="black" stopOpacity="0" />
            </radialGradient>
            <mask id="game-screen-hex-mask">
              <rect width={GRID_WIDTH} height={GRID_HEIGHT} fill="url(#game-screen-hex-fade)" />
            </mask>
          </defs>
          <g mask="url(#game-screen-hex-mask)">
            {HEX_GRID.map((hex) => <polygon key={hex.key} points={hex.points} />)}
          </g>
        </svg>
      </div>
    </div>
  );
}
