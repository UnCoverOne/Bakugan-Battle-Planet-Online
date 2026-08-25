"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ACHIEVEMENT_DEFINITIONS } from "../../lib/achievements";
import {
  ALWAYS_AVAILABLE_PROFILE_REWARDS,
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  normalizeAchievementRewardAssignments,
  type AchievementRewardAssignments,
} from "../../lib/achievement-rewards";
import {
  PROFILE_AVATARS,
  PROFILE_COVERS,
  PROFILE_TITLES,
} from "../../lib/profile-customization";
import { useApp } from "../application/AppProvider";
import {
  ActionButton,
  Field,
  RouteHero,
  StatusChip,
  Surface,
} from "../design-system/primitives";
import styles from "./AchievementRewardManagement.module.css";

type RewardGroupKey = keyof AchievementRewardAssignments;
type RewardItem = { id: string; label: string };

const GROUPS: Array<{
  key: RewardGroupKey;
  label: string;
  description: string;
  items: readonly RewardItem[];
  alwaysAvailable: ReadonlySet<string>;
}> = [
  {
    key: "titles",
    label: "Titles",
    description: "Profile Titles shown beside a Brawler's identity.",
    items: PROFILE_TITLES,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.titles,
  },
  {
    key: "covers",
    label: "Covers",
    description: "Brawler Profile cover artwork.",
    items: PROFILE_COVERS,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.covers,
  },
  {
    key: "avatars",
    label: "Avatars",
    description: "Brawler Profile Icons used as profile pictures.",
    items: PROFILE_AVATARS,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.avatars,
  },
];

export function AchievementRewardManagement() {
  const { notify } = useApp();
  const [assignments, setAssignments] = useState<AchievementRewardAssignments>(
    () => normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/admin/achievement-rewards", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Achievement rewards could not be loaded.");
        return normalizeAchievementRewardAssignments(result.assignments);
      })
      .then((value) => {
        setAssignments(value);
        setError("");
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Achievement rewards could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const assignedCount = useMemo(
    () => GROUPS.reduce(
      (count, group) => count + Object.values(assignments[group.key]).filter(Boolean).length,
      0,
    ),
    [assignments],
  );

  const setRewardAchievement = (
    group: RewardGroupKey,
    rewardId: string,
    achievementId: string,
  ) => {
    setAssignments((current) => normalizeAchievementRewardAssignments({
      ...current,
      [group]: {
        ...current[group],
        [rewardId]: achievementId || null,
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/achievement-rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Achievement rewards could not be saved.");
      setAssignments(normalizeAchievementRewardAssignments(result.assignments));
      setError("");
      notify("Achievement reward assignments saved.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Achievement rewards could not be saved.";
      setError(message);
      notify(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.route}>
      <RouteHero
        eyebrow="ADMINISTRATOR"
        title="Achievement Rewards"
        description="Assign profile customization rewards to achievements. Changes apply globally to Titles, Covers, and Avatars."
        aside={<StatusChip tone="warning">{assignedCount} ASSIGNED</StatusChip>}
      />

      <Surface className={styles.toolbar}>
        <div>
          <strong>Reward catalogue</strong>
          <p>The default Profile Title and default Cover remain permanently available so every account always has a valid fallback.</p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={saving}
            onClick={() => setAssignments(normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS))}
          >
            Restore defaults
          </button>
          <ActionButton disabled={loading || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save Rewards"}
          </ActionButton>
        </div>
      </Surface>

      {loading ? <Surface className={styles.state} role="status">Loading achievement rewards…</Surface> : null}
      {error ? <Surface className={styles.state} role="alert">{error}</Surface> : null}

      <div className={styles.groups}>
        {GROUPS.map((group) => (
          <Surface as="section" className={styles.group} key={group.key}>
            <header>
              <div>
                <span>REWARD TYPE</span>
                <h2>{group.label}</h2>
                <p>{group.description}</p>
              </div>
              <StatusChip tone="info">
                {Object.values(assignments[group.key]).filter(Boolean).length} / {group.items.length} GATED
              </StatusChip>
            </header>
            <div className={styles.rows}>
              {group.items.map((reward) => {
                const permanent = group.alwaysAvailable.has(reward.id);
                const value = assignments[group.key][reward.id] ?? "";
                return (
                  <div className={styles.row} key={reward.id}>
                    <div>
                      <strong>{reward.label}</strong>
                      <small>{reward.id}</small>
                    </div>
                    {permanent ? (
                      <StatusChip tone="success">Always available</StatusChip>
                    ) : (
                      <Field label={`Achievement for ${reward.label}`}>
                        <select
                          value={value ?? ""}
                          onChange={(event) => setRewardAchievement(group.key, reward.id, event.target.value)}
                        >
                          <option value="">No achievement · always available</option>
                          {ACHIEVEMENT_DEFINITIONS.map((achievement) => (
                            <option value={achievement.id} key={achievement.id}>
                              {achievement.name} · {achievement.category}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                  </div>
                );
              })}
            </div>
          </Surface>
        ))}
      </div>

      <p className={styles.backLink}>
        <Link href="/admin">← Back to Administrator Control Centre</Link>
      </p>
    </div>
  );
}
