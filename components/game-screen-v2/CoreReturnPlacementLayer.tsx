"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { HEX_CELLS, type CoreType, type MatchState } from "../../lib/game";
import {
  legalCoreReturnCells,
  pendingCoreReturnsForPlayer,
} from "../../lib/coreReturns";
import { dispatchLocalGameAction } from "../../lib/engine/local-command-dispatcher";
import {
  matchCommandHeaders,
  publishMatch,
  readMatchStore,
} from "./matchStore";
import { playerUsesOppositeMatrixPerspective } from "./matrixPerspectiveState";
import styles from "./CorePlacementLayer.module.css";

const CORE_BACK_ART: Record<CoreType, string> = {
  Fist: "/assets/core-backs/fist.png",
  "Flaming Fist": "/assets/core-backs/flaming-fist.png",
  Shield: "/assets/core-backs/shield.png",
  "Magic Shield": "/assets/core-backs/magic-shield.png",
  Helix: "/assets/core-backs/helix.png",
};

export function CoreReturnPlacementLayer({
  match,
  playerId,
}: {
  match: MatchState;
  playerId?: string;
}) {
  const [selectedCoreId, setSelectedCoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const actorId = playerId ?? match.players[0]?.id;
  const oppositePerspective = playerUsesOppositeMatrixPerspective(match, actorId);
  const mine = Boolean(actorId && match.priority === actorId);
  const returns = pendingCoreReturnsForPlayer(match, actorId);
  const legal = useMemo(() => legalCoreReturnCells(match), [match.version]);
  const totalRemaining = (match as MatchState & { pendingCoreReturns?: unknown[] }).pendingCoreReturns?.length ?? 0;

  if (match.phase !== "retract" || !actorId) return null;

  const submit = async (coreId: string, cell: string) => {
    if (busy || !mine) return;
    setBusy(true);
    setError("");
    try {
      const stored = readMatchStore();
      if (!stored.online) {
        publishMatch(dispatchLocalGameAction(match, actorId, "place", { coreId, cell }));
      } else {
        const response = await fetch("/api/game", {
          method: "POST",
          cache: "no-store",
          headers: matchCommandHeaders(stored),
          body: JSON.stringify({
            action: "place",
            code: match.code,
            playerId: actorId,
            expectedVersion: match.version,
            payload: { coreId, cell },
          }),
        });
        const data = await response.json() as { state?: MatchState; error?: string };
        if (data.state) publishMatch(data.state);
        if (!response.ok) throw new Error(data.error ?? "The BakuCore could not be returned.");
      }
      setSelectedCoreId("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The BakuCore could not be returned.");
    } finally {
      setBusy(false);
    }
  };

  const placingName = match.players.find((player) => player.id === match.priority)?.name ?? "Opponent";
  return (
    <section className={styles.layer} aria-label="Return BakuCores to the field">
      <header>
        <div>
          <small>RETRACTING STEP • {totalRemaining} CORE{totalRemaining === 1 ? "" : "S"} REMAINING</small>
          <h1>{mine ? "PLACE A RETURNED BAKUCORE" : `${placingName} IS RETURNING CORES`}</h1>
        </div>
        <p>Choose any legal connected position. The previous position is not required.</p>
      </header>
      <div className={styles.layout}>
        <aside className={styles.tray} aria-label="BakuCores you must return">
          <strong>CORES TO RETURN</strong>
          {returns.map((item) => (
            <button
              type="button"
              key={item.id}
              disabled={!mine || busy}
              data-selected={selectedCoreId === item.core.id}
              onClick={() => setSelectedCoreId(item.core.id)}
            >
              <img src={item.core.art} alt={item.core.name} width="150" height="130" loading="eager" />
              <span>{item.core.name}</span>
            </button>
          ))}
          {!returns.length ? <p>Waiting for {placingName} to finish returning BakuCores.</p> : null}
        </aside>
        <div
          className={styles.matrix}
          aria-label="BakuCore field"
          data-perspective={oppositePerspective ? "opposite" : "local"}
        >
          {HEX_CELLS.map((cell) => {
            const placement = match.placements.find((candidate) => (
              candidate.cell === cell.id && !candidate.attachedTo
            ));
            const available = mine && Boolean(selectedCoreId) && legal.includes(cell.id);
            const position = {
              "--q": oppositePerspective ? -cell.q : cell.q,
              "--r": oppositePerspective ? -cell.r : cell.r,
            } as CSSProperties;
            return (
              <button
                type="button"
                key={cell.id}
                className={styles.cell}
                style={position}
                disabled={!available}
                data-occupied={Boolean(placement)}
                data-legal={available}
                onClick={() => void submit(selectedCoreId, cell.id)}
              >
                {placement
                  ? <img src={CORE_BACK_ART[placement.core.type]} alt="Face-down BakuCore" width="104" height="90" />
                  : <span>{available ? "+" : ""}</span>}
              </button>
            );
          })}
        </div>
        <aside className={styles.order}>
          <strong>RETURN ORDER</strong>
          <p>The player retracting a Bakugan chooses where each attached BakuCore returns.</p>
          <p>Multiple BakuCores are placed one at a time, in any order that player chooses.</p>
          <p>Every returned BakuCore must share a complete edge with a BakuCore already on the field.</p>
          {match.log.filter((entry) => entry.kind === "game").slice(-6).reverse().map((entry) => (
            <p key={entry.id}>{entry.message}</p>
          ))}
        </aside>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
