import assert from "node:assert/strict";
import test from "node:test";

test("loading the rules catalogue does not eagerly compile all 1,734 cards", async () => {
  const { CARDS } = await import("../lib/data");
  const originalMap = CARDS.map;
  // The old module evaluated CARDS.map(definitionForCard) at import time.
  // In this isolated test module, fail if it ever happens again.
  CARDS.map = () => {
    throw new Error("Rules catalogue eagerly enumerated cards during import");
  };
  try {
    await import("../lib/rules/catalogue");
  } finally {
    CARDS.map = originalMap;
  }
});

test("requested rule definitions are cached and full catalogue order is preserved", async () => {
  const { CARDS } = await import("../lib/data");
  const { allRuleDefinitions, ruleDefinitionForCard } = await import("../lib/rules/catalogue");
  const first = ruleDefinitionForCard(CARDS[0]);
  const last = ruleDefinitionForCard(CARDS[CARDS.length - 1]);
  assert.strictEqual(ruleDefinitionForCard(CARDS[0]), first);
  assert.strictEqual(ruleDefinitionForCard({ ...CARDS[0], id: "instance-id" }), first);
  assert.notStrictEqual(last, first);

  const definitions = allRuleDefinitions();
  assert.equal(definitions.length, CARDS.length);
  assert.equal(new Set(definitions.map((definition) => definition.cardId)).size, CARDS.length);
  assert.ok(Object.isFrozen(definitions));
  assert.strictEqual(definitions[0], first);
  assert.strictEqual(definitions[definitions.length - 1], last);
  assert.strictEqual(allRuleDefinitions(), definitions);
});

test("lazy rule lookup rejects unknown identities and modified printed text", async () => {
  const { CARDS } = await import("../lib/data");
  const { ruleDefinitionForCard, UnsupportedCardTextError } = await import("../lib/rules/catalogue");
  const card = CARDS[0];
  const canonical = ruleDefinitionForCard(card);
  assert.throws(
    () => ruleDefinitionForCard({ ...card, catalogId: "unknown-printing" }),
    (error: unknown) => error instanceof UnsupportedCardTextError && error.code === "UNKNOWN_CARD_DEFINITION",
  );
  assert.throws(
    () => ruleDefinitionForCard({ ...card, effect: card.effect + " Modified." }),
    (error: unknown) => error instanceof UnsupportedCardTextError && error.code === "CARD_TEXT_MISMATCH",
  );
  assert.strictEqual(ruleDefinitionForCard(card), canonical);
});
