from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def edit(path, replacements):
    p = ROOT / path
    text = p.read_text()
    for old, new, label in replacements:
        count = text.count(old)
        if count != 1:
            raise RuntimeError(f"{path} {label}: expected one match, found {count}")
        text = text.replace(old, new, 1)
    p.write_text(text)


edit("lib/rules/model.ts", [
    (
'''  factions?: Faction[];
  /** Preferred ownership primitive for the zone/object pool being selected. */''',
'''  factions?: Faction[];
  /** Exact printed card identity requested by an effect-originated play. */
  cardName?: string;
  /** Preferred ownership primitive for the zone/object pool being selected. */''',
        "choice card name",
    ),
    (
'''  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean; cardType?: CardType; maximumCost?: number; sourceOwner?: ZoneOwner; destinationOwner?: ZoneOwner }''',
'''  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean; cardType?: CardType; factions?: Faction[]; cardName?: string; maximumCost?: number; sourceOwner?: ZoneOwner; destinationOwner?: ZoneOwner }''',
        "play action filters",
    ),
])

edit("lib/rules/choices.ts", [
    (
'''  if (spec.factions?.length && !candidate.factions.some((faction) => spec.factions!.includes(faction))) return false;
  const printedCost = candidate.cost === "X" ? Number.POSITIVE_INFINITY : candidate.cost;''',
'''  if (spec.factions?.length && !candidate.factions.some((faction) => spec.factions!.includes(faction))) return false;
  if (spec.cardName) {
    const normalize = (value: string) => value
      .replace(/[\\[\\]]/g, "")
      .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\\s+/i, "")
      .replace(/\\s+/g, " ")
      .trim()
      .toLowerCase();
    const wanted = normalize(spec.cardName);
    if (![candidate.displayName, candidate.name].some((value) => normalize(value) === wanted)) return false;
  }
  const printedCost = candidate.cost === "X" ? Number.POSITIVE_INFINITY : candidate.cost;''',
        "choice exact card filter",
    ),
])

edit("lib/rules/catalogue-primitives.ts", [
    (
'''  const persistentFreePermission = /for the rest of the turn,\\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission) actions.push({''',
'''  const persistentFreePermission = /for the rest of the turn,\\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeFactionPlay = text.match(/play\\s+an?\\s+\\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\\]\\s+card(?:\\s+(?:with cost|that costs?)\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?\\s+for free/i);
  if (freeFactionPlay) actions.push({
    kind: "play",
    source: "hand",
    free: true,
    factions: [freeFactionPlay[1] as Faction],
    maximumCost: freeFactionPlay[2] ? Number(freeFactionPlay[2]) : undefined,
    sourceOwner: "controller",
  });
  const namedFreePlay = !freeFactionPlay
    ? text.match(/play\\s+\\[([A-Za-z]+)\\]\\s+([A-Za-z][A-Za-z0-9'’ -]*?)\\s+for free/i)
    : null;
  if (namedFreePlay) actions.push({
    kind: "play",
    source: "hand",
    free: true,
    cardName: `${namedFreePlay[1]} ${namedFreePlay[2].trim()}`,
    sourceOwner: "controller",
  });
  const chosenCardFreePlay = /play that card for free/i.test(text);
  if (chosenCardFreePlay) actions.push({ kind: "play", source: "hand", free: true, sourceOwner: "controller" });
  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission && !freeFactionPlay && !namedFreePlay && !chosenCardFreePlay) actions.push({''',
        "generalize faction named and chosen-card free plays",
    ),
])

structure_path = ROOT / "lib/rules/catalogue-structure.ts"
structure = structure_path.read_text()
structure = structure.replace(
'''  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission) {
    const selected = choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private");''',
'''  const freeFactionPlay = text.match(/play\\s+an?\\s+\\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\\]\\s+card(?:\\s+(?:with cost|that costs?)\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?\\s+for free/i);
  if (freeFactionPlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose a card to play", false, "controller", "private");
    selected.factions = [freeFactionPlay[1] as GameCard["faction"]];
    if (freeFactionPlay[2]) selected.maximumCost = Number(freeFactionPlay[2]);
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }
  const namedFreePlay = !freeFactionPlay
    ? text.match(/play\\s+\\[([A-Za-z]+)\\]\\s+([A-Za-z][A-Za-z0-9'’ -]*?)\\s+for free/i)
    : null;
  if (namedFreePlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose the named card to play", false, "controller", "private");
    selected.cardName = `${namedFreePlay[1]} ${namedFreePlay[2].trim()}`;
    selected.owner = "controller";
    selected.targetOwner = selected.owner;
    selected.playForFree = true;
    result.push(selected);
  }
  const chosenOpponentAction = /look at your opponent(?:'s|’s) hand and choose an Action card/i.test(text);
  if (chosenOpponentAction) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose an Action card from your opponent's hand", false, "controller", "private");
    selected.cardType = "Action";
    selected.owner = "opponent";
    selected.targetOwner = selected.owner;
    result.push(selected);
  }
  const freeHandPlay = text.match(/play\\s+(?:an?|the)?\\s*(Action|Hero|Evo|card)(?:\\s+card)?(?:\\s+that costs?\\s+(\\d+)\\s+\\[Energy\\]\\s+or less)?(?:\\s+from\\s+(?:your\\s+)?hand|\\s+from\\s+it)?\\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission && !freeFactionPlay && !namedFreePlay) {
    const selected = choice("handCardIds", "resolve", "hand-card", "Choose a card to play", false, "controller", "private");''',
1,
)
if structure.count('const freeFactionPlay = text.match') != 1:
    raise RuntimeError("catalogue-structure free choice replacement failed")
