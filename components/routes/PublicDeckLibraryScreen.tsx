"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { legalDeckFormats, validateDeck, type DeckFormat, type DeckRecord } from "../../lib/data";
import type { DeckValidationResult } from "../../lib/deck-validation";
import { rememberAccountIntent } from "../../lib/account-intent";
import { DECK_LIMIT, uniqueDeckName } from "../../lib/deck-transfer";
import { invalidateResponse } from "../../lib/response-cache";
import { deckSetName } from "../../lib/deck-set";
import { useAppFields } from "../application/AppProvider";
import { formatTimestamp } from "../application/ui";
import { CardGrid, StatusChip, Surface } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";
import { MotionValue } from "../design-system/MotionValue";
import { type LibraryView, type DeckFormatFilter, DeckAreaHeader, DeckLibrarySkeleton, DeckToolbar, CharacterFan, DeckFactionSymbols } from "./DeckLibraryPresentation";
import { deckFormatLabel, useCompetitiveRules, clone, useOnlineStatus, DeckState } from "./DeckRouteShared";
import { type PublicDeckFavoriteMetadata, usePublicDeckCatalogue } from "./PublicDeckCatalogue";

export function PublicDeckLibraryScreen() {
  const { ready, decks, setDecks, notify, authUser, promptAccount } = useAppFields(["ready", "decks", "setDecks", "notify", "authUser", "promptAccount"]);
  const router = useRouter();
  const online = useOnlineStatus();
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [formatFilter, setFormatFilter] = useState<DeckFormatFilter>("all");
  const [sort, setSort] = useState("Updated");
  const [view, setView] = useState<LibraryView>("grid");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [pendingFavoriteIds, setPendingFavoriteIds] = useState<Set<string>>(() => new Set());
  const catalogue = usePublicDeckCatalogue(online, authUser?.id);
  const competitiveRules = useCompetitiveRules();
  const allPublic = catalogue.decks;
  useEffect(() => {
    if (!authUser || catalogue.status !== "online") setFavoritesOnly(false);
  }, [authUser, catalogue.status]);
  if (!ready || catalogue.status === "loading") return <DeckLibrarySkeleton />;
  if (catalogue.status === "error") {
    return (
      <div className={styles.route}>
        <DeckAreaHeader section="public" count={0} legalCount={0} />
        <DeckState tone="error" role="alert" title="Public decks are unavailable" copy={catalogue.error ?? "Reconnect and try again."} />
      </div>
    );
  }

  const reports = new Map<string, DeckValidationResult>(
    allPublic.map((deck): [string, DeckValidationResult] => [
      deck.id,
      validateDeck(deck, competitiveRules.restrictions, competitiveRules.deckSize),
    ]),
  );
  const compatibility = new Map<string, DeckFormat[]>(
    allPublic.map((deck): [string, DeckFormat[]] => [
      deck.id,
      legalDeckFormats(deck, competitiveRules.restrictions, competitiveRules.deckSize),
    ]),
  );
  const visible = allPublic.filter((deck) => {
    const legalFormats = compatibility.get(deck.id) ?? [];
    const legal = legalFormats.length > 0;
    const matchesQuery = !query || `${deck.name} ${deck.creator} ${deck.description} ${deck.factions.join(" ")} ${deckSetName(deck)}`.toLowerCase().includes(query.toLowerCase());
    const matchesFaction = faction === "All" || deck.factions.includes(faction);
    const matchesFormat = formatFilter === "all" || legalFormats.includes(formatFilter);
    const matchesFavorite = !favoritesOnly || Boolean(catalogue.favorites[deck.id]?.viewerHasFavorited);
    return matchesQuery && matchesFaction && matchesFormat && matchesFavorite && (legality === "All" || (legality === "Legal" ? legal : !legal));
  }).sort((a, b) => {
    if (sort === "Name") return a.name.localeCompare(b.name);
    if (sort === "Set") return deckSetName(a).localeCompare(deckSetName(b));
    if (sort === "Most Favorited") {
      const favoriteDifference = (catalogue.favorites[b.id]?.favoriteCount ?? 0) - (catalogue.favorites[a.id]?.favoriteCount ?? 0);
      if (favoriteDifference) return favoriteDifference;
      const publishedDifference = Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);
      return publishedDifference || a.name.localeCompare(b.name);
    }
    return Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt);
  });
  const toggleFavorite = async (deck: DeckRecord) => {
    if (catalogue.status !== "online") {
      notify("Community Favorites are available while online.");
      return;
    }
    if (!authUser) {
      rememberAccountIntent("favorite-deck", { deckId: deck.id, returnTo: window.location.pathname });
      promptAccount("favorite-deck");
      return;
    }
    if (pendingFavoriteIds.has(deck.id)) return;
    const current = catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false };
    const nextFavorited = !current.viewerHasFavorited;
    const optimistic = {
      favoriteCount: Math.max(0, current.favoriteCount + (nextFavorited ? 1 : -1)),
      viewerHasFavorited: nextFavorited,
    };
    catalogue.updateFavorite(deck.id, optimistic);
    setPendingFavoriteIds((ids) => new Set(ids).add(deck.id));
    try {
      const response = await fetch("/api/public-decks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: nextFavorited ? "favorite" : "unfavorite", deckId: deck.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.favorite) throw new Error(result.error ?? "Favorite could not be changed.");
      invalidateResponse("public-decks:");
      catalogue.updateFavorite(deck.id, {
        favoriteCount: Number(result.favorite.favoriteCount) || 0,
        viewerHasFavorited: Boolean(result.favorite.viewerHasFavorited),
      });
    } catch (error) {
      catalogue.updateFavorite(deck.id, current);
      notify(error instanceof Error ? error.message : "Favorite could not be changed.");
    } finally {
      setPendingFavoriteIds((ids) => {
        const next = new Set(ids);
        next.delete(deck.id);
        return next;
      });
    }
  };
  const copyDeck = (deck: DeckRecord) => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const legalFormats = compatibility.get(deck.id) ?? [];
    if (!legalFormats.length) return notify("This public deck is not legal in any supported format.");
    const copy = {
      ...clone(deck),
      id: globalThis.crypto.randomUUID(),
      name: uniqueDeckName(deck.name, decks),
      visibility: "Private" as const,
      creator: undefined,
      publishedAt: undefined,
      sourceDeckId: deck.id,
      sourceCreator: deck.creator ?? "Community Brawler",
      sourceCreatorUserId: (deck as DeckRecord & { creatorUserId?: string }).creatorUserId,
      updatedAt: new Date().toISOString(),
      revision: 1,
    };
    setDecks((items: DeckRecord[]) => [copy, ...items]);
    notify(`${copy.name} copied to My Decks.`);
    router.push(`/decks/${encodeURIComponent(copy.id)}`);
  };

  return (
    <div className={styles.route}>
      <DeckAreaHeader
        section="public"
        count={allPublic.length}
        legalCount={[...compatibility.values()].filter((formats) => formats.length > 0).length}
      />
      {catalogue.status === "offline" && (
        <DeckState
          tone="offline"
          role="status"
          title="Showing offline fallback decks"
          copy="These are the latest administrator-managed fallback decks cached on this device. They are not part of the online Public Deck library."
        />
      )}
      <DeckToolbar
        query={query}
        setQuery={setQuery}
        faction={faction}
        setFaction={setFaction}
        legality={legality}
        setLegality={setLegality}
        formatFilter={formatFilter}
        setFormatFilter={setFormatFilter}
        sort={sort}
        setSort={setSort}
        view={view}
        setView={setView}
        count={visible.length}
        sortOptions={["Updated", "Name", "Set", "Most Favorited"]}
        favoritesOnly={favoritesOnly}
        setFavoritesOnly={setFavoritesOnly}
        favoritesEnabled={catalogue.status === "online" && Boolean(authUser)}
      />
      {visible.length ? (
        <CardGrid className={`${styles.deckGrid} ${styles[`deckGrid_${view}`]}`} minCardWidth="20rem">
          {visible.map((deck) => (
            <PublicDeckTile
              key={deck.id}
              deck={deck}
              report={reports.get(deck.id)!}
              legalFormats={compatibility.get(deck.id) ?? []}
              view={view}
              favorite={catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false }}
              favoriteAvailable={catalogue.status === "online"}
              favoritePending={pendingFavoriteIds.has(deck.id)}
              onFavorite={() => void toggleFavorite(deck)}
              onOpen={() => router.push(`/decks/public/${encodeURIComponent(deck.id)}`)}
              onCopy={() => copyDeck(deck)}
            />
          ))}
        </CardGrid>
      ) : (
        <DeckState title="No public decks found" copy="Try a broader search or clear the current filters." />
      )}
    </div>
  );
}

