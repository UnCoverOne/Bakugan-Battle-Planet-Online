"use client";

import Link from "next/link";
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
  } = useAppFields([
    "authUser", "match", "online", "matchCapability", "matchControllerId",
    "accountMatchSessions", "resumeCurrentMatch", "resumingCurrentMatch",
    "resumeAccountMatch", "resumingMatchCode",
  ]);

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
      </section>
    </div>
  );
}
