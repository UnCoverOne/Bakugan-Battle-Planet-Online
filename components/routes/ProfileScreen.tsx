"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { achievementsFor, type Achievement } from "../../lib/achievements";
import { accountStatMatches } from "../../lib/match-statistics";
import { BAKUGAN, validateDeck, type DeckRecord } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
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
import {
  PROFILE_AVATAR_PRESETS,
  ProfileAvatar,
} from "../profile/ProfileAvatar";
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
  const achievements = useMemo(
    () => achievementsFor(decks, history, lifetimeStats),
    [decks, history, lifetimeStats],
  );
  const completedGames = accountStatMatches(history);
  const gamesPlayed = Math.max(completedGames.length, lifetimeStats.matchesPlayed - lifetimeStats.trainingMatches);
  const wins = Math.max(completedGames.filter(
    (item: any) => item.result === "Victor",
  ).length, lifetimeStats.wins);
  const winRate = gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0;
  const publicDecks = decks.filter(
    (deck: DeckRecord) => deck.visibility === "Public",
  );
  const completedAchievementIds = useMemo(
    () =>
      new Set(
        achievements
          .filter((achievement) => achievement.unlocked)
          .map((achievement) => achievement.id),
      ),
    [achievements],
  );
  const showcasedAchievements = (profile.showcaseAchievementIds ?? [])
    .map((id) => achievements.find((achievement) => achievement.id === id))
    .filter(
      (achievement): achievement is Achievement =>
        Boolean(achievement?.unlocked),
    )
    .slice(0, PROFILE_SHOWCASE_LIMIT);
  const showcasedDecks = (profile.showcaseDeckIds ?? [])
    .map((id) => publicDecks.find((deck) => deck.id === id))
    .filter((deck): deck is DeckRecord => Boolean(deck))
    .slice(0, PROFILE_SHOWCASE_LIMIT);
  const selectedTitle =
    PROFILE_TITLES.find((item) => item.id === profile.titleId) ??
    PROFILE_TITLES[0];
  const selectedCover =
    PROFILE_COVERS.find((item) => item.id === profile.coverId) ??
    PROFILE_COVERS[0];
  useEffect(() => {
    if (!recordId) return;
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
  }, [history, recordId, setReplay]);

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
    ? (history.find((item: any) => item.id === recordId) ?? (replay?.id === recordId ? replay : null))
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

      {section === "overview" && (
        <main className={styles.profileOverview}>
          <section
            className={`${styles.identityCard} ${styles[`faction_${profile.faction.toLowerCase()}`]}`}
          >
            <img
              className={styles.identityCoverArt}
              src={selectedCover.src}
              alt=""
              width="1920"
              height="480"
              decoding="async"
              fetchPriority="high"
            />
            <button
              className={`${styles.editButton} ${styles.coverEdit}`}
              type="button"
              aria-label="Edit cover"
              title="Edit cover"
              onClick={() => setDialog("cover")}
            >
              <PencilIcon />
            </button>
            <div className={styles.identityContent}>
              <div className={styles.portraitWrap}>
                <ProfileAvatar
                  profile={profile}
                  className={styles.profilePortrait}
                />
                <button
                  type="button"
                  className={`${styles.editButton} ${styles.portraitEdit}`}
                  aria-label="Edit picture"
                  title="Edit picture"
                  onClick={() => setDialog("avatar")}
                >
                  <PencilIcon />
                </button>
              </div>
              <div className={styles.identityCopy}>
                <span className={styles.eyebrow}>Brawler profile</span>
                <h1>{profile.name}</h1>
                <div className={styles.titleLine}>
                  <strong>{selectedTitle.label}</strong>
                  <button
                    className={`${styles.editButton} ${styles.titleEdit}`}
                    type="button"
                    aria-label="Edit title"
                    title="Edit title"
                    onClick={() => setDialog("title")}
                  >
                    <PencilIcon />
                  </button>
                </div>
                <div className={styles.factionIdentity}>
                  <img
                    src={FACTION_SYMBOLS[profile.faction]}
                    alt=""
                    width="32"
                    height="32"
                  />
                  <span>{profile.faction} Brawler</span>
                  <button
                    className={`${styles.editButton} ${styles.titleEdit}`}
                    type="button"
                    aria-label="Edit Brawler faction"
                    title="Edit Brawler faction"
                    onClick={() => setDialog("faction")}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.stats} aria-label="Match statistics">
            <Metric label="Win Rate" value={`${winRate}%`} />
            <Metric label="Games Won" value={wins} />
            <Metric label="Games Played" value={gamesPlayed} />
          </section>

          <ShowcaseSection
            eyebrow={`${showcasedAchievements.length}/${PROFILE_SHOWCASE_LIMIT} selected`}
            title="Showcased Achievements"
            action={<Link href="/profile/achievements">Choose achievements</Link>}
          >
            {showcasedAchievements.length ? (
              <div className={styles.achievementShowcaseGrid}>
                {showcasedAchievements.map((achievement) => (
                  <article
                    className={styles.showcaseAchievement}
                    key={achievement.id}
                  >
                    <span aria-hidden="true">★</span>
                    <div>
                      <strong>{achievement.name}</strong>
                      <small>{achievement.category}</small>
                      <p>{achievement.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <SystemState
                compact
                tone="empty"
                title="No achievements showcased"
                message="Choose up to three completed achievements from the Achievements screen."
                actions={<Link href="/profile/achievements">Choose achievements</Link>}
              />
            )}
          </ShowcaseSection>

          <ShowcaseSection
            eyebrow={`${showcasedDecks.length}/${PROFILE_SHOWCASE_LIMIT} selected`}
            title="Public Decks"
            action={<Link href="/decks">Choose decks</Link>}
          >
            {showcasedDecks.length ? (
              <div className={styles.deckShowcaseGrid}>
                {showcasedDecks.map((deck) => (
                  <Link
                    className={styles.showcaseDeck}
                    href={`/decks/public/${encodeURIComponent(deck.id)}`}
                    key={deck.id}
                  >
                    <CharacterStack deck={deck} />
                    <div>
                      <strong>{deck.name}</strong>
                      <span>
                        {deck.factions.join(" • ") || "Team incomplete"}
                      </span>
                      <small>{deckSetName(deck)}</small>
                    </div>
                    <StatusChip
                      tone={validateDeck(deck).isLegal ? "success" : "danger"}
                    >
                      {validateDeck(deck).isLegal ? "Legal" : "Invalid"}
                    </StatusChip>
                  </Link>
                ))}
              </div>
            ) : (
              <SystemState
                compact
                tone="empty"
                title="No Public decks showcased"
                message="Publish a deck, then choose it from My Decks. Draft and Private decks are not eligible."
                actions={<Link href="/decks">Open My Decks</Link>}
              />
            )}
          </ShowcaseSection>
        </main>
      )}
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
                    <small>{unlocked ? requirement : `Locked · ${requirement}`}</small>
                  </span>
                  <i aria-hidden="true">
                    {selectedTitle.id === title.id ? "✓" : unlocked ? "○" : "🔒"}
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
                    <small>{unlocked ? requirement : `Locked · ${requirement}`}</small>
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

function ShowcaseSection({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface as="section" className={styles.showcaseSection}>
      <header className={styles.panelHeading}>
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </Surface>
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

function PencilIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Z" />
      <path d="m14.06 4.19 2.37-2.37a1 1 0 0 1 1.42 0l4.33 4.33a1 1 0 0 1 0 1.42l-2.37 2.37-5.75-5.75Z" />
    </svg>
  );
}

function CharacterStack({ deck }: { deck: DeckRecord }) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((item) => item.id === id))
    .filter(Boolean);
  return (
    <div
      className={styles.characterStack}
      aria-label={`${characters.length} Character Cards`}
    >
      {characters.map((character) => (
        <img
          key={character!.id}
          src={cardArtSource(character!.character, "thumbnail")}
          alt=""
          width="48"
          height="67"
          loading="lazy"
        />
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
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
    return <ReplayTheatre record={activeRecord} onBack={() => router.push("/profile/records")} />;
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
