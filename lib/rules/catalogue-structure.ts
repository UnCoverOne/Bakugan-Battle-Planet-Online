import { CARDS } from "../data";
import type { CardChoices, GameCard } from "../game";
import type { AbilityDefinition, CardPlayDefinition, ChoiceSpec, CostEffect, RuleAction, RuleInstruction, RulesCardId } from "./model";
import { conditionFor, durationFor, parseAtomicEffects, ruleCardId } from "./catalogue-primitives";

const REPLACEMENT_CARD_IDS = new Set([
  "bb-7", "bb-22", "bb-24", "bb-27", "bb-32", "bb-48", "bb-50",
  "bb-52", "bb-92", "bb-97", "bb-107", "bb-121", "bb-125", "bb-136",
  "br-15", "br-31", "br-43", "br-46", "br-49",
  "aa-10", "aa-23", "aa-29", "aa-31", "aa-34", "aa-37", "aa-38",
  "aa-49", "aa-61", "aa-138",
]);

function splitInstructions(card: GameCard, source: string): RuleInstruction[] {
  const normalized = source.trim();
  const clauses = normalized
    ? normalized.split(/(?<=\.)\s+|\n+/).map((clause) => clause.trim()).filter(Boolean)
    : [""];
  return clauses.map((clause, index) => {
    const condition = conditionFor(clause);
    let effects = parseAtomicEffects(card, clause);
    if (ruleCardId(card) === "bb-152") effects = effects.filter((effect) => effect.kind !== "discard");
    if (!effects.length) effects = [{ kind: "sequence", effects: [] }];
    if (REPLACEMENT_CARD_IDS.has(ruleCardId(card)) && /instead/i.test(clause)) {
      const parts = clause.split(/\binstead\b/i);
      const before = parseAtomicEffects(card, parts[0] ?? "");
      const after = parseAtomicEffects(card, parts.slice(1).join(" instead "));
      effects = [{ kind: "conditional", condition, whenTrue: after, whenFalse: before, replacement: true }];
    }
    return {
      id: `${ruleCardId(card)}:instruction:${index}`,
      condition,
      effects,
      actions: effects,
      choices: choicesForText(card, clause, "resolve"),
      sourceText: clause,
    };
  });
}

function choice(
  id: keyof CardChoices,
  timing: ChoiceSpec["timing"],
  selector: ChoiceSpec["selector"],
  label: string,
  optional = false,
  chooser: ChoiceSpec["chooser"] = "controller",
  visibility: ChoiceSpec["visibility"] = "public",
): ChoiceSpec {
  return { id, timing, selector, label, optional, chooser, visibility, minimum: optional ? 0 : 1, maximum: 1 };
}

function choicesForText(card: GameCard, text: string, defaultTiming: ChoiceSpec["timing"]): ChoiceSpec[] {
  const result: ChoiceSpec[] = [];
  const timing = /when you play this|\bmay\b|\bSacrifice\b/i.test(text) ? "resolve" : defaultTiming;
  if (card.type === "Evo" && defaultTiming === "announce") result.push(choice("targetBakuganId", "announce", "chosen-bakugan", "Choose the matching Character"));
  if (/choose (?:a|an|one).*Bakugan|target .*Bakugan|retract (?:one of )?(?:your )?(?:open )?Bakugan/i.test(text)) result.push(choice("targetBakuganId", timing, "chosen-bakugan", "Choose a Bakugan"));
  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "controller", "Choose a player"));
  if (/destroy a hero|choose a hero|take control of a hero/i.test(text)) result.push(choice("targetHeroId", timing, "hero", "Choose a Hero"));
  if (/destroy an evo|choose an evo/i.test(text)) result.push(choice("targetEvoId", timing, "evo", "Choose an Evo"));
  if (/destroy (?:an?|two|three) (?:enemy )?energy|choose an energy/i.test(text)) result.push(choice("targetEnergyIds", timing, "energy-card", "Choose Energy"));
  if (/attach a bakucore|remove .*bakucore|choose a bakucore|turn a bakucore/i.test(text)) result.push(choice("coreCell", timing, "bakucore", "Choose a BakuCore"));
  if (/sacrifice|discard (?:a|an|one|two|three|any|up to)|cards? from your hand/i.test(text)) {
    result.push(choice("discardCardIds", timing, "hand-card", /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard", /up to|any number/i.test(text), /opponent/i.test(text) ? "opponent" : "controller", "private"));
  }
  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));
  if (/top .*cards?.*any order/i.test(text)) result.push(choice("orderedCardIds", timing, "deck-card", "Order the revealed cards", false, "controller", "private"));
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free/i.test(text)) result.push(choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private"));
  if (/Battle Mastery:.*Choose one|choose one of the following/i.test(text)) result.push(choice("mode", timing, "mode", "Choose a Battle Mastery mode"));
  if (card.cost === "X" || /choose (?:a value for )?x/i.test(text)) result.push(choice("xValue", "pay", "number", "Choose X"));
  if (/\bmay\b/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));
  return result.filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id && candidate.timing === item.timing) === index);
}

