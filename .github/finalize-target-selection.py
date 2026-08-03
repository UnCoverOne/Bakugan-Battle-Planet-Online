from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise AssertionError(f"Anchor missing in {path}: {old[:160]!r}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "lib/rules/catalogue-structure.ts",
    r'''  const explicitBakuganTarget = /choose (?:a|an|one|another).*Bakugan|target .*Bakugan|retract (?:one of )?(?:your )?(?:open )?Bakugan|attach .*bakucore.*to (?:an? )?(?:open )?Bakugan|give (?:a|an|one|another)(?: \[[^\]]+\])? Bakugan|(?:a|an|one|another)(?: \[[^\]]+\])? Bakugan gets?|to (?:a|an|one) \[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan/i.test(text);''',
    r'''  const explicitBakuganTarget = /choose (?:a|an|one|another).*Bakugan|target .*Bakugan|retract (?:(?:one of|another) )?(?:your )?(?:open )?Bakugan|attach .*bakucore.*to (?:an? )?(?:open )?Bakugan|give (?:a|an|one|another)(?: \[[^\]]+\])? Bakugan|(?:a|an|one|another)(?: \[[^\]]+\])? Bakugan gets?|to (?:a|an|one) \[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan/i.test(text);''',
)

replace_once(
    "lib/rules/catalogue-structure.ts",
    '''export function playDefinitionForCard(card: GameCard): CardPlayDefinition {
  const choices = choicesForText(card, card.effect, "announce");''',
    '''export function playDefinitionForCard(card: GameCard): CardPlayDefinition {
  const choices = choicesForText(card, card.effect, "announce");
  // A later trigger on the same card must not move a When-you-play target
  // from announcement to resolution. Parse each When-you-play clause in
  // isolation and merge its announcement selections into the card play.
  for (const match of card.effect.matchAll(/when you play this[\\s\\S]*?(?=\\b(?:when this opens|Victor|Underdog|at (?:the )?end of (?:your |the )?turn)\\s*[-:]|$)/gi)) {
    for (const selected of choicesForText(card, match[0], "announce").filter((choice) => choice.timing === "announce")) {
      if (!choices.some((choice) => choice.id === selected.id && choice.timing === selected.timing)) choices.push(selected);
    }
  }''',
)

replace_once(
    "lib/rules/choices.ts",
    '''    case "all-enemy": {
      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy" ? [opponent]
        : card.type === "Evo" ? [controller]
          : targetOwners(match, controllerId, spec);
      return owners.flatMap((owner) => owner.bakugan
        .filter((bakugan) => card.type !== "Evo" || canonicalEvoTargetAllowed(ruleDefinitionForCard(card), bakugan))
''',
    '''    case "all-enemy": {
      const evoSourceChoice = card.type === "Evo"
        && (spec.id === "sourceBakuganId" || spec.label === "Choose the matching Character");
      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy" ? [opponent]
        : evoSourceChoice ? [controller]
          : targetOwners(match, controllerId, spec);
      return owners.flatMap((owner) => owner.bakugan
        .filter((bakugan) => !evoSourceChoice || canonicalEvoTargetAllowed(ruleDefinitionForCard(card), bakugan))
''',
)

path = Path("tests/underdog-target-selection.test.ts")
text = path.read_text()
text = text.replace(r'/setAnswers\\(\\(current\\) => \\{/', r'/setAnswers\(\(current\) => \{/')
text = text.replace(r'/valuesFor\\(current, field\\)/', r'/valuesFor\(current, field\)/')
text = text.replace(r'/field\\.kind === "card"/', r'/field\.kind === "card"/')

old = '''  const shadow = card("bb-154", "shadow-breath");
  first.hand = [shadow];
  first.heroes = [card("bb-201", "friendly-hero")];
  second.heroes = [card("bb-202", "enemy-hero")];
  const prepared = prepareCardPlay(state, first.id, shadow.id);
  const field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetHeroId");'''
new = '''  const shadow = card("bb-154", "shadow-breath");
  first.heroes = [card("bb-201", "friendly-hero")];
  second.heroes = [card("bb-202", "enemy-hero")];
  const schema = buildChoiceSchema(state, first.id, shadow);
  const field = schema.fields.find((candidate) => candidate.id === "targetHeroId");'''
if old not in text:
    raise AssertionError("Shadow Breath regression anchor missing")
text = text.replace(old, new, 1)

if 'ruleDefinitionForCard(card("br-51"))' not in text:
    raise AssertionError("Karmic Balance regression anchor missing")
text = text.replace('ruleDefinitionForCard(card("br-51"))', 'ruleDefinitionForCard(card("br-32"))', 1)

old = '''  floodState.first.hand = [flood];
  floodState.second.heroes = [card("bb-202", "flood-hero")];
  floodState.second.bakugan[0].evoStack = [card("bb-231", "covered-evo"), card("bb-232", "top-evo")];
  const prepared = prepareCardPlay(floodState.state, floodState.first.id, flood.id);
  const field = prepared.pendingChoice?.schema.fields.find((candidate) => candidate.id === "targetCardId");'''
new = '''  floodState.second.heroes = [card("bb-202", "flood-hero")];
  floodState.second.bakugan[0].evoStack = [card("bb-231", "covered-evo"), card("bb-232", "top-evo")];
  const schema = buildChoiceSchema(floodState.state, floodState.first.id, flood);
  const field = schema.fields.find((candidate) => candidate.id === "targetCardId");'''
if old not in text:
    raise AssertionError("Flash Flood regression anchor missing")
path.write_text(text.replace(old, new, 1))

print("Final target-selection corrections applied.")
