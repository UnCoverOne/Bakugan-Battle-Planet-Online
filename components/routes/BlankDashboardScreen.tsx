"use client";

import Link from "next/link";
import { useState } from "react";
import { achievementsForProfile, ACHIEVEMENT_CATEGORY_DETAILS } from "../../lib/achievements";
import { AchievementCategoryIcon } from "./AchievementCategoryIcon";
import { BattleActivityPanel } from "./BattleActivityPanel";
import { WebsiteUpdatesStrip } from "./WebsiteUpdatesStrip";
import { legalDeckFormats } from "../../lib/data";
import { rememberAccountIntent } from "../../lib/account-intent";
import { invalidateResponse } from "../../lib/response-cache";
import { usePublicDeckCatalogue } from "./PublicDeckCatalogue";
import { useCompetitiveRules, useOnlineStatus } from "./DeckRouteShared";
import { DeckGalleryBody } from "./DeckGalleryCard";
import { useAppFields } from "../application/AppProvider";
import styles from "./BlankDashboardScreen.module.css";

function formatTime(value: unknown): string | null {
  const stamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return new Date(stamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function localMatchSummary(match: any): string {
  const round = Number.isFinite(match?.turn) && match.turn > 0 ? `Round ${match.turn}` : match?.phase === "lobby" ? "Lobby" : "Match in Progress";
  const log = Array.isArray(match?.log) ? match.log : [];
  const latest = log.length ? log[log.length - 1]?.at : null;
  const time = formatTime(latest);
  return time ? `${round} · ${time}` : round;
}

export function BlankDashboardScreen() {
  const {
    authUser, match, online, matchCapability, matchControllerId,
    accountMatchSessions, resumeCurrentMatch, resumingCurrentMatch,
    resumeAccountMatch, resumingMatchCode,
    decks, profile, history, lifetimeStats, promptAccount, notify,
  } = useAppFields([
    "authUser", "match", "online", "matchCapability", "matchControllerId",
    "accountMatchSessions", "resumeCurrentMatch", "resumingCurrentMatch",
    "resumeAccountMatch", "resumingMatchCode",
    "decks", "profile", "history", "lifetimeStats", "promptAccount", "notify",
  ]);

  const connectionOnline = useOnlineStatus();
  const catalogue = usePublicDeckCatalogue(connectionOnline, authUser?.id);
  const rules = useCompetitiveRules();
  const [likePending, setLikePending] = useState(false);
  const achievements = achievementsForProfile(decks, history, lifetimeStats, profile);
  const recentCompleted = achievements.filter(item => item.status === "completed")
    .sort((a, b) => (Date.parse(b.completedAt ?? "") || 0) - (Date.parse(a.completedAt ?? "") || 0));
  const nearComplete = achievements.filter(item => item.status === "in-progress")
    .sort((a, b) => b.current / b.target - a.current / a.target);
  const displayAchievements = [...recentCompleted.slice(0, 1), ...nearComplete].slice(0, 3);
  const featuredDeck = catalogue.decks.find(deck => Boolean(deck.description?.trim())) ?? catalogue.decks[0];
  const favorite = featuredDeck ? catalogue.favorites[featuredDeck.id] ?? { favoriteCount: 0, viewerHasFavorited: false } : null;

  async function toggleFeaturedLike() {
    if (!featuredDeck || likePending) return;
    if (!authUser) {
      rememberAccountIntent("favorite-deck", { deckId: featuredDeck.id, returnTo: window.location.pathname });
      promptAccount("favorite-deck");
      return;
    }
    if (!favorite || catalogue.status !== "online") return;
    const nextFavorited = !favorite.viewerHasFavorited;
    catalogue.updateFavorite(featuredDeck.id, {
      favoriteCount: Math.max(0, favorite.favoriteCount + (nextFavorited ? 1 : -1)),
      viewerHasFavorited: nextFavorited,
    });
    setLikePending(true);
    try {
      const response = await fetch("/api/public-decks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: nextFavorited ? "favorite" : "unfavorite", deckId: featuredDeck.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.favorite) throw new Error(result.error ?? "Unable to update likes.");
      catalogue.updateFavorite(featuredDeck.id, result.favorite);
      invalidateResponse("public-decks:");
    } catch (error) {
      catalogue.updateFavorite(featuredDeck.id, favorite);
      notify(error instanceof Error ? error.message : "Unable to update likes.");
    } finally {
      setLikePending(false);
    }
  }

  // Match the app shell's existing resume eligibility so we never advertise
  // a local online match whose seat credentials are no longer available.
  const canResumeLocal = Boolean(match && (!online || (matchCapability && matchControllerId)));
  const accountSession = !canResumeLocal && authUser && Array.isArray(accountMatchSessions)
    ? accountMatchSessions[0]
    : null;
  const canResume = canResumeLocal || Boolean(accountSession);
  const isResuming = Boolean(resumingCurrentMatch || (accountSession && resumingMatchCode === accountSession.code));
  const accountTime = accountSession ? formatTime(accountSession.updatedAt) : null;
  const accountPhase = accountSession?.phase === "lobby" ? "Lobby" : accountSession?.phase === "intermission" ? "Between Games" : "Match in Progress";
  const subtitle = canResumeLocal
    ? localMatchSummary(match)
    : accountSession
      ? accountTime ? `${accountPhase} · ${accountTime}` : accountPhase
      : "Start a New Game";

  function handleResume() {
    if (canResumeLocal) {
      void resumeCurrentMatch();
    } else if (accountSession) {
      void resumeAccountMatch(accountSession);
    }
  }

  return (
    <div className={styles.home}>
      <section className={styles.hero} aria-labelledby="battle-planet-title">
        <div className={styles.shade} aria-hidden="true" />
        <div className={styles.artwork} aria-hidden="true">
          <img
            src="/assets/home/Dragonoid%20Hero%20Art.webp"
            alt=""
            width={960}
            height={920}
          />
        </div>
        <div className={styles.content}>
          <div className={styles.heroControls}>
            <h1 id="battle-planet-title" className={styles.title}>
            <span>BATTLE</span><span>PLANET</span>
          </h1>
          <div className={styles.actions}>
            {canResume ? (
              <button type="button" className={`${styles.action} ${styles.primary}`} onClick={handleResume} disabled={isResuming}
                aria-label={`Resume current match: ${subtitle}`}>
                <span className={styles.actionCopy}>
                  <span className={styles.actionTitle}>{isResuming ? "RESUMING…" : "RESUME"}</span>
                  <span className={styles.actionSubtitle}>{subtitle}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M4 11a8 8 0 1 1 2.1 6M4 5v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            ) : (
              <Link href="/play" className={`${styles.action} ${styles.primary}`}>
                <span className={styles.actionCopy}>
                  <span className={styles.actionTitle}>PLAY</span>
                  <span className={styles.actionSubtitle}>Start a New Game</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="m8 5.5 11 6.5-11 6.5v-13Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>
              </Link>
            )}
            <Link href="/decks" className={`${styles.action} ${styles.secondary}`}>
              <span className={styles.actionCopy}>
                <span className={styles.actionTitle}>DECKS</span>
                <span className={styles.actionSubtitle}>Build and Manage Decks</span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><rect x="5" y="3" width="14" height="18" rx="0" stroke="currentColor" strokeWidth="1.8"/><path d="M8 7h8M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </Link>
          </div>
          </div>
        </div>
      </section>
      <div className={styles.dashboard}>
        <section className={styles.achievementPanel} aria-labelledby="home-achievements-title">
          <header className={styles.panelHeader}>
            <h2 id="home-achievements-title">Achievements</h2>
            <Link href="/profile/achievements">View All</Link>
          </header>
          <div className={styles.achievementList}>
            {displayAchievements.length ? displayAchievements.map(item => (
              <div className={styles.achievementRow} key={item.id}>
                <span className={styles.achievementGlyph} style={{ color: ACHIEVEMENT_CATEGORY_DETAILS[item.category].color }} aria-hidden="true">
                  <AchievementCategoryIcon category={item.category} />
                </span>
                <div className={styles.achievementText}>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                  <div className={`${styles.progressTrack} ${item.status === "completed" ? styles.progressCompleted : ""}`} role="progressbar" aria-label={item.name} aria-valuemin={0} aria-valuemax={item.target} aria-valuenow={item.current}>
                    <span style={{ width: `${Math.min(100, 100 * item.current / item.target)}%` }} />
                  </div>
                </div>
                <span className={styles.progressValue}>{item.current}/{item.target}</span>
              </div>
            )) : <p className={styles.emptyPanel}>Complete matches and build decks to earn achievements.</p>}
          </div>
        </section>
        <section className={styles.featuredPanel} aria-labelledby="home-featured-title">
          <header className={styles.panelHeader}>
            <h2 id="home-featured-title">Featured Deck</h2>
            <Link href="/decks/public">Browse Decks</Link>
          </header>
          {featuredDeck ? <DeckGalleryBody
            deck={featuredDeck}
            href={`/decks/public/${encodeURIComponent(featuredDeck.id)}`}
            legalFormats={legalDeckFormats(featuredDeck, rules.restrictions, rules.deckSize)}
            creatorName={featuredDeck.creator ?? "Community Brawler"}
            creatorUserId={(featuredDeck as typeof featuredDeck & { creatorUserId?: string }).creatorUserId}
            featured
            likes={favorite?.favoriteCount}
            liked={favorite?.viewerHasFavorited}
            onLike={catalogue.status === "online" ? () => void toggleFeaturedLike() : undefined}
            likeDisabled={likePending}
          /> : <p className={styles.emptyPanel}>No public decks to feature yet. Explore the deck library to get started.</p>}
        </section>
      </div>
      <BattleActivityPanel />
      <WebsiteUpdatesStrip />
    </div>
  );
}
