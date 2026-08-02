import type { GameCard } from "../game";
import type {
  AbilityDefinition,
  CardPlayDefinition,
  ChoiceSpec,
  RuleAction,
  RuleInstruction,
} from "./model";

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

type DeckWindow = {
  mode: "look" | "reveal";
  count: number;
};

type DeckSearch = {
  cardType?: GameCard["type"];
};

type InstructionEntry = {
  abilityIndex: number;
  instructionIndex: number;
  instruction: RuleInstruction;
  position: number;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function numberValue(value: string | undefined, fallback = 1) {
  if (!value) return fallback;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || fallback);
}

function deckWindowFor(text: string): DeckWindow | null {
  const match = normalizeText(text).match(
    /\b(look at|reveal)\s+the\s+top\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?cards?\s+of\s+(?:your|an opponent['’]s|your opponent['’]s)\s+deck\b/i,
  );
  if (!match) return null;
  return {
    mode: /^reveal$/i.test(match[1]) ? "reveal" : "look",
    count: numberValue(match[2], 1),
  };
}

function deckSearchFor(text: string): DeckSearch | null {
  const match = normalizeText(text).match(
    /\bsearch your deck(?:\s+for\s+(?:a|an|one)\s+(?:(Action|Hero|Evo|Flip|Character)\s+)?card)?\b/i,
  );
  if (!match) return null;
  return {
    cardType: match[1] as GameCard["type"] | undefined,
  };
}

function sourcePosition(card: GameCard, sourceText: string) {
  const source = normalizeText(card.effect).toLowerCase();
  const clause = normalizeText(sourceText).toLowerCase();
  const position = source.indexOf(clause);
  return position < 0 ? Number.MAX_SAFE_INTEGER : position;
}

