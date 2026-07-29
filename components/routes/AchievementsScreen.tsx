"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ACHIEVEMENT_CATEGORIES,
  sortAchievements,
  type Achievement,
  type AchievementStatus,
} from "../../lib/achievements";
import { StatusChip, Surface } from "../design-system/primitives";
import styles from "./AchievementsScreen.module.css";

const STATUS_CONTENT: Record<
  AchievementStatus,
  { title: string; description: string; route: string }
> = {
  completed: {
    title: "Completed",
    description: "Milestones you have earned, newest first.",
    route: "completed",
  },
  "in-progress": {
    title: "In Progress",
    description: "Active milestones, closest to completion first.",
    route: "in-progress",
  },
  locked: {
    title: "Locked",
    description: "Milestones you have not begun, sorted alphabetically.",
    route: "locked",
  },
};

const STATUS_ORDER: AchievementStatus[] = [
  "completed",
  "in-progress",
  "locked",
];

const routeStatus = (view?: string): AchievementStatus | null =>
  STATUS_ORDER.find((status) => STATUS_CONTENT[status].route === view) ?? null;

const categoryGlyph: Record<string, string> = {
  "Getting Started": "★",
  "Deck Building": "▤",
  Battle: "⚔",
  Compendium: "◇",
  "Online Play": "◎",
};

function formatCompletion(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Completed";
  return `Completed ${new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))}`;
}

function AchievementCard({
  achievement,
  showcased,
  onToggleShowcase,
}: {
  achievement: Achievement;
  showcased: boolean;
  onToggleShowcase: (achievement: Achievement) => void;
}) {
  const percentage = Math.round(
    (achievement.current / achievement.target) * 100,
  );
  return (
    <Surface
      as="article"
      className={`${styles.card} ${styles[achievement.status.replace("-", "")]}`}
    >
      <div className={styles.cardTop}>
        <span className={styles.glyph} aria-hidden="true">
          {achievement.status === "completed"
            ? "✓"
            : categoryGlyph[achievement.category]}
        </span>
        <StatusChip
          tone={achievement.status === "completed" ? "success" : "neutral"}
        >
          {achievement.category}
        </StatusChip>
        <button
          className={styles.showcaseToggle}
          type="button"
          aria-pressed={showcased}
          disabled={!achievement.unlocked}
          title={
            achievement.unlocked
              ? showcased
                ? "Remove from Profile showcase"
                : "Showcase on Profile"
              : "Complete this achievement before showcasing it"
          }
          onClick={() => onToggleShowcase(achievement)}
        >
          <span aria-hidden="true">{showcased ? "★" : "☆"}</span>
          {showcased ? "Showcased" : "Showcase"}
        </button>
      </div>
      <div className={styles.cardCopy}>
        <h3>{achievement.name}</h3>
        <p>{achievement.description}</p>
      </div>
      <div className={styles.progressRow}>
        <div>
          <span>
            {achievement.current} / {achievement.target}
          </span>
          <strong>
            {achievement.status === "completed"
              ? formatCompletion(achievement.completedAt)
              : `${percentage}%`}
          </strong>
        </div>
        <progress
          aria-label={`${achievement.name}: ${achievement.current} of ${achievement.target}`}
          max={achievement.target}
          value={achievement.current}
        />
      </div>
    </Surface>
  );
}

function EmptyAchievements({ status }: { status: AchievementStatus }) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true">◇</span>
      <strong>No matching {STATUS_CONTENT[status].title.toLowerCase()} achievements</strong>
      <p>Change the search text or category filter to see more milestones.</p>
    </div>
  );
}

