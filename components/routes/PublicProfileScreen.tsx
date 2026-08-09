"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PlayerSummary } from "../profile/PlayerPreview";
import styles from "./PublicProfileScreen.module.css";

type PublicProfile = PlayerSummary & { joinedAt: number; coverId: string; showcaseAchievementIds: string[]; showcaseDecks: Array<{ id: string; name: string; factions: string[] }> };

export function PublicProfileScreen({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`/api/ranked?action=profile&userId=${encodeURIComponent(userId)}`, { cache: "no-store" }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Profile unavailable."); setProfile(result.profile); }).catch((cause) => setError(cause instanceof Error ? cause.message : "Profile unavailable.")); }, [userId]);
  if (!profile) return <div className={styles.state}>{error || "Loading Brawler Profile…"}</div>;
  return <div className={styles.route}>
    <header><div className={styles.avatar}>{profile.displayName.slice(0, 2).toUpperCase()}</div><div><span>{profile.faction} BRAWLER</span><h1>{profile.displayName}</h1><p>Joined {new Date(profile.joinedAt).toLocaleDateString()}</p></div></header>
    <section className={styles.rank}><div><span>RANK</span><strong>{profile.rank}</strong></div><div><span>BRAWLER POINTS</span><strong>{profile.bp} BP</strong></div><div><span>RANKED RECORD</span><strong>{profile.wins}–{profile.losses}</strong></div><div><span>WIN RATE</span><strong>{profile.winRate}%</strong></div></section>
    <section><h2>SHOWCASED DECKS</h2>{profile.showcaseDecks.length ? <div className={styles.decks}>{profile.showcaseDecks.map((deck) => <article key={deck.id}><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span></article>)}</div> : <p>No public decks are showcased.</p>}</section>
    <Link href="/leaderboard">← RETURN TO LEADERBOARD</Link>
  </div>;
}

