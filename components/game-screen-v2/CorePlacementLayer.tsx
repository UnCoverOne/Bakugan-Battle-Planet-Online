"use client";

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { HEX_CELLS, legalPlacementCells, placeCore, type CoreType, type MatchState } from "../../lib/game";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore } from "./matchStore";
import { playerUsesOppositeMatrixPerspective } from "./matrixPerspectiveState";
import styles from "./CorePlacementLayer.module.css";

const CORE_BACK_ART: Record<CoreType, string> = {
  Fist: "/assets/core-backs/fist.png",
  "Flaming Fist": "/assets/core-backs/flaming-fist.png",
  Shield: "/assets/core-backs/shield.png",
  "Magic Shield": "/assets/core-backs/magic-shield.png",
  Helix: "/assets/core-backs/helix.png",
};

// These dimensions are the unscaled bounds of the radius-four interactive
// matrix: eight centre-to-centre steps plus one complete outer cell.
const MATRIX_BASE_WIDTH_REM = 38;
const MATRIX_BASE_HEIGHT_REM = 42.6;
const MATRIX_SAFE_INSET_PX = 10;

export function CorePlacementLayer({
  match,
  playerId,
  startupError = "",
  onRetryStart,
}: {
  match: MatchState | null;
  playerId?: string;
  startupError?: string;
  onRetryStart?: () => void;
}) {
  const [selectedCoreId, setSelectedCoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [matrixScale, setMatrixScale] = useState(1);
  const matrixRef = useRef<HTMLDivElement>(null);
  const actorId = playerId ?? match?.players[0]?.id;
  const oppositePerspective = playerUsesOppositeMatrixPerspective(match, actorId);
  const player = match?.players.find((candidate) => candidate.id === actorId);
  const startingPlayer = match?.players.find((candidate) => candidate.id === match.initialStartingPlayer);
  const legal = useMemo(() => match ? legalPlacementCells(match) : [], [match?.version]);

  useLayoutEffect(() => {
    const matrix = matrixRef.current;
    if (!matrix || match?.phase !== "placement") return;
    let frame = 0;

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const availableWidth = matrix.clientWidth - MATRIX_SAFE_INSET_PX * 2;
        const availableHeight = matrix.clientHeight - MATRIX_SAFE_INSET_PX * 2;
        if (availableWidth <= 0 || availableHeight <= 0) return;
        const next = Math.min(
          1,
          availableWidth / (MATRIX_BASE_WIDTH_REM * rootFontSize),
          availableHeight / (MATRIX_BASE_HEIGHT_REM * rootFontSize),
        );
        if (Number.isFinite(next) && next > 0) setMatrixScale(next);
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(matrix);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [match?.phase]);

  if (!match || !actorId || !player || !["startingPlayer", "placement"].includes(match.phase)) return null;

  const submit = async (coreId: string, cell: string) => {
    if (busy || match.priority !== actorId) return;
    setBusy(true);
    setError("");
    try {
      const stored = readMatchStore();
      if (!stored.online) {
        writeCoordinatedMatch(placeCore(match, actorId, coreId, cell));
      } else {
        const response = await fetch("/api/game", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", ...(stored.capability ? { "x-match-capability": stored.capability } : {}) },
          body: JSON.stringify({ action: "place", code: match.code, playerId: actorId, expectedVersion: match.version, payload: { coreId, cell } }),
        });
        const data = await response.json() as { state?: MatchState; error?: string };
        if (data.state) writeCoordinatedMatch(data.state);
        if (!response.ok) throw new Error(data.error ?? "The BakuCore could not be placed.");
      }
      setSelectedCoreId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The BakuCore could not be placed.");
    } finally { setBusy(false); }
  };

  if (match.phase === "startingPlayer") {
    return <section className={styles.reveal} role="status" aria-live="polite">
      <div className={styles.coin} aria-hidden="true"><span>◆</span><span>◆</span></div>
      <small>SERVER STARTING-PLAYER SELECTION</small>
      <h1>{startingPlayer?.name ?? "Selecting…"}</h1>
      <p>places the first BakuCore</p>
      <span className={styles.audit}>Audited random event • {match.code}</span>
      {startupError ? <div className={styles.startupError} role="alert">
        <strong>The match could not start automatically.</strong>
        <span>{startupError}</span>
        <button type="button" onClick={onRetryStart}>Retry</button>
      </div> : null}
    </section>;
  }

  const mine = match.priority === actorId;
  const unused = player.cores.filter((core) => !match.placements.some((placement) => placement.playerId === actorId && placement.core.id === core.id));
  const matrixStyle = { "--matrix-scale": matrixScale } as CSSProperties;
  return <section className={styles.layer} aria-label="BakuCore placement">
    <header><div><small>CORE PLACEMENT • {match.placements.length}/12</small><h1>{mine ? "PLACE A BAKUCORE" : `${match.players.find((candidate) => candidate.id === match.priority)?.name ?? "Opponent"} IS PLACING`}</h1></div><p>{match.stepLabel}</p></header>
    <div className={styles.layout}>
      <aside className={styles.tray} aria-label="Your unused BakuCores">
        <strong>YOUR UNUSED CORES</strong>
        {unused.map((core) => <button type="button" key={core.id} disabled={!mine || busy} data-selected={selectedCoreId === core.id} onClick={() => setSelectedCoreId(core.id)}>
          <img src={core.art} alt={core.name} width="150" height="130" loading="eager" />
          <span>{core.name}</span>
        </button>)}
      </aside>
      <div ref={matrixRef} className={styles.matrix} aria-label="Face-down BakuCore matrix" data-perspective={oppositePerspective ? "opposite" : "local"}>
        <div className={styles.matrixGrid} style={matrixStyle}>
          {HEX_CELLS.map((cell) => {
            const placement = match.placements.find((candidate) => candidate.cell === cell.id);
            const available = mine && Boolean(selectedCoreId) && legal.includes(cell.id);
            const position = {
              "--q": oppositePerspective ? -cell.q : cell.q,
              "--r": oppositePerspective ? -cell.r : cell.r,
            } as CSSProperties;
            return <button type="button" key={cell.id} className={styles.cell} style={position} disabled={!available} data-occupied={Boolean(placement)} data-legal={available} onClick={() => void submit(selectedCoreId, cell.id)}>
              {placement ? <img src={CORE_BACK_ART[placement.core.type]} alt="Face-down BakuCore" width="104" height="90" /> : <span>{available ? "+" : ""}</span>}
            </button>;
          })}
        </div>
      </div>
      <aside className={styles.order}><strong>PLACEMENT ORDER</strong>{match.log.filter((entry) => entry.kind === "game").slice(-8).reverse().map((entry) => <p key={entry.id}>{entry.message}</p>)}</aside>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}

