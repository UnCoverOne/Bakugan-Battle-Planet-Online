"use client";

import { useRouter } from "next/navigation";
import { type DeckRecord } from "../../lib/data";
import { useAppFields } from "../application/AppProvider";
import { clone } from "./DeckRouteShared";
import { DeckDetailPresentation, MissingDeck } from "./DeckDetailPresentation";
import detailStyles from "./DeckDetail.module.css";

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setBuilderDeck, notify, profile, authUser, catalogueRevision } = useAppFields(["decks", "setBuilderDeck", "notify", "profile", "authUser", "catalogueRevision"]);
  void catalogueRevision;
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id} />;
  return (
    <DeckDetailPresentation
      deck={deck}
      notify={notify}
      creatorIdentity={{
        userId: deck.sourceDeckId ? deck.sourceCreatorUserId : authUser?.id,
        displayName: deck.sourceDeckId ? deck.sourceCreator ?? "Community Brawler" : profile.name,
      }}
      primaryAction={<button type="button" className={detailStyles.primaryAction} onClick={() => {
        setBuilderDeck(clone(deck));
        router.push("/builder/" + encodeURIComponent(deck.id));
      }}>Edit Deck</button>}
    />
  );
}
