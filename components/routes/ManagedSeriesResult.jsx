"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLobbySession } from "../application/LobbySessionProvider";
import { completedMatchKey } from "../../lib/match-result-navigation";
import { matchRoundCount } from "../../lib/match-result-summary";
import styles from "./PersistentPlayRoutes.module.css";

export function ManagedSeriesResult() {
  const { recovery, recoverResult, unavailable, error: sessionError, refresh } = useLobbySession();
  const seriesId = recovery.status === "member" ? recovery.lobby.previousSeriesId : null;
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError("");
    if (seriesId) {
      void recoverResult()
        .then(value => { if (!cancelled) setResult(value); })
        .catch(cause => { if (!cancelled) setError(cause.message); });
    }
    return () => { cancelled = true; };
  }, [seriesId, recoverResult, attempt]);

  const state = result?.seriesId === seriesId ? result.state : null;
  const recordId = state ? completedMatchKey(state) : null;
  const hasLobby = recovery.status === "member";
  return (
    <section className={styles.screen}>
      <h1>Series result</h1>
      {state ? (
        <>
          <h2>{state.winner === result.playerId ? "Victory" : "Defeat"}</h2>
          <p>{state.players.map(player => `${player.name}: ${state.series[player.id] ?? 0}`).join(" · ")}</p>
          <p>{matchRoundCount(state)} rounds</p>
          {state.resultReason && <p>{state.resultReason}</p>}
          {recordId && <Link className="bb-button" href={`/profile/records/${encodeURIComponent(recordId)}`}>View match record</Link>}
        </>
      ) : (
        <p role="status">{error || sessionError || (seriesId || recovery.status === "checking" ? "Recovering result…" : "No completed series available.")}</p>
      )}
      {(error || unavailable) && <button className="bb-button" type="button" onClick={async () => {
        await refresh();
        setAttempt(previous => previous + 1);
      }}>Retry</button>}
      <Link className="bb-button" href={hasLobby ? "/play/lobby" : "/play"}>{hasLobby ? "Return to Lobby" : "Return to Play"}</Link>
    </section>
  );
}
