"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { legalDeckFormats, type DeckFormat, type DeckRecord } from "../../lib/data";
import { rememberAccountIntent } from "../../lib/account-intent";
import { DECK_LIMIT, uniqueDeckName } from "../../lib/deck-transfer";
import { invalidateResponse } from "../../lib/response-cache";
import { deckSetName } from "../../lib/deck-set";
import { useAppFields } from "../application/AppProvider";

import library from "./DeckLibrary.module.css";
import { type LibraryView, type DeckFormatFilter, DeckLibraryHeader, DeckLibrarySkeleton, DeckToolbar, DeckLibraryEmpty } from "./DeckLibraryPresentation";
import { DeckGalleryBody } from "./DeckGalleryCard";
import { useCompetitiveRules, clone, useOnlineStatus, DeckState } from "./DeckRouteShared";
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
      <div className={library.route}><div className={library.shell}><DeckLibraryHeader section="public" /><DeckState tone="error" role="alert" title="Public decks are unavailable" copy={catalogue.error ?? "Reconnect and try again."} /></div></div>
    );
  }

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

  return <div className={library.route}><div className={library.shell}>
    <DeckLibraryHeader section="public" />
    {catalogue.status === "offline" && <DeckState tone="offline" role="status" title="Offline public decks"
      copy="Showing cached or bundled fallback decks rather than the live community catalogue." />}
    <DeckToolbar query={query} setQuery={setQuery} faction={faction} setFaction={setFaction}
      legality={legality} setLegality={setLegality} formatFilter={formatFilter} setFormatFilter={setFormatFilter}
      sort={sort} setSort={setSort} view={view} setView={setView}
      sortOptions={["Updated", "Name", "Set", "Most Favorited"]}
      favoritesOnly={favoritesOnly} setFavoritesOnly={setFavoritesOnly}
      favoritesEnabled={catalogue.status === "online" && Boolean(authUser)} />
    <div className={library.libraryMeta}>
      <p className={library.count}>{allPublic.length} public decks{visible.length !== allPublic.length ? ` · ${visible.length} shown` : ""}</p>
    </div>
    {visible.length ? <div className={`${library.grid} ${view === "list" ? library.gridList : ""}`}>
      {visible.map((deck) => <PublicDeckTile key={deck.id} deck={deck}
        legalFormats={compatibility.get(deck.id) ?? []}
        favorite={catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false }}
        favoriteAvailable={catalogue.status === "online"} favoritePending={pendingFavoriteIds.has(deck.id)}
        onFavorite={() => void toggleFavorite(deck)}
        onCopy={() => copyDeck(deck)} />)}
    </div> : <DeckLibraryEmpty title="No public decks found" message="Try another search or clear your filters."
      action={<button type="button" onClick={() => { setQuery("");setFaction("All");setLegality("All");setFormatFilter("all");setFavoritesOnly(false); }}>Clear filters</button>} />}
  </div></div>;
}

function PublicDeckTile({
  deck, legalFormats, favorite, favoriteAvailable, favoritePending, onFavorite, onCopy,
}: {
  deck: DeckRecord; legalFormats: DeckFormat[];
  favorite: PublicDeckFavoriteMetadata; favoriteAvailable: boolean;
  favoritePending: boolean; onFavorite: () => void; onCopy: () => void;
}) {
  const href = `/decks/public/${encodeURIComponent(deck.id)}`;
  return <article className={library.card} data-deck-library-card>
    <div className={library.cardMain}><DeckGalleryBody deck={deck} href={href}
      creatorName={deck.creator ?? "Community Brawler"}
      creatorUserId={(deck as DeckRecord & { creatorUserId?: string }).creatorUserId}
      legalFormats={legalFormats} likes={favorite.favoriteCount} liked={favorite.viewerHasFavorited}
      onLike={favoriteAvailable ? onFavorite : undefined} likeDisabled={favoritePending} /></div>
    <footer className={library.cardFooter}>
      
      <div className={library.cardActions}>
        <Link href={href}>View deck</Link>
        <button type="button" onClick={onCopy} disabled={!legalFormats.length} title="Copy to My Decks">Copy</button>
      </div>
    </footer>
  </article>;
}
