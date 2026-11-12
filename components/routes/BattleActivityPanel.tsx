"use client";

import Link from "next/link";
import { playerMatchSummary } from "../../lib/match-statistics";
import type { MatchResultRecord } from "../../lib/persistence";
import { useAppFields } from "../application/AppProvider";
import styles from "./BattleActivityPanel.module.css";

const iconCommon = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
};

function BattleIcon() {
  return <svg {...iconCommon}><path d="m13 19 6-6M14.5 17.5 3.6 6.6A2 2 0 0 1 3 5.2V3h2.2a2 2 0 0 1 1.4.6l10.9 10.9M14.8 6.2l2.6-2.6A2 2 0 0 1 18.8 3H21v2.2a2 2 0 0 1-.6 1.4l-2.6 2.6M16 16l4 4m-1 1 2-2M5 14l4 4m-4 3-2-2m4.5-2.5L4 20" /></svg>;
}

function TrophyIcon() {
  return <svg {...iconCommon}><path d="M8 21h8m-4-4v4M7 4h10v7a5 5 0 0 1-10 0V4ZM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4" /></svg>;
}

function RateIcon() {
  return <svg {...iconCommon}><path d="M4 20V12m6 8V7m6 13V4m6 16v-9" /></svg>;
}

function recordTime(record: MatchResultRecord) {
  const value = Date.parse(record.at);
  return Number.isFinite(value) ? value : 0;
}

function latestCompletedMatch(history: MatchResultRecord[]) {
  return history
    .filter((record) =>
      Boolean(record.id)
      && ["Victor", "Defeat", "Draw"].includes(record.result)
      && !/disconnect|abandon/i.test(record.reason ?? ""),
    )
    .reduce<MatchResultRecord | null>((latest, record) =>
      !latest || recordTime(record) > recordTime(latest) ? record : latest, null);
}

export function BattleActivityPanel() {
  const { history, lifetimeStats, authUser } = useAppFields([
    "history", "lifetimeStats", "authUser",
  ]);
  const { gamesPlayed, gamesWon, winRate } = playerMatchSummary(
    history, lifetimeStats, Boolean(authUser),
  );
  const latest = latestCompletedMatch(history);
  const resultLabel = latest?.result === "Victor" ? "Victory"
    : latest?.result === "Defeat" ? "Defeat" : "Draw";
  const resultClass = latest?.result === "Victor" ? styles.victory
    : latest?.result === "Defeat" ? styles.defeat : styles.draw;
  const matchDate = latest && recordTime(latest) > 0
    ? new Date(latest.at).toLocaleDateString(undefined, {
        day: "numeric", month: "short", year: "numeric",
      })
    : null;

  return (
    <section className={styles.panel} aria-labelledby="home-battle-activity-title">
      <header className={styles.header}>
        <h2 id="home-battle-activity-title">Battle Activity</h2>
        <Link href="/history">Match History <span aria-hidden="true">↗</span></Link>
      </header>

      <div className={styles.stats} aria-label="Lifetime battle statistics">
        <div className={styles.stat}>
          <div className={styles.statTitle}><span className={styles.battleIcon}><BattleIcon /></span><span>Total Battles</span></div>
          <strong>{gamesPlayed}</strong>
        </div>
        <div className={styles.stat}>
          <div className={styles.statTitle}><span className={styles.winIcon}><TrophyIcon /></span><span>Victories</span></div>
          <strong>{gamesWon}</strong>
        </div>
        <div className={styles.stat}>
          <div className={styles.statTitle}><span className={styles.rateIcon}><RateIcon /></span><span>Win Rate</span></div>
          <strong>{winRate}%</strong>
        </div>
      </div>

      <div className={styles.latest}>
        <h3>Latest Battle</h3>
        {latest ? (
          <Link className={`${styles.match} ${resultClass}`} href={`/history/${encodeURIComponent(latest.id)}`}
            aria-label={`${resultLabel} against ${latest.opponent || "Opponent"}. Open match record`}>
            <span className={styles.resultIcon}><TrophyIcon /></span>
            <span className={styles.matchMain}>
              <strong>{resultLabel}</strong>
              <span>vs {latest.opponent || "Opponent"}</span>
            </span>
            <span className={styles.matchDetails}>
              <strong>{latest.score || "—"}</strong>
              {matchDate ? <small>{matchDate}</small> : null}
            </span>
            <span className={styles.matchArrow} aria-hidden="true">›</span>
          </Link>
        ) : (
          <div className={styles.noMatch}>
            <span aria-hidden="true"><BattleIcon /></span>
            No battles recorded yet
          </div>
        )}
      </div>
    </section>
  );
}
