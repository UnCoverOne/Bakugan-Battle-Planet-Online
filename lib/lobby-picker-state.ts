type IdentifiedDeck = { id: string };

/** A slot click can replace a committed Ranked deck without forcing the
 * player to deselect it first. Selection is provisional until confirmation. */
export function proposedDeckSelection<T extends IdentifiedDeck>(
  draft: readonly T[], deck: T, limit: number, replacement: string | null,
): T[] | null {
  if (draft.some(item => item.id === deck.id)) return draft.filter(item => item.id !== deck.id);
  if (limit === 1) return [deck];
  if (replacement && draft.some(item => item.id === replacement)) {
    return draft.map(item => item.id === replacement ? deck : item);
  }
  return draft.length < limit ? [...draft, deck] : null;
}

export function sameDeckSelection<T>(left: readonly T[], right: readonly T[], signature: (deck: T) => string) {
  return left.length === right.length && left.every((deck, index) => signature(deck) === signature(right[index]));
}
