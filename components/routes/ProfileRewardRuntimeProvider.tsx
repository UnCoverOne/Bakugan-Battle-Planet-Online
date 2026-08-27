"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACHIEVEMENT_DEFINITIONS,
  achievementsFor,
  applyAchievementCompletions,
  normalizeAchievementDefinitions,
  resetAchievementDefinitionRuntime,
  setAchievementDefinitionRuntime,
  type AchievementDefinition,
} from "../../lib/achievements";
import {
  normalizeAchievementProgress,
  observeAchievementDecks,
  recordAchievementMatch,
} from "../../lib/achievement-progress";
import {
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  normalizeAchievementRewardAssignments,
  type AchievementRewardAssignments,
} from "../../lib/achievement-rewards";
import { completedMatchKey } from "../../lib/match-result-navigation";
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
  const {
    profile,
    setProfile,
    decks,
    history,
    lifetimeStats,
    match,
    online,
    playerId,
    selectedDeck,
  } = useApp();
  const [assignments, setAssignments] = useState<AchievementRewardAssignments>(
    () => normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS),
  );
  const [definitions, setDefinitions] = useState<AchievementDefinition[]>(
    () => normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS),
  );
  const liveAchievements = useMemo(
    () => achievementsFor(
      decks,
      history,
      lifetimeStats,
      definitions,
      profile.achievementProgress,
    ),
    [decks, definitions, history, lifetimeStats, profile.achievementProgress],
  );
  const achievements = useMemo(
    () => applyAchievementCompletions(liveAchievements, profile.achievementCompletions),
    [liveAchievements, profile.achievementCompletions],
  );
  const completedAchievementIds = useMemo(
    () => new Set(
      achievements
        .filter((achievement) => achievement.unlocked)
        .map((achievement) => achievement.id),
    ),
    [achievements],
  );

  setAchievementDefinitionRuntime(definitions);
  setProfileRewardRuntime(assignments, completedAchievementIds);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile-rewards", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile rewards unavailable.");
        const nextDefinitions = normalizeAchievementDefinitions(result.achievements);
        const activeAchievementIds = new Set(nextDefinitions.map((item) => item.id));
        setDefinitions(nextDefinitions);
        setAssignments(normalizeAchievementRewardAssignments(result.assignments, activeAchievementIds));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        const fallbackDefinitions = normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS);
        setDefinitions(fallbackDefinitions);
        setAssignments(normalizeAchievementRewardAssignments(
          DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
          new Set(fallbackDefinitions.map((item) => item.id)),
        ));
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => {
    resetAchievementDefinitionRuntime();
    resetProfileRewardRuntime();
  }, []);

  // Deck-building progress is evidence-based rather than derived from the current
  // library forever. Once a qualifying legal deck has been observed, later edits
  // or deletion do not take that progress away.
  useEffect(() => {
    setProfile((current) => {
      const before = normalizeAchievementProgress(current.achievementProgress);
      let nextProgress = observeAchievementDecks(before, decks);
      const resultId = completedMatchKey(match);
      if (resultId) {
        const opponent = match?.players?.find((player: { id: string }) => player.id !== playerId);
        const rankedOpponent = opponent ? match?.ranked?.players?.[opponent.id] : null;
        const mode = match?.ranked ? "ranked" : online ? "casual" : "training";
        nextProgress = recordAchievementMatch(
          nextProgress,
          {
            id: resultId,
            result: match?.winner === playerId ? "Victor" : "Defeat",
            mode,
            format: match?.format,
            opponentKey: rankedOpponent?.userId ?? opponent?.name,
          },
          selectedDeck ?? null,
        );
      }
      if (JSON.stringify(before) === JSON.stringify(nextProgress)) return current;
      return { ...current, achievementProgress: nextProgress };
    });
  }, [decks, match, online, playerId, selectedDeck, setProfile]);

  // Completion timestamps are permanent. This is intentionally separate from
  // live progress so deleting a deck or changing an Administrator rule never
  // revokes an achievement that was legitimately earned.
  useEffect(() => {
    setProfile((current) => {
      const stored = current.achievementCompletions ?? {};
      const newlyCompleted = liveAchievements.filter(
        (achievement) => achievement.unlocked && !stored[achievement.id],
      );
      if (!newlyCompleted.length) return current;

      const nextCompletions = { ...stored };
      const recordedAt = new Date().toISOString();
      for (const achievement of newlyCompleted) {
        nextCompletions[achievement.id] = achievement.completedAt ?? recordedAt;
      }
      return { ...current, achievementCompletions: nextCompletions };
    });
  }, [liveAchievements, setProfile]);

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

  return <Fragment key={JSON.stringify(definitions)}>{children}</Fragment>;
}
