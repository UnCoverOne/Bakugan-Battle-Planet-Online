"use client";

import { useRouter } from "next/navigation";
import { validateDeck, type DeckRecord } from "../../lib/data";
import { encodeDeckCode } from "../../lib/deck-transfer";
import { useAppFields } from "../application/AppProvider";
import { copyText } from "../application/ui";
import { ActionButton } from "../design-system/primitives";
import { clone } from "./DeckRouteShared";
import { DeckDetailPresentation, DeckSharePanel, MissingDeck } from "./DeckDetailPresentation";

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setBuilderDeck, setSelectedDeckId, notify, profile, authUser, catalogueRevision } = useAppFields(["decks", "setBuilderDeck", "setSelectedDeckId", "notify", "profile", "authUser", "catalogueRevision"]);
  void catalogueRevision;
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id} />;
  const report = validateDeck(deck);
  return (
    <DeckDetailPresentation
      deck={deck}
      notify={notify}
      creatorIdentity={{
        userId: deck.sourceDeckId ? deck.sourceCreatorUserId : authUser?.id,
        displayName: deck.sourceDeckId ? deck.sourceCreator ?? "Community Brawler" : profile.name,
      }}
      sharePanel={<DeckSharePanel deck={deck} notify={notify} showCopyAction={false} />}
      actions={(
        <>
          <ActionButton onClick={() => {
            setBuilderDeck(clone(deck));
            router.push(`/builder/${encodeURIComponent(deck.id)}`);
          }}>Edit Deck</ActionButton>
          <ActionButton
            tone="secondary"
            disabled={!report.isLegal}
            onClick={() => {
              setSelectedDeckId(deck.id);
              notify(`${deck.name} selected for Play.`);
            }}
          >Select for Play</ActionButton>
          <ActionButton tone="quiet" onClick={() => void copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied."))}>Copy Code</ActionButton>
        </>
      )}
    />
  );
}
