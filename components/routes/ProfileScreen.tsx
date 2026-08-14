"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { achievementsFor } from "../../lib/achievements";
import { accountStatMatches } from "../../lib/match-statistics";
import {
  buildPublicBrawlerProfile,
  normalizePublicBrawlerProfile,
  type PublicRankedProfile,
} from "../../lib/public-profile";
import {
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  PROFILE_TITLES,
  profileRewardUnlocked,
  toggleShowcaseId,
} from "../../lib/profile-customization";
import { useApp } from "../application/AppProvider";
import { SystemState } from "../application/SystemState";
import { formatTimestamp } from "../application/ui";
import { PROFILE_AVATAR_PRESETS } from "../profile/ProfileAvatar";
import { BrawlerProfileView } from "../profile/BrawlerProfileView";
import { ReplayTheatre } from "../replay/ReplayTheatre";
import {
  Field,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import { AchievementsScreen } from "./AchievementsScreen";
import styles from "./ProfileScreen.module.css";

type ProfileSection = "overview" | "achievements" | "records";
type ProfileDialog = "avatar" | "title" | "faction" | "cover";

const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

const PROFILE_FACTIONS = [
  "Pyrus",
  "Aquos",
  "Darkus",
  "Haos",
  "Ventus",
  "Aurelus",
] as const;

const resultTone = (result: string) =>
  result === "Victor" ? "success" : result === "Defeat" ? "danger" : "neutral";

export function ProfileScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const {
    profile,
    setProfile,
    history,
    lifetimeStats,
    decks,
    notify,
    replay,
    setReplay,
    authUser,
  } = useApp();
  const section: ProfileSection =
    segments[0] === "achievements"
      ? "achievements"
      : segments[0] === "records"
        ? "records"
        : "overview";
  const recordId =
    section === "records" ? decodeURIComponent(segments[1] ?? "") : "";
  const [saved, setSaved] = useState("");
  const [dialog, setDialog] = useState<ProfileDialog | null>(null);
  const [recordFilter, setRecordFilter] = useState("all");
  const [rankedProfile, setRankedProfile] =
    useState<PublicRankedProfile | null>(null);
  const achievements = useMemo(
    () => achievementsFor(decks, history, lifetimeStats),
    [decks, history, lifetimeStats],
  );
  const completedGames = accountStatMatches(history);
  const gamesPlayed = Math.max(
    completedGames.length,
    lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches,
  );
  const wins = Math.max(
    completedGames.filter((item: any) => item.result === "Victor").length,
    lifetimeStats.wins,
  );
  const winRate = gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0;
  const completedAchievementIds = useMemo(
    () =>
      new Set(
        achievements
          .filter((achievement) => achievement.unlocked)
          .map((achievement) => achievement.id),
      ),
    [achievements],
  );
  const selectedTitle =
    PROFILE_TITLES.find((item) => item.id === profile.titleId) ??
    PROFILE_TITLES[0];
  const selectedCover =
    PROFILE_COVERS.find((item) => item.id === profile.coverId) ??
    PROFILE_COVERS[0];
  const unifiedProfile = useMemo(
    () =>
      buildPublicBrawlerProfile({
        userId: authUser?.id ?? "local-profile",
        joinedAt: authUser?.createdAt ?? null,
        profile,
        decks,
        achievements,
        stats: { gamesPlayed, gamesWon: wins, winRate },
        ranked: rankedProfile,
      }),
    [
      achievements,
      authUser?.createdAt,
      authUser?.id,
      decks,
      gamesPlayed,
      profile,
      rankedProfile,
      winRate,
      wins,
    ],
  );

  useEffect(() => {
    if (!recordId) return;
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
  }, [history, recordId, setReplay]);

  useEffect(() => {
    if (!authUser?.id) {
      setRankedProfile(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/profile?userId=${encodeURIComponent(authUser.id)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Profile unavailable.");
        return normalizePublicBrawlerProfile(result.profile);
      })
      .then((publicProfile) => setRankedProfile(publicProfile?.ranked ?? null))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRankedProfile(null);
      });
    return () => controller.abort();
  }, [authUser?.id]);

  useEffect(() => {
    if (!dialog) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      removeEventListener("keydown", close);
    };
  }, [dialog]);

  useEffect(() => {
    const selected = profile.showcaseAchievementIds ?? [];
    const eligible = selected
      .filter((id) => completedAchievementIds.has(id))
      .slice(0, PROFILE_SHOWCASE_LIMIT);
    if (
      selected.length === eligible.length &&
      selected.every((id, index) => id === eligible[index])
    ) {
      return;
    }
    setProfile({ ...profile, showcaseAchievementIds: eligible });
  }, [completedAchievementIds, profile, setProfile]);

  const activeRecord = recordId
    ? (history.find((item: any) => item.id === recordId) ??
      (replay?.id === recordId ? replay : null))
    : null;

  if (section === "achievements") {
    return (
      <AchievementsScreen
        achievements={achievements}
        view={segments[1]}
        showcaseIds={profile.showcaseAchievementIds}
        onToggleShowcase={(achievement) => {
          if (!achievement.unlocked) {
            notify("Complete an achievement before showcasing it.");
            return;
          }
          const result = toggleShowcaseId(
            profile.showcaseAchievementIds,
            achievement.id,
          );
          if (result.reachedLimit) {
            notify(
              `Your Profile can showcase up to ${PROFILE_SHOWCASE_LIMIT} achievements.`,
            );
            return;
          }
          setProfile({ ...profile, showcaseAchievementIds: result.ids });
          notify(
            result.ids.includes(achievement.id)
              ? `${achievement.name} added to your Profile showcase.`
              : `${achievement.name} removed from your Profile showcase.`,
          );
        }}
      />
    );
  }

  const updateCustomization = (
    patch: Partial<typeof profile>,
    message: string,
  ) => {
    setProfile({ ...profile, ...patch });
    setSaved(message);
    window.setTimeout(() => setSaved(""), 2400);
  };

  return (
    <div className={styles.route}>
      <Tabs label="Profile sections" className={styles.tabs}>
        <Link
          aria-current={section === "overview" ? "page" : undefined}
          className={section === "overview" ? "active" : ""}
          href="/profile"
        >
          Overview
        </Link>
        <Link
          aria-current={section === "records" ? "page" : undefined}
          className={section === "records" ? "active" : ""}
          href="/profile/records"
        >
          Match records
        </Link>
        <Link href="/leaderboard">Leaderboard</Link>
      </Tabs>
      <div className={styles.saveAnnouncement} role="status" aria-live="polite">
        {saved}
      </div>

      {section === "overview" ? (
        <BrawlerProfileView
          profile={unifiedProfile}
          ownerActions={{
            onEditAvatar: () => setDialog("avatar"),
            onEditTitle: () => setDialog("title"),
            onEditFaction: () => setDialog("faction"),
            onEditCover: () => setDialog("cover"),
            achievementsHref: "/profile/achievements",
            decksHref: "/decks",
          }}
        />
      ) : null}
      {section === "records" && (
        <RecordsPanel
          history={history}
          activeRecord={activeRecord}
          filter={recordFilter}
          setFilter={setRecordFilter}
          router={router}
        />
      )}

      {dialog === "avatar" && (
        <ProfileModal
          title="Choose a profile picture"
          description="Use the default account initials or choose one of the Brawler Profile Icons."
          onClose={() => setDialog(null)}
        >
          <div className={styles.avatarPresetGrid}>
            <button
              type="button"
              aria-label="Reset profile picture to default account initials"
              aria-pressed={!profile.avatar}
              onClick={() => {
                updateCustomization(
                  { avatar: "" },
                  "Profile picture reset to default",
                );
                setDialog(null);
              }}
            >
              <span
                className={`${styles.avatarPresetIcon} ${styles.avatarInitialsPreview}`}
                aria-hidden="true"
              >
                {profile.name.slice(0, 2).toUpperCase()}
              </span>
              <span>Default profile picture</span>
            </button>
            {PROFILE_AVATAR_PRESETS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={`Use ${item.name} profile icon`}
                aria-pressed={profile.avatar === `preset:${item.id}`}
                onClick={() => {
                  updateCustomization(
                    { avatar: `preset:${item.id}` },
                    "Profile picture updated",
                  );
                  setDialog(null);
                }}
              >
                <img
                  className={styles.avatarPresetIcon}
                  src={item.src}
                  alt=""
                  width="380"
                  height="380"
                  loading="lazy"
                  decoding="async"
                />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        </ProfileModal>
      )}

      {dialog === "title" && (
        <ProfileModal
          title="Choose a Profile Title"
          description="Titles are permanent quest rewards. Complete the associated achievement to unlock each one."
          onClose={() => setDialog(null)}
        >
          <div className={styles.rewardList}>
            {PROFILE_TITLES.map((title) => {
              const unlocked = profileRewardUnlocked(
                title,
                completedAchievementIds,
              );
              const requirement = title.achievementId
                ? achievements.find(
                    (achievement) => achievement.id === title.achievementId,
                  )?.name
                : "Available by default";
              return (
                <button
                  type="button"
                  key={title.id}
                  disabled={!unlocked}
                  aria-pressed={selectedTitle.id === title.id}
                  onClick={() => {
                    updateCustomization(
                      { titleId: title.id },
                      "Profile Title updated",
                    );
                    setDialog(null);
                  }}
                >
                  <span>
                    <strong>{title.label}</strong>
                    <small>{
                      unlocked ? requirement : `Locked · ${requirement}`
                    }</small>
                  </span>
                  <i aria-hidden="true">
                    {selectedTitle.id === title.id
                      ? "✓"
                      : unlocked
                        ? "○"
                        : "🔒"}
                  </i>
                </button>
              );
            })}
          </div>
        </ProfileModal>
      )}

      {dialog === "faction" && (
        <ProfileModal
          title="Choose a Brawler Faction"
          description="Choose the faction shown as your Brawler identity."
          onClose={() => setDialog(null)}
        >
          <div className={styles.rewardList}>
            {PROFILE_FACTIONS.map((faction) => (
              <button
                type="button"
                key={faction}
                aria-pressed={profile.faction === faction}
                onClick={() => {
                  updateCustomization(
                    { faction },
                    "Brawler faction updated",
                  );
                  setDialog(null);
                }}
              >
                <span>
                  <strong>{faction}</strong>
                  <small>{faction} Brawler</small>
                </span>
                <img
                  src={FACTION_SYMBOLS[faction]}
                  alt=""
                  width="36"
                  height="36"
                />
              </button>
            ))}
          </div>
        </ProfileModal>
      )}

      {dialog === "cover" && (
        <ProfileModal
          title="Choose a Cover"
          description="Choose one of the Brawler Profile Covers."
          onClose={() => setDialog(null)}
        >
          <div className={styles.coverGrid}>
            {PROFILE_COVERS.map((cover) => {
              const unlocked = profileRewardUnlocked(
                cover,
                completedAchievementIds,
              );
              const requirement = cover.achievementId
                ? achievements.find(
                    (achievement) => achievement.id === cover.achievementId,
                  )?.name
                : "Available by default";
              return (
                <button
                  type="button"
                  key={cover.id}
                  disabled={!unlocked}
                  aria-pressed={selectedCover.id === cover.id}
                  onClick={() => {
                    updateCustomization(
                      { coverId: cover.id },
                      "Profile Cover updated",
                    );
                    setDialog(null);
                  }}
                >
                  <img
                    className={styles.coverArt}
                    src={cover.src}
                    alt=""
                    width="1920"
                    height="480"
                    loading="lazy"
                    decoding="async"
                  />
                  <span className={styles.coverCopy}>
                    <strong>{cover.label}</strong>
                    <small>{
                      unlocked ? requirement : `Locked · ${requirement}`
                    }</small>
                  </span>
                </button>
              );
            })}
          </div>
        </ProfileModal>
      )}
    </div>
  );
}

