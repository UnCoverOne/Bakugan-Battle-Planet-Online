import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { evaluateNumberValue, type NumberExpression } from "../lib/rules/values";

const countSources = new Set(["hand", "deck", "discard", "energy", "hero", "bakugan", "open-bakugan", "held-bakucore", "cards-played", "factions-played"]);
const unaryKinds = new Set(["floor", "ceil", "absolute", "negate"]);
function isNumberExpression(value: unknown): value is NumberExpression {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  switch (node.kind) {
    case "constant": return typeof node.value === "number";
    case "choice-value": case "choice-count": return typeof node.choiceId === "string";
    case "count": return typeof node.source === "string" && countSources.has(node.source);
    case "property": return Boolean(node.subject) && typeof node.property === "string";
    case "event-value": return node.property === "amount";
    case "sum": return Array.isArray(node.terms);
    case "subtract": return "left" in node && "right" in node;
    case "product": return Array.isArray(node.factors);
    case "divide": return "numerator" in node && "denominator" in node;
    case "minimum": case "maximum": return Array.isArray(node.values);
    case "clamp": return "value" in node;
    case "conditional": return !Array.isArray(node.whenTrue) && !Array.isArray(node.whenFalse) && "whenTrue" in node && "whenFalse" in node;
    case "captured": return typeof node.key === "string" && typeof node.at === "string" && "value" in node;
    default: return typeof node.kind === "string" && unaryKinds.has(node.kind) && "value" in node;
  }
}
function expressionsIn(value: unknown, found: NumberExpression[] = []): NumberExpression[] {
  if (isNumberExpression(value)) found.push(value);
  if (Array.isArray(value)) value.forEach((item) => expressionsIn(item, found));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => expressionsIn(item, found));
  return found;
}

test("every catalogue card compiles through the canonical value system", () => {
  const state = createMatch("VALUE-CATALOGUE", "bo1", [makePlayer("first", "First", STARTER_DECKS[0]), makePlayer("second", "Second", STARTER_DECKS[1])]);
  const player = state.players[0];
  player.cardsPlayedThisTurn = 3;
  player.factionsPlayedThisTurn = ["Aquos", "Pyrus", "Darkus"];
  player.heroes = CARDS.filter((card) => card.type === "Hero").slice(0, 2).map((card, index) => ({ ...card, id: `audit-hero-${index}` }));
  player.discard = CARDS.slice(0, 4).map((card, index) => ({ ...card, id: `audit-discard-${index}` }));
  player.energyZone = CARDS.slice(4, 10).map((card, index) => ({ ...card, id: `audit-energy-${index}` }));
  let cardsWithExpressions = 0;
  let evaluated = 0;
  for (const card of CARDS) {
    const definition = ruleDefinitionForCard(card);
    const serialized = JSON.stringify(definition);
    assert.equal(serialized.includes("amountExpression"), false, `${card.catalogId} still serializes amountExpression`);
    assert.equal(/\"scale\"\s*:/.test(serialized), false, `${card.catalogId} still serializes a numeric scale side channel`);
    const expressions = expressionsIn(definition);
    if (expressions.length) cardsWithExpressions += 1;
    for (const expression of expressions) {
      for (const choices of [{ xValue: 0, discardCardIds: [] }, { xValue: 2, discardCardIds: ["audit-discard-0", "audit-discard-1"] }]) {
        const value = evaluateNumberValue(state, expression, { controllerId: "first", chooserId: "first", choices, sourceCardId: card.id, moment: "resolve", event: { amount: 5 } });
        assert.equal(Number.isFinite(value), true, `${card.catalogId} ${JSON.stringify(expression)} produced ${String(value)}`);
        evaluated += 1;
      }
    }
  }
  assert.equal(new Set(CARDS.map((card) => card.catalogId)).size, CARDS.length, "catalogue IDs must remain unique");
  assert.ok(cardsWithExpressions > 0, "catalogue must exercise generalized numeric expressions");
  assert.ok(evaluated > 0, "catalogue expressions must be evaluated");
});