function dependsOnInspectedCards(text: string) {
  return /^(?:put\s+(?:them|those cards|the rest)|if\s+(?:it(?:['’]?s)?|they|the revealed card|(?:one|any) of (?:them|those cards))|(?:then\s+)?(?:choose|select|play|put)\s+(?:one|it|them|those cards|the chosen card))/i.test(
    normalizeText(text),
  );
}

function emptySequence(action: RuleAction) {
  return action.kind === "sequence" && action.effects.length === 0;
}

function normalizedDeckEffect(action: RuleAction, window: DeckWindow): RuleAction {
  if (action.kind === "reveal" && action.object === "deck-top") {
    return { ...action, amount: window.count };
  }
  return action;
}

function mergeEffects(group: readonly InstructionEntry[], window: DeckWindow, allowReorder: boolean) {
  const effects: RuleAction[] = [];
  group.forEach((entry, index) => {
    const current = entry.instruction.effects
      .filter((action) => !emptySequence(action))
      .map((action) => normalizedDeckEffect(action, window));
    if (!current.length) return;
    if (index > 0 && /^if\b/i.test(normalizeText(entry.instruction.sourceText))) {
      effects.push({
        kind: "conditional",
        condition: { kind: "printed", text: entry.instruction.sourceText },
        whenTrue: current,
      });
    } else {
      effects.push(...current);
    }
  });

  if (window.mode === "reveal" && !effects.some((action) => (
    action.kind === "reveal" && action.object === "deck-top"
  ))) {
    effects.unshift({ kind: "reveal", object: "deck-top", amount: window.count });
  }
  if (allowReorder && !effects.some((action) => action.kind === "reorder-deck")) {
    effects.push({ kind: "reorder-deck", amount: window.count });
  }
  // A private look with no further printed operation still needs an executable
  // instruction so resolution pauses for the viewer. An amount-zero reorder is
  // an authoritative no-op and cannot change the deck.
  if (!effects.length) effects.push({ kind: "reorder-deck", amount: 0 });
  return effects;
}

function topDeckChoice(
  window: DeckWindow,
  allowReorder: boolean,
): ChoiceSpec {
  const cards = window.count === 1 ? "card" : "cards";
  const verb = allowReorder ? "Order" : window.mode === "reveal" ? "Reveal" : "Look at";
  return {
    id: "orderedCardIds",
    timing: "resolve",
    selector: "deck-card",
    label: `${verb} the top ${window.count} ${cards}`,
    chooser: "controller",
    visibility: window.mode === "reveal" ? "public" : "private",
    minimum: window.count,
    maximum: window.count,
  };
}

function selectionChoice(window: DeckWindow, cardType?: GameCard["type"]): ChoiceSpec {
  const cards = window.count === 1 ? "card" : "cards";
  return {
    id: "deckCardId",
    timing: "resolve",
    selector: "deck-card",
    label: `Choose one of the top ${window.count} ${cards}`,
    chooser: "controller",
    visibility: window.mode === "reveal" ? "public" : "private",
    minimum: 1,
    maximum: 1,
    cardType,
  };
}

function fullDeckViewChoice(): ChoiceSpec {
  return {
    id: "orderedCardIds",
    timing: "resolve",
    selector: "deck-card",
    label: "Search all cards in your deck (top 0 cards)",
    chooser: "controller",
    visibility: "private",
    minimum: 0,
    maximum: 0,
  };
}

function articleFor(cardType: GameCard["type"]) {
  return /^[AEIOU]/i.test(cardType) ? "an" : "a";
}

function fullDeckSelectionChoice(search: DeckSearch, optional: boolean): ChoiceSpec {
  const target = search.cardType
    ? `${articleFor(search.cardType)} ${search.cardType} card`
    : "a card";
  return {
    id: "deckCardId",
    timing: "resolve",
    selector: "deck-card",
    label: `Choose ${target} from your deck`,
    chooser: "controller",
    visibility: "private",
    minimum: optional ? 0 : 1,
    maximum: 1,
    optional,
    cardType: search.cardType,
  };
}

function normalizeSearchAction(action: RuleAction, search: DeckSearch): RuleAction {
  if (action.kind === "search") {
    return {
      ...action,
      amount: Math.max(1, action.amount),
      cardType: search.cardType ?? action.cardType,
    };
  }
  if (action.kind === "conditional") {
    return {
      ...action,
      whenTrue: action.whenTrue.map((nested) => normalizeSearchAction(nested, search)),
      whenFalse: action.whenFalse?.map((nested) => normalizeSearchAction(nested, search)),
    };
  }
  if (action.kind === "replacement") {
    return {
      ...action,
      replaceWith: action.replaceWith.map((nested) => normalizeSearchAction(nested, search)),
    };
  }
  if (action.kind === "sequence") {
    return {
      ...action,
      effects: action.effects.map((nested) => normalizeSearchAction(nested, search)),
    };
  }
  return action;
}

function enhanceSearchInstruction(instruction: RuleInstruction, cardText: string): RuleInstruction {
  const search = deckSearchFor(instruction.sourceText);
  if (!search) return instruction;
  const optional = /\byou may put (?:it|that card|the (?:chosen|searched(?:-for)?|revealed) card) into your hand\b/i.test(
    normalizeText(cardText),
  );
  const effects = instruction.effects.map((action) => normalizeSearchAction(action, search));
  return {
    ...instruction,
    effects,
    actions: effects,
    choices: [
      fullDeckViewChoice(),
      fullDeckSelectionChoice(search, optional),
      ...instruction.choices.filter((choice) => (
        choice.id !== "orderedCardIds" && choice.id !== "deckCardId"
      )),
    ],
  };
}

function choicesForGroup(
  group: readonly InstructionEntry[],
  window: DeckWindow,
  allowReorder: boolean,
  allowSelection: boolean,
) {
  const sourceText = group.map((entry) => normalizeText(entry.instruction.sourceText)).join(" ");
  const inspectedType = sourceText.match(
    /\bif (?:one|any) of (?:them|those cards) (?:is|are) (?:a|an) (Action|Flip|Hero|Evo|Character) card\b/i,
  )?.[1] as GameCard["type"] | undefined;
  const choices = [topDeckChoice(window, allowReorder)];
  if (allowSelection) choices.push(selectionChoice(window, inspectedType));
  for (const entry of group) {
    for (const choice of entry.instruction.choices) {
      if (choice.id === "orderedCardIds" || choice.id === "deckCardId") continue;
      if (!choices.some((candidate) => candidate.id === choice.id && candidate.timing === choice.timing)) {
        choices.push(choice);
      }
    }
  }
  return choices;
}

function mergedInstruction(group: readonly InstructionEntry[], window: DeckWindow): RuleInstruction {
  const sourceText = group.map((entry) => normalizeText(entry.instruction.sourceText)).join(" ");
  const allowReorder = /\bput\s+(?:them|those cards)\s+on top of (?:your|the) deck\s+in any order\b/i.test(sourceText);
  const selectionToHand = /\bput\s+(?:(?:one|a card)\s+of\s+(?:them|those cards)|the chosen card)\s+into your hand\b/i.test(sourceText);
  const allowSelection = selectionToHand
    || /\b(?:choose|select)\s+(?:a|an|one)\s+(?:of\s+)?(?:them|those cards)\b|\b(?:play|put)\s+one\s+of\s+(?:them|those cards)\b/i.test(sourceText)
    || (window.count > 1 && /\bplay it\b/i.test(sourceText));
  let effects = mergeEffects(group, window, allowReorder);
  if (selectionToHand) {
    effects = effects.filter((action) => !(action.kind === "reorder-deck" && action.amount === 0));
    if (!effects.some((action) => action.kind === "reorder-deck" && action.amount === window.count)) {
      effects.push({ kind: "reorder-deck", amount: window.count });
    }
    effects.push({ kind: "draw", amount: 1 });
  }
  return {
    ...group[0].instruction,
    sourceText,
    effects,
    actions: effects,
    choices: choicesForGroup(group, window, allowReorder, allowSelection),
  };
}

/**
 * Reconnect sentence-split top-deck instructions into one resolving object.
 * This preserves trigger ownership while giving the UI one authoritative card
 * window for private looks, public reveals, selection, and permitted ordering.
 *
 * Full-deck searches use the same pending-choice channel, but add a zero-answer
 * viewer field containing every card currently in the deck plus a separately
 * validated selection field containing only legal search targets.
 */
export function enhanceDeckInspectionAbilities(
  card: GameCard,
  abilities: readonly AbilityDefinition[],
): AbilityDefinition[] {
  const entries = abilities.flatMap((ability, abilityIndex) => ability.instructions.map(
    (instruction, instructionIndex): InstructionEntry => ({
      abilityIndex,
      instructionIndex,
      instruction,
      position: sourcePosition(card, instruction.sourceText),
    }),
  )).sort((left, right) => left.position - right.position
    || left.abilityIndex - right.abilityIndex
    || left.instructionIndex - right.instructionIndex);

  const replacements = new Map<RuleInstruction, RuleInstruction>();
  const consumed = new Set<RuleInstruction>();
  for (let index = 0; index < entries.length; index += 1) {
    const first = entries[index];
    if (consumed.has(first.instruction)) continue;
    const window = deckWindowFor(first.instruction.sourceText);
    if (!window) continue;
    const group = [first];
    for (let nextIndex = index + 1; nextIndex < entries.length; nextIndex += 1) {
      const next = entries[nextIndex];
      if (!dependsOnInspectedCards(next.instruction.sourceText)) break;
      group.push(next);
    }
    replacements.set(first.instruction, mergedInstruction(group, window));
    for (const dependent of group.slice(1)) consumed.add(dependent.instruction);
  }

  return abilities.map((ability) => ({
    ...ability,
    instructions: ability.instructions.flatMap((instruction) => {
      if (consumed.has(instruction)) return [];
      return [enhanceSearchInstruction(replacements.get(instruction) ?? instruction, card.effect)];
    }),
  })).filter((ability) => ability.instructions.length > 0);
}

/** Deck inspection is a resolution-time operation, never an announce-time play choice. */
export function enhanceDeckInspectionPlayDefinition(
  card: GameCard,
  play: CardPlayDefinition,
): CardPlayDefinition {
  if (!deckWindowFor(card.effect) && !deckSearchFor(card.effect)) return play;
  return {
    ...play,
    choices: play.choices.filter((choice) => (
      choice.id !== "orderedCardIds" && choice.id !== "deckCardId"
    )),
  };
}
