import { validateDeck, type DeckRecord } from "./data";

export const MAX_SYNC_BYTES = 4_000_000;

export function encodedJsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validateUserSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Sync data must be an object.");
  const snapshot = value as Record<string, unknown>;
  if (snapshot.schemaVersion !== 1) throw new Error("Unsupported sync-data schema version.");
  if (!Array.isArray(snapshot.decks) || snapshot.decks.length > 50) throw new Error("Sync data may contain at most 50 decks.");
  if (snapshot.deletedDecks !== undefined) {
    if (!Array.isArray(snapshot.deletedDecks) || snapshot.deletedDecks.length > 200) throw new Error("Sync data may contain at most 200 deleted-deck records.");
    for (const [index, candidate] of snapshot.deletedDecks.entries()) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`Deleted-deck record ${index + 1} is invalid.`);
      const deletion = candidate as Record<string, unknown>;
      if (typeof deletion.id !== "string" || !deletion.id || typeof deletion.deletedAt !== "string" || !Number.isFinite(Date.parse(deletion.deletedAt))) throw new Error(`Deleted-deck record ${index + 1} has an invalid ID or timestamp.`);
    }
  }
  if (!Array.isArray(snapshot.history) || snapshot.history.length > 200) throw new Error("Sync data may contain at most 200 history records.");
  for (const [index, candidate] of snapshot.decks.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`Deck ${index + 1} is invalid.`);
    const deck = candidate as Record<string, unknown>;
    if (typeof deck.id !== "string" || !deck.id || typeof deck.name !== "string" || !deck.name.trim()) throw new Error(`Deck ${index + 1} has no valid identity.`);
    if (!Array.isArray(deck.bakuganIds) || deck.bakuganIds.length > 3 || !deck.bakuganIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid Bakugan Team.`);
    if (!Array.isArray(deck.coreIds) || deck.coreIds.length > 6 || !deck.coreIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid BakuCore kit.`);
    if (!Array.isArray(deck.cardIds) || deck.cardIds.length > 40 || !deck.cardIds.every((id) => typeof id === "string")) throw new Error(`Deck ${index + 1} has an invalid Main Deck.`);
    if (!["Draft", "Private", "Public"].includes(String(deck.visibility))) throw new Error(`Deck ${index + 1} has an invalid visibility.`);
    const validation = validateDeck(deck as unknown as DeckRecord);
    if (deck.visibility === "Public" && !validation.isLegal) {
      const firstIssue = validation.issues[0];
      throw new Error(`Public deck ${index + 1} [${firstIssue.code}]: ${firstIssue.message}`);
    }
  }
  for (const [index, candidate] of snapshot.history.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`History record ${index + 1} is invalid.`);
    const record = candidate as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) throw new Error(`History record ${index + 1} has an invalid ID or timestamp.`);
    if (!Array.isArray(record.log) || record.log.length > 10_000) throw new Error(`History record ${index + 1} has an invalid event log.`);
  }
}
