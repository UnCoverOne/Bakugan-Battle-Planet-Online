"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateDeck, type DeckRecord } from "../../lib/data";
import { rememberAccountIntent } from "../../lib/account-intent";
import { DECK_LIMIT, uniqueDeckName } from "../../lib/deck-transfer";
import { invalidateResponse } from "../../lib/response-cache";
import { useAppFields } from "../application/AppProvider";
import { ActionButton } from "../design-system/primitives";
import styles from "./DeckRoutes.module.css";
import { MotionValue } from "../design-system/MotionValue";
import { clone, useOnlineStatus, DeckState } from "./DeckRouteShared";
import { usePublicDeckCatalogue } from "./PublicDeckCatalogue";
import { DeckDetailPresentation, DeckSharePanel, MissingDeck } from "./DeckDetailPresentation";

export function PublicDeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const online = useOnlineStatus();
  const { decks, setDecks, setBuilderDeck, notify, authUser, promptAccount, catalogueRevision } = useAppFields(["decks", "setDecks", "setBuilderDeck", "notify", "authUser", "promptAccount", "catalogueRevision"]);
  void catalogueRevision;
  const [favoritePending, setFavoritePending] = useState(false);
  const catalogue = usePublicDeckCatalogue(online, authUser?.id);
  if (catalogue.status === "loading") {
    return <div className={styles.route}><DeckState tone="loading" role="status" title="Loading public deck" copy="Retrieving the current public catalogue…" /></div>;
  }
  if (catalogue.status === "error") {
    return <div className={styles.route}><DeckState tone="error" role="alert" title="Public deck unavailable" copy={catalogue.error ?? "Reconnect and try again."} /></div>;
  }
  const deck = catalogue.decks.find((item) => item.id === id);
  if (!deck) return <MissingDeck id={id} publicDeck />;
  const favorite = catalogue.favorites[deck.id] ?? { favoriteCount: 0, viewerHasFavorited: false };
  const toggleFavorite = async () => {
    if (catalogue.status !== "online") return notify("Community Favorites are available while online.");
    if (!authUser) {
      rememberAccountIntent("favorite-deck", { deckId: deck.id, returnTo: window.location.pathname });
      promptAccount("favorite-deck");
      return;
    }
    if (favoritePending) return;
    const nextFavorited = !favorite.viewerHasFavorited;
    const optimistic = {
      favoriteCount: Math.max(0, favorite.favoriteCount + (nextFavorited ? 1 : -1)),
      viewerHasFavorited: nextFavorited,
    };
    catalogue.updateFavorite(deck.id, optimistic);
    setFavoritePending(true);
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
      catalogue.updateFavorite(deck.id, favorite);
      notify(error instanceof Error ? error.message : "Favorite could not be changed.");
    } finally {
      setFavoritePending(false);
    }
  };
  const copy = () => {
    if (decks.length >= DECK_LIMIT) return notify(`Deck limit reached (${DECK_LIMIT}).`);
    const report = validateDeck(deck);
    if (!report.isLegal) return notify(`This public deck cannot be copied: ${report.issues[0].message}`);
    const next = {
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
    setDecks((items: DeckRecord[]) => [next, ...items]);
    notify(`${next.name} copied to My Decks.`);
    router.push(`/decks/${encodeURIComponent(next.id)}`);
  };
  const editAsAdministrator = () => {
    setBuilderDeck(clone(deck));
    router.push(`/builder/${encodeURIComponent(`admin-public:${deck.id}`)}?returnTo=${encodeURIComponent(`/decks/public/${deck.id}`)}`);
  };
  const deleteAsAdministrator = async () => {
    if (!globalThis.confirm(`Delete public deck “${deck.name}”? This cannot be undone.`)) return;
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "public-delete", id: deck.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Public deck could not be deleted.");
      invalidateResponse("public-decks:");
      notify(`${deck.name} deleted.`);
      router.push("/decks/public");
      router.refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Public deck could not be deleted.");
    }
  };
  return (
    <DeckDetailPresentation
      deck={deck}
      publicView
      notify={notify}
      sharePanel={(
        <DeckSharePanel
          deck={deck}
          copyAvailable={validateDeck(deck).isLegal}
          onCopy={copy}
          notify={notify}
        />
      )}
      actions={(
        <>
          {catalogue.status === "online" && (
            <ActionButton
              aria-pressed={favorite.viewerHasFavorited}
              disabled={favoritePending}
              onClick={() => void toggleFavorite()}
            >
              <MotionValue value={favorite.viewerHasFavorited}>{favorite.viewerHasFavorited ? "★ Favorited" : "☆ Favorite"}</MotionValue> · <MotionValue value={favorite.favoriteCount} /> {favorite.favoriteCount === 1 ? "Favorite" : "Favorites"}
            </ActionButton>
          )}
          {catalogue.status === "online" && authUser?.roles?.includes("administrator") && (
            <>
              <ActionButton tone="secondary" onClick={editAsAdministrator}>Edit as Administrator</ActionButton>
              <ActionButton tone="quiet" onClick={() => void deleteAsAdministrator()}>Delete Deck</ActionButton>
            </>
          )}
          <Link className={styles.textAction} href="/decks/public">Back to Public Decks</Link>
        </>
      )}
    />
  );
}
