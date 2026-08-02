"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { captureCoreReturns } from "../../lib/coreReturns";
import type { MatchState } from "../../lib/game";
import { CoreReturnPlacementLayer } from "./CoreReturnPlacementLayer";
import {
  MATCH_UPDATE_EVENT,
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

const resultOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 12000,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(4, 8, 18, 0.78)",
  backdropFilter: "blur(10px)",
};

const resultPanelStyle: CSSProperties = {
  position: "relative",
  width: "min(440px, calc(100vw - 32px))",
  padding: "32px 28px 28px",
  overflow: "hidden",
  border: "1px solid",
  borderRadius: 20,
  background: "linear-gradient(145deg, rgba(23, 30, 51, 0.98), rgba(8, 12, 24, 0.98))",
  color: "#ffffff",
  textAlign: "center",
};

const resultCloseStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 38,
  height: 38,
  border: "1px solid rgba(255, 255, 255, 0.2)",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.08)",
  color: "#ffffff",
  fontSize: 24,
  lineHeight: 1,
  cursor: "pointer",
};

const resultBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 30,
  marginBottom: 16,
  padding: "5px 12px",
  border: "1px solid",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.14em",
};

const resultTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(2.4rem, 11vw, 4.6rem)",
  lineHeight: 0.95,
  letterSpacing: "0.04em",
};

const resultReasonStyle: CSSProperties = {
  margin: "18px auto 0",
  maxWidth: 340,
  color: "rgba(255, 255, 255, 0.72)",
  fontSize: 15,
  lineHeight: 1.5,
};

const resultScoreStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
  margin: "24px 0",
};

const resultScoreItemStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  padding: "12px 10px",
  border: "1px solid rgba(255, 255, 255, 0.12)",
  borderRadius: 12,
  background: "rgba(255, 255, 255, 0.05)",
};

const resultExitStyle: CSSProperties = {
  width: "100%",
  minHeight: 50,
  border: 0,
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 900,
  letterSpacing: "0.08em",
  cursor: "pointer",
};

type ResultOutcome = "victory" | "loss" | "draw";

const RESULT_COPY: Record<ResultOutcome, {
  title: string;
  eyebrow: string;
  summary: string;
  accent: string;
  buttonText: string;
}> = {
  victory: {
    title: "VICTORY",
    eyebrow: "BRAWL COMPLETE",
    summary: "You won the game.",
    accent: "#f6c84f",
    buttonText: "#111827",
  },
  loss: {
    title: "LOSS",
    eyebrow: "BRAWL COMPLETE",
    summary: "Your opponent won the game.",
    accent: "#ff5a66",
    buttonText: "#ffffff",
  },
  draw: {
    title: "DRAW",
    eyebrow: "BRAWL COMPLETE",
    summary: "The game ended without a winner.",
    accent: "#80d8ff",
    buttonText: "#07131c",
  },
};

function MatchResultDialog({
  match,
  playerId,
  onExit,
}: {
  match: MatchState;
  playerId?: string;
  onExit: () => void;
}) {
  const [open, setOpen] = useState(true);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const localPlayerId = playerId ?? match.players[0]?.id;
  const outcome: ResultOutcome = !match.winner
    ? "draw"
    : match.winner === localPlayerId ? "victory" : "loss";
  const copy = RESULT_COPY[outcome];

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  if (!open) return null;

  return (
    <div style={resultOverlayStyle} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-result-title"
        aria-describedby="match-result-description"
        style={{
          ...resultPanelStyle,
          borderColor: copy.accent,
          boxShadow: `0 28px 90px rgba(0, 0, 0, 0.58), 0 0 0 1px ${copy.accent}33`,
        }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close match result"
          title="Close"
          style={resultCloseStyle}
          onClick={() => setOpen(false)}
        >
          ×
        </button>
        <span style={{ ...resultBadgeStyle, color: copy.accent, borderColor: copy.accent }}>
          {copy.eyebrow}
        </span>
        <h2 id="match-result-title" style={{ ...resultTitleStyle, color: copy.accent }}>
          {copy.title}
        </h2>
        <p id="match-result-description" style={resultReasonStyle}>
          {copy.summary}{match.resultReason ? ` ${match.resultReason}` : ""}
        </p>
        <div style={resultScoreStyle} aria-label="Final score">
          {match.players.map((player) => (
            <div key={player.id} style={resultScoreItemStyle}>
              <strong style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                {player.name}
              </strong>
              <span style={{ color: copy.accent, fontSize: 26, fontWeight: 900 }}>
                {match.series[player.id] ?? 0}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          style={{ ...resultExitStyle, background: copy.accent, color: copy.buttonText }}
          onClick={onExit}
        >
          EXIT GAME
        </button>
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
  useMatchTransport();
  const returnState = useMatchSelector((state) => ({
    match: state.match,
    playerId: state.playerId,
    route: state.route,
  }));
  const retracting = returnState.route === "match" && returnState.match?.phase === "retract";
  const completed = returnState.route === "match" && returnState.match?.phase === "result";

  return (
    <>
      {retracting ? (
        <CoreReturnPlacementLayer match={returnState.match!} playerId={returnState.playerId} />
      ) : null}
      {completed ? (
        <MatchResultDialog
          match={returnState.match!}
          playerId={returnState.playerId}
          onExit={() => {
            writeGameRoute("result");
            window.location.reload();
          }}
        />
      ) : null}
    </>
  );
}
