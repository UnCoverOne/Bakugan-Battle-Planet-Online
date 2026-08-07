from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"Missing patch anchor: {label}")
    return source.replace(old, new, 1)


# Explicit Bakugan targets must remain valid even when the modifier controller is
# the opposing player. Otherwise rules-state card reductions aimed at an enemy
# are silently filtered before ShadowStrike can classify/prevent them.
path = Path("lib/rules/modifiers.ts")
source = path.read_text()
source = replace_once(
    source,
    '''function targetMatches(state: MatchState, modifier: ContinuousModifier, bakugan: Bakugan, player: PlayerState) {
  if (modifier.targetBakuganId && modifier.targetBakuganId !== bakugan.id) return false;
  if (modifier.targetFaction && modifier.targetFaction !== bakugan.faction) return false;
  if (modifier.excludedTargetFaction && modifier.excludedTargetFaction === bakugan.faction) return false;
  if (modifier.target === "all-bakugan") return true;
  if (modifier.controllerId === player.id) return ["active-friendly", "chosen-bakugan", "all-friendly", "self"].includes(modifier.target);
  return ["active-enemy", "all-enemy"].includes(modifier.target);
}
''',
    '''function targetMatches(state: MatchState, modifier: ContinuousModifier, bakugan: Bakugan, player: PlayerState) {
  if (modifier.targetBakuganId) return modifier.targetBakuganId === bakugan.id;
  if (modifier.targetFaction && modifier.targetFaction !== bakugan.faction) return false;
  if (modifier.excludedTargetFaction && modifier.excludedTargetFaction === bakugan.faction) return false;
  if (modifier.target === "all-bakugan") return true;
  if (modifier.controllerId === player.id) return ["active-friendly", "chosen-bakugan", "all-friendly", "self"].includes(modifier.target);
  return ["active-enemy", "all-enemy"].includes(modifier.target);
}
''',
    "explicit modifier target matching",
)
path.write_text(source)


# The catalogue contains both "each other card" (Clone Army) and "every other
# card" (Mind Flood). Recognize both when attaching a scale to a numeric stat.
path = Path("lib/rules/catalogue-primitives.ts")
source = path.read_text()
source = replace_once(
    source,
    '  if (/\\bfor each\\b/i.test(trailingClause)) return scaleFor(trailingClause);',
    '  if (/\\bfor (?:each|every)\\b/i.test(trailingClause)) return scaleFor(trailingClause);',
    "trailing each/every scaling",
)
source = replace_once(
    source,
    '  if (/\\bfor each\\b[^,]*,\\s*$/i.test(leadingClause)) return scaleFor(leadingClause);',
    '  if (/\\bfor (?:each|every)\\b[^,]*,\\s*$/i.test(leadingClause)) return scaleFor(leadingClause);',
    "leading each/every scaling",
)
path.write_text(source)


# Make regression Bakugan intentionally text-blank so the assertions measure
# only the effect under test rather than an arbitrary faction Character's static
# keyword. Also verify ShadowStrike gained after reductions reverts them.
path = Path("tests/rules-shadowstrike-clone-shun.test.ts")
tests = path.read_text()
tests = replace_once(
    tests,
    '  const source = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);',
    '  const source = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction && !candidate.effect.trim())\n    ?? CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);',
    "plain character fixture",
)
tests = replace_once(
    tests,
    '''  let state = matchWith(defender, attacker);
  state.shadowStrike[protectedBakugan.id] = true;

  state = resolveSimpleCard(state, defender.id, attacker.id, positive.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);

  state.priority = attacker.id;
  state = resolveSimpleCard(state, attacker.id, defender.id, negative.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);
  const evaluated = evaluateBakuganCharacteristics(state, state.players[0].bakugan[0], state.players[0]);
''',
    '''  let state = matchWith(defender, attacker);

  state = resolveSimpleCard(state, defender.id, attacker.id, positive.id);
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);

  state.priority = attacker.id;
  state = resolveSimpleCard(state, attacker.id, defender.id, negative.id);
  assert.equal(totalPower(state, defender.id), 600);
  assert.equal(totalDamage(state, defender.id), 9);

  // Gaining ShadowStrike after a reduction must immediately revert only the
  // reductions from cards/BakuCores while retaining unrelated positive buffs.
  state.shadowStrike[protectedBakugan.id] = true;
  assert.equal(totalPower(state, defender.id), 800);
  assert.equal(totalDamage(state, defender.id), 11);
  const evaluated = evaluateBakuganCharacteristics(state, state.players[0].bakugan[0], state.players[0]);
''',
    "ShadowStrike reversion scenario",
)
tests = replace_once(
    tests,
    '''    let state = matchWith(ai, human);
    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
    const currentBakugan = currentAi.bakugan[0];
    const evaluated = evaluateBakuganCharacteristics(state, currentBakugan, currentAi);
    assert.equal(evaluated.frostStrike, otherCards, `expected ${otherCards} FrostStrike after ${otherCards} other cards`);
''',
    '''    let state = matchWith(ai, human);
    const baseline = evaluateBakuganCharacteristics(state, ai.bakugan[0], ai).frostStrike;
    state = resolveSimpleCard(state, ai.id, human.id, cloneArmy.id);
    const currentAi = state.players.find((candidate) => candidate.id === ai.id)!;
    const currentBakugan = currentAi.bakugan[0];
    const evaluated = evaluateBakuganCharacteristics(state, currentBakugan, currentAi);
    assert.equal(evaluated.frostStrike - baseline, otherCards, `expected +${otherCards} FrostStrike after ${otherCards} other cards`);
''',
    "Clone Army baseline delta",
)
path.write_text(tests)