function ProfileModal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
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
        className={styles.editDialog}
        elevation="overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-dialog-title"
      >
        <header className={styles.dialogHeading}>
          <div>
            <StatusChip tone="info">Profile customization</StatusChip>
            <h2 id="profile-dialog-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </Surface>
    </div>
  );
}

function RecordsPanel({
  history,
  activeRecord,
  filter,
  setFilter,
  router,
}: any) {
  if (activeRecord) {
    return (
      <ReplayTheatre
        record={activeRecord}
        onBack={() => router.push("/profile/records")}
      />
    );
  }
  const visible = history.filter(
    (item: any) =>
      filter === "all" ||
      item.result.toLowerCase() === filter ||
      item.mode === filter ||
      item.format === filter,
  );
  return (
    <section className={styles.section}>
      <header className={styles.sectionToolbar}>
        <div>
          <span>Match archive</span>
          <h2>Recorded matches</h2>
        </div>
        <Field label="Filter">
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">All records</option>
            <option value="victor">Victories</option>
            <option value="defeat">Defeats</option>
            <option value="training">Training</option>
            <option value="casual">Casual</option>
            <option value="ranked">Ranked</option>
            <option value="bo1">Best of one</option>
            <option value="bo3">Best of three</option>
          </select>
        </Field>
      </header>
      {visible.length ? (
        <Surface className={styles.recordTable}>
          {visible.map((item: any) => (
            <button
              key={item.id}
              onClick={() =>
                router.push(`/profile/records/${encodeURIComponent(item.id)}`)
              }
            >
              <StatusChip tone={resultTone(item.result)}>
                {item.result}
              </StatusChip>
              <strong>{item.opponent}</strong>
              <span>{item.score}</span>
              <span>{item.mode ?? "legacy"}</span>
              <small>{formatTimestamp(item.at)}</small>
              <i>Open →</i>
            </button>
          ))}
        </Surface>
      ) : (
        <SystemState
          compact
          tone="empty"
          title="No matching records"
          message="Complete a training or online match, or clear the current filter."
          actions={<Link href="/play">Play a match</Link>}
        />
      )}
    </section>
  );
}
