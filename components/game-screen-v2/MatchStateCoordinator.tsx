"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { captureCoreReturns } from "../../lib/coreReturns";
import type { MatchState } from "../../lib/game";
import { completedMatchKey, isCompletedSeriesResult } from "../../lib/match-result-navigation";
import { CoreReturnPlacementLayer } from "./CoreReturnPlacementLayer";
import {
  dragonoidMaximusResultRemaining,
  isDragonoidMaximusResult,
} from "./alternateWinPresentation";
import styles from "./MatchResultDialog.module.css";
import { MatchResultSocial } from "../social/MatchResultSocial";
import {
  MATCH_UPDATE_EVENT,
  finalizeCompletedMatchExit,
  publishMatch,
  publishRoute,
  publishSettings,
  readMatchStore,
  useMatchSelector,
  useMatchTransport,
  type MatchClientSettings,
} from "./matchStore";

export { MATCH_UPDATE_EVENT };

const GAME_ROUTE_PATHS: Record<string, string> = {
  entry: "/",
  dashboard: "/dashboard",
  play: "/play",
  lobby: "/play/lobby",
  match: "/play/match",
  result: "/play/result",
  settings: "/settings",
};

type ResultOutcome = "victory" | "loss" | "draw";

type ResultCopy = {
  title: string;
  summary: string;
  accent: string;
};

const RESULT_COPY: Record<ResultOutcome, ResultCopy> = {
  victory: {
    title: "VICTORY",
    summary: "You won the game.",
    accent: "#f6c84f",
  },
  loss: {
    title: "DEFEAT",
    summary: "Your opponent won the game.",
    accent: "#ff5a66",
  },
  draw: {
    title: "DRAW",
    summary: "The game ended without a winner.",
    accent: "#80d8ff",
  },
};

function matchIsComplete(match: MatchState) {
  return isCompletedSeriesResult(match);
}

function resultReasonCopy(
  match: MatchState,
  outcome: ResultOutcome,
  localPlayerId: string | undefined,
  fallback: string,
) {
  const reason = match.resultReason?.trim() ?? "";
  const normalized = reason.toLowerCase();
  const defeatedPlayer = match.winner
    ? match.players.find((player) => player.id !== match.winner)
    : null;
  const defeatedLocally = defeatedPlayer?.id === localPlayerId;
  const defeatedName = defeatedPlayer?.name ?? "The defeated player";

  if (normalized.includes("dragonoid maximus")) {
    return {
      title: outcome === "victory" ? "VICTORY BY MAXIMUS" : "DEFEAT BY MAXIMUS",
      detail: outcome === "victory"
        ? "You controlled Dan, Wynton, Lia, and Dragonoid Maximus when its ultimate effect resolved."
        : `${match.players.find((player) => player.id === match.winner)?.name ?? "Your opponent"} resolved Dragonoid Maximus's ultimate win effect.`,
    };
  }

  if (normalized.includes("deck-out")) {
    return {
      title: outcome === "victory"
        ? "VICTORY BY DECK-OUT"
        : outcome === "loss" ? "DEFEAT BY DECK-OUT" : "DECK-OUT DRAW",
      detail: defeatedLocally
        ? "You had no cards remaining when damage was dealt."
        : `${defeatedName} had no cards remaining when damage was dealt.`,
    };
  }

  if (normalized.includes("conced")) {
    return {
      title: outcome === "victory"
        ? "VICTORY BY CONCESSION"
        : outcome === "loss" ? "DEFEAT BY CONCESSION" : "MATCH DRAWN",
      detail: defeatedLocally ? "You conceded the game." : `${defeatedName} conceded the game.`,
    };
  }

  if (normalized.includes("disconnect")) {
    return {
      title: outcome === "victory"
        ? "VICTORY BY DISCONNECT"
        : outcome === "loss" ? "DEFEAT BY DISCONNECT" : "MATCH DRAWN",
      detail: defeatedLocally
        ? "Your connection expired before the match could continue."
        : `${defeatedName}'s connection expired before the match could continue.`,
    };
  }

  return {
    title: outcome === "victory" ? "MATCH WON" : outcome === "loss" ? "MATCH LOST" : "MATCH DRAWN",
    detail: reason ? `${fallback} ${reason}` : fallback,
  };
}

function playerRole(playerId: string, localPlayerId: string | undefined) {
  if (playerId === localPlayerId) return "PLAYER";
  if (playerId === "training-bot") return "TRAINING AI";
  return "OPPONENT";
}

