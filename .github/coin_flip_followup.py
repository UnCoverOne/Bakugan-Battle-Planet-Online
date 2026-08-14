from pathlib import Path

path = Path("tests/reported-gameplay-regressions-2026-08.test.ts")
text = path.read_text()
old_import = 'import { activeTappedEnergyIds } from "../lib/rules/costs";\nimport { compileCardEffect } from "../lib/rules/effects";\nimport { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";'
new_import = 'import { activeTappedEnergyIds } from "../lib/rules/costs";\nimport { conditionFor } from "../lib/rules/catalogue-primitives";\nimport { compileCardEffect } from "../lib/rules/effects";\nimport { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";'
if old_import not in text:
    raise SystemExit("coin flip test import anchor not found")
text = text.replace(old_import, new_import, 1)
old = '''  const tailsCard = { ...lostAtSea, effect: "Flip a coin. If tails, draw a card." };\n  const tailsProgram = compileCardEffect(tailsCard);\n  assert.deepEqual(tailsProgram.instructions[1].condition, { kind: "coin-result", result: "tails" });'''
new = '''  assert.deepEqual(\n    conditionFor("If tails, draw a card."),\n    { kind: "coin-result", result: "tails" },\n  );'''
if old not in text:
    raise SystemExit("coin flip tails regression anchor not found")
path.write_text(text.replace(old, new, 1))
