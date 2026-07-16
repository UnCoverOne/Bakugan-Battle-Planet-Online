"use client";

import { useEffect, useRef, useState } from "react";
import { GameScreen } from "../../components/game-screen-v2/GameScreen";
import type { MatchState } from "../../lib/game";

const MATCH_STORAGE_KEY = "bbp-active-match-v1";
const PLAYER_STORAGE_KEY = "bbp-player-id";

export default function GameScreenLabPage() {
  const [match, setMatch] = useState<MatchState | null>(null);
  const [playerId, setPlayerId] = useState<string>();
  const previousMatch = useRef<string | null>(null);
  const previousPlayer = useRef<string | null>(null);

  useEffect(() => {
    const syncStoredMatch = () => {
      const rawMatch = localStorage.getItem(MATCH_STORAGE_KEY);
      const rawPlayer = localStorage.getItem(PLAYER_STORAGE_KEY);

      if (rawMatch !== previousMatch.current) {
        previousMatch.current = rawMatch;
        try {
          setMatch(rawMatch ? JSON.parse(rawMatch) as MatchState : null);
        } catch {
          setMatch(null);
        }
      }

      if (rawPlayer !== previousPlayer.current) {
        previousPlayer.current = rawPlayer;
        try {
          setPlayerId(rawPlayer ? JSON.parse(rawPlayer) as string : undefined);
        } catch {
          setPlayerId(rawPlayer ?? undefined);
        }
      }
    };

    syncStoredMatch();
    const interval = window.setInterval(syncStoredMatch, 500);
    window.addEventListener("storage", syncStoredMatch);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", syncStoredMatch);
    };
  }, []);

  const exit = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  };

  return <GameScreen match={match} playerId={playerId} onExit={exit} />;
}
