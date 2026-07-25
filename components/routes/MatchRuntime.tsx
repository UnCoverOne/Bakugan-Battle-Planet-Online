"use client";

import dynamic from "next/dynamic";

const GameplayRuntime = dynamic(
  () => import("../game-screen-v2/GameplayRuntime").then((module) => module.GameplayRuntime),
  { ssr: false, loading: () => <div className="boot-screen"><span className="pulse" /><h1>LOADING GAMEPLAY RUNTIME</h1><p>Preparing the rules engine and tabletop presentation…</p></div> },
);

export function MatchRuntime() {
  return <GameplayRuntime />;
}
