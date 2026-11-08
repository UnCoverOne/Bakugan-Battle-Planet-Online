"use client";

import Link from "next/link";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { activeSessionPresentation } from "../../lib/active-session";
import { accountMatchSessionPresentation, type AccountMatchSessionSummary } from "../../lib/account-match-session";
import type { FeaturedCommunityDeck } from "../../lib/home-dashboard";
import { lifetimeMatchStatsFromHistory } from "../../lib/match-statistics";
import { useAppFields } from "../application/AppProvider";

// Achievement evaluation uses catalogue/deck validation, so it is split out
// of the first-load dashboard bundle rather than importing the catalogue here.
const HomeAchievements = lazy(() => import("./HomeAchievements"));

type FeaturedStatus = "loading" | "ready" | "error";

function FeaturedDeck() {
  const [deck, setDeck] = useState<FeaturedCommunityDeck | null>(null);
  const [status, setStatus] = useState<FeaturedStatus>("loading");

  useEffect(() => {
    let mounted = true;
    let lastChecked = 0;
    let pending: AbortController | null = null;
    const refresh = async () => {
      if (!mounted || !navigator.onLine || Date.now() - lastChecked < 60_000) return;
      lastChecked = Date.now();
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch("/api/home/featured-deck", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Featured deck unavailable");
        const result = await response.json() as { deck?: FeaturedCommunityDeck | null };
        if (mounted && !controller.signal.aborted) {
          setDeck(result.deck ?? null);
          setStatus("ready");
        }
      } catch {
        if (mounted && !controller.signal.aborted) setStatus("error");
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    return () => {
      mounted = false;
      pending?.abort();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
    };
  }, []);

  return (
    <section aria-labelledby="home-featured-title">
      <h2 id="home-featured-title">Featured Community Deck</h2>
      {status === "loading" ? (
        <p role="status">Loading featured deck…</p>
      ) : status === "error" ? (
        <p role="status">Featured deck is temporarily unavailable.</p>
      ) : deck ? (
        <div>
          <h3>{deck.name}</h3>
          <p>By {deck.creator} · Standard</p>
          {deck.description && <p>{deck.description}</p>}
          <Link prefetch={false} href={`/decks/public/${encodeURIComponent(deck.id)}`}>
            View deck
          </Link>
        </div>
      ) : <p>No legal Standard community deck has been published yet.</p>}
    </section>
  );
}

export default function HomeDashboard() {
  const {
    ready,
    authChecking,
    accountDataReady,
    authUser,
    history,
    lifetimeStats,
    match,
    online,
    matchCapability,
    matchControllerId,
    accountMatchSessions,
    resumeCurrentMatch,
    resumingCurrentMatch,
    resumeAccountMatch,
    resumingMatchCode,
  } = useAppFields([
    "ready", "authChecking", "accountDataReady", "authUser",
    "history", "lifetimeStats", "match", "online",
    "matchCapability", "matchControllerId", "accountMatchSessions",
    "resumeCurrentMatch", "resumingCurrentMatch",
    "resumeAccountMatch", "resumingMatchCode",
  ]);

  const dataReady = ready && !authChecking && (!authUser || accountDataReady);
  const activeSession = dataReady
    ? activeSessionPresentation(!online || (matchCapability && matchControllerId) ? match : null)
    : null;
  const recoverableSession: AccountMatchSessionSummary | undefined = dataReady && !activeSession
    ? accountMatchSessions?.find((session: AccountMatchSessionSummary) => session.code !== match?.code)
    : undefined;
  const remoteAction = recoverableSession
    ? accountMatchSessionPresentation(recoverableSession)
    : null;

  const stats = useMemo(
    () => authUser ? lifetimeMatchStatsFromHistory(history) : lifetimeStats,
    [authUser, history, lifetimeStats],
  );
  const played = stats.matchesPlayed;
  const wins = stats.wins;
  const winRate = played ? Math.round(wins / played * 100) : 0;

  return (
    <div className="home-dashboard">
      <section aria-labelledby="home-play-title">
        <h2 id="home-play-title">Play</h2>
        <div className="home-dashboard-actions">
          {!dataReady ? (
            <button type="button" disabled>Loading…</button>
          ) : activeSession ? (
            <button type="button" disabled={resumingCurrentMatch}
              onClick={() => void resumeCurrentMatch()}>
              {resumingCurrentMatch ? "Resuming…" : activeSession.kind === "lobby" ? "Resume Lobby" : "Resume Match"}
            </button>
          ) : recoverableSession ? (
            <button type="button" disabled={Boolean(resumingMatchCode)}
              onClick={() => void resumeAccountMatch(recoverableSession)}>
              {resumingMatchCode ? "Resuming…" : remoteAction?.actionLabel ?? "Resume Match"}
            </button>
          ) : (
            <Link prefetch={false} href="/play">Play</Link>
          )}
          <Link prefetch={false} href="/decks">Decks</Link>
        </div>
      </section>

      {dataReady ? (
        <Suspense fallback={<section aria-labelledby="home-achievements-loading"><h2 id="home-achievements-loading">Achievements</h2><p role="status">Loading achievements…</p></section>}>
          <HomeAchievements />
        </Suspense>
      ) : (
        <section aria-labelledby="home-achievements-pending">
          <h2 id="home-achievements-pending">Achievements</h2>
          <p role="status">Loading player data…</p>
        </section>
      )}

      <FeaturedDeck />

      <section aria-labelledby="home-stats-title">
        <h2 id="home-stats-title">Player Statistics</h2>
        {dataReady ? (
          <dl className="home-dashboard-stats">
            <div><dt>Games played</dt><dd>{played}</dd></div>
            <div><dt>Games won</dt><dd>{wins}</dd></div>
            <div><dt>Win rate</dt><dd>{winRate}%</dd></div>
          </dl>
        ) : <p role="status">Loading player data…</p>}
      </section>
    </div>
  );
}
