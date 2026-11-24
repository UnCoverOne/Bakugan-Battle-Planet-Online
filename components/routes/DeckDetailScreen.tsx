"use client";

import { useRouter } from "next/navigation";
import { type DeckRecord } from "../../lib/data";
import { DECK_LIMIT, uniqueDeckName } from "../../lib/deck-transfer";
import { PROFILE_SHOWCASE_LIMIT, toggleShowcaseId } from "../../lib/profile-customization";
import { useAppFields } from "../application/AppProvider";
import { clone } from "./DeckRouteShared";
import { DeckDetailPresentation, MissingDeck } from "./DeckDetailPresentation";

export function DeckDetailScreen({ id }: { id: string }) {
  const router = useRouter();
  const { decks, setDecks, setBuilderDeck, notify, profile, setProfile, authUser, catalogueRevision } = useAppFields([
    "decks", "setDecks", "setBuilderDeck", "notify", "profile", "setProfile", "authUser", "catalogueRevision",
  ]);
  void catalogueRevision;
  const deck = decks.find((item: DeckRecord) => item.id === id);
  if (!deck) return <MissingDeck id={id} />;

  const duplicate = () => {
    if (decks.length >= DECK_LIMIT) return notify("Deck limit reached (" + DECK_LIMIT + ").");
    const next: DeckRecord = {
      ...clone(deck),
      id: globalThis.crypto.randomUUID(),
      name: uniqueDeckName(deck.name + " Copy", decks),
      visibility: "Private",
      creator: undefined,
      publishedAt: undefined,
      updatedAt: new Date().toISOString(),
      revision: 1,
    };
    setDecks((items: DeckRecord[]) => [next, ...items]);
    notify(next.name + " created.");
    router.push("/decks/" + encodeURIComponent(next.id));
  };
  const remove = () => {
    if (!window.confirm("Delete “" + deck.name + "”? This cannot be undone.")) return;
    setDecks((items: DeckRecord[]) => items.filter(item => item.id !== deck.id));
    notify(deck.name + " deleted.");
    router.push("/decks");
  };
  const showcased = (profile.showcaseDeckIds ?? []).includes(deck.id);
  const toggleShowcase = () => {
    if (deck.visibility !== "Public") return notify("Only Public decks can be showcased on your Profile.");
    const result = toggleShowcaseId(profile.showcaseDeckIds, deck.id);
    if (result.reachedLimit) return notify("Your Profile can showcase up to " + PROFILE_SHOWCASE_LIMIT + " Public decks.");
    setProfile({ ...profile, showcaseDeckIds: result.ids });
    notify(result.ids.includes(deck.id) ? "Deck added to Profile showcase." : "Deck removed from Profile showcase.");
  };
  return <DeckDetailPresentation
    deck={deck}
    notify={notify}
    creatorIdentity={{
      userId: deck.sourceDeckId ? deck.sourceCreatorUserId : authUser?.id,
      displayName: deck.sourceDeckId ? deck.sourceCreator ?? "Community Brawler" : profile.name,
    }}
    primaryAction={<button type="button" className="bb-button bb-button--primary" onClick={() => {
      setBuilderDeck(clone(deck));
      router.push("/builder/" + encodeURIComponent(deck.id));
    }}>Edit Deck</button>}
    menuActions={<>
      <button type="button" onClick={duplicate}>Duplicate Deck</button>
      {deck.visibility === "Public" &&
        <button type="button" onClick={toggleShowcase}>{showcased ? "Remove from Profile Showcase" : "Showcase on Profile"}</button>}
      <button type="button" data-danger="true" onClick={remove}>Delete Deck</button>
    </>}
  />;
}
