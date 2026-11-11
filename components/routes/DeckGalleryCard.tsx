"use client";

import Link from "next/link";
import { OriginalImage } from "../media/OriginalImage";
import { CardArt } from "../cards/CardArt";
import { DeckCreatorIdentity } from "../profile/DeckCreatorIdentity";
import { FACTION_SYMBOLS } from "../../lib/card-filters";
import { cardArtSource } from "../../lib/content/card-art";
import { BAKUGAN, deckLeadCard, type DeckFormat, type DeckRecord } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import styles from "./DeckGalleryCard.module.css";

/** Approved artwork window: x 6%, y 15%, width 88% of scan width, 4:3. */
export function CharacterPortrait({ src, name }: { src: string; name: string }) {
  return <span className={styles.portrait} role="img" aria-label={name}>
    <OriginalImage src={src} alt="" loading="lazy" decoding="async" />
  </span>;
}

export function DeckPreview({ deck }: { deck: DeckRecord }) {
  const characters = deck.bakuganIds.slice(0, 3).map(id => BAKUGAN.find(b => b.id === id));
  const featured = deckLeadCard(deck);
  return <div className={styles.preview} aria-label={`Three Bakugan and featured card for ${deck.name}`}>
    <div className={styles.portraits}>
      {Array.from({ length: 3 }, (_, index) => {
        const character = characters[index];
        return character
          ? <CharacterPortrait key={index} name={character.name} src={cardArtSource(character.character, "full")} />
          : <span className={styles.emptyPortrait} key={index} aria-label="Empty Bakugan slot">?</span>;
      })}
    </div>
    <div className={styles.featuredCard}>
      {featured
        ? <CardArt src={cardArtSource(featured, "full")} cardType={featured.type} presentation="readable" alt={`Featured card: ${featured.displayName}`} loading="lazy" decoding="async" />
        : <span className={styles.emptyCard}>No featured card</span>}
    </div>
  </div>;
}

const formatLabels: Record<DeckFormat, string> = { standard: "Standard", singleton: "Singleton", competitive: "Competitive" };

type Props = {
  deck: DeckRecord;
  href: string;
  legalFormats: DeckFormat[];
  creatorName: string;
  creatorUserId?: string;
  featured?: boolean;
  views?: number;
  likes?: number;
  liked?: boolean;
  onLike?: () => void;
  likeDisabled?: boolean;
};

export function DeckGalleryBody({
  deck, href, legalFormats, creatorName, creatorUserId, featured = false,
  views, likes, liked = false, onLike, likeDisabled = false,
}: Props) {
  // Historic deck records only contain updatedAt; never call that a creation date.
  const createdAt = (deck as DeckRecord & { createdAt?: string }).createdAt;
  const dateValue = createdAt ?? deck.publishedAt ?? deck.updatedAt;
  const dateLabel = createdAt ? "Created" : deck.publishedAt ? "Published" : "Updated";
  const date = Number.isFinite(Date.parse(dateValue))
    ? new Date(dateValue).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "Unknown";
  const factionNames = Array.from(new Set(deck.factions));
  return <div className={`${styles.body} ${featured ? styles.bodyFeatured : ""}`}>
    <Link href={href} className={styles.previewLink} aria-label={`View deck ${deck.name}`}>
      <DeckPreview deck={deck} />
    </Link>
    <div className={styles.info}>
      <Link href={href} className={styles.name} title={deck.name}>{deck.name}</Link>
      <div className={styles.creator}><DeckCreatorIdentity userId={creatorUserId} displayName={creatorName} /></div>
      <div className={styles.factions} aria-label={`Factions: ${factionNames.join(", ")}`}>
        {factionNames.map(faction => FACTION_SYMBOLS[faction]
          ? <OriginalImage key={faction} src={FACTION_SYMBOLS[faction]} alt={faction} title={faction} loading="lazy" />
          : null)}
      </div>
      {featured && <p className={styles.description}>{deck.description || ""}</p>}
      <div className={styles.tags} aria-label="Latest set and legal formats">
        <span className={styles.setTag} title={`Latest set: ${deckSetName(deck)}`}>{deckSetName(deck)}</span>
        {legalFormats.length
          ? legalFormats.map(format => <span className={styles.formatTag} key={format}>{formatLabels[format]}</span>)
          : <span className={styles.invalidTag}>No legal formats</span>}
      </div>
      <div className={styles.footer}>
        <time className={styles.date} dateTime={dateValue} title={`${dateLabel} ${date}`}>{dateLabel} {date}</time>
        <span className={styles.engagement}>
          <span className={styles.views} title={views == null ? "View counts are not yet available" : `${views} views`} aria-label={views == null ? "Views unavailable" : `${views} views`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
            {views == null ? "—" : views.toLocaleString()}
          </span>
          {onLike ? <button type="button" className={styles.like} onClick={onLike} disabled={likeDisabled} aria-pressed={liked} aria-label={`${liked ? "Unlike" : "Like"} ${deck.name}; ${likes ?? 0} likes`}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/></svg>
            {(likes ?? 0).toLocaleString()}
          </button> : likes != null ? <span className={styles.views} aria-label={`${likes} likes`}>♥ {likes.toLocaleString()}</span> : null}
        </span>
      </div>
    </div>
  </div>;
}
