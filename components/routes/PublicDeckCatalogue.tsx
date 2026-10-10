"use client";

import { useEffect, useRef, useState } from "react";
import { BUNDLED_OFFLINE_PUBLIC_DECKS, type DeckRecord } from "../../lib/data";
import { cachedResponse, invalidateResponse, peekResponse, publicDeckResponseKey } from "../../lib/response-cache";
import { readOfflinePublicDeckCache, writeOfflinePublicDeckCache } from "../../lib/public-deck-cache";
import { clone } from "./DeckRouteShared";

export type PublicDeckFavoriteMetadata = {
  favoriteCount: number;
  viewerHasFavorited: boolean;
};

export type PublicDeckCatalogueState = {
  status: "loading" | "online" | "offline" | "error";
  decks: DeckRecord[];
  favorites: Record<string, PublicDeckFavoriteMetadata>;
  error?: string;
};

export const publicFavoriteMetadata = (
  decks: DeckRecord[],
  value: unknown,
): Record<string, PublicDeckFavoriteMetadata> => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, { favoriteCount?: unknown; viewerHasFavorited?: unknown }>
    : {};
  return Object.fromEntries(decks.map((deck) => {
    const metadata = source[deck.id];
    return [deck.id, {
      favoriteCount: Math.max(0, Number(metadata?.favoriteCount) || 0),
      viewerHasFavorited: Boolean(metadata?.viewerHasFavorited),
    }];
  }));
};

export function usePublicDeckCatalogue(online: boolean, viewerUserId?: string) {
  const [state, setState] = useState<PublicDeckCatalogueState>({ status: "loading", decks: [], favorites: {} });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const previousViewer = useRef(viewerUserId);
  useEffect(() => {
    const refresh = () => { invalidateResponse("public-decks:"); setRefreshRevision((value) => value + 1); };
    addEventListener("bbp-public-deck-favorites-updated", refresh);
    return () => removeEventListener("bbp-public-deck-favorites-updated", refresh);
  }, []);
  useEffect(() => {
    let active = true;
    if (!online) {
      const cached = readOfflinePublicDeckCache(localStorage);
      const decks = (cached ?? BUNDLED_OFFLINE_PUBLIC_DECKS).map(clone);
      setState({ status: "offline", decks, favorites: {} });
      return () => { active = false; };
    }
    const sameViewer = previousViewer.current === viewerUserId;
    previousViewer.current = viewerUserId;
    const key = publicDeckResponseKey(viewerUserId);
    const cached = peekResponse<{ decks: DeckRecord[]; favorites?: unknown }>(key);
    setState(current => cached
      ? { status: "online", decks: cached.decks, favorites: publicFavoriteMetadata(cached.decks, cached.favorites) }
      : sameViewer && current.decks.length ? current : { status: "loading", decks: [], favorites: {} });
    cachedResponse<{ decks: DeckRecord[]; favorites?: unknown; offlineFallbackDecks?: DeckRecord[]; offlineFallbackRevision?: number; error?: string }>(key, "/api/public-decks")
      .then((result) => {
        if (!Array.isArray(result.decks)) throw new Error(result.error ?? "Public decks are unavailable.");
        if (Array.isArray(result.offlineFallbackDecks)) {
          writeOfflinePublicDeckCache(
            localStorage,
            result.offlineFallbackDecks,
            Number(result.offlineFallbackRevision ?? Date.now()),
          );
        }
        if (active) setState({
          status: "online",
          decks: result.decks,
          favorites: publicFavoriteMetadata(result.decks, result.favorites),
        });
      })
      .catch((error) => {
        if (active) setState(current => ({
          ...current,
          status: current.decks.length ? current.status : "error",
          error: error instanceof Error ? error.message : "Public decks are unavailable.",
        }));
      });
    return () => { active = false; };
  }, [online, refreshRevision, viewerUserId]);
  const updateFavorite = (deckId: string, metadata: PublicDeckFavoriteMetadata) => {
    setState((current) => ({
      ...current,
      favorites: { ...current.favorites, [deckId]: metadata },
    }));
  };
  return { ...(previousViewer.current === viewerUserId ? state : { status: "loading" as const, decks: [], favorites: {} }), updateFavorite };
}
