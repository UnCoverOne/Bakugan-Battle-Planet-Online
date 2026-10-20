"use client";

import { useEffect } from "react";
import {
  OPPONENT_AI_STALL_TIMEOUT_MS,
  opponentPriorityCanFallback,
  recoverStalledOpponentPriority,
} from "../../lib/opponentAiRecovery";
import { writeCoordinatedMatch } from "./MatchStateCoordinator";
import { readMatchStore, useMatchSelector } from "./matchStore";

export function OpponentAiProgressWatchdog({ onRecover }: { onRecover: () => void }) {
  const state = useMatchSelector((snapshot) => ({
    route: snapshot.route,
    online: snapshot.online,
    match: snapshot.match,
  }));

  useEffect(() => {
    const match = state.match;
    if (
      state.route !== "match"
      || state.online
      || !match
      || !opponentPriorityCanFallback(match, "training-bot")
    ) return;

    const matchId = match.id;
    const version = match.version;
    const timeout = window.setTimeout(() => {
      const current = readMatchStore();
      const latest = current.match;
      if (
        current.route !== "match"
        || current.online
        || !latest
        || latest.id !== matchId
        || latest.version !== version
      ) return;

      const recovered = recoverStalledOpponentPriority(latest, "training-bot");
      if (!recovered) return;

      writeCoordinatedMatch(recovered);
      // Remount GameplayClient so its cleanup terminates a worker that may still
      // be stuck inside an expensive tactical search. The replacement client
      // creates a fresh worker for the AI's next action.
      onRecover();
    }, OPPONENT_AI_STALL_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [state.route, state.online, state.match, onRecover]);

  return null;
}
