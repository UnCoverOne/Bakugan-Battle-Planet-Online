import type { DeckRecord } from "./data";

export type BuilderDraft = {
  version: 1;
  routeId: string;
  deck: DeckRecord;
  base: string;
  ui: Record<string, unknown>;
};
const listeners = new Set<() => void>();
const memory = new Map<string, BuilderDraft>();
const active = new Map<string, string | null>();
const prefix = "bbp-builder-session-v1:";
export const builderScope = (userId?: string) => userId ? `account:${userId}` : "guest";
const draftKey = (scope: string, id: string) => `${prefix}${encodeURIComponent(scope)}:draft:${encodeURIComponent(id)}`;
const activeKey = (scope: string) => `${prefix}${encodeURIComponent(scope)}:active`;
export const builderBase = (deck?: DeckRecord) => deck ? JSON.stringify({
  id: deck.id, name: deck.name, description: deck.description, visibility: deck.visibility,
  format: deck.format, revision: deck.revision, updatedAt: deck.updatedAt,
  bakuganIds: deck.bakuganIds, coreIds: deck.coreIds, cardIds: deck.cardIds,
  leadCardId: deck.leadCardId, notes: deck.notes, tags: deck.tags,
}) : "";

export function shouldConfirmBuilderExit(deck: DeckRecord, saved?: DeckRecord) {
  const nonEmpty = deck.cardIds.length > 0 || deck.bakuganIds.length > 0 || deck.coreIds.length > 0;
  return nonEmpty && builderBase(deck) !== builderBase(saved);
}

export function readBuilderDraft(scope: string, id: string): BuilderDraft | null {
  const key = draftKey(scope, id);
  if (memory.has(key)) return memory.get(key)!;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    const deck = value?.deck;
    if (value?.version !== 1 || value.routeId !== id || typeof value.base !== "string"
      || !value.ui || typeof value.ui !== "object" || !deck || typeof deck.id !== "string"
      || typeof deck.name !== "string" || !deck.id
      || (deck.tags !== undefined && (!Array.isArray(deck.tags) || !deck.tags.every((tag: unknown) => typeof tag === "string")))
      || typeof deck.updatedAt !== "string"
      || !["Draft", "Private", "Public"].includes(deck.visibility)
      || !["factions", "bakuganIds", "coreIds", "cardIds"].every(field =>
        Array.isArray(deck[field]) && deck[field].every((item: unknown) => typeof item === "string"))) return null;
    memory.set(key, value);
    return value;
  } catch { return null; }
}

// The editor coalesces writes and flushes on unmount/pagehide. Memory is retained
// immediately so local navigation is recoverable even when storage is unavailable.
export function writeBuilderDraft(scope: string, draft: BuilderDraft): boolean {
  const key = draftKey(scope, draft.routeId);
  memory.set(key, draft);
  try { localStorage.setItem(key, JSON.stringify(draft)); return true; }
  catch { return false; }
}

export function setActiveBuilder(scope: string, id: string | null) {
  active.set(scope, id);
  try {
    if (id) localStorage.setItem(activeKey(scope), id);
    else localStorage.removeItem(activeKey(scope));
  } catch { /* Keep same-tab resume available. */ }
  listeners.forEach(listener => listener());
}
export function activeBuilder(scope: string): string | null {
  if (active.has(scope)) return active.get(scope)!;
  try { return localStorage.getItem(activeKey(scope)); } catch { return null; }
}
export function clearBuilderDraft(scope: string, id: string) {
  memory.delete(draftKey(scope, id));
  try { localStorage.removeItem(draftKey(scope, id)); } catch { /* Best effort. */ }
  if (activeBuilder(scope) === id) setActiveBuilder(scope, null);
}
export function subscribeBuilder(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function builderNavigationHref(id: string | null, decks: readonly DeckRecord[]) {
  if (!id || id.startsWith("admin-") || (id !== "new" && !decks.some(deck => deck.id === id))) return "/decks";
  return `/builder/${encodeURIComponent(id)}`;
}
