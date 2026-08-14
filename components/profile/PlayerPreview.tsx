"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PROFILE_TITLES } from "../../lib/profile-customization";
import {
  normalizePublicBrawlerProfile,
  type PublicBrawlerProfile,
} from "../../lib/public-profile";
import { ProfileAvatar } from "./ProfileAvatar";
import styles from "./PlayerPreview.module.css";

export type PlayerSummary = PublicBrawlerProfile;

export function PlayerPreview({
  userId,
  displayName,
  children,
}: {
  userId: string;
  displayName: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<PlayerSummary | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open || summary || !userId) return;
    fetch(`/api/profile?userId=${encodeURIComponent(userId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile unavailable.");
        const normalized = normalizePublicBrawlerProfile(result.profile);
        if (!normalized) throw new Error("Profile data is invalid.");
        setSummary(normalized);
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "Profile unavailable."),
      );
  }, [open, summary, userId]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", close);
    return () => removeEventListener("pointerdown", close);
  }, [open]);
  if (!userId) return <>{children ?? displayName}</>;
  const title = summary
    ? (PROFILE_TITLES.find((item) => item.id === summary.titleId) ??
      PROFILE_TITLES[0])
    : PROFILE_TITLES[0];
  return (
    <span className={styles.root} ref={root}>
      <button
        className={styles.trigger}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? displayName}
      </button>
      {open ? (
        <span
          className={styles.popover}
          role="dialog"
          aria-label={`${displayName} profile preview`}
        >
          {summary ? (
            <>
              <span className={styles.identity}>
                <ProfileAvatar
                  profile={{ name: summary.displayName, avatar: summary.avatar }}
                  className={styles.avatar}
                />
                <span>
                  <strong>{summary.displayName}</strong>
                  <small>
                    {summary.faction} · {title.label}
                  </small>
                </span>
              </span>
              <span className={styles.rank}>
                <strong>{summary.ranked?.rank ?? "Unranked"}</strong>
                <b>{summary.ranked ? `${summary.ranked.bp} BP` : "No Ranked record"}</b>
              </span>
              <span className={styles.stats}>
                <span>
                  <b>{summary.stats.gamesWon}</b> wins
                </span>
                <span>
                  <b>{summary.stats.gamesPlayed}</b> games
                </span>
                <span>
                  <b>{summary.stats.winRate}%</b> win rate
                </span>
              </span>
              <Link href={`/brawlers/${encodeURIComponent(summary.userId)}`}>
                VIEW PROFILE
              </Link>
            </>
          ) : (
            <span className={styles.loading}>{error || "Loading Brawler…"}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}
