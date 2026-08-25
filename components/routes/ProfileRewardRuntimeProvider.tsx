"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { achievementsFor } from "../../lib/achievements";
import {
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  normalizeAchievementRewardAssignments,
  type AchievementRewardAssignments,
} from "../../lib/achievement-rewards";
import {
  PROFILE_COVERS,
  PROFILE_TITLES,
} from "../../lib/profile-customization";
import {
  resetProfileRewardRuntime,
  setProfileRewardRuntime,
} from "../../lib/profile-reward-runtime";
import { useApp } from "../application/AppProvider";

export function ProfileRewardRuntimeProvider({ children }: { children: ReactNode }) {
  const { profile, setProfile, decks, history, lifetimeStats } = useApp();
  const [assignments, setAssignments] = useState<AchievementRewardAssignments>(
    () => normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS),
  );
  const achievements = useMemo(
    () => achievementsFor(decks, history, lifetimeStats),
    [decks, history, lifetimeStats],
  );
  const completedAchievementIds = useMemo(
    () => new Set(
      achievements
        .filter((achievement) => achievement.unlocked)
        .map((achievement) => achievement.id),
    ),
    [achievements],
  );

  setProfileRewardRuntime(assignments, completedAchievementIds);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile-rewards", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile rewards unavailable.");
        setAssignments(normalizeAchievementRewardAssignments(result.assignments));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAssignments(normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => resetProfileRewardRuntime(), []);

  useEffect(() => {
    const next = { ...profile };
    let changed = false;

    const titleRequirement = assignments.titles[profile.titleId] ?? null;
    if (titleRequirement && !completedAchievementIds.has(titleRequirement)) {
      next.titleId = PROFILE_TITLES[0].id;
      changed = true;
    }

    const coverRequirement = assignments.covers[profile.coverId] ?? null;
    if (coverRequirement && !completedAchievementIds.has(coverRequirement)) {
      next.coverId = PROFILE_COVERS[0].id;
      changed = true;
    }

    const avatarMatch = /^preset:([a-z0-9-]{1,120})$/i.exec(profile.avatar ?? "");
    if (avatarMatch) {
      const avatarRequirement = assignments.avatars[avatarMatch[1]] ?? null;
      if (avatarRequirement && !completedAchievementIds.has(avatarRequirement)) {
        next.avatar = "";
        changed = true;
      }
    }

    if (changed) setProfile(next);
  }, [assignments, completedAchievementIds, profile, setProfile]);

  return children;
}
