"use client";

import Link from "next/link";
import { useMemo } from "react";
import { achievementsForProfile } from "../../lib/achievements";
import { closestUnfinishedAchievements } from "../../lib/home-dashboard";
import { lifetimeMatchStatsFromHistory } from "../../lib/match-statistics";
import { useAppFields } from "../application/AppProvider";

export default function HomeAchievements() {
  const { decks, history, lifetimeStats, profile, authUser } = useAppFields([
    "decks", "history", "lifetimeStats", "profile", "authUser",
  ]);
  const stats = useMemo(
    () => authUser ? lifetimeMatchStatsFromHistory(history) : lifetimeStats,
    [authUser, history, lifetimeStats],
  );
  const closest = useMemo(
    () => closestUnfinishedAchievements(
      achievementsForProfile(decks, history, stats, profile),
    ),
    [decks, history, stats, profile],
  );

  return (
    <section aria-labelledby="home-achievements-title">
      <header>
        <h2 id="home-achievements-title">Achievements</h2>
        <Link prefetch={false} href="/profile/achievements">View all</Link>
      </header>
      {closest.length ? (
        <ul>
          {closest.map((achievement) => (
            <li key={achievement.id}>
              <strong>{achievement.name}</strong>
              <p>{achievement.description}</p>
              <span>{achievement.current} / {achievement.target}</span>
              <progress
                aria-label={`${achievement.name}: ${achievement.current} of ${achievement.target}`}
                value={achievement.current}
                max={achievement.target}
              />
            </li>
          ))}
        </ul>
      ) : <p>All available achievements are complete.</p>}
    </section>
  );
}
