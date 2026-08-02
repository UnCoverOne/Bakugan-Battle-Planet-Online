import { CARDS } from "../data";
import type { CardChoices, GameCard } from "../game";
import type { AbilityDefinition, CardPlayDefinition, ChoiceSpec, CostEffect, RuleAction, RuleInstruction, RulesCardId } from "./model";
import { conditionFor, durationFor, parseAtomicEffects, ruleCardId } from "./catalogue-primitives";

function splitInstructions(card: GameCard, source: string): RuleInstruction[] {
  const normalized = source.replace(/\s*\n\s*/g, " ").trim();
  const clauses = normalized
    ? normalized.split(/(?<=\.)\s+/).map((clause) => clause.trim()).filter(Boolean)
      .flatMap((clause) => {
        // Preserve the Reroll-success condition on every dependent clause.
        // This must run before the generic "and you may Reroll" splitter so
        // cards such as Rip Tide do not turn their optional draw unconditional.
        const rerollConditional = clause.match(/^(If you open on the Reroll,\s*)(.*?)(?:,?\s+and\s+)(you may\s+.*)$/i);
        if (rerollConditional && rerollConditional[2].trim()) {
          return [
            `${rerollConditional[1]}${rerollConditional[2].trim().replace(/[,;:]$/, "")}.`,
            `${rerollConditional[1]}${rerollConditional[3].trim()}`,
          ];
        }
        const reroll = clause.match(/^(.*?)(?:,?\s+and\s+)(you may Reroll\b.*)$/i);
        if (reroll && reroll[1].trim()) {
          return [reroll[1].trim().replace(/[,;:]$/, "") + ".", reroll[2].trim()];
        }
        return [clause];
      })
    : [""];
  const instructions = clauses.map((clause, index) => {
    const condition = conditionFor(clause);
    let effects = parseAtomicEffects(card, clause);
    if (ruleCardId(card) === "bb-152") effects = effects.filter((effect) => effect.kind !== "discard");
    if (!effects.length) effects = [{ kind: "sequence", effects: [] }];
    return {
      id: `${ruleCardId(card)}:instruction:${index}`,
      condition,
      effects,
      actions: effects,
      choices: choicesForText(card, clause, "resolve"),
      sourceText: clause,
    };
  });

  // A sentence-ending "instead" clause replaces the immediately preceding
  // effect. Detect that grammar directly so every set receives the same rules
  // treatment and prose such as "instead of [B]" is left alone.
  for (let index = 1; index < instructions.length; index += 1) {
    const current = instructions[index];
    if (current.condition.kind === "always" || !/\binstead\s*\.?\s*$/i.test(current.sourceText)) continue;
    const previous = instructions[index - 1];
    const replacementText = current.sourceText.replace(/\s*\binstead\s*\.?\s*$/i, "");
    const triggerEffects = previous.effects.filter((effect) => effect.kind === "trigger");
    const baseEffects = previous.effects.filter((effect) => effect.kind !== "trigger");
    const effects: RuleAction[] = [...triggerEffects, {
      kind: "conditional",
      condition: current.condition,
      whenTrue: parseAtomicEffects(card, replacementText),
      whenFalse: baseEffects,
      replacement: true,
    }];
    const sourceText = `${previous.sourceText} ${current.sourceText}`;
    instructions.splice(index - 1, 2, {
      ...previous,
      condition: { kind: "always" },
      effects,
      actions: effects,
      choices: choicesForText(card, sourceText, "resolve"),
      sourceText,
    });
    index -= 1;
  }
  return instructions;
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
  if (/sacrifice|discard (?:a|an|one|two|three|any|up to|\d+)|cards? from your hand/i.test(text)
    && !/choose a player to discard/i.test(text)
    && !(/if you open on the Reroll/i.test(text) && /\bVictor\s*:/i.test(text))) {
    const optional = /up to|any number|may discard/i.test(text);
    const selected = choice(
      "discardCardIds",
      timing,
      "hand-card",
      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard",
      optional,
      /opponent/i.test(text) ? "opponent" : "controller",
      "private",
    );
    const printedAmount = text.match(/discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i)?.[1];
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = printedAmount ? words[printedAmount.toLowerCase()] ?? Number(printedAmount) : 1;
    selected.minimum = optional ? 0 : amount;
    selected.maximum = /any number/i.test(text) ? 99 : Math.max(1, amount);
    result.push(selected);
  }
  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));
  if (/top .*cards?.*any order/i.test(text)) result.push(choice("orderedCardIds", timing, "deck-card", "Order the revealed cards", false, "controller", "private"));
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play that Bakugan(?:'s|’s) Evo card for free/i.test(text)) {
    const selected = choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private");
    if (/that Bakugan(?:'s|’s) Evo/i.test(text)) selected.cardType = "Evo";
    result.push(selected);
  }
  if (/Battle Mastery:.*Choose one|choose one of the following/i.test(text)) result.push(choice("mode", timing, "mode", "Choose a Battle Mastery mode"));
  if (card.cost === "X" || /choose (?:a value for )?x/i.test(text)) result.push(choice("xValue", "pay", "number", "Choose X"));
  if (/\bmay\b/i.test(text) && !/may discard/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));
  return result.filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id && candidate.timing === item.timing) === index);
}

