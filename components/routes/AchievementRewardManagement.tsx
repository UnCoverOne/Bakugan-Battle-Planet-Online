"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACHIEVEMENT_CATEGORIES,
  ACHIEVEMENT_DEFINITIONS,
  ACHIEVEMENT_METRICS,
  normalizeAchievementDefinitions,
  type AchievementDefinition,
  type AchievementMetricKey,
} from "../../lib/achievements";
import {
  ALWAYS_AVAILABLE_PROFILE_REWARDS,
  DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS,
  PROFILE_REWARD_UNAVAILABLE,
  normalizeAchievementRewardAssignments,
  rewardAssignmentIsAchievement,
  type AchievementRewardAssignments,
} from "../../lib/achievement-rewards";
import {
  PROFILE_AVATARS,
  PROFILE_COVER_CATALOGUE,
  PROFILE_TITLE_CATALOGUE,
} from "../../lib/profile-customization";
import { useApp } from "../application/AppProvider";
import {
  ActionButton,
  Field,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import styles from "./AchievementRewardManagement.module.css";

type RewardGroupKey = keyof AchievementRewardAssignments;
type RewardItem = { id: string; label: string };
type RewardReference = {
  group: RewardGroupKey;
  groupLabel: string;
  id: string;
  label: string;
};
type SortMode = "catalogue" | "name" | "category" | "target" | "reward";
type RewardFilter = "all" | "assigned" | "unassigned";
type ModalState =
  | { type: "edit"; achievementId: string }
  | { type: "reward"; achievementId: string }
  | { type: "unassigned" }
  | null;

const GROUPS: Array<{
  key: RewardGroupKey;
  label: string;
  singular: string;
  items: readonly RewardItem[];
  alwaysAvailable: ReadonlySet<string>;
}> = [
  {
    key: "titles",
    label: "Titles",
    singular: "Title",
    items: PROFILE_TITLE_CATALOGUE,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.titles,
  },
  {
    key: "covers",
    label: "Covers",
    singular: "Cover",
    items: PROFILE_COVER_CATALOGUE,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.covers,
  },
  {
    key: "avatars",
    label: "Avatars",
    singular: "Avatar",
    items: PROFILE_AVATARS,
    alwaysAvailable: ALWAYS_AVAILABLE_PROFILE_REWARDS.avatars,
  },
];

const catalogueOrder = new Map(
  ACHIEVEMENT_DEFINITIONS.map((achievement, index) => [achievement.id, index]),
);

const metricLabel = (metric: AchievementMetricKey) => metric
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/^./, (value) => value.toUpperCase());

function cloneAssignments(assignments: AchievementRewardAssignments): AchievementRewardAssignments {
  return {
    titles: { ...assignments.titles },
    covers: { ...assignments.covers },
    avatars: { ...assignments.avatars },
  };
}

function rewardsByAchievement(assignments: AchievementRewardAssignments) {
  const result = new Map<string, RewardReference>();
  for (const group of GROUPS) {
    for (const reward of group.items) {
      const achievementId = assignments[group.key][reward.id];
      if (!rewardAssignmentIsAchievement(achievementId)) continue;
      result.set(achievementId as string, {
        group: group.key,
        groupLabel: group.singular,
        id: reward.id,
        label: reward.label,
      });
    }
  }
  return result;
}

function clearAchievementReward(
  assignments: AchievementRewardAssignments,
  achievementId: string,
) {
  const next = cloneAssignments(assignments);
  for (const group of GROUPS) {
    for (const reward of group.items) {
      if (next[group.key][reward.id] === achievementId) {
        next[group.key][reward.id] = null;
      }
    }
  }
  return next;
}