export function AchievementsScreen({
  achievements,
  view,
  showcaseIds = [],
  onToggleShowcase,
}: {
  achievements: Achievement[];
  view?: string;
  showcaseIds?: string[];
  onToggleShowcase: (achievement: Achievement) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeStatus = routeStatus(view);
  const query = searchParams.get("q") ?? "";
  const requestedCategory = searchParams.get("category") ?? "All";
  const category = ACHIEVEMENT_CATEGORIES.includes(
    requestedCategory as (typeof ACHIEVEMENT_CATEGORIES)[number],
  )
    ? requestedCategory
    : "All";

  const updateParam = (key: "q" | "category", value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === "All") next.delete(key);
    else next.set(key, value);
    const suffix = next.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
      scroll: false,
    });
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visible = achievements.filter(
    (achievement) =>
      (category === "All" || achievement.category === category) &&
      (!normalizedQuery ||
        `${achievement.name} ${achievement.description} ${achievement.category}`
          .toLowerCase()
          .includes(normalizedQuery)),
  );
  const counts = Object.fromEntries(
    STATUS_ORDER.map((status) => [
      status,
      achievements.filter((achievement) => achievement.status === status)
        .length,
    ]),
  ) as Record<AchievementStatus, number>;
  const queryString = new URLSearchParams();
  if (query) queryString.set("q", query);
  if (category !== "All") queryString.set("category", category);
  const preservedFilters = queryString.toString();

  return (
    <div className={styles.route}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <div>
            <Link className={styles.backLink} href={activeStatus ? "/profile/achievements" : "/profile"}>
              ← {activeStatus ? "Achievement overview" : "Brawler profile"}
            </Link>
            <span className={styles.eyebrow}>Brawler progression</span>
            <h1>
              {activeStatus
                ? `${STATUS_CONTENT[activeStatus].title} Achievements`
                : "Achievements"}
            </h1>
            <p>
              {activeStatus
                ? STATUS_CONTENT[activeStatus].description
                : "Track every earned milestone and see what you are closest to completing next."}
            </p>
          </div>
          <span className={styles.total}>
            <strong>{achievements.length}</strong>
            <small>Total milestones</small>
          </span>
        </div>

        <div className={styles.summary} aria-label="Achievement totals">
          {STATUS_ORDER.map((status) => (
            <div className={styles[status.replace("-", "")]} key={status}>
              <span>{STATUS_CONTENT[status].title}</span>
              <strong>{counts[status]}</strong>
            </div>
          ))}
        </div>

        <div className={styles.controls}>
          <label>
            <span>Search achievements</span>
            <div className={styles.searchControl}>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="Search by name or requirement"
                value={query}
                onChange={(event) => updateParam("q", event.target.value)}
              />
            </div>
          </label>
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => updateParam("category", event.target.value)}
            >
              <option value="All">All categories</option>
              {ACHIEVEMENT_CATEGORIES.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {activeStatus ? (
        <section className={styles.allSection}>
          <div className={styles.sectionHeading}>
            <div>
              <span>{visible.filter((item) => item.status === activeStatus).length} shown</span>
              <h2>{STATUS_CONTENT[activeStatus].title}</h2>
            </div>
            {(query || category !== "All") && (
              <Link href={pathname}>Clear filters</Link>
            )}
          </div>
          {sortAchievements(visible, activeStatus).length ? (
            <div className={styles.allGrid}>
              {sortAchievements(visible, activeStatus).map((achievement) => (
                <AchievementCard
                  achievement={achievement}
                  showcased={showcaseIds.includes(achievement.id)}
                  onToggleShowcase={onToggleShowcase}
                  key={achievement.id}
                />
              ))}
            </div>
          ) : (
            <EmptyAchievements status={activeStatus} />
          )}
        </section>
      ) : (
        STATUS_ORDER.map((status) => {
          const sorted = sortAchievements(visible, status);
          const destination = `/profile/achievements/${STATUS_CONTENT[status].route}${
            preservedFilters ? `?${preservedFilters}` : ""
          }`;
          return (
            <section className={styles.previewSection} key={status}>
              <div className={styles.sectionHeading}>
                <div>
                  <span>{counts[status]} total</span>
                  <h2>{STATUS_CONTENT[status].title}</h2>
                  <p>{STATUS_CONTENT[status].description}</p>
                </div>
                <Link className={styles.viewAll} href={destination}>
                  View All <span aria-hidden="true">→</span>
                </Link>
              </div>
              {sorted.length ? (
                <div className={styles.previewGrid}>
                  {sorted.slice(0, 3).map((achievement) => (
                    <AchievementCard
                      achievement={achievement}
                      showcased={showcaseIds.includes(achievement.id)}
                      onToggleShowcase={onToggleShowcase}
                      key={achievement.id}
                    />
                  ))}
                </div>
              ) : (
                <EmptyAchievements status={status} />
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
