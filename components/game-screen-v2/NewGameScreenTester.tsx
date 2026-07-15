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

  return <aside className="new-game-screen-test-control" aria-label="Experimental game screen">
    <div>
      <small>EXPERIMENTAL CLIENT</small>
      <strong>NEW GAME SCREEN</strong>
      <span>Use the blank standalone battlefield after lobby and BakuCore placement.</span>
    </div>
    <button type="button" role="switch" aria-checked={enabled} onClick={toggle}>
      {enabled ? "ENABLED" : "DISABLED"}
    </button>
  </aside>;
}
