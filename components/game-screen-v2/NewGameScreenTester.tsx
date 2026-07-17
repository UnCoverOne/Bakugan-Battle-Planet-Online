"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchState } from "../../lib/game";
import { BakuCoreLayer } from "./BakuCoreLayer";
import { CardHandLayer } from "./CardHandLayer";
import { CardPreviewLayer } from "./CardPreviewLayer";
import { GameScreen } from "./GameScreen";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
const MATCH_KEY = "bbp-active-match-v1";
const PLAYER_KEY = "bbp-player-id";

type StoredGameScreenState = {
  route: string;
  enabled: boolean;
  match: MatchState | null;
  playerId?: string;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readStoredState(): StoredGameScreenState {
  const settings = parseStoredValue<{ useNewGameScreen?: boolean }>(
    localStorage.getItem(SETTINGS_KEY),
    {},
  );

  return {
    route: parseStoredValue(localStorage.getItem(ROUTE_KEY), "entry"),
    enabled: Boolean(settings.useNewGameScreen),
    match: parseStoredValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    playerId: parseStoredValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

export function NewGameScreenTester() {
  const [storedState, setStoredState] = useState<StoredGameScreenState>({
    route: "entry",
    enabled: false,
    match: null,
    playerId: undefined,
  });
  const previousRawState = useRef("");

  useEffect(() => {
    const update = () => {
      const rawState = [
        localStorage.getItem(ROUTE_KEY),
        localStorage.getItem(SETTINGS_KEY),
        localStorage.getItem(MATCH_KEY),
        localStorage.getItem(PLAYER_KEY),
      ].join("\u0000");

      if (rawState === previousRawState.current) return;
      previousRawState.current = rawState;
      setStoredState(readStoredState());
    };

    update();
    const interval = window.setInterval(update, 200);
    window.addEventListener("storage", update);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
    };
  }, []);

  const toggle = () => {
    let settings: Record<string, unknown> = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch {}
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, useNewGameScreen: !storedState.enabled }));
    window.location.reload();
  };

  const exit = () => {
    localStorage.setItem(ROUTE_KEY, JSON.stringify("play"));
    window.location.reload();
  };

  if (storedState.enabled && storedState.route === "match") {
    return (
      <>
        <GameScreen
          match={storedState.match}
          playerId={storedState.playerId}
          onExit={exit}
        />
        <BakuCoreLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <CardHandLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <CardPreviewLayer />
      </>
    );
  }
  if (storedState.route !== "play") return null;

  return <aside aria-label="Experimental game screen" style={{
    position: "fixed", right: 20, bottom: 20, zIndex: 200,
    display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 16,
    width: "min(520px, calc(100vw - 40px))", padding: "14px 16px",
    border: "1px solid rgba(246,181,27,.7)", background: "rgba(2,8,13,.96)",
    boxShadow: "0 16px 40px rgba(0,0,0,.65)", color: "#fff",
  }}>
    <div style={{ display: "grid", gap: 4 }}>
      <small style={{ color: "#f6b51b", fontWeight: 900, letterSpacing: ".12em" }}>EXPERIMENTAL CLIENT</small>
      <strong>NEW GAME SCREEN</strong>
      <span style={{ color: "#a8c0c9", fontSize: 12, lineHeight: 1.35 }}>Use the standalone battlefield after lobby and BakuCore placement. Press Esc to return to Play.</span>
    </div>
    <button type="button" role="switch" aria-checked={storedState.enabled} onClick={toggle} style={{
      minWidth: 104, padding: "10px 12px", border: `1px solid ${storedState.enabled ? "#f6b51b" : "#6b8088"}`,
      background: storedState.enabled ? "#f6b51b" : "#071216", color: storedState.enabled ? "#111" : "#fff", fontWeight: 900,
    }}>
      {storedState.enabled ? "ENABLED" : "DISABLED"}
    </button>
  </aside>;
}
