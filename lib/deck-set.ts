import { CARD_SET_INFO, cardSetCode, type CardSetCode } from "./content/catalogue";
import type { DeckRecord } from "./data";

const SET_RELEASE_ORDER: readonly CardSetCode[] = ["BB", "BR", "AA"];
const SET_RELEASE_INDEX = new Map(SET_RELEASE_ORDER.map((code, index) => [code, index]));

export function deckSetCode(deck: Pick<DeckRecord, "bakuganIds" | "cardIds">): CardSetCode {
  let newest: CardSetCode = "BB";
  for (const catalogId of [...deck.bakuganIds, ...deck.cardIds]) {
    const code = cardSetCode({ catalogId });
    if ((SET_RELEASE_INDEX.get(code) ?? 0) > (SET_RELEASE_INDEX.get(newest) ?? 0)) newest = code;
  }
  return newest;
}

export function deckSetName(deck: Pick<DeckRecord, "bakuganIds" | "cardIds">) {
  return CARD_SET_INFO[deckSetCode(deck)].name;
}
