from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if new in text and old not in text:
        return
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {text.count(old)}")
    file.write_text(text.replace(old, new, 1))


def replace_between(path: str, start_marker: str, end_marker: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    if replacement in text:
        return
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"Missing start marker in {path}: {start_marker}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"Missing end marker in {path}: {end_marker}")
    file.write_text(text[:start] + replacement + text[end:])


replace_once(
    "lib/rules/model.ts",
    '  | { kind: "energize"; amount: number; source: "hand" | "deck" | "hero" | "self" }',
    '  | { kind: "energize"; amount: number; source: "hand" | "deck" | "hero" | "self"; enters: "charged" | "uncharged" }',
)

replace_between(
    "lib/rules/catalogue-primitives.ts",
    "  const energize = text.match(",
    "\n\n  const generatedEnergy",
    '''  const energizeEntryState = /\\buncharged\\b/i.test(text) ? "uncharged" as const : "charged" as const;
  const energize = text.match(/energize (?:the top )?(a|an|one|two|three|\\d+)?\\s*cards?/i);
  if (energize) actions.push({
    kind: "energize",
    amount: numberValue(energize[1]),
    source: /top/i.test(energize[0]) ? "deck" : "hand",
    enters: energizeEntryState,
  });
  if (/Energize (?:it|that Hero)/i.test(text)) actions.push({
    kind: "energize",
    amount: 1,
    source: "hero",
    enters: energizeEntryState,
  });
  if (/Energize this(?: uncharged|\\b)/i.test(text)) actions.push({
    kind: "energize",
    amount: 1,
    source: "self",
    enters: energizeEntryState,
  });''',
)

structure = Path("lib/rules/catalogue-structure.ts")
structure_text = structure.read_text()
structure_marker = "  const energizeFromHand = text.match("
if structure_marker not in structure_text:
    anchor = '  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));'
    if anchor not in structure_text:
        raise SystemExit("Missing catalogue-structure hand-choice insertion anchor")
    block = '''  const energizeFromHand = text.match(/\\benergize\\s+(?:(a|an|one|two|three|\\d+)\\s+)?cards?\\s+(?:in|from)\\s+your\\s+hand\\b/i);
  if (energizeFromHand) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };
    const printed = energizeFromHand[1]?.toLowerCase();
    const amount = printed ? words[printed] ?? Math.max(1, Number(printed) || 1) : 1;
    const selected = choice(
      "handCardIds",
      "resolve",
      "hand-card",
      `Choose ${amount === 1 ? "a card" : `${amount} cards`} to Energize`,
      false,
      "controller",
      "private",
    );
    selected.minimum = amount;
    selected.maximum = amount;
    result.push(selected);
  }
'''
    structure.write_text(structure_text.replace(anchor, block + anchor, 1))

replace_once(
    "lib/game.ts",
    'import { cardCostBreakdown } from "./rules/costs";',
    'import { activeTappedEnergyIds, cardCostBreakdown } from "./rules/costs";',
)

game = Path("lib/game.ts")
game_text = game.read_text()
helper_marker = "type EffectEnergyPlayer = PlayerState"
if helper_marker not in game_text:
    anchor = "const instructionChoices = (pending: PendingEffect, instructionIndex: number) => Object.entries(pending.resolvedChoices ?? {})"
    if anchor not in game_text:
        raise SystemExit("Missing game Energize helper insertion anchor")
    helper = '''type EffectEnergyPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };

function applyEnergizedEntryState(
  state: MatchState,
  player: PlayerState,
  cards: readonly GameCard[],
  enters: "charged" | "uncharged",
) {
  if (!cards.length) return;
  const tracked = player as EffectEnergyPlayer;
  const newIds = new Set(cards.map((card) => card.id));
  if (tracked.energyTapTurn !== state.turn) {
    tracked.energyTapTurn = state.turn;
    const existing = player.energyZone.filter((card) => !newIds.has(card.id));
    const legacyGenerated = Math.min(Math.max(0, Math.floor(player.energy)), existing.length);
    tracked.tappedEnergyIds = existing.slice(0, legacyGenerated).map((card) => card.id);
    player.energy = legacyGenerated;
  } else {
    tracked.tappedEnergyIds = activeTappedEnergyIds(tracked, state.turn);
  }
  const uncharged = new Set(tracked.tappedEnergyIds ?? []);
  for (const card of cards) {
    if (enters === "uncharged") uncharged.add(card.id);
    else uncharged.delete(card.id);
  }
  tracked.tappedEnergyIds = [...uncharged];
  player.maxEnergy = player.energyZone.length;
}

'''
    game.write_text(game_text.replace(anchor, helper + anchor, 1))

replace_between(
    "lib/game.ts",
    '    case "energize":',
    '    case "generate-energy":',
    '''    case "energize": {
      if (choices.confirmed === false) return;
      if (action.source === "hand") {
        const selectedIds = choices.handCardIds?.slice(0, action.amount) ?? [];
        if (selectedIds.length !== action.amount || new Set(selectedIds).size !== action.amount) return;
        const selected = new Set(selectedIds);
        const energized = player.hand.filter((candidate) => selected.has(candidate.id));
        if (energized.length !== action.amount) return;
        player.hand = player.hand.filter((candidate) => !selected.has(candidate.id));
        player.energyZone.push(...energized);
        applyEnergizedEntryState(state, player, energized, action.enters);
      } else if (action.source === "deck") {
        const energized: GameCard[] = [];
        for (let index = 0; index < action.amount; index += 1) {
          const energyCard = player.deckCards.shift();
          if (energyCard) energized.push(energyCard);
        }
        player.energyZone.push(...energized);
        applyEnergizedEntryState(state, player, energized, action.enters);
        syncDeck(player);
      } else if (action.source === "hero") {
        for (const owner of state.players) {
          const index = owner.heroes.findIndex((hero) => hero.id === choices.targetHeroId);
          if (index >= 0) {
            const energized = owner.heroes.splice(index, 1);
            owner.energyZone.push(...energized);
            applyEnergizedEntryState(state, owner, energized, action.enters);
            break;
          }
        }
      } else if (action.source === "self" && !player.energyZone.some((candidate) => candidate.id === card.id)) {
        for (const owner of state.players) owner.heroes = owner.heroes.filter((candidate) => candidate.id !== card.id);
        player.discard = player.discard.filter((candidate) => candidate.id !== card.id);
        player.energyZone.push(card);
        applyEnergizedEntryState(state, player, [card], action.enters);
      }
      return;
    }
''',
)

test_file = Path("tests/reported-gameplay-regressions-2026-08.test.ts")
test_text = test_file.read_text()
if "  resolveStructuredEffect," not in test_text:
    old = '''  passPriority,
  playCard,
  type Core,'''
    new = '''  passPriority,
  playCard,
  resolveStructuredEffect,
  submitCardChoice,
  type Core,'''
    if old not in test_text:
        raise SystemExit("Missing game import anchor in reported regressions")
    test_text = test_text.replace(old, new, 1)
if 'import { activeTappedEnergyIds } from "../lib/rules/costs";' not in test_text:
    old = '''import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";'''
    new = '''import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { activeTappedEnergyIds } from "../lib/rules/costs";
import { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";
import { createRuleObject } from "../lib/rules/objects";'''
    if old not in test_text:
        raise SystemExit("Missing rules import anchor in reported regressions")
    test_text = test_text.replace(old, new, 1)

marker = 'test("typed Energize actions preserve charged and uncharged entry state"'
if marker not in test_text:
    test_text += r'''

test("typed Energize actions preserve charged and uncharged entry state", () => {
  const trox = card("bb-373", "entry-state-trox");
  const troxAction = ruleDefinitionForCard(trox).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(troxAction && troxAction.kind === "energize");
  assert.equal(troxAction.source, "hand");
  assert.equal(troxAction.enters, "uncharged");

  const chargedCard = CARDS.find((candidate) => (
    /energize the top two cards of their deck/i.test(candidate.effect)
    && !/uncharged/i.test(candidate.effect)
  ));
  assert.ok(chargedCard);
  const chargedAction = ruleDefinitionForCard(chargedCard).abilities
    .flatMap((ability) => ability.instructions)
    .flatMap((instruction) => instruction.effects)
    .find((action) => action.kind === "energize");
  assert.ok(chargedAction && chargedAction.kind === "energize");
  assert.equal(chargedAction.source, "deck");
  assert.equal(chargedAction.enters, "charged");
});

test("Ventus Trox Ultra energizes the selected hand card uncharged", () => {
  const player = makePlayer("trox-player", "Trox Player", STARTER_DECKS[0]);
  const opponent = makePlayer("trox-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("TROXENERGY", "bo1", [player, opponent]);
  state.turn = 4;
  state.phase = "victor";
  state.stepLabel = "Brawl Phase • Victor Step";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const trox = card("bb-373", "runtime-trox");
  const existing = card("bb-10", "existing-charged-energy");
  const fodder = card("bb-17", "selected-hand-energy");
  live.hand = [fodder];
  live.energyZone = [existing];
  live.maxEnergy = 1;
  live.energy = 0;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).energyTapTurn = state.turn;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).tappedEnergyIds = [];
  live.bakugan[0].character = trox;
  live.bakugan[0].open = true;
  state.selected[live.id] = live.bakugan[0].id;

  const ability = ruleDefinitionForCard(trox).abilities.find((candidate) => (
    candidate.trigger?.event === "VICTOR_DECLARED"
  ));
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: live.id,
    card: trox,
    ability,
    kind: "trigger",
    sourceId: trox.id,
    choices: { sourceBakuganId: live.bakugan[0].id },
  });

  let resolving = resolveStructuredEffect(state, pending);
  assert.ok(resolving.pendingChoice);
  assert.ok(resolving.pendingChoice.schema.fields.some((field) => field.id === "confirmed"));
  assert.ok(resolving.pendingChoice.schema.fields.some((field) => field.id === "handCardIds"));
  resolving = submitCardChoice(resolving, live.id, {
    confirmed: true,
    handCardIds: [fodder.id],
  });

  const after = resolving.players.find((candidate) => candidate.id === live.id)!;
  assert.equal(after.hand.some((candidate) => candidate.id === fodder.id), false);
  assert.equal(after.energyZone.some((candidate) => candidate.id === fodder.id), true);
  assert.equal(after.maxEnergy, 2);
  assert.deepEqual(activeTappedEnergyIds(after, resolving.turn), [fodder.id]);
  assert.equal(activeTappedEnergyIds(after, resolving.turn).includes(existing.id), false);
});

test("unqualified Energize effects add Energy cards charged", () => {
  const player = makePlayer("charged-player", "Charged Player", STARTER_DECKS[0]);
  const opponent = makePlayer("charged-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("CHARGEDENERGY", "bo1", [player, opponent]);
  state.turn = 3;
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const live = state.players.find((candidate) => candidate.id === player.id)!;
  const source = CARDS.find((candidate) => (
    /energize the top two cards of their deck/i.test(candidate.effect)
    && !/uncharged/i.test(candidate.effect)
  ));
  assert.ok(source);
  const sourceCard = { ...source, id: "charged-energize-source" };
  const oldEnergy = card("bb-10", "already-uncharged-energy");
  const first = card("bb-17", "new-charged-energy-one");
  const second = card("bb-18", "new-charged-energy-two");
  live.energyZone = [oldEnergy];
  live.maxEnergy = 1;
  live.energy = 0;
  live.deckCards = [first, second];
  live.deck = 2;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).energyTapTurn = state.turn;
  (live as typeof live & { energyTapTurn?: number; tappedEnergyIds?: string[] }).tappedEnergyIds = [oldEnergy.id];

  const ability = ruleDefinitionForCard(sourceCard).abilities.find((candidate) => candidate.kind !== "triggered");
  assert.ok(ability);
  const pending = createRuleObject({
    controllerId: live.id,
    card: sourceCard,
    ability,
    kind: "card",
  });
  let resolving = resolveStructuredEffect(state, pending);
  assert.ok(resolving.pendingChoice);
  resolving = submitCardChoice(resolving, live.id, { confirmed: true });

  const after = resolving.players.find((candidate) => candidate.id === live.id)!;
  assert.deepEqual(after.energyZone.map((candidate) => candidate.id), [oldEnergy.id, first.id, second.id]);
  assert.deepEqual(activeTappedEnergyIds(after, resolving.turn), [oldEnergy.id]);
  assert.equal(after.maxEnergy, 3);
  assert.equal(after.deck, 0);
});
'''

test_file.write_text(test_text)
