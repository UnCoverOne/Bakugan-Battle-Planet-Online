import { CARDS } from "../data";
import type { CardChoices, CoreType, GameCard } from "../game";
import type { AbilityDefinition, CardPlayDefinition, ChoiceSpec, CostEffect, RuleAction, RuleInstruction, RulesCardId } from "./model";
import { conditionFor, durationFor, parseAtomicEffects, ruleCardId } from "./catalogue-primitives";

const CORE_TYPE_BY_SYMBOL: Record<string, CoreType> = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
};

function singleAttachedCoreTypes(text: string): CoreType[] {
  const symbols = text.match(
    /\battach\s+(?:an?\s+)?(?:additional\s+|another\s+)?(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  )?.[1];
  if (!symbols) return [];
  return [...symbols.matchAll(/\[(FT|FF|SD|MS|HE)\]/gi)]
    .map((match) => CORE_TYPE_BY_SYMBOL[match[1].toUpperCase()])
    .filter((coreType, index, values) => values.indexOf(coreType) === index);
}

function expandMultiCoreAttachment(clause: string) {
  const match = clause.match(
    /^(.*?)\bAttach\s+up to\s+(two|three|\d+)\s+(\[(?:FT|FF|SD|MS|HE)\])\s+from the Field to (.+?)\.?$/i,
  );
  if (!match) return null;
  const amount = match[2].toLowerCase() === "two" ? 2 : match[2].toLowerCase() === "three" ? 3 : Number(match[2]);
  if (!Number.isFinite(amount) || amount < 1 || amount > 10) return null;
  const prefix = match[1].trim();
  const symbol = match[3];
  const target = match[4].trim().replace(/\.$/, "");
  return Array.from({ length: amount }, (_, index) => (
    index === 0
      ? `${prefix}${prefix ? " " : ""}You may attach a ${symbol} from the Field to ${target}.`
      : `Then you may attach a ${symbol} from the Field to ${target}.`
  ));
}

function splitInstructions(card: GameCard, source: string): RuleInstruction[] {
  const normalized = source.replace(/\s*\n\s*/g, " ").trim();
  const clauses = normalized
    ? normalized.split(/(?<=\.)\s+/).map((clause) => clause.trim()).filter(Boolean)
      .flatMap((clause) => {
        // "Attach up to N" is modelled as N optional sequential selections.
        // This preserves the printed 0..N choice without requiring one giant
        // multi-select answer and lets each chosen core leave the Field before
        // the next legal-choice set is calculated.
        const multiCoreAttachment = expandMultiCoreAttachment(clause);
        if (multiCoreAttachment) return multiCoreAttachment;
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
        // A printed "then" is an ordering boundary. Keeping both halves in
        // one instruction requests all choices before either action runs,
        // which reverses effects such as "Draw two cards, then discard two
        // cards." Splitting here lets the resolver finish (and, for manual
        // draws, suspend for) the first action before it builds the second
        // action's choice schema.
        const sequential = clause.match(/^(.*?),\s+then\s+(.+)$/i);
        if (sequential?.[1].trim() && sequential[2].trim()) {
          return [
            `${sequential[1].trim().replace(/[,;:]$/, "")}.`,
            `Then ${sequential[2].trim()}`,
          ];
        }
        return [clause];
      })
    : [""];
  const instructions = clauses.map((clause, index) => {
    const condition = conditionFor(clause);
    let effects = parseAtomicEffects(card, clause);
    const attachedCoreTypes = singleAttachedCoreTypes(clause);
    if (attachedCoreTypes.length && !effects.some((effect) => effect.kind === "move" && effect.verb === "attach" && effect.object === "bakucore")) {
      effects = [...effects.filter((effect) => effect.kind !== "sequence"), { kind: "move", verb: "attach", object: "bakucore", amount: 1 }];
    }
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
  const cardId = ruleCardId(card);
  const timing = /when you play this|\bmay\b|\bSacrifice\b/i.test(text) ? "resolve" : defaultTiming;
  const targetTiming = /\bBattle Mastery\b|when this opens|\bVictor\s*[-:]|\bUnderdog\s*:|at (?:the )?end of (?:your |the )?turn/i.test(text)
    ? "resolve"
    : defaultTiming;
  const discardPaysPlayCost = /\bdiscard\s+(?:a|an|one|two|three|\d+)\s+cards?\s+to play this for free\b/i.test(text);
  const takeControlHero = /take control of a hero/i.test(text);
  const targetOwner = takeControlHero || /enemy|opposing|opponent(?:'s|’s)/i.test(text)
    ? "opponent" as const
    : /(?:one of )?your (?:open )?(?:Bakugan|Hero|Evo|Energy)/i.test(text)
      ? "controller" as const
      : "any" as const;
  const maximumCost = Number(text.match(/costs? (\d+) \[Energy\] or less/i)?.[1] ?? Number.NaN);
  const printedMaximum = Number.isFinite(maximumCost) ? maximumCost : undefined;
  const attachedCoreTypes = singleAttachedCoreTypes(text);
  const attachesCore = /\battach\s+(?:an?\s+)?(?:additional\s+|another\s+)?bakucore/i.test(text) || attachedCoreTypes.length > 0;
  const coreAttachmentTarget = attachesCore
    && /\bto\s+(?:one of\s+)?(?:your\s+)?(?:an?\s+)?(?:open\s+)?Bakugan\b/i.test(text);
  const explicitBakuganTarget = /choose (?:a|an|one|another).*Bakugan|target .*Bakugan|retract (?:(?:one of|another) )?(?:your )?(?:open )?Bakugan|give (?:a|an|one|another)(?: \[[^\]]+\])? Bakugan|(?:a|an|one|another)(?: \[[^\]]+\])? Bakugan gets?|to (?:a|an|one) \[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] Bakugan/i.test(text)
    || coreAttachmentTarget;
  const separateEvoEffectTarget = card.type === "Evo"
    && defaultTiming === "announce"
    && /when you play this/i.test(text)
    && explicitBakuganTarget
    && cardId !== "aa-99";

  if (card.type === "Evo" && defaultTiming === "announce") {
    const selected = choice(
      separateEvoEffectTarget ? "sourceBakuganId" : "targetBakuganId",
      "announce",
      "chosen-bakugan",
      "Choose the matching Character",
    );
    selected.targetOwner = "controller";
    result.push(selected);
  }

  const negateMatch = text.match(/negate (?:a|an) (Hero or Action|Action|Hero) card/i);
  if (negateMatch) {
    const selected = choice("targetEffectId", defaultTiming, "batch-object", "Choose the card effect to negate");
    selected.cardTypes = /Hero or Action/i.test(negateMatch[1])
      ? ["Hero", "Action"]
      : [negateMatch[1] as GameCard["type"]];
    selected.objectKinds = ["card"];
    selected.targetOwner = "opponent";
    selected.maximumCost = printedMaximum;
    result.push(selected);
  }

  if (cardId === "aa-50") {
    const enemy = choice("targetBakuganId", "announce", "chosen-bakugan", "Choose the enemy Bakugan");
    enemy.targetOwner = "opponent";
    const friendly = choice("secondaryTargetBakuganId", "announce", "chosen-bakugan", "Choose one of your Bakugan");
    friendly.targetOwner = "controller";
    result.push(enemy, friendly);
  } else if (explicitBakuganTarget && cardId !== "aa-99") {
    const selected = choice("targetBakuganId", targetTiming, "chosen-bakugan", "Choose a Bakugan");
    selected.targetOwner = targetOwner;
    if (/open Bakugan/i.test(text) || attachesCore) selected.openState = "open";
    if (/didn['’]?t open this turn|did not open this turn/i.test(text)) selected.notOpenedThisTurn = true;
    if (/another open Bakugan/i.test(text)) selected.excludeSourceBakugan = true;
    const faction = text.match(/(?:choose|give|to|target)\s+(?:a|an|one|another)?\s*\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1]
      ?? text.match(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan\s+gets?/i)?.[1];
    if (faction) selected.factions = [faction as GameCard["faction"]];
    result.push(selected);
  }
  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "controller", "Choose a player"));
  if (!/destroy all/i.test(text) && /destroy a hero|choose a hero|take control of a hero/i.test(text)) {
    const selected = choice("targetHeroId", targetTiming, "hero", "Choose a Hero");
    selected.targetOwner = takeControlHero ? "opponent" : targetOwner;
    selected.maximumCost = printedMaximum;
    result.push(selected);
  }
  if (!/destroy all/i.test(text) && /destroy an evo|choose an evo/i.test(text)) {
    const selected = choice("targetEvoId", targetTiming, "evo", "Choose an Evo");
    selected.targetOwner = targetOwner;
    selected.notPlayedThisTurn = /not played this turn/i.test(text);
    result.push(selected);
  }
  if (!/destroy all/i.test(text) && /destroy (?:an?|two|three) (?:enemy )?energy|choose an energy/i.test(text)) {
    const selected = choice("targetEnergyIds", targetTiming, "energy-card", "Choose Energy");
    selected.targetOwner = targetOwner;
    const amountText = text.match(/destroy (an?|one|two|three|\d+) (?:enemy )?energy/i)?.[1]?.toLowerCase();
    const amount = amountText === "two" ? 2 : amountText === "three" ? 3 : Number(amountText) || 1;
    selected.minimum = cardId === "bb-97" ? 1 : amount;
    selected.maximum = cardId === "bb-97" ? 2 : amount;
    result.push(selected);
  }
  const rechargeChoice = text.match(/\brecharge\s+up to\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+Energy cards?\b/i);
  if (rechargeChoice) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const amount = words[rechargeChoice[1].toLowerCase()] ?? Math.max(1, Number(rechargeChoice[1]) || 1);
    const selected = choice("targetEnergyIds", "resolve", "energy-card", `Choose up to ${amount} uncharged Energy cards`, true);
    selected.targetOwner = "controller";
    selected.energyState = "uncharged";
    selected.minimum = 0;
    selected.maximum = amount;
    result.push(selected);
  }
  if (!/\ball BakuCores?\b|remove all BakuCores?/i.test(text)
    && (attachesCore || /remove .*bakucore|choose a bakucore|turn a bakucore/i.test(text))) {
    const selected = choice("coreCell", targetTiming, "bakucore", "Choose a BakuCore");
    // Cores on the Field are shared game objects; words such as "your" in an
    // attachment effect qualify the Bakugan target, not ownership of the Core.
    selected.targetOwner = attachesCore ? "any" : targetOwner;
    selected.attachmentState = attachesCore || /turn .*face up/i.test(text)
      ? "unattached"
      : /remove|return .*field face down/i.test(text) ? "attached" : undefined;
    if (attachedCoreTypes.length) selected.coreTypes = attachedCoreTypes;
    result.push(selected);
  }
  if (/choose a non-energy card in play/i.test(text)) {
    const selected = choice("targetCardId", targetTiming, "card-in-play", "Choose a non-Energy card in play");
    selected.targetOwner = targetOwner;
    result.push(selected);
  }
  if (/\bsacrifice\b|\bdiscard\s+(?:a|an|one|two|three|any|up to|\d+)\s+cards?\b|\bdiscard\s+cards?\s+from your hand\b/i.test(text)
    && !discardPaysPlayCost
    && !/choose a player to discard/i.test(text)
    && !(/if you open on the Reroll/i.test(text) && /\bVictor\s*:/i.test(text))) {
    const optional = /up to|any number|may discard/i.test(text);
    const selected = choice(
      "discardCardIds",
      "resolve",
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
  const energizeFromHand = text.match(/\benergize\s+(?:(a|an|one|two|three|\d+)\s+)?cards?\s+(?:in|from)\s+your\s+hand\b/i);
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
  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));
  if (/top .*cards?.*any order/i.test(text)) result.push(choice("orderedCardIds", timing, "deck-card", "Order the revealed cards", false, "controller", "private"));
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play that Bakugan(?:'s|’s) Evo card for free/i.test(text)) {
    const selected = choice("handCardIds", timing, "hand-card", "Choose a card to play", false, "controller", "private");
    if (/that Bakugan(?:'s|’s) Evo/i.test(text)) selected.cardType = "Evo";
    result.push(selected);
  }
  if (/Battle Mastery:.*Choose one|choose one of the following/i.test(text)) result.push(choice("mode", timing, "mode", "Choose a Battle Mastery mode"));
  if (card.cost === "X" || /choose (?:a value for )?x/i.test(text)) result.push(choice("xValue", "pay", "number", "Choose X"));
  if (/\bmay\b/i.test(text) && !/may discard|may recharge up to/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));
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

  // Pact of Darkness resolves its optional Sacrifice payment through the
  // paused Damage sequence. It must retain its printed cost until that
  // sequence has actually discarded a card.
  if (ruleCardId(card) !== "bb-152" && /play this for free|this is free/i.test(text)) {
    result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });
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
  // A later trigger on the same card must not move a When-you-play target
  // from announcement to resolution. Parse each When-you-play clause in
  // isolation and merge its announcement selections into the card play.
  for (const match of card.effect.matchAll(/when you play this[\s\S]*?(?=\b(?:when this opens|Victor|Underdog|at (?:the )?end of (?:your |the )?turn)\s*[-:]|$)/gi)) {
    for (const selected of choicesForText(card, match[0], "announce").filter((choice) => choice.timing === "announce")) {
      if (!choices.some((choice) => choice.id === selected.id && choice.timing === selected.timing)) choices.push(selected);
    }
  }
  // Pact of Darkness owns a dedicated two-stage Damage-step payment
  // prompt, so it must not enter the generic card-choice editor.
  if (ruleCardId(card) === "bb-152") {
    for (let index = choices.length - 1; index >= 0; index -= 1) {
      if (choices[index].id === "discardCardIds") choices.splice(index, 1);
    }
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
    const continuesTrigger = Boolean(activeTrigger) && /^(?:then\b|shuffle\s+your\s+deck\b|you\s+may\s+(?:put|play|attach)\s+(?:it|that\s+card|the\s+(?:chosen|revealed)\s+card|an?\s+\[(?:FT|FF|SD|MS|HE)\])\b|if\s+(?:it(?:['’]?s|\b)|they\b|you do\b|an?\s+[^,.]+\s+cards?\s+is\s+revealed\s+this\s+way\b|one\s+of\s+(?:them|those\s+cards)\b|the\s+revealed\s+card\b))/i.test(
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
