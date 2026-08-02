"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { copyText, formatTimestamp } from "../application/ui";
import {
  PROFILE_AVATAR_PRESETS,
  ProfileAvatar,
} from "../profile/ProfileAvatar";
import {
  ActionButton,
  Field,
  StatusChip,
  Surface,
  Tabs,
} from "../design-system/primitives";
import { AchievementsScreen } from "./AchievementsScreen";
import styles from "./ProfileScreen.module.css";

type ProfileSection = "overview" | "achievements" | "records";
type ProfileDialog = "avatar" | "crop" | "title" | "cover";

const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

const resultTone = (result: string) =>
  result === "Victor" ? "success" : result === "Defeat" ? "danger" : "neutral";

export function ProfileScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const {
    profile,
    setProfile,
    history,
    decks,
    notify,
    replay,
    setReplay,
    replayIndex,
    setReplayIndex,
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
  const [cropSource, setCropSource] = useState("");
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const [cropZoom, setCropZoom] = useState(1);
  const [uploadError, setUploadError] = useState("");
  const [recordFilter, setRecordFilter] = useState("all");
  const uploadRef = useRef<HTMLInputElement>(null);
  const achievements = useMemo(
    () => achievementsFor(decks, history),
    [decks, history],
  );
  const completedGames = accountStatMatches(history);
  const gamesPlayed = completedGames.length;
  const wins = completedGames.filter(
    (item: any) => item.result === "Victor",
  ).length;
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
  const coverCharacter = BAKUGAN.find(
    (item) => item.faction === (selectedCover.faction ?? profile.faction),
  );
  const coverSource = coverCharacter
    ? cardArtSource(coverCharacter.character, "full")
    : "";

  useEffect(() => {
    if (!recordId) return;
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
  }, [history, recordId, setReplay, setReplayIndex]);

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
    ? (history.find((item: any) => item.id === recordId) ?? replay)
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

  const receiveUpload = (file?: File) => {
    setUploadError("");
    if (!file) return;
    if (!/^image\/(?:png|jpe?g|webp)$/i.test(file.type)) {
      setUploadError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError("Choose an image smaller than 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setUploadError("The image could not be read.");
        return;
      }
      setCropSource(reader.result);
      setCropX(50);
      setCropY(50);
      setCropZoom(1);
      setDialog("crop");
    };
    reader.onerror = () => setUploadError("The image could not be read.");
    reader.readAsDataURL(file);
  };

  const applyCrop = async () => {
    try {
      const image = new Image();
      image.src = cropSource;
      await image.decode();
      const size = 512;
      const scale =
        Math.max(size / image.naturalWidth, size / image.naturalHeight) *
        cropZoom;
      const sourceWidth = size / scale;
      const sourceHeight = size / scale;
      const sourceX =
        Math.max(0, image.naturalWidth - sourceWidth) * (cropX / 100);
      const sourceY =
        Math.max(0, image.naturalHeight - sourceHeight) * (cropY / 100);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image cropping is unavailable.");
      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        size,
        size,
      );
      updateCustomization(
        { avatar: canvas.toDataURL("image/jpeg", 0.86) },
        "Profile picture updated",
      );
      setCropSource("");
      setDialog(null);
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? error.message
          : "The image could not be cropped.",
      );
    }
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
      </Tabs>
      <div className={styles.saveAnnouncement} role="status" aria-live="polite">
        {saved}
      </div>

      {section === "overview" && (
        <main className={styles.profileOverview}>
          <section
            className={`${styles.identityCard} ${styles[`faction_${profile.faction.toLowerCase()}`]}`}
            style={
              coverSource
                ? {
                    backgroundImage: `linear-gradient(90deg, rgba(0, 8, 13, .94) 0%, rgba(0, 8, 13, .7) 54%, rgba(0, 8, 13, .22) 100%), url("${coverSource}")`,
                  }
                : undefined
            }
          >
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
          replayIndex={replayIndex}
          setReplayIndex={setReplayIndex}
          filter={recordFilter}
          setFilter={setRecordFilter}
          router={router}
        />
      )}

      {dialog === "avatar" && (
        <ProfileModal
          title="Edit profile picture"
          description="Choose a Bakugan preset, upload and crop your own image, or restore the automated initials."
          onClose={() => setDialog(null)}
        >
          <div className={styles.avatarPresetGrid}>
            {PROFILE_AVATAR_PRESETS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={profile.avatar === `preset:${item.id}`}
                onClick={() => {
                  updateCustomization(
                    { avatar: `preset:${item.id}` },
                    "Profile picture updated",
                  );
                  setDialog(null);
                }}
              >
                <img src={cardArtSource(item.character, "full")} alt="" />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <input
            ref={uploadRef}
            className={styles.hiddenUpload}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => receiveUpload(event.target.files?.[0])}
          />
          {uploadError && (
            <p className={styles.dialogError} role="alert">
              {uploadError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <ActionButton
              tone="secondary"
              onClick={() => uploadRef.current?.click()}
            >
              Upload your own
            </ActionButton>
            <ActionButton
              tone="quiet"
              onClick={() => {
                updateCustomization(
                  { avatar: "" },
                  "Profile picture reset to initials",
                );
                setDialog(null);
              }}
            >
              Reset to initials
            </ActionButton>
          </div>
        </ProfileModal>
      )}

      {dialog === "crop" && (
        <ProfileModal
          title="Crop profile picture"
          description="Move the crop focus and zoom until the square preview is ready."
          onClose={() => setDialog(null)}
        >
          <div className={styles.cropPreview}>
            <img
              src={cropSource}
              alt="Profile picture crop preview"
              style={{
                objectPosition: `${cropX}% ${cropY}%`,
                transform: `scale(${cropZoom})`,
              }}
            />
          </div>
          <div className={styles.cropControls}>
            <Field label="Horizontal focus">
              <input
                type="range"
                min="0"
                max="100"
                value={cropX}
                onChange={(event) => setCropX(Number(event.target.value))}
              />
            </Field>
            <Field label="Vertical focus">
              <input
                type="range"
                min="0"
                max="100"
                value={cropY}
                onChange={(event) => setCropY(Number(event.target.value))}
              />
            </Field>
            <Field label="Zoom">
              <input
                type="range"
                min="1"
                max="3"
                step=".05"
                value={cropZoom}
                onChange={(event) => setCropZoom(Number(event.target.value))}
              />
            </Field>
          </div>
          {uploadError && (
            <p className={styles.dialogError} role="alert">
              {uploadError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <ActionButton tone="secondary" onClick={() => setDialog("avatar")}>
              Back
            </ActionButton>
            <ActionButton onClick={() => void applyCrop()}>
              Use cropped picture
            </ActionButton>
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

      {dialog === "cover" && (
        <ProfileModal
          title="Choose a Cover"
          description="Cover images are earned through achievements and use artwork already available in the game."
          onClose={() => setDialog(null)}
        >
          <div className={styles.coverGrid}>
            {PROFILE_COVERS.map((cover) => {
              const unlocked = profileRewardUnlocked(
                cover,
                completedAchievementIds,
              );
              const character = BAKUGAN.find(
                (item) => item.faction === (cover.faction ?? profile.faction),
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
                  {character && (
                    <img
                      src={cardArtSource(character.character, "full")}
                      alt=""
                    />
                  )}
                  <span>
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
  replayIndex,
  setReplayIndex,
  filter,
  setFilter,
  router,
}: any) {
  if (activeRecord) {
    const event = activeRecord.log[replayIndex];
    return (
      <section className={styles.recordDetail}>
        <header>
          <ActionButton
            tone="quiet"
            onClick={() => router.push("/profile/records")}
          >
            ← Match records
          </ActionButton>
          <div>
            <span>Record {activeRecord.id}</span>
            <h2>
              {activeRecord.result} vs {activeRecord.opponent}
            </h2>
            <p>
              {formatTimestamp(activeRecord.at)} ·{" "}
              {(activeRecord.format ?? "unknown").toUpperCase()} ·{" "}
              {activeRecord.mode ?? "legacy"}
            </p>
          </div>
          <ActionButton
            tone="secondary"
            onClick={() => void copyText(window.location.href)}
          >
            Copy link
          </ActionButton>
        </header>
        <div className={styles.recordLayout}>
          <Surface
            as="aside"
            className={styles.eventList}
            aria-label="Match events"
          >
            {activeRecord.log.map((item: any, index: number) => (
              <button
                className={index === replayIndex ? styles.active : ""}
                key={item.id}
                onClick={() => setReplayIndex(index)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>{item.kind}</strong>
                  <p>{item.message}</p>
                </div>
              </button>
            ))}
          </Surface>
          <Surface className={styles.eventFocus}>
            <StatusChip tone={event?.kind === "random" ? "warning" : "info"}>
              {event?.kind?.toUpperCase() ?? "EVENT"}
            </StatusChip>
            <h2>{event?.message ?? "No event selected"}</h2>
            <p>{event ? new Date(event.at ?? 0).toLocaleTimeString() : ""}</p>
            <div>
              <button
                onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}
              >
                ← Previous
              </button>
              <span>
                {replayIndex + 1} / {activeRecord.log.length}
              </span>
              <button
                onClick={() =>
                  setReplayIndex(
                    Math.min(activeRecord.log.length - 1, replayIndex + 1),
                  )
                }
              >
                Next →
              </button>
            </div>
          </Surface>
          <Surface as="aside" className={styles.recordMetadata}>
            <h2>Match details</h2>
            <dl>
              <div>
                <dt>Result</dt>
                <dd>{activeRecord.result}</dd>
              </div>
              <div>
                <dt>Score</dt>
                <dd>{activeRecord.score}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{activeRecord.reason}</dd>
              </div>
              <div>
                <dt>Events</dt>
                <dd>{activeRecord.log.length}</dd>
              </div>
            </dl>
          </Surface>
        </div>
      </section>
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
            <option value="online">Online</option>
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
