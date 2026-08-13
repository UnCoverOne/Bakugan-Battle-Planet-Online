"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useApp } from "../application/AppProvider";
import { primeMatchStore } from "../game-screen-v2/matchStore";

function RuntimeLoading({ message = "Preparing the rules engine and tabletop presentation…" }: { message?: string }) {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <span className="pulse" />
      <h1>LOADING GAMEPLAY RUNTIME</h1>
      <p>{message}</p>
    </div>
  );
}

const GameplayRuntime = dynamic(
  () => import("../game-screen-v2/GameplayRuntime").then((module) => module.GameplayRuntime),
  { ssr: false, loading: () => <RuntimeLoading /> },
);

/**
 * AppProvider intentionally debounces durable browser writes. Prime the
 * route-local gameplay store from its live React state before mounting the
 * heavyweight runtime so navigation cannot race localStorage persistence.
 */
export function MatchRuntime() {
  const { ready, match, online, playerId, matchCapability, matchControllerId, settings } = useApp();
  const [bootstrappedMatchId, setBootstrappedMatchId] = useState("");
  const [missingMatch, setMissingMatch] = useState(false);

  useEffect(() => {
    if (!ready || !match) return;
    const primed = primeMatchStore({
      route: "match",
      match,
      online,
      playerId,
      capability: matchCapability,
      controllerId: matchControllerId,
      settings,
    });
    if (primed.match?.id === match.id) {
      setBootstrappedMatchId(match.id);
      setMissingMatch(false);
    }
  }, [match, matchCapability, matchControllerId, online, playerId, ready, settings]);

  useEffect(() => {
    if (!ready || match) {
      setMissingMatch(false);
      return;
    }
    const timeout = window.setTimeout(() => setMissingMatch(true), 900);
    return () => window.clearTimeout(timeout);
  }, [match, ready]);

  if (missingMatch) {
    return (
      <div className="boot-screen" role="alert">
        <h1>MATCH COULD NOT BE RESTORED</h1>
        <p>No active match state was available after the gameplay route loaded.</p>
        <Link href="/play">Return to match setup</Link>
      </div>
    );
  }

  if (!ready || !match || bootstrappedMatchId !== match.id) {
    return <RuntimeLoading message="Restoring the active match before the tabletop is mounted…" />;
  }

  return <GameplayRuntime key={match.id} />;
}