export function AchievementRewardManagement() {
  const { notify } = useApp();
  const [assignments, setAssignments] = useState<AchievementRewardAssignments>(
    () => normalizeAchievementRewardAssignments(DEFAULT_ACHIEVEMENT_REWARD_ASSIGNMENTS),
  );
  const [achievements, setAchievements] = useState<AchievementDefinition[]>(
    () => normalizeAchievementDefinitions(ACHIEVEMENT_DEFINITIONS),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [rewardFilter, setRewardFilter] = useState<RewardFilter>("all");
  const [sort, setSort] = useState<SortMode>("catalogue");
  const [modal, setModal] = useState<ModalState>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/admin/achievement-rewards", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Achievements could not be loaded.");
        const nextAchievements = normalizeAchievementDefinitions(result.achievements);
        return {
          achievements: nextAchievements,
          assignments: normalizeAchievementRewardAssignments(
            result.assignments,
            new Set(nextAchievements.map((item) => item.id)),
          ),
        };
      })
      .then((value) => {
        setAchievements(value.achievements);
        setAssignments(value.assignments);
        setError("");
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Achievements could not be loaded.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!modal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      removeEventListener("keydown", close);
    };
  }, [modal]);

  const rewardMap = useMemo(() => rewardsByAchievement(assignments), [assignments]);
  const assignedCount = rewardMap.size;
  const unassignedCount = useMemo(
    () => GROUPS.reduce(
      (count, group) => count + group.items.filter(
        (reward) => !rewardAssignmentIsAchievement(assignments[group.key][reward.id]),
      ).length,
      0,
    ),
    [assignments],
  );

  const visibleAchievements = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = achievements.filter((achievement) => {
      const hasReward = rewardMap.has(achievement.id);
      return (category === "All" || achievement.category === category) &&
        (rewardFilter === "all" || (rewardFilter === "assigned" ? hasReward : !hasReward)) &&
        (!normalizedQuery ||
          `${achievement.name} ${achievement.description} ${achievement.category} ${metricLabel(achievement.metric)}`
            .toLowerCase()
            .includes(normalizedQuery));
    });
    return [...filtered].sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "category") {
        return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
      }
      if (sort === "target") return left.target - right.target || left.name.localeCompare(right.name);
      if (sort === "reward") {
        return Number(rewardMap.has(right.id)) - Number(rewardMap.has(left.id)) || left.name.localeCompare(right.name);
      }
      return (catalogueOrder.get(left.id) ?? 9999) - (catalogueOrder.get(right.id) ?? 9999);
    });
  }, [achievements, category, query, rewardFilter, rewardMap, sort]);

  const persist = async (
    nextAssignments: AchievementRewardAssignments,
    nextAchievements: AchievementDefinition[],
    message: string,
  ) => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/achievement-rewards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignments: nextAssignments, achievements: nextAchievements }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Achievements could not be saved.");
      const normalizedAchievements = normalizeAchievementDefinitions(result.achievements);
      const activeIds = new Set(normalizedAchievements.map((item) => item.id));
      setAchievements(normalizedAchievements);
      setAssignments(normalizeAchievementRewardAssignments(result.assignments, activeIds));
      setError("");
      notify(message);
      return true;
    } catch (reason) {
      const messageText = reason instanceof Error ? reason.message : "Achievements could not be saved.";
      setError(messageText);
      notify(messageText);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAchievement = async (achievement: AchievementDefinition) => {
    const next = achievements.map((item) => item.id === achievement.id ? achievement : item);
    if (await persist(assignments, next, `${achievement.name} updated.`)) setModal(null);
  };

  const deleteAchievement = async (achievement: AchievementDefinition) => {
    if (!confirm(`Delete ${achievement.name}? Player progress for this achievement will no longer be shown.`)) return;
    const nextAchievements = achievements.filter((item) => item.id !== achievement.id);
    const nextAssignments = clearAchievementReward(assignments, achievement.id);
    if (await persist(nextAssignments, nextAchievements, `${achievement.name} deleted.`)) setModal(null);
  };

  const selectReward = async (
    achievement: AchievementDefinition,
    groupKey: RewardGroupKey,
    rewardId: string,
  ) => {
    const next = clearAchievementReward(assignments, achievement.id);
    next[groupKey][rewardId] = achievement.id;
    const normalized = normalizeAchievementRewardAssignments(
      next,
      new Set(achievements.map((item) => item.id)),
    );
    if (await persist(normalized, achievements, `Reward updated for ${achievement.name}.`)) setModal(null);
  };

  const clearReward = async (achievement: AchievementDefinition) => {
    const next = clearAchievementReward(assignments, achievement.id);
    if (await persist(next, achievements, `Reward cleared for ${achievement.name}.`)) setModal(null);
  };

  const setUnassignedAvailability = async (
    groupKey: RewardGroupKey,
    rewardId: string,
    available: boolean,
  ) => {
    const next = cloneAssignments(assignments);
    next[groupKey][rewardId] = available ? null : PROFILE_REWARD_UNAVAILABLE;
    await persist(
      next,
      achievements,
      available ? "Reward made available by default." : "Reward made unavailable.",
    );
  };

  const selectedAchievement = modal && modal.type !== "unassigned"
    ? achievements.find((item) => item.id === modal.achievementId) ?? null
    : null;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <span>ACHIEVEMENTS</span>
          <h2>Achievement Management</h2>
          <p>Edit progression milestones and control the single reward attached to each achievement.</p>
        </div>
        <div className={styles.headingActions}>
          <StatusChip tone="info">{assignedCount} REWARDED</StatusChip>
          <ActionButton
            tone="secondary"
            disabled={loading || saving}
            onClick={() => setModal({ type: "unassigned" })}
          >
            Unassigned Rewards · {unassignedCount}
          </ActionButton>
        </div>
      </div>

      <Surface className={styles.toolbar}>
        <Field label="Search achievements">
          <input
            type="search"
            placeholder="Search by name or requirement"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="All">All categories</option>
            {ACHIEVEMENT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Reward">
          <select value={rewardFilter} onChange={(event) => setRewardFilter(event.target.value as RewardFilter)}>
            <option value="all">All achievements</option>
            <option value="assigned">Has reward</option>
            <option value="unassigned">No reward</option>
          </select>
        </Field>
        <Field label="Sort">
          <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
            <option value="catalogue">Catalogue order</option>
            <option value="name">Name A–Z</option>
            <option value="category">Category</option>
            <option value="target">Target · low to high</option>
            <option value="reward">Rewarded first</option>
          </select>
        </Field>
      </Surface>

      {loading ? <Surface className={styles.state} role="status">Loading achievements…</Surface> : null}
      {error ? <Surface className={styles.state} role="alert">{error}</Surface> : null}

      {!loading && (
        <Surface className={styles.catalogue}>
          <header className={styles.catalogueHeader}>
            <span>{visibleAchievements.length} shown · {achievements.length} total</span>
            <span>Reward</span>
          </header>
          <div className={styles.rows}>
            {visibleAchievements.map((achievement) => {
              const reward = rewardMap.get(achievement.id);
              return (
                <div className={styles.row} key={achievement.id}>
                  <button
                    className={styles.achievementButton}
                    type="button"
                    onClick={() => setModal({ type: "edit", achievementId: achievement.id })}
                  >
                    <span className={styles.achievementIdentity}>
                      <StatusChip tone="neutral">{achievement.category}</StatusChip>
                      <strong>{achievement.name}</strong>
                      <small>{achievement.description}</small>
                    </span>
                    <span className={styles.parameters}>
                      <span>{metricLabel(achievement.metric)}</span>
                      <strong>Target {achievement.target}</strong>
                    </span>
                  </button>
                  <button
                    className={`${styles.rewardButton} ${reward ? styles.hasReward : ""}`}
                    type="button"
                    onClick={() => setModal({ type: "reward", achievementId: achievement.id })}
                  >
                    {reward ? (
                      <>
                        <small>{reward.groupLabel}</small>
                        <strong>{reward.label}</strong>
                        <span>Change reward →</span>
                      </>
                    ) : (
                      <>
                        <small>Reward</small>
                        <strong>No reward</strong>
                        <span>Select reward →</span>
                      </>
                    )}
                  </button>
                </div>
              );
            })}
            {!visibleAchievements.length ? (
              <div className={styles.empty}>
                <strong>No matching achievements</strong>
                <p>Change the search, category, or reward filter to see more milestones.</p>
              </div>
            ) : null}
          </div>
        </Surface>
      )}

      {modal?.type === "edit" && selectedAchievement ? (
        <AchievementEditorModal
          achievement={selectedAchievement}
          saving={saving}
          onClose={() => setModal(null)}
          onSave={(value) => void saveAchievement(value)}
          onDelete={() => void deleteAchievement(selectedAchievement)}
        />
      ) : null}

      {modal?.type === "reward" && selectedAchievement ? (
        <RewardPickerModal
          achievement={selectedAchievement}
          assignments={assignments}
          achievements={achievements}
          saving={saving}
          onClose={() => setModal(null)}
          onClear={() => void clearReward(selectedAchievement)}
          onSelect={(group, rewardId) => void selectReward(selectedAchievement, group, rewardId)}
        />
      ) : null}

      {modal?.type === "unassigned" ? (
        <UnassignedRewardsModal
          assignments={assignments}
          saving={saving}
          onClose={() => setModal(null)}
          onAvailability={(group, rewardId, available) => void setUnassignedAvailability(group, rewardId, available)}
        />
      ) : null}
    </section>
  );
}