structure = structure.replace(
'''  if (/\\bmay\\b/i.test(text) && !/may discard|may recharge up to/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));''',
'''  if ((/\\bmay\\b/i.test(text) || /\\byou can play\\b/i.test(text))
    && !persistentFreePermission
    && !/may discard|may recharge up to/i.test(text)) {
    result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));
  }''',
1,
)
# Propagate the source-zone owner for a chosen card referenced by a later sentence.
needle = '''  // A sentence-ending "instead" clause replaces the immediately preceding
  // effect. Detect that grammar directly so every set receives the same rules
'''
insert = '''  // A later “play that card” clause reuses a selection made in the previous
  // sentence. Carry the selected hidden-zone owner forward without encoding a
  // printing ID in the executor.
  for (let index = 1; index < instructions.length; index += 1) {
    const current = instructions[index];
    if (!/play that card for free/i.test(current.sourceText)) continue;
    const selected = instructions[index - 1].choices.find((candidate) => candidate.id === "handCardIds");
    if (!selected) continue;
    current.effects = current.effects.map((effect) => (
      effect.kind === "play" ? { ...effect, sourceOwner: selected.owner ?? selected.targetOwner ?? "controller" } : effect
    ));
    current.actions = current.effects;
  }

'''
if needle not in structure:
    raise RuntimeError("catalogue-structure propagation insertion point missing")
structure = structure.replace(needle, insert + needle, 1)
structure_path.write_text(structure)

# Shared runtime enforces every compiled card filter before the child transaction begins.
edit("lib/game.ts", [
    (
'''      if (!selected || (action.cardType && selected.type !== action.cardType)) return;
      const printedCost = selected.cost === "X" ? Number.POSITIVE_INFINITY : selected.cost;''',
'''      if (!selected || (action.cardType && selected.type !== action.cardType)) return;
      if (action.factions?.length && !selected.factions.some((faction) => action.factions!.includes(faction))) return;
      if (action.cardName) {
        const normalize = (value: string) => value
          .replace(/[\\[\\]]/g, "")
          .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\\s+/i, "")
          .replace(/\\s+/g, " ")
          .trim()
          .toLowerCase();
        const wanted = normalize(action.cardName);
        if (![selected.displayName, selected.name].some((value) => normalize(value) === wanted)) return;
      }
      const printedCost = selected.cost === "X" ? Number.POSITIVE_INFINITY : selected.cost;''',
        "enforce free-play card filters",
    ),
])

# Update focused expectations and add explicit coverage for faction/named/chosen-card forms.
test_path = ROOT / "tests/card-play-pipeline.test.ts"
test = test_path.read_text()
test = test.replace(
'  assert.match(sacrifice?.description ?? "", /3 Energy.*only 2/i);',
'  assert.match(sacrifice?.description ?? "", /Not enough Energy.*3 required.*2 available/i);',
1,
)
test += r'''

test("faction-qualified free plays retain faction and cost restrictions", () => {
  for (const [id, expectedMaximum] of [["bb-222", 4], ["bb-226", undefined]] as const) {
    const source = card(id, `${id}-free-model`);
    const play = compileCardEffect(source).instructions
      .flatMap((instruction) => instruction.effects)
      .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
    assert.ok(play, `${id} should compile a free play`);
    assert.deepEqual(play.factions, ["Aquos"]);
    assert.equal(play.maximumCost, expectedMaximum);
    const choice = ruleDefinitionForCard(source).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.choices)
      .find((candidate) => candidate.id === "handCardIds");
    assert.deepEqual(choice?.factions, ["Aquos"]);
    assert.equal(choice?.maximumCost, expectedMaximum);
    assert.equal(choice?.playForFree, true);
  }
});

test("named Underdog free plays compile to an exact-card shared play request", () => {
  for (const id of ["aa-91", "aa-167", "aa-171", "aa-178", "aa-197", "aa-201"] as const) {
    const source = card(id, `${id}-named-free`);
    const play = compileCardEffect(source).instructions
      .flatMap((instruction) => instruction.effects)
      .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
    assert.ok(play?.cardName, `${id} should retain the named card identity`);
    const choice = ruleDefinitionForCard(source).abilities
      .flatMap((ability) => ability.instructions)
      .flatMap((instruction) => instruction.choices)
      .find((candidate) => candidate.id === "handCardIds");
    assert.equal(choice?.cardName, play.cardName);
    assert.equal(choice?.playForFree, true);
  }
});

test("Darkus Titan Hydranoid carries the opponent-owned chosen Action into the shared play request", () => {
  const source = card("aa-118", "hydranoid-chosen-card");
  const definition = ruleDefinitionForCard(source);
  const instructions = definition.abilities.flatMap((ability) => ability.instructions);
  const selection = instructions.flatMap((instruction) => instruction.choices).find((choice) => choice.id === "handCardIds");
  assert.equal(selection?.owner, "opponent");
  assert.equal(selection?.cardType, "Action");
  const play = instructions.flatMap((instruction) => instruction.effects)
    .find((action): action is Extract<RuleAction, { kind: "play" }> => action.kind === "play");
  assert.ok(play);
  assert.equal(play.sourceOwner, "opponent");
  assert.equal(play.free, true);
});
'''
test_path.write_text(test)

print("Full free-play coverage fixes applied.")
