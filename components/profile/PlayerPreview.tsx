"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./PlayerPreview.module.css";

export type PlayerSummary = {
  userId: string;
  displayName: string;
  faction: string;
  avatarId: string;
  titleId: string;
  rank: string;
  bp: number;
  wins: number;
  losses: number;
  winRate: number;
};

export function PlayerPreview({ userId, displayName, children }: { userId: string; displayName: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open || summary || !userId) return;
    fetch(`/api/ranked?action=profile&userId=${encodeURIComponent(userId)}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Profile unavailable."); setSummary(result.profile); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Profile unavailable."));
  }, [open, summary, userId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    addEventListener("pointerdown", close);
    return () => removeEventListener("pointerdown", close);
  }, [open]);
  if (!userId) return <>{children ?? displayName}</>;
  return <span className={styles.root} ref={root}>
    <button className={styles.trigger} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{children ?? displayName}</button>
    {open ? <span className={styles.popover} role="dialog" aria-label={`${displayName} profile preview`}>
      {summary ? <>
        <span className={styles.identity}><span className={styles.avatar}>{summary.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{summary.displayName}</strong><small>{summary.faction} · {summary.titleId.replaceAll("-", " ")}</small></span></span>
        <span className={styles.rank}><strong>{summary.rank}</strong><b>{summary.bp} BP</b></span>
        <span className={styles.stats}><span><b>{summary.wins}</b> wins</span><span><b>{summary.losses}</b> losses</span><span><b>{summary.winRate}%</b> win rate</span></span>
        <Link href={`/brawlers/${encodeURIComponent(summary.userId)}`}>VIEW PROFILE</Link>
      </> : <span className={styles.loading}>{error || "Loading Brawler…"}</span>}
    </span> : null}
  </span>;
}

