"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import Link from "next/link";
import type { ReactNode } from "react";
import { ACHIEVEMENT_CATEGORY_DETAILS } from "../../lib/achievements";
import { BAKUGAN } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import {
  PROFILE_COVERS,
  PROFILE_SHOWCASE_LIMIT,
  PROFILE_TITLES,
} from "../../lib/profile-customization";
import type {
  PublicBrawlerProfile,
  PublicProfileDeck,
} from "../../lib/public-profile";
import { SystemState } from "../application/SystemState";
import { StatusChip, Surface } from "../design-system/primitives";
import { ProfileAvatar } from "./ProfileAvatar";
import styles from "../routes/ProfileScreen.module.css";
import mobileStyles from "./BrawlerProfileMobile.module.css";

const FACTION_SYMBOLS: Record<string, string> = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

export type BrawlerProfileOwnerActions = {
  onEditAvatar: () => void;
  onEditTitle: () => void;
  onEditFaction: () => void;
  onEditCover: () => void;
  achievementsHref: string;
  decksHref: string;
};

export function BrawlerProfileView({
  profile,
  ownerActions,
}: {
  profile: PublicBrawlerProfile;
  ownerActions?: BrawlerProfileOwnerActions;
}) {
  const selectedTitle =
    PROFILE_TITLES.find((item) => item.id === profile.titleId) ??
    PROFILE_TITLES[0];
  const selectedCover =
    PROFILE_COVERS.find((item) => item.id === profile.coverId) ??
    PROFILE_COVERS[0];

  return (
    <main className={styles.profileOverview}>
      <section
        className={`${styles.identityCard} ${styles[`faction_${profile.faction.toLowerCase()}`]} ${mobileStyles.card}`}
      >
        <OriginalImage
          className={`${styles.identityCoverArt} ${mobileStyles.coverArt}`}
          src={selectedCover.src}
          alt=""
          width="1920"
          height="480"
          decoding="async"
          fetchPriority="high"
        />
        {ownerActions ? (
          <button
            className={`${styles.editButton} ${styles.coverEdit}`}
            type="button"
            aria-label="Edit cover"
            title="Edit cover"
            onClick={ownerActions.onEditCover}
          >
            <PencilIcon />
          </button>
        ) : null}
        <div className={`${styles.identityContent} ${mobileStyles.content}`}>
          <div className={`${styles.portraitWrap} ${mobileStyles.portrait}`}>
            <ProfileAvatar
              profile={{ name: profile.displayName, avatar: profile.avatar }}
              className={styles.profilePortrait}
            />
            {ownerActions ? (
              <button
                type="button"
                className={`${styles.editButton} ${styles.portraitEdit}`}
                style={{ right: "-0.2rem", bottom: "-0.2rem" }}
                aria-label="Edit picture"
                title="Edit picture"
                onClick={ownerActions.onEditAvatar}
              >
                <PencilIcon />
              </button>
            ) : null}
          </div>
          <div className={`${styles.identityCopy} ${mobileStyles.copy}`}>
            <h1>{profile.displayName}</h1>
            <div className={styles.titleLine}>
              <strong>{selectedTitle.label}</strong>
              {ownerActions ? (
                <button
                  className={`${styles.editButton} ${styles.titleEdit}`}
                  type="button"
                  aria-label="Edit title"
                  title="Edit title"
                  onClick={ownerActions.onEditTitle}
                >
                  <PencilIcon />
                </button>
              ) : null}
            </div>
            <div className={styles.factionIdentity}>
              <OriginalImage
                src={FACTION_SYMBOLS[profile.faction]}
                alt=""
                width="32"
                height="32"
              />
              <span>{profile.faction} Brawler</span>
              {ownerActions ? (
                <button
                  className={`${styles.editButton} ${styles.titleEdit}`}
                  type="button"
                  aria-label="Edit Brawler faction"
                  title="Edit Brawler faction"
                  onClick={ownerActions.onEditFaction}
                >
                  <PencilIcon />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.stats} aria-label="Public match statistics">
        <Metric label="Win Rate" value={`${profile.stats.winRate}%`} />
        <Metric label="Games Won" value={profile.stats.gamesWon} />
        <Metric label="Games Played" value={profile.stats.gamesPlayed} />
      </section>

      <Surface as="section" className={styles.showcaseSection}>
        <header className={styles.panelHeading}>
          <div>
            <span>Ranked Conquest</span>
            <h2>Ranked Profile</h2>
          </div>
        </header>
        {profile.ranked ? (
          <div className={styles.metrics} aria-label="Ranked statistics">
            <Metric label="Rank" value={profile.ranked.rank} />
            <Metric label="Brawler Points" value={`${profile.ranked.bp} BP`} />
            <Metric
              label="Ranked Record"
              value={`${profile.ranked.wins}–${profile.ranked.losses}`}
            />
            <Metric label="Ranked Win Rate" value={`${profile.ranked.winRate}%`} />
          </div>
        ) : (
          <SystemState
            compact
            tone="empty"
            title="No Ranked record yet"
            message="Complete a Ranked Conquest series to establish a public Ranked record."
            actions={<Link href="/play">Play Ranked</Link>}
          />
        )}
        {profile.joinedAt ? (
          <p className={styles.dataNote}>
            Joined {new Date(profile.joinedAt).toLocaleDateString()}
          </p>
        ) : null}
      </Surface>

      <ShowcaseSection
        eyebrow={
          ownerActions
            ? `${profile.showcaseAchievements.length}/${PROFILE_SHOWCASE_LIMIT} selected`
            : `${profile.showcaseAchievements.length} showcased`
        }
        title="Showcased Achievements"
        action={
          ownerActions ? (
            <Link href={ownerActions.achievementsHref}>Choose achievements</Link>
          ) : null
        }
      >
        {profile.showcaseAchievements.length ? (
          <div className={styles.achievementShowcaseGrid}>
            {profile.showcaseAchievements.map((achievement) => {
              const category = ACHIEVEMENT_CATEGORY_DETAILS[achievement.category];
              return (
                <article
                  className={styles.showcaseAchievement}
                  key={achievement.id}
                  style={{ borderColor: `${category.color}66`, boxShadow: `inset 0 3px 0 ${category.color}` }}
                >
                  <span
                    aria-hidden="true"
                    style={{ borderColor: category.color, color: category.color }}
                  >
                    {category.glyph}
                  </span>
                  <div>
                    <strong>{achievement.name}</strong>
                    <small style={{ color: category.color }}>
                      <span aria-hidden="true">{category.glyph}</span>{" "}{achievement.category}
                    </small>
                    <p>{achievement.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <SystemState
            compact
            tone="empty"
            title="No achievements showcased"
            message={
              ownerActions
                ? "Choose up to three completed achievements from the Achievements screen."
                : "This Brawler has not showcased any completed achievements."
            }
            actions={
              ownerActions ? (
                <Link href={ownerActions.achievementsHref}>Choose achievements</Link>
              ) : undefined
            }
          />
        )}
      </ShowcaseSection>

      <ShowcaseSection
        eyebrow={
          ownerActions
            ? `${profile.showcaseDecks.length}/${PROFILE_SHOWCASE_LIMIT} selected`
            : `${profile.showcaseDecks.length} showcased`
        }
        title="Public Decks"
        action={
          ownerActions ? <Link href={ownerActions.decksHref}>Choose decks</Link> : null
        }
      >
        {profile.showcaseDecks.length ? (
          <div className={styles.deckShowcaseGrid}>
            {profile.showcaseDecks.map((deck) => (
              <Link
                className={styles.showcaseDeck}
                href={`/decks/public/${encodeURIComponent(deck.id)}`}
                key={deck.id}
              >
                <CharacterStack deck={deck} />
                <div>
                  <strong>{deck.name}</strong>
                  <span>{deck.factions.join(" • ") || "Team incomplete"}</span>
                  <small>{deck.setName}</small>
                </div>
                <StatusChip tone={deck.isLegal ? "success" : "danger"}>
                  {deck.isLegal ? "Legal" : "Invalid"}
                </StatusChip>
              </Link>
            ))}
          </div>
        ) : (
          <SystemState
            compact
            tone="empty"
            title="No Public decks showcased"
            message={
              ownerActions
                ? "Publish a deck, then choose it from My Decks. Draft and Private decks are not eligible."
                : "This Brawler has not showcased any Public decks."
            }
            actions={
              ownerActions ? (
                <Link href={ownerActions.decksHref}>Open My Decks</Link>
              ) : undefined
            }
          />
        )}
      </ShowcaseSection>
    </main>
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

function PencilIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Z" />
      <path d="m14.06 4.19 2.37-2.37a1 1 0 0 1 1.42 0l4.33 4.33a1 1 0 0 1 0 1.42l-2.37 2.37-5.75-5.75Z" />
    </svg>
  );
}

function CharacterStack({ deck }: { deck: PublicProfileDeck }) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((item) => item.id === id))
    .filter(Boolean);
  return (
    <div
      className={styles.characterStack}
      aria-label={`${characters.length} Character Cards`}
    >
      {characters.map((character) => (
        <OriginalImage
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