function AchievementEditorModal({
  achievement,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  achievement: AchievementDefinition;
  saving: boolean;
  onClose: () => void;
  onSave: (achievement: AchievementDefinition) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<AchievementDefinition>({ ...achievement });
  return (
    <AdminModal
      title={achievement.name}
      label="Edit achievement"
      description={`Achievement ID · ${achievement.id}`}
      onClose={onClose}
    >
      <div className={styles.editorFields}>
        <Field label="Name">
          <input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </Field>
        <Field label="Description">
          <textarea value={draft.description} maxLength={300} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Field>
        <div className={styles.fieldPair}>
          <Field label="Category">
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as AchievementDefinition["category"] })}>
              {ACHIEVEMENT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Progress metric">
            <select value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value as AchievementMetricKey })}>
              {ACHIEVEMENT_METRICS.map((metric) => <option key={metric} value={metric}>{metricLabel(metric)}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Target">
          <input
            type="number"
            min={1}
            max={1000000}
            value={draft.target}
            onChange={(event) => setDraft({ ...draft, target: Math.max(1, Number(event.target.value) || 1) })}
          />
        </Field>
      </div>
      <div className={styles.modalActions}>
        <ActionButton tone="danger" disabled={saving} onClick={onDelete}>Delete Achievement</ActionButton>
        <span />
        <button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <ActionButton disabled={saving || !draft.name.trim() || !draft.description.trim()} onClick={() => onSave(draft)}>
          {saving ? "Saving…" : "Save Changes"}
        </ActionButton>
      </div>
    </AdminModal>
  );
}

