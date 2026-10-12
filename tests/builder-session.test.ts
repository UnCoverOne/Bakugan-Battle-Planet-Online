import assert from "node:assert/strict";
import { test } from "node:test";
import { activeBuilder, builderBase, builderNavigationHref, builderScope, clearBuilderDraft, readBuilderDraft, setActiveBuilder, subscribeBuilder, shouldConfirmBuilderExit, writeBuilderDraft, type BuilderDraft } from "../lib/builder-session";
import type { DeckRecord } from "../lib/data";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
} });
const deck: DeckRecord = { id: "one", name: "Draft", updatedAt: "2026-10-12", visibility: "Draft", factions: [], bakuganIds: [], coreIds: [], cardIds: ["card-a", "card-a"] };
const draft: BuilderDraft = { version: 1, routeId: "one", deck, base: builderBase(deck), ui: { galleryQuery: "dragonoid", saveName: "Unfinished name", builderView: "deck" } };

test("drafts preserve quantities, metadata and UI independently for each deck and account", () => {
  const scope = builderScope("alice");
  assert.equal(writeBuilderDraft(scope, draft), true);
  assert.deepEqual(readBuilderDraft(scope, "one"), draft);
  assert.equal(readBuilderDraft(builderScope("bob"), "one"), null);
  assert.equal(readBuilderDraft(builderScope(), "one"), null);
  assert.equal(readBuilderDraft(scope, "two"), null);
  const other = { ...draft, routeId: "two", deck: { ...deck, id: "two", cardIds: [] } };
  writeBuilderDraft(scope, other);
  assert.deepEqual(readBuilderDraft(scope, "one")?.deck.cardIds, ["card-a", "card-a"]);
  assert.deepEqual(readBuilderDraft(scope, "two"), other);
});

test("explicit exit clears only resume destination; successful save clears the draft", () => {
  const scope = "exit-test";
  writeBuilderDraft(scope, draft);
  let notifications = 0;
  const unsubscribe = subscribeBuilder(() => notifications++);
  setActiveBuilder(scope, "one");
  assert.equal(builderNavigationHref(activeBuilder(scope), [deck]), "/builder/one");
  setActiveBuilder(scope, null);
  assert.equal(builderNavigationHref(activeBuilder(scope), [deck]), "/decks");
  assert.deepEqual(readBuilderDraft(scope, "one"), draft);
  setActiveBuilder(scope, "one");
  clearBuilderDraft(scope, "one");
  assert.equal(readBuilderDraft(scope, "one"), null);
  assert.equal(activeBuilder(scope), null);
  assert.equal(notifications, 4);
  unsubscribe();
});

test("deleted decks and administrator sessions cannot hijack Decks navigation", () => {
  assert.equal(builderNavigationHref("one", []), "/decks");
  assert.equal(builderNavigationHref("admin-public:one", [deck]), "/decks");
  assert.equal(builderNavigationHref("new", []), "/builder/new");
  assert.equal(builderNavigationHref("a/b", [{ ...deck, id: "a/b" }]), "/builder/a%2Fb");
  assert.notEqual(builderBase(deck), builderBase({ ...deck, cardIds: ["card-b"] }));
});

test("fresh browser state restores persisted drafts and rejects corrupt records", () => {
  const key = "bbp-builder-session-v1:fresh:draft:one";
  values.set(key, JSON.stringify(draft));
  assert.deepEqual(readBuilderDraft("fresh", "one"), draft);
  values.set("bbp-builder-session-v1:broken:draft:one", JSON.stringify({ ...draft, deck: { ...deck, cardIds: "bad" } }));
  assert.equal(readBuilderDraft("broken", "one"), null);
  values.set("bbp-builder-session-v1:broken-json:draft:one", "{");
  assert.equal(readBuilderDraft("broken-json", "one"), null);
});

test("storage failure retains same-tab progress and reports failure", () => {
  const original = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("Quota exceeded"); };
  try {
    assert.equal(writeBuilderDraft("quota", draft), false);
    assert.deepEqual(readBuilderDraft("quota", "one"), draft);
    setActiveBuilder("quota", "one");
    assert.equal(activeBuilder("quota"), "one");
  } finally { localStorage.setItem = original; }
});

test("exit confirmation distinguishes saved decks, empty drafts and unfinished changes", () => {
  assert.equal(shouldConfirmBuilderExit(deck, { ...deck }), false);
  assert.equal(shouldConfirmBuilderExit(deck), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, cardIds: [] }), false);
  assert.equal(shouldConfirmBuilderExit({ ...deck, cardIds: [], coreIds: ["core"] }), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, cardIds: [], bakuganIds: ["bakugan"] }), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, name: "Edited name" }, deck), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, description: "Edited description" }, deck), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, format: "singleton" }, deck), true);
  assert.equal(shouldConfirmBuilderExit({ ...deck, cardIds: ["different"] }, deck), true);
});