function reductionScaleFor(text: string): Extract<CostEffect, { kind: "cost-reduce" }>["scale"] {
  if (/for each card you (?:have )?played this turn/i.test(text)) return "cards-played-this-turn";
  if (/for each BakuCore that your Bakugan hold/i.test(text)) return "held-bakucore";
  return undefined;
}

function costModifiersFor(card: GameCard): CostEffect[] {
  const result: CostEffect[] = [];
  const text = card.effect;

  // A card's own play-cost adjustment must explicitly name "this". Static
  // reducers such as Shun, Lightning, and Strata target cards played later and
  // are evaluated from their active Hero source by the cost calculator.
  for (const match of text.matchAll(/\bthis\s+costs?\s+(\d+)\s+\[Energy\]\s+less(?:\s+to\s+(?:play|use))?(?:\s+for\s+each\s+[^.]+)?/gi)) {
    result.push({
      kind: "cost-reduce",
      amount: Number(match[1]),
      duration: "instant",
      condition: conditionFor(text),
      appliesTo: "self",
      scale: reductionScaleFor(match[0]),
    });
  }

  const controlledCardReduction = text.match(/\b(?:your\s+)?(Action|Hero|Flip)\s+cards?\s+cost(?:\s+you)?\s+(\d+)\s+\[Energy\]\s+less\b/i);
  if (controlledCardReduction) {
    result.push({
      kind: "cost-reduce",
      amount: Number(controlledCardReduction[2]),
      duration: "while-source-active",
      cardType: controlledCardReduction[1] as GameCard["type"],
      appliesTo: "controller",
    });
  }
  const controlledEvoReduction = text.match(/\bEvos?\s+cost(?:\s+you)?\s+(\d+)\s+\[Energy\]\s+less\b/i);
  if (controlledEvoReduction) {
    result.push({
      kind: "cost-reduce",
      amount: Number(controlledEvoReduction[1]),
      duration: "while-source-active",
      cardType: "Evo",
      appliesTo: "controller",
    });
  }

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

function cardEntryInstruction(card: GameCard, trigger: RuleInstruction): RuleInstruction {
  const sourceText = trigger.sourceText.split(/[,;:]/, 1)[0]?.trim() || trigger.sourceText;
  const effects: RuleAction[] = [{ kind: "sequence", effects: [] }];
  return {
    id: `${ruleCardId(card)}:enter-play`,
    condition: { kind: "always" },
    effects,
    actions: effects,
    choices: [],
    sourceText,
  };
}

export function abilityDefinitionsForCard(card: GameCard): AbilityDefinition[] {
  const instructions = splitInstructions(card, card.effect);
  const triggered: RuleInstruction[][] = [];
  const ordinary: RuleInstruction[] = [];
  let activeTrigger: RuleInstruction[] | undefined;
  for (const instruction of instructions) {
    const startsTrigger = instruction.condition.kind !== "reroll-opened"
      && instruction.effects.some((effect) => effect.kind === "trigger");
    if (startsTrigger) {
      activeTrigger = [instruction];
      triggered.push(activeTrigger);
      continue;
    }
    // Sentence splitting must not turn a follow-up clause into an enter-play
    // spell. These phrases refer to information or an action created by the
    // preceding trigger and therefore share that trigger's event timing.
    const continuesTrigger = Boolean(activeTrigger) && /^(?:then\b|you\s+may\s+(?:put|play)\s+(?:it|that\s+card|the\s+(?:chosen|revealed)\s+card)\b|if\s+(?:it(?:['’]?s|\b)|they\b|you do\b|an?\s+[^,.]+\s+cards?\s+is\s+revealed\s+this\s+way\b|one\s+of\s+(?:them|those\s+cards)\b|the\s+revealed\s+card\b))/i.test(
      instruction.sourceText.trim(),
    );
    if (continuesTrigger) activeTrigger!.push(instruction);
    else {
      activeTrigger = undefined;
      ordinary.push(instruction);
    }
  }
  const result: AbilityDefinition[] = [];
  if (["Hero", "Evo"].includes(card.type) && triggered.length && !ordinary.length) {
    result.push({
      id: `${ruleCardId(card)}:spell`,
      kind: "spell",
      instructions: [cardEntryInstruction(card, triggered[0][0])],
    });
  } else if (ordinary.length || !triggered.length) result.push({
    id: `${ruleCardId(card)}:${card.type === "Character" ? "character" : "spell"}`,
    kind: card.type === "Character" ? "character" : card.type === "Hero" && ordinary.some((instruction) => instruction.effects.some((effect) => (
      (effect.kind === "modify-stat" || effect.kind === "grant-keyword") && effect.duration === "while-source-active"
    ))) ? "static" : "spell",
    instructions: ordinary.length ? ordinary : instructions,
  });
  for (const group of triggered) {
    const trigger = group[0].effects.find((effect): effect is Extract<RuleAction, { kind: "trigger" }> => effect.kind === "trigger")!;
    result.push({ id: `${ruleCardId(card)}:trigger:${result.length}`, kind: "triggered", trigger: trigger.definition, instructions: group });
  }
  return result;
}