function MatchResultDialog({
  match,
  playerId,
  onViewRecord,
  onContinue,
  onDismiss,
}: {
  match: MatchState;
  playerId?: string;
  onViewRecord: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const localPlayerId = playerId ?? match.players[0]?.id;
  const outcome: ResultOutcome = !match.winner
    ? "draw"
    : match.winner === localPlayerId ? "victory" : "loss";
  const copy = RESULT_COPY[outcome];
  const complete = matchIsComplete(match);
  const reason = resultReasonCopy(match, outcome, localPlayerId, copy.summary);
  const localPlayer = match.players.find((player) => player.id === localPlayerId)
    ?? match.players[0];
  const opponent = match.players.find((player) => player.id !== localPlayer?.id)
    ?? match.players[1];
  const localScore = localPlayer ? match.series[localPlayer.id] ?? 0 : 0;
  const opponentScore = opponent ? match.series[opponent.id] ?? 0 : 0;
  const scoreLabel = match.format === "bo3" ? "SERIES SCORE" : "FINAL SCORE";
  const eyebrow = complete ? "MATCH COMPLETE" : `GAME ${match.gameNumber} COMPLETE`;
  const primaryLabel = complete ? "EXIT MATCH" : "CONTINUE SERIES";

  useEffect(() => {
    primaryButtonRef.current?.focus();
    const continueOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (complete) {
        onDismiss();
        return;
      }
      onContinue();
    };
    window.addEventListener("keydown", continueOnEscape);
    return () => window.removeEventListener("keydown", continueOnEscape);
  }, [complete, onContinue, onDismiss]);

  return (
    <div
      className={styles.overlay}
      role="presentation"
      style={{ "--result-accent": copy.accent } as CSSProperties}
    >
      <section
        className={styles.panel}
        data-outcome={outcome}
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-result-title"
        aria-describedby="match-result-description"
      >
        <span className={styles.energyTrace} aria-hidden="true" />
        {complete ? (
          <button
            type="button"
            className={styles.closeAction}
            aria-label="Close match complete window"
            onClick={onDismiss}
          >
            ×
          </button>
        ) : null}
        <header className={styles.header}>
          <img className={styles.logo} src="/assets/logo.png" alt="" aria-hidden="true" />
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 id="match-result-title" className={styles.title}>{copy.title}</h2>
          <div className={styles.reason}>
            <strong>{reason.title}</strong>
            <p id="match-result-description">{reason.detail}</p>
          </div>
        </header>

        <div
          className={styles.score}
          aria-label={`${scoreLabel}: ${localPlayer?.name ?? "Player"} ${localScore}, ${opponent?.name ?? "Opponent"} ${opponentScore}`}
        >
          <span className={styles.scoreLabel}>{scoreLabel}</span>
          <div className={styles.scoreSide} data-winner={match.winner === localPlayer?.id ? "true" : "false"}>
            <strong title={localPlayer?.name}>{localPlayer?.name ?? "Player"}</strong>
            <small>{localPlayer ? playerRole(localPlayer.id, localPlayerId) : "PLAYER"}</small>
          </div>
          <div className={styles.scoreValue} aria-hidden="true">
            <strong>{localScore}</strong>
            <i>—</i>
            <strong>{opponentScore}</strong>
          </div>
          <div className={styles.scoreSide} data-align="right" data-winner={match.winner === opponent?.id ? "true" : "false"}>
            <MatchResultSocial matchCode={match.code} opponentName={opponent?.name ?? "Opponent"} compact />
            <small>{opponent ? playerRole(opponent.id, localPlayerId) : "OPPONENT"}</small>
          </div>
        </div>

        <div className={styles.actions} data-single={complete ? "true" : "false"}>
          {!complete ? (
            <button type="button" className={styles.secondaryAction} onClick={onViewRecord}>
              VIEW MATCH RECORD
            </button>
          ) : null}
          <button
            ref={primaryButtonRef}
            type="button"
            className={styles.primaryAction}
            onClick={onContinue}
          >
            {primaryLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

export function writeCoordinatedMatch(next: MatchState) {
  return publishMatch(captureCoreReturns(readMatchStore().match, next));
}

export function pathnameForGameRoute(route: string) {
  return GAME_ROUTE_PATHS[route] ?? null;
}

export function writeGameRoute(route: string) {
  const pathname = pathnameForGameRoute(route);
  if (typeof window !== "undefined" && pathname && window.location.pathname !== pathname) {
    window.history.replaceState(window.history.state, "", pathname);
  }
  publishRoute(route);
}

export function writeGameSettings(settings: Record<string, unknown>) {
  publishSettings(settings as MatchClientSettings);
}

export function MatchStateCoordinator() {
  const router = useRouter();
  useMatchTransport();
  const returnState = useMatchSelector((state) => ({
    match: state.match,
    playerId: state.playerId,
    route: state.route,
  }));
  const retracting = returnState.route === "match" && returnState.match?.phase === "retract";
  const completed = returnState.route === "match" && returnState.match?.phase === "result";
  const [resultReady, setResultReady] = useState(false);
  const [dismissedResultKey, setDismissedResultKey] = useState<string | null>(null);
  const resultKey = completed && returnState.match
    ? `${returnState.match.id}:${returnState.match.gameNumber}:${returnState.match.winner ?? ""}:${returnState.match.resultReason ?? ""}`
    : null;

  useEffect(() => {
    const match = returnState.match;
    if (!completed || !match) {
      setResultReady(false);
      setDismissedResultKey(null);
      return;
    }
    if (!isDragonoidMaximusResult(match)) {
      setResultReady(true);
      return;
    }
    const remaining = dragonoidMaximusResultRemaining(match);
    if (remaining <= 0) {
      setResultReady(true);
      return;
    }
    setResultReady(false);
    const timeout = window.setTimeout(() => setResultReady(true), remaining);
    return () => window.clearTimeout(timeout);
  }, [completed, returnState.match]);

  return (
    <>
      {retracting ? (
        <CoreReturnPlacementLayer match={returnState.match!} playerId={returnState.playerId} />
      ) : null}
      {completed && resultReady && resultKey !== dismissedResultKey ? (
        <MatchResultDialog
          match={returnState.match!}
          playerId={returnState.playerId}
          onViewRecord={() => {
            const recordId = completedMatchKey(returnState.match!);
            if (recordId) router.push(`/profile/records/${encodeURIComponent(recordId)}`);
          }}
          onDismiss={() => {
            if (resultKey) setDismissedResultKey(resultKey);
          }}
          onContinue={() => {
            if (isCompletedSeriesResult(returnState.match)) {
              if (finalizeCompletedMatchExit()) router.replace("/play/result");
              return;
            }
            writeGameRoute("result");
            router.push("/play/result");
          }}
        />
      ) : null}
    </>
  );
}
