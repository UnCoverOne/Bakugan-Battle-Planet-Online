import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const productionRulesSources = [
  "../lib/game.ts",
  "../lib/rules/model.ts",
  "../lib/rules/primitives.ts",
  "../lib/rules/catalogue-primitives.ts",
  "../lib/rules/catalogue-structure.ts",
  "../lib/rules/costs.ts",
  "../lib/rules/modifiers.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

test("the rules engine has one canonical dynamic-value representation", () => {
  assert.doesNotMatch(productionRulesSources, /\b(?:AmountExpression|AmountCountSource|AmountEvaluationContext|evaluateAmountExpression|amountExpressionForScale|CostScale|printedScaleMultiplier|scaleStat|statValues)\b/);
  assert.doesNotMatch(productionRulesSources, /\b(?:action|modifier)\.scale\b|\bscale\?:\s*(?:string|CostScale)/);
});
