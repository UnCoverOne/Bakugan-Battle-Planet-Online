from pathlib import Path

# Applied once by the temporary validation workflow on the feature branch.


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "lib/game.ts",
    '''  if (isRuleObject(pending)) completeRuleObject(pending);
  if (!pending.alternateWin) stageDragonoidMaximusWinEffect(state);''',
    '''  if (isRuleObject(pending)) completeRuleObject(pending);
  // Completion and removal are one transaction. Self-moving effects such as
  // Turn to Energy must never leave a terminal rule object stranded in the
  // batch if a caller resumes through a different continuation path.
  state.batch = state.batch.filter((candidate) => candidate.id !== pending.id);
  if (!pending.alternateWin) stageDragonoidMaximusWinEffect(state);''',
)

replace_once(
    "lib/rules/state.ts",
    '''    } satisfies RuleObject;
  });
  return state;''',
    '''    } satisfies RuleObject;
  }).filter((pending) => !(
    isRuleObject(pending) && pending.status === "resolved"
  ));
  return state;''',
)

replace_once(
    "tests/turn-to-energy-chain.test.ts",
    'import { dispatchRulesCommand } from "../lib/rules/runtime";\n',
    'import { dispatchRulesCommand } from "../lib/rules/runtime";\nimport { isRuleObject, normalizeRuleObjects } from "../lib/rules/state";\n',
)

with Path("tests/turn-to-energy-chain.test.ts").open("a") as file:
    file.write('''

test("normalization removes a completed Turn to Energy object stranded in the batch", () => {
  const { state, playerId, source } = turnToEnergyState();
  const played = dispatchRulesCommand(state, playerId, {
    type: "PLAY_CARD",
    cardId: source.id,
    choices: {},
  });
  const pending = played.batch[0];
  assert.ok(pending && isRuleObject(pending));

  const player = played.players.find((candidate) => candidate.id === playerId)!;
  player.energyZone.push(pending.card);
  player.maxEnergy = player.energyZone.length;
  pending.status = "resolved";
  pending.instructionIndex = 1;
  pending.cursor.instructionIndex = 1;

  normalizeRuleObjects(played);
  assert.equal(played.batch.length, 0);
  assert.equal(player.energyZone.some((card) => card.id === source.id), true);
});
''')

package = Path("package.json")
text = package.read_text()
needle = "tests/profile-customization.test.ts tests/deck-energy-reveal.test.ts tests/presentation-stability.test.ts"
replacement = "tests/profile-customization.test.ts tests/deck-energy-reveal.test.ts tests/turn-to-energy-chain.test.ts tests/presentation-stability.test.ts"
if needle not in text:
    raise SystemExit("Could not locate package test-list insertion point")
package.write_text(text.replace(needle, replacement, 1))
