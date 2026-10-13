import assert from "node:assert/strict";
import { test } from "node:test";
import { createBuilderCardControls } from "../lib/builder-card-selection";
import { deckConstructionIdentity, type DeckRestriction } from "../lib/deck-validation";

const cards = new Map([
  ["a", { catalogId: "a", name: "Original", constructionIdentity: "shared" }],
  ["reprint", { catalogId: "reprint", name: "Reprint", constructionIdentity: "shared" }],
  ["b", { catalogId: "b", name: "Other", constructionIdentity: "other" }],
]);
const controls = (ids: string[], limit: 0 | 1 | 2, format: "competitive" | "standard" | "singleton" = "competitive", ready = true, maximum = 50) =>
  createBuilderCardControls(ids, cards, format, [{ constructionIdentity: "shared", limit }], maximum, ready);

test("competitive bans prevent additions and display a ban label", () => {
  const result = controls([], 0);
  assert.equal(result.canAdd("a"), false);
  assert.equal(result.canAdd("reprint"), false);
  assert.equal(result.canAdd("b"), true);
  assert.equal(result.restrictionLabel("a"), "Banned in Competitive");
});

test("one- and two-copy restrictions count alternate printings together", () => {
  assert.equal(controls([], 1).canAdd("a"), true);
  assert.equal(controls(["a"], 1).canAdd("reprint"), false);
  assert.equal(controls(["reprint"], 2).canAdd("a"), true);
  assert.equal(controls(["reprint", "a"], 2).canAdd("a"), false);
  assert.equal(controls(["reprint", "a", "a"], 2).canAdd("reprint"), false);
  assert.equal(controls([], 1).restrictionLabel("a"), "Competitive: max 1 copy");
  assert.equal(controls([], 2).restrictionLabel("a"), "Competitive: max 2 copies");
});

test("standard and singleton ignore competitive bans but enforce their own identity limits", () => {
  assert.equal(controls([], 0, "standard").canAdd("a"), true);
  assert.equal(controls(["a", "reprint", "a"], 0, "standard").canAdd("reprint"), false);
  assert.equal(controls(["a"], 2, "singleton").canAdd("reprint"), false);
  assert.equal(controls([], 0, "standard").restrictionLabel("a"), undefined);
  assert.equal(controls([], 0, "singleton").restrictionLabel("a"), undefined);
});

test("loading or failed rules block competitive additions; deck capacity and unknown IDs remain protected", () => {
  assert.equal(controls([], 2, "competitive", false).canAdd("b"), false);
  assert.equal(controls([], 0, "standard", false).canAdd("a"), true);
  assert.equal(controls(["b"], 2, "competitive", true, 1).canAdd("a"), false);
  assert.equal(controls([], 2).canAdd("missing"), false);
});

test("unrestricted competitive cards retain the three-copy limit", () => {
  const restrictions: DeckRestriction[] = [];
  const result = createBuilderCardControls(["a", "reprint", "a"], cards, "competitive", restrictions, 50, true);
  assert.equal(result.canAdd("reprint"), false);
  assert.equal(result.canAdd("b"), true);
  assert.equal(result.restrictionLabel("b"), undefined);
});

test("construction identity fallback matches the central validator", () => {
  const card = { catalogId: "fallback", displayName: "Card", effect: "Effect" };
  assert.equal(deckConstructionIdentity(card), "Card|Effect");
  assert.equal(deckConstructionIdentity({ ...card, constructionIdentity: "canonical" }), "canonical");
});