function RewardPickerModal({
  achievement,
  assignments,
  achievements,
  saving,
  onClose,
  onClear,
  onSelect,
}: {
  achievement: AchievementDefinition;
  assignments: AchievementRewardAssignments;
  achievements: AchievementDefinition[];
  saving: boolean;
  onClose: () => void;
  onClear: () => void;
  onSelect: (group: RewardGroupKey, rewardId: string) => void;
}) {
  const [groupKey, setGroupKey] = useState<RewardGroupKey>("titles");
  const group = GROUPS.find((item) => item.key === groupKey) ?? GROUPS[0];
  const current = rewardsByAchievement(assignments).get(achievement.id) ?? null;
  const achievementNames = new Map(achievements.map((item) => [item.id, item.name]));
  return (
    <AdminModal
      title={`Reward for ${achievement.name}`}
      label="Achievement reward"
      description="Choose one reward. Rewards already used by another achievement cannot be selected."
      onClose={onClose}
    >
      <div className={styles.rewardPickerHeader}>
        <Tabs label="Reward types" className={styles.rewardTabs}>
          {GROUPS.map((item) => (
            <button
              type="button"
              className={groupKey === item.key ? "active" : ""}
              aria-pressed={groupKey === item.key}
              onClick={() => setGroupKey(item.key)}
              key={item.key}
            >
              {item.label}
            </button>
          ))}
        </Tabs>
        <button type="button" disabled={!current || saving} onClick={onClear}>Clear reward</button>
      </div>
      <div className={styles.rewardChoices}>
        {group.items.map((reward) => {
          const assignment = assignments[group.key][reward.id];
          const assignedElsewhere = rewardAssignmentIsAchievement(assignment) && assignment !== achievement.id;
          const selected = assignment === achievement.id;
          const permanent = group.alwaysAvailable.has(reward.id);
          const state = selected
            ? "Selected"
            : assignedElsewhere
              ? `Used by ${achievementNames.get(assignment as string) ?? "another achievement"}`
              : permanent
                ? "Available by default"
                : assignment === PROFILE_REWARD_UNAVAILABLE
                  ? "Currently not available"
                  : "Available by default";
          return (
            <button
              type="button"
              key={reward.id}
              disabled={saving || assignedElsewhere}
              aria-pressed={selected}
              onClick={() => onSelect(group.key, reward.id)}
            >
              <span>
                <strong>{reward.label}</strong>
                <small>{state}</small>
              </span>
              {selected ? <StatusChip tone="success">CURRENT</StatusChip> : assignedElsewhere ? <StatusChip tone="warning">IN USE</StatusChip> : <span aria-hidden="true">→</span>}
            </button>
          );
        })}
      </div>
    </AdminModal>
  );
}