function PublicDeckTile({
  deck,
  report,
  legalFormats,
  view,
  favorite,
  favoriteAvailable,
  favoritePending,
  onFavorite,
  onOpen,
  onCopy,
}: {
  deck: DeckRecord;
  report: DeckValidationResult;
  legalFormats: DeckFormat[];
  view: LibraryView;
  favorite: PublicDeckFavoriteMetadata;
  favoriteAvailable: boolean;
  favoritePending: boolean;
  onFavorite: () => void;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <Surface as="article" className={`${styles.deckCard} ${styles.publicDeckCard} ${styles[`deckCard_${view}`]}`}>
      <button className={styles.deckCardMain} onClick={onOpen} aria-label={`View ${deck.name}`}>
        <CharacterFan deck={deck} compact={view === "list"} featured />
        <div className={styles.deckCardCopy}>
          <div className={styles.deckTitleRow}><h2 data-deck-name>{deck.name}</h2></div>
          <p>by {deck.creator ?? "Community Brawler"}</p>
          <div className={styles.chipRow}>
            <StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip>
            <StatusChip tone={legalFormats.length ? "success" : "danger"}>{legalFormats.length ? "Legal" : `${report.issues.length} issues`}</StatusChip>
          </div>
          <DeckFactionSymbols factions={deck.factions} />
          <small>{legalFormats.length ? `Legal formats: ${legalFormats.map(deckFormatLabel).join(" · ")}` : "No legal formats"}</small>
          <small>Published {formatTimestamp(deck.publishedAt ?? deck.updatedAt)}</small>
        </div>
      </button>
      <div className={`${styles.deckCardActions} ${styles.publicDeckActions}`}>
        <button onClick={onOpen}>View Deck</button>
        <button onClick={onCopy} disabled={!legalFormats.length} title="Copy to My Decks">Copy</button>
        {favoriteAvailable && (
          <button
            data-ui="favorite-button"
            className={styles.favoriteButton}
            aria-label={`${favorite.viewerHasFavorited ? "Remove" : "Add"} ${deck.name} ${favorite.viewerHasFavorited ? "from" : "to"} Favorites. ${favorite.favoriteCount} ${favorite.favoriteCount === 1 ? "favorite" : "favorites"}.`}
            aria-pressed={favorite.viewerHasFavorited}
            disabled={favoritePending}
            title={`${favorite.viewerHasFavorited ? "Favorited" : "Favorite"} · ${favorite.favoriteCount}`}
            onClick={onFavorite}
          >
            <MotionValue value={favorite.viewerHasFavorited}><span aria-hidden="true">{favorite.viewerHasFavorited ? "★" : "☆"}</span></MotionValue>
            <MotionValue value={favorite.favoriteCount}><span>{favorite.favoriteCount}</span></MotionValue>
          </button>
        )}
      </div>
    </Surface>
  );
}
