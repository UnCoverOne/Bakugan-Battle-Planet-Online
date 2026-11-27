"use client";

import { LucideIcon } from "../design-system/LucideIcon";
import Link from "next/link";
import { playerMatchSummary } from "../../lib/match-statistics";
import type { MatchResultRecord } from "../../lib/persistence";
import { useAppFields } from "../application/AppProvider";
import styles from "./BattleActivityPanel.module.css";

function BattleIcon(){return <LucideIcon name="swords"/>;}
function TrophyIcon(){return <LucideIcon name="trophy"/>;}
function RateIcon(){return <LucideIcon name="chart-no-axes-column"/>;}

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
            <span className={styles.matchArrow} aria-hidden="true"><LucideIcon name="chevron-right" size={18}/></span>
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