function UnassignedRewardsModal({
  assignments,
  saving,
  onClose,
  onAvailability,
}: {
  assignments: AchievementRewardAssignments;
  saving: boolean;
  onClose: () => void;
  onAvailability: (group: RewardGroupKey, rewardId: string, available: boolean) => void;
}) {
  const [groupKey, setGroupKey] = useState<RewardGroupKey>("titles");
  const group = GROUPS.find((item) => item.key === groupKey) ?? GROUPS[0];
  const rewards = group.items.filter(
    (reward) => !rewardAssignmentIsAchievement(assignments[group.key][reward.id]),
  );
  return (
    <AdminModal
      title="Unassigned Rewards"
      label="Default availability"
      description="Only rewards that are not tied to an achievement are shown. Set whether each can be selected by players by default."
      onClose={onClose}
    >
      <Tabs label="Unassigned reward types" className={styles.rewardTabs}>
        {GROUPS.map((item) => {
          const count = item.items.filter((reward) => !rewardAssignmentIsAchievement(assignments[item.key][reward.id])).length;
          return (
            <button
              type="button"
              className={groupKey === item.key ? "active" : ""}
              aria-pressed={groupKey === item.key}
              onClick={() => setGroupKey(item.key)}
              key={item.key}
            >
              {item.label} · {count}
            </button>
          );
        })}
      </Tabs>
      <div className={styles.availabilityRows}>
        {rewards.map((reward) => {
          const permanent = group.alwaysAvailable.has(reward.id);
          const available = assignments[group.key][reward.id] !== PROFILE_REWARD_UNAVAILABLE;
          return (
            <div className={styles.availabilityRow} key={reward.id}>
              <div>
                <strong>{reward.label}</strong>
                <small>{permanent ? "Required profile fallback" : reward.id}</small>
              </div>
              {permanent ? (
                <StatusChip tone="success">AVAILABLE BY DEFAULT</StatusChip>
              ) : (
                <div className={styles.availabilityToggle} role="group" aria-label={`Availability for ${reward.label}`}>
                  <button
                    type="button"
                    className={available ? styles.activeChoice : ""}
                    aria-pressed={available}
                    disabled={saving}
                    onClick={() => onAvailability(group.key, reward.id, true)}
                  >
                    Available by default
                  </button>
                  <button
                    type="button"
                    className={!available ? styles.activeChoice : ""}
                    aria-pressed={!available}
                    disabled={saving}
                    onClick={() => onAvailability(group.key, reward.id, false)}
                  >
                    Not available
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!rewards.length ? <div className={styles.empty}><strong>No unassigned {group.label.toLowerCase()}</strong></div> : null}
      </div>
    </AdminModal>
  );
}

function AdminModal({
  title,
  label,
  description,
  onClose,
  children,
}: {
  title: string;
  label: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Surface
        className={styles.dialog}
        elevation="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="achievement-admin-dialog-title"
      >
        <header className={styles.dialogHeading}>
          <div>
            <StatusChip tone="info">{label}</StatusChip>
            <h2 id="achievement-admin-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className={styles.dialogBody}>{children}</div>
      </Surface>
    </div>
  );
}
