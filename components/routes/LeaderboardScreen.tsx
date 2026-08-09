"use client";

import { useEffect, useState } from "react";
import { PlayerPreview } from "../profile/PlayerPreview";
import styles from "./LeaderboardScreen.module.css";

type Entry = { position: number; userId: string; displayName: string; faction: string; rank: string; bp: number; wins: number; losses: number; winRate: number };

export function LeaderboardScreen() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<{ entries: Entry[]; total: number; pageSize: number; viewerPosition: number | null; viewerUserId: string | null } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    fetch(`/api/ranked?page=${page}&pageSize=25&search=${encodeURIComponent(search)}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Leaderboard unavailable."); if (active) setData(result); })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "Leaderboard unavailable."));
    return () => { active = false; };
  }, [page, search]);
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25)));
  return <div className={styles.route}>
    <header><span>RANKED PLAY</span><h1>BRAWLER LEADERBOARD</h1><p>Players ranked by Brawler Points. BP is transferred zero-sum after each completed Best-of-Three Ranked series.</p></header>
    <form onSubmit={(event) => { event.preventDefault(); setPage(1); setSearch(query.trim()); }}><input aria-label="Search Brawlers" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Brawlers…" /><button>SEARCH</button></form>
    {data?.viewerPosition ? <p className={styles.position}>YOUR POSITION · #{data.viewerPosition}</p> : null}
    {error ? <p className={styles.error}>{error}</p> : null}
    <section className={styles.table} aria-label="Ranked leaderboard">
      <div className={styles.heading}><span>#</span><span>BRAWLER</span><span>RANK</span><span>BP</span><span>RECORD</span><span>WIN RATE</span></div>
      {data?.entries.map((entry) => <article key={entry.userId} className={entry.userId === data.viewerUserId ? styles.viewer : undefined}>
        <b>{entry.position}</b><PlayerPreview userId={entry.userId} displayName={entry.displayName}><span><strong>{entry.displayName}</strong><small>{entry.faction}</small></span></PlayerPreview><span>{entry.rank}</span><strong>{entry.bp}</strong><span>{entry.wins}–{entry.losses}</span><span>{entry.winRate}%</span>
      </article>)}
    </section>
    <nav><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>← PREVIOUS</button><span>PAGE {page} OF {pages}</span><button disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>NEXT →</button></nav>
  </div>;
}