function costModifiersFor(card: GameCard): CostEffect[] {
  const result: CostEffect[] = [];
  const text = card.effect;
  for (const match of text.matchAll(/costs? (\d+) \[Energy\] less/gi)) result.push({ kind: "cost-reduce", amount: Number(match[1]), duration: durationFor(text), condition: conditionFor(text) });
  if (/play this for free|this is free/i.test(text)) result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });
  if (ruleCardId(card) === "bb-152") {
    result.push({ kind: "cost-discard", amount: 1, choiceId: "discardCardIds" });
    result.push({ kind: "cost-alternative", label: "Discard a card instead of paying the printed Energy cost", components: [{ kind: "cost-discard", amount: 1, choiceId: "discardCardIds" }] });
  }
  if (ruleCardId(card) === "aa-112") {
    result.push({ kind: "cost-alternative", label: "Discard two cards instead of paying the printed Energy cost", components: [{ kind: "cost-discard", amount: 2, choiceId: "discardCardIds" }] });
  }
  return result;
}

function evoIdentities(card: GameCard): RulesCardId[] {
  if (card.type !== "Evo" || !card.evolvesFrom) return [];
  const normalize = (value: string) => value
    .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
    .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\s+/i, "")
    .replace(/\bSerpeteze\b/gi, "Serpenteze")
    .replace(/\s+/g, " ").trim().toLowerCase();
  const inferred = normalize((card.displayName || card.name).replace(/^(Diamond|Hyper|Titan|Maximus)\s+/i, ""));
  const declared = normalize(card.evolvesFrom ?? "");
  const setPrefix = ruleCardId(card).split("-")[0];
  const candidates = CARDS.filter((candidate) => candidate.type === "Character"
    && [declared, inferred].includes(normalize(candidate.displayName || candidate.name))
    && (card.factions?.length ? card.factions.includes(candidate.faction) : candidate.faction === card.faction));
  const sameSet = candidates.filter((candidate) => ruleCardId(candidate).startsWith(`${setPrefix}-`));
  return (sameSet.length ? sameSet : candidates).slice(0, 1).map((candidate) => ruleCardId(candidate));
}

export function playDefinitionForCard(card: GameCard): CardPlayDefinition {
  const choices = choicesForText(card, card.effect, "announce");
  if (ruleCardId(card) === "bb-1" && !choices.some((item) => item.selector === "batch-object")) {
    choices.unshift(choice("mode", "announce", "batch-object", "Choose the Action effect to negate"));
  }
  if (ruleCardId(card) === "bb-152") {
    const existing = choices.find((item) => item.id === "discardCardIds");
    if (existing) existing.timing = "pay";
    else choices.push(choice("discardCardIds", "pay", "hand-card", "Choose the additional-cost discard", false, "controller", "private"));
  }
  if (ruleCardId(card) === "aa-112") choices.push(choice("discardCardIds", "pay", "hand-card", "Choose two cards for the alternative cost", false, "controller", "private"));
  return {
    choices,
    costModifiers: costModifiersFor(card),
    evolvesFrom: evoIdentities(card),
    sourceZones: card.type === "Flip" ? ["damage-reveal"] : ["hand"],
  };
}

export function abilityDefinitionsForCard(card: GameCard): AbilityDefinition[] {
  const instructions = splitInstructions(card, card.effect);
  const triggered = instructions.filter((instruction) => instruction.effects.some((effect) => effect.kind === "trigger"));
  const ordinary = instructions.filter((instruction) => !triggered.includes(instruction));
  const result: AbilityDefinition[] = [];
  if (ordinary.length || !triggered.length) result.push({
    id: `${ruleCardId(card)}:${card.type === "Character" ? "character" : "spell"}`,
    kind: card.type === "Character" ? "character" : card.type === "Hero" && ordinary.some((instruction) => instruction.effects.some((effect) => effect.kind === "continuous")) ? "static" : "spell",
    instructions: ordinary.length ? ordinary : instructions,
  });
  for (const instruction of triggered) {
    const trigger = instruction.effects.find((effect): effect is Extract<RuleAction, { kind: "trigger" }> => effect.kind === "trigger")!;
    result.push({ id: `${ruleCardId(card)}:trigger:${result.length}`, kind: "triggered", trigger: trigger.definition, instructions: [instruction] });
  }
  return result;
}
