"use client";

import { useEffect, useState } from "react";
import { GameScreen } from "./GameScreen";

const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";

function readRoute() {
  try { return JSON.parse(localStorage.getItem(ROUTE_KEY) || '"entry"') as string; }
  catch { return "entry"; }
}

function readEnabled() {
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as { useNewGameScreen?: boolean };
    return Boolean(settings.useNewGameScreen);
  } catch { return false; }
}

export function NewGameScreenTester() {
  const [route, setRoute] = useState("entry");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      setEnabled(readEnabled());
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, useNewGameScreen: !enabled }));
    window.location.reload();
  };

  const exit = () => {
    localStorage.setItem(ROUTE_KEY, JSON.stringify("play"));
    window.location.reload();
  };

  if (enabled && route === "match") return <GameScreen onExit={exit} />;
  if (route !== "play") return null;

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
      <span style={{ color: "#a8c0c9", fontSize: 12, lineHeight: 1.35 }}>Use the blank standalone battlefield after lobby and BakuCore placement. Press Esc to return to Play.</span>
    </div>
    <button type="button" role="switch" aria-checked={enabled} onClick={toggle} style={{
      minWidth: 104, padding: "10px 12px", border: `1px solid ${enabled ? "#f6b51b" : "#6b8088"}`,
      background: enabled ? "#f6b51b" : "#071216", color: enabled ? "#111" : "#fff", fontWeight: 900,
    }}>
      {enabled ? "ENABLED" : "DISABLED"}
    </button>
  </aside>;
}
