"use client";

import { OriginalImage } from "@/components/media/OriginalImage";
import Link from "next/link";
import { type ReactNode } from "react";
import { FACTIONS, FACTION_SYMBOLS } from "../../lib/card-filters";
import { cardArtSource } from "../../lib/content/card-art";
import { BAKUGAN, deckLeadCard, type DeckFormat, type DeckRecord } from "../../lib/data";
import { CardArt } from "../cards/CardArt";
import { CardGrid, Field, RouteHero, Surface, Tabs } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";

export type LibraryView = "grid" | "list";

export type DeckFormatFilter = "all" | DeckFormat;

export function DeckAreaHeader({
  section,
  count,
  legalCount,
  action,
}: {
  section: "mine" | "public";
  count: number;
  legalCount: number;
  action?: ReactNode;
}) {
  return (
    <RouteHero
      className={styles.routeHero}
      eyebrow="DECK ARSENAL"
      title={section === "mine" ? "My Decks" : "Public Decks"}
      description={
        section === "mine"
          ? `${count} saved · ${legalCount} legal · ${count - legalCount} requiring attention`
          : `${count} community loadouts ready to inspect and copy.`
      }
      aside={(
        <div className={styles.heroUtilities}>
          {action}
          <Tabs label="Deck library sections">
            <Link aria-current={section === "mine" ? "page" : undefined} href="/decks">My Decks</Link>
            <Link aria-current={section === "public" ? "page" : undefined} href="/decks/public">Public Decks</Link>
          </Tabs>
        </div>
      )}
    />
  );
}

export function DeckLibrarySkeleton() {
  return (
    <div className={styles.route} aria-busy="true" aria-label="Loading deck library">
      <div className={styles.heroSkeleton} />
      <div className={styles.toolbarSkeleton} />
      <CardGrid className={styles.deckGrid} minCardWidth="20rem">
        {Array.from({ length: 6 }, (_, index) => (
          <div className={styles.deckSkeleton} key={index}>
            <div /><span /><span /><span />
          </div>
        ))}
      </CardGrid>
    </div>
  );
}

export function DeckToolbar({
  query,
  setQuery,
  faction,
  setFaction,
  legality,
  setLegality,
  formatFilter,
  setFormatFilter,
  sort,
  setSort,
  view,
  setView,
  count,
  sortOptions = ["Updated", "Name", "Set"],
  favoritesOnly,
  setFavoritesOnly,
  favoritesEnabled = true,
}: {
  query: string;
  setQuery: (value: string) => void;
  faction: string;
  setFaction: (value: string) => void;
  legality: string;
  setLegality: (value: string) => void;
  formatFilter: DeckFormatFilter;
  setFormatFilter: (value: DeckFormatFilter) => void;
  sort: string;
  setSort: (value: string) => void;
  view: LibraryView;
  setView: (value: LibraryView) => void;
  count: number;
  sortOptions?: string[];
  favoritesOnly?: boolean;
  setFavoritesOnly?: (value: boolean) => void;
  favoritesEnabled?: boolean;
}) {
  return (
    <Surface className={styles.toolbar} elevation="overlay">
      <Field className={styles.search} label="Search decks">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, faction, tag, or set…"
        />
      </Field>
      <Field label="Faction">
        <select value={faction} onChange={(event) => setFaction(event.target.value)}>
          <option>All</option>
          {FACTIONS.map((value) => <option key={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Legality">
        <select value={legality} onChange={(event) => setLegality(event.target.value)}>
          <option>All</option><option>Legal</option><option>Issues</option>
        </select>
      </Field>
      <Field label="Format">
        <select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as DeckFormatFilter)}>
          <option value="all">All formats</option>
          <option value="standard">Standard</option>
          <option value="singleton">Singleton</option>
          <option value="competitive">Competitive</option>
        </select>
      </Field>
      <Field label="Sort">
        <select value={sort} onChange={(event) => setSort(event.target.value)}>
          {sortOptions.map((option) => <option key={option}>{option}</option>)}
        </select>
      </Field>
      {setFavoritesOnly && (
        <Field label="Favorites">
          <select
            value={favoritesOnly ? "Mine" : "All"}
            disabled={!favoritesEnabled}
            onChange={(event) => setFavoritesOnly(event.target.value === "Mine")}
          >
            <option value="All">All decks</option>
            <option value="Mine">My Favorites</option>
          </select>
        </Field>
      )}
      <div className={styles.viewControls}>
        <span>{count} shown</span>
        <Tabs label="Deck layout">
          <button aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>Grid</button>
          <button aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button>
        </Tabs>
      </div>
    </Surface>
  );
}

export function CharacterFan({
  deck,
  compact = false,
  featured = false,
}: {
  deck: DeckRecord;
  compact?: boolean;
  featured?: boolean;
}) {
  const characters = deck.bakuganIds
    .map((id) => BAKUGAN.find((candidate) => candidate.id === id))
    .filter(Boolean);
  const featuredCard = featured ? deckLeadCard(deck) : undefined;
  const featuredPreviewCard = featuredCard && !characters.some(
    (character) => character?.character.catalogId === featuredCard.catalogId,
  ) ? featuredCard : undefined;
  return (
    <div
      className={`${styles.characterFan} ${featuredPreviewCard ? styles.characterFanFeatured : ""} ${compact ? styles.characterFanCompact : ""}`}
      data-featured-preview={featuredPreviewCard ? "true" : undefined}
    >
      {Array.from({ length: 3 }, (_, index) => {
        const character = characters[index];
        return character ? (
          <CardArt
            key={character.id}
            src={cardArtSource(character.character, "full")}
            cardType={character.character.type}
            presentation="readable"
            loading="lazy"
            decoding="async"
            alt={character.name}
          />
        ) : (
          <div className={styles.characterPlaceholder} key={`empty-${index}`} aria-label="Empty Character slot">?</div>
        );
      })}
      {featuredPreviewCard && (
        <CardArt
          className={styles.featuredPreviewCard}
          src={cardArtSource(featuredPreviewCard, "full")}
          cardType={featuredPreviewCard.type}
          presentation="readable"
          loading="lazy"
          decoding="async"
          alt={`Featured card: ${featuredPreviewCard.displayName}`}
        />
      )}
    </div>
  );
}

export function DeckFactionSymbols({ factions }: { factions: string[] }) {
  const visibleFactions = factions.filter((faction) => Boolean(FACTION_SYMBOLS[faction]));
  if (!visibleFactions.length) return <span className={styles.factionSymbols}>No factions selected</span>;
  return (
    <span className={styles.factionSymbols} aria-label={`Factions: ${visibleFactions.join(", ")}`}>
      {visibleFactions.map((faction) => (
        <OriginalImage
          key={faction}
          src={FACTION_SYMBOLS[faction]}
          alt=""
          aria-hidden="true"
          title={faction}
        />
      ))}
    </span>
  );
}

export function DeckFactionTags({ factions }: { factions: string[] }) {
  const visibleFactions = factions.filter((faction) => Boolean(FACTION_SYMBOLS[faction]));
  if (!visibleFactions.length) return <span className={styles.emptyFactionTag}>No factions</span>;
  return (
    <div className={styles.factionTags} aria-label={`Factions: ${visibleFactions.join(", ")}`}>
      {visibleFactions.map((faction) => (
        <span className={styles.factionTag} key={faction}>
          <OriginalImage src={FACTION_SYMBOLS[faction]} alt="" aria-hidden="true" />
          {faction}
        </span>
      ))}
    </div>
  );
}
