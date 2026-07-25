import { textFingerprint } from "../content/catalogue";
import { CARD_CATALOGUE_VERSION, RULES_PROFILE_VERSION } from "../content/versions";
import { CARDS } from "../data";
import type { CardChoices, CardType, Faction, GameCard } from "../game";
import type {
  AbilityDefinition,
  CardPlayDefinition,
  ChoiceSpec,
  CostEffect,
  RuleAction,
  RuleCondition,
  RuleDefinition,
  RuleInstruction,
  RuleProgram,
  RulesCardId,
  RulesDuration,
  TriggerDefinition,
  TriggerEventName,
} from "./model";
import { provenanceForDefinition, validateDefinitionProvenance } from "./provenance";

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const REPLACEMENT_CARD_NUMBERS = new Set([7, 22, 24, 27, 32, 48, 50, 52, 92, 97, 107, 121, 125, 136]);

function numberValue(value: string | undefined, fallback = 1) {
  if (!value) return fallback;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || fallback);
}

function cardId(card: GameCard): RulesCardId {
  return (card.catalogId || `bb-${card.number}`) as RulesCardId;
}

function durationFor(text: string): RulesDuration {
  if (/next (?:Action|card|Gear)/i.test(text)) return "next-card";
  if (/this turn|until end of turn/i.test(text)) return "turn";
  if (/your Bakugan have|opposing Bakugan|while|as long as/i.test(text)) return "while-source-active";
  return "instant";
}

function conditionFor(text: string): RuleCondition {
  if (/\bFury\b/i.test(text)) return { kind: "fury" };
  if (/\bTurbo\b/i.test(text)) return { kind: "turbo" };
  if (/\bDomination\b/i.test(text)) return { kind: "domination" };
  if (/\bFlow\b/i.test(text)) return { kind: "flow" };
  if (/\bVictor\b/i.test(text)) return { kind: "victor" };
  const faction = text.match(/If \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i)?.[1] as Faction | undefined;
  if (faction) return { kind: "faction", faction };
  return { kind: "always" };
}

function triggerFor(text: string): TriggerDefinition | undefined {
  const table: Array<[RegExp, TriggerEventName, TriggerDefinition["relationship"]]> = [
    [/when (?:your |an )?opponent plays/i, "CARD_PLAYED", "opponent"],
    [/when you play|when this is played/i, "CARD_PLAYED", "controller"],
    [/when you select a Bakugan/i, "BAKUGAN_SELECTED", "controller"],
    [/when this opens|when you open a Bakugan/i, "BAKUGAN_OPENED", "controller"],
    [/when you discard|if this is discarded/i, "CARD_DISCARDED", "controller"],
    [/\bVictor\s*[-:]/i, "VICTOR_DECLARED", "controller"],
    [/when one of your Bakugan attacks|if you deal \d+ or more damage/i, "ATTACK_CREATED", "controller"],
    [/if you take damage/i, "DAMAGE_TAKEN", "controller"],
    [/when you have no cards in hand|when your hand is empty/i, "HAND_EMPTIED", "controller"],
    [/at the end of (?:your |the )?turn/i, "TURN_ENDED", "controller"],
  ];
  for (const [pattern, event, relationship] of table) {
    if (!pattern.test(text)) continue;
    const cardType = text.match(/plays? an? (Action|Hero|Evo|Flip)/i)?.[1] as CardType | undefined;
    return {
      event,
      relationship,
      cardType,
      optional: /\bmay\b/i.test(text),
      interveningCondition: /\bif\b/i.test(text) ? conditionFor(text) : undefined,
    };
  }
  return undefined;
}

function scaleFor(text: string) {
  return /sacrifice/i.test(text) ? "sacrificed-card" : text.match(/for each ([^.,]+)/i)?.[1]?.trim();
}

function scopeFor(text: string): "target" | "all-enemy" | "all-friendly" {
  if (/all enemy Bakugan|(?:enemy|opposing) Bakugan (?:have|get)/i.test(text)) return "all-enemy";
  if (/all (?:of )?your Bakugan|your Bakugan (?:have|get)/i.test(text)) return "all-friendly";
  return "target";
}

function parseAtomicEffects(card: GameCard, text: string): RuleAction[] {
  const actions: RuleAction[] = [];
  const duration = durationFor(text);
  const scale = scaleFor(text);
  const scope = scopeFor(text);

  for (const match of text.matchAll(/([+-]\d+)\s*\[B\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "power", amount: Number(match[1]), scale, duration, scope });
  }
  for (const match of text.matchAll(/([+-]\d+)\s*\[Damage (?:Rating|Power)\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "damage", amount: Number(match[1]), scale, duration, scope });
  }
  for (const match of text.matchAll(/\+?(\d+)\s*\[FrostStrike\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale, duration, scope });
  }
  if (/Double\s*Strike/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "DoubleStrike", duration });
  if (/ShadowStrike/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });
  if (/\[Stop\]/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });

  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) actions.push({ kind: "draw", amount: numberValue(draw[1]), scale });
  const discard = text.match(/discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (discard) {
    const amount = numberValue(discard[1]);
    actions.push({ kind: "discard", amount, minimum: /any number|up to/i.test(text) ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text) });
  }

  const energize = text.match(/energize (?:the top )?(a|an|one|two|three|\d+)?\s*cards?/i);
  if (energize) actions.push({ kind: "energize", amount: numberValue(energize[1]), source: /top/i.test(energize[0]) ? "deck" : "hand" });
  if (/Energize (?:it|that Hero)/i.test(text)) actions.push({ kind: "energize", amount: 1, source: "hero" });
  if (/Energize this(?: uncharged|\b)/i.test(text)) actions.push({ kind: "energize", amount: 1, source: "self" });

  const generatedEnergy = text.match(/\+(\d+) \[Energy\]/i);
  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: Number(generatedEnergy[1]), scale });
  const setPower = text.match(/\[B\] becomes (\d+)/i);
  if (setPower) actions.push({ kind: "set-stat", stat: "power", value: Number(setPower[1]) });
  const setDamage = text.match(/\[Damage Rating\] becomes (\d+)/i);
  if (setDamage) actions.push({ kind: "set-stat", stat: "damage", value: Number(setDamage[1]) });
  if (/Victor is decided by highest \[Damage Rating\]/i.test(text)) actions.push({ kind: "set-rule", rule: "victor-stat", value: "damage", duration });

  const movement: Array<[RegExp, Extract<RuleAction, { kind: "move" }>["verb"], Extract<RuleAction, { kind: "move" }>["object"]]> = [
    [/destroy .*hero/i, "destroy", "hero"], [/destroy .*evo/i, "destroy", "evo"], [/destroy .*energy/i, "destroy", "energy"],
    [/return .*hand/i, "return", "card"], [/retract .*bakugan/i, "retract", "bakugan"], [/attach .*bakucore/i, "attach", "bakucore"],
    [/remove .*bakucore/i, "remove", "bakucore"], [/return .*bakucore.*field face down/i, "return", "bakucore"],
    [/shuffle .*discard/i, "shuffle", "card"], [/take control .*hero/i, "control", "hero"], [/put this into .*hand/i, "return", "card"],
  ];
  for (const [pattern, verb, object] of movement) {
    if (pattern.test(text)) actions.push({ kind: "move", verb, object, amount: /two|all/i.test(text) ? (/two/i.test(text) ? 2 : 99) : 1 });
  }
  if (/destroy this/i.test(text)) actions.push({ kind: "move", verb: "destroy", object: "hero", amount: 1 });
  if (/turn a BakuCore .*face up/i.test(text)) actions.push({ kind: "reveal", object: "bakucore", amount: 1 });
  const reorder = text.match(/(?:look at|reveal) the top (a|an|one|two|three|four|five|\d+) cards?.*put them on top.*any order/i);
  if (reorder) actions.push({ kind: "reorder-deck", amount: numberValue(reorder[1]) });
  if (/reveal the top card of your deck/i.test(text)) actions.push({ kind: "reveal", object: "deck-top", amount: 1 });
  if (/play (?:it|this card) for free/i.test(text)) actions.push({ kind: "play", source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck", free: true });
  if (/play a card from your hand for free/i.test(text)) actions.push({ kind: "play", source: "hand", free: true });
  const attack = text.match(/makes? an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] attack for (\d+) \[Damage Rating\]/i);
  if (attack) actions.push({ kind: "attack", faction: attack[1] as Faction, amount: Number(attack[2]) });
  if (/draw all remaining damage from an attack/i.test(text)) actions.push({ kind: "damage-to-hand" });
  if (/^end the turn|nothing else can happen this turn/i.test(text)) actions.push({ kind: "end-turn", recharge: false });
  if (/shuffle your deck/i.test(text)) actions.push({ kind: "shuffle-deck" });
  if (/negate an action/i.test(text)) actions.push({ kind: "negate", cardType: "Action", copy: /copy/i.test(text), targetChoiceId: "mode" });
  if (/negate a hero/i.test(text)) actions.push({ kind: "negate", cardType: "Hero", copy: false, targetChoiceId: "mode" });
  if (/search your deck/i.test(text)) actions.push({ kind: "search", cardType: text.match(/for an? (Action|Hero|Evo|Flip)/i)?.[1], amount: 1 });
  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action", independentChoices: true });

  const trigger = triggerFor(text);
  if (trigger) actions.push({ kind: "trigger", event: trigger.event, definition: trigger });
  if (/your Bakugan have|opposing Bakugan|while|as long as|maximum of \d+ damage/i.test(text)) {
    const stat = /damage/i.test(text) ? "damage" as const : "power" as const;
    const amount = Number(text.match(/([+-]\d+)/)?.[1] ?? 0);
    actions.push({
      kind: "continuous",
      modifier: {
        id: `${cardId(card)}:continuous:${actions.length}`,
        source: { kind: "card", instanceId: card.id, catalogId: cardId(card) },
        controllerId: "",
        target: /opposing/i.test(text) ? "all-enemy" : "all-friendly",
        stat,
        amount,
        layer: "continuous",
        duration: "while-source-active",
        condition: conditionFor(text),
        createdTurn: 0,
        sourceCategory: "continuous",
      },
    });
  }

  if (!actions.length) actions.push({ kind: "sequence", effects: [] });
  return actions;
}

function splitInstructions(card: GameCard, source: string): RuleInstruction[] {
  const normalized = source.trim();
  const clauses = normalized
    ? normalized.split(/(?<=\.)\s+|\n+/).map((clause) => clause.trim()).filter(Boolean)
    : [""];
  return clauses.map((clause, index) => {
    const condition = conditionFor(clause);
    let effects = parseAtomicEffects(card, clause);
    if (card.number === 152) effects = effects.filter((effect) => effect.kind !== "discard");
    if (!effects.length) effects = [{ kind: "sequence", effects: [] }];
    if (REPLACEMENT_CARD_NUMBERS.has(card.number) && /instead/i.test(clause)) {
      const parts = clause.split(/\binstead\b/i);
      const before = parseAtomicEffects(card, parts[0] ?? "");
      const after = parseAtomicEffects(card, parts.slice(1).join(" instead "));
      effects = [{ kind: "conditional", condition, whenTrue: after, whenFalse: before, replacement: true }];
    }
    return {
      id: `${cardId(card)}:instruction:${index}`,
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
  if (/choose (?:a|an|one).*Bakugan|target .*Bakugan|retract a Bakugan/i.test(text)) result.push(choice("targetBakuganId", timing, "chosen-bakugan", "Choose a Bakugan"));
  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "controller", "Choose a player"));
  if (/destroy a hero|choose a hero|take control of a hero/i.test(text)) result.push(choice("targetHeroId", timing, "hero", "Choose a Hero"));
  if (/destroy an evo|choose an evo/i.test(text)) result.push(choice("targetEvoId", timing, "evo", "Choose an Evo"));
  if (/destroy (?:an?|two) (?:enemy )?energy|choose an energy/i.test(text)) result.push(choice("targetEnergyIds", timing, "energy-card", "Choose Energy"));
  if (/attach a bakucore|remove .*bakucore|choose a bakucore|turn a bakucore/i.test(text)) result.push(choice("coreCell", timing, "bakucore", "Choose a BakuCore"));
  if (/sacrifice|discard (?:a|an|one|two|three|any|up to)|cards? from your hand/i.test(text)) {
    result.push(choice("discardCardIds", timing, "hand-card", /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard", /up to|any number/i.test(text), /opponent/i.test(text) ? "opponent" : "controller", "private"));
  }
  if (/search your deck/i.test(text)) result.push(choice("deckCardId", timing, "deck-card", "Choose a card from your deck", false, "controller", "private"));
  if (/top .*cards?.*any order/i.test(text)) result.push(choice("orderedCardIds", timing, "deck-card", "Order the revealed cards", false, "controller", "private"));
  if (card.cost === "X" || /choose (?:a value for )?x/i.test(text)) result.push(choice("xValue", "pay", "number", "Choose X"));
  if (/\bmay\b/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));
  return result.filter((item, index, values) => values.findIndex((candidate) => candidate.id === item.id && candidate.timing === item.timing) === index);
}

function costModifiersFor(card: GameCard): CostEffect[] {
  const result: CostEffect[] = [];
  const text = card.effect;
  for (const match of text.matchAll(/costs? (\d+) \[Energy\] less/gi)) result.push({ kind: "cost-reduce", amount: Number(match[1]), duration: durationFor(text), condition: conditionFor(text) });
  if (/play this for free|this is free/i.test(text)) result.push({ kind: "cost-free", duration: durationFor(text), condition: conditionFor(text) });
  if (card.number === 152) {
    result.push({ kind: "cost-discard", amount: 1, choiceId: "discardCardIds" });
    result.push({ kind: "cost-alternative", label: "Discard a card instead of paying the printed Energy cost", components: [{ kind: "cost-discard", amount: 1, choiceId: "discardCardIds" }] });
  }
  return result;
}

function evoIdentities(card: GameCard): RulesCardId[] {
  if (card.type !== "Evo" || !card.evolvesFrom) return [];
  const normalize = (value: string) => value.replace(/\s*\(Battle Brawlers\)\s*$/i, "").replace(/\s+/g, " ").trim().toLowerCase();
  const candidates = CARDS.filter((candidate) => candidate.type === "Character"
    && normalize(candidate.displayName || candidate.name) === normalize(card.evolvesFrom ?? "")
    && (card.factions?.length ? card.factions.includes(candidate.faction) : candidate.faction === card.faction));
  return candidates.slice(0, 1).map((candidate) => cardId(candidate));
}

function playDefinition(card: GameCard): CardPlayDefinition {
  const choices = choicesForText(card, card.effect, "announce");
  if (card.number === 1 && !choices.some((item) => item.selector === "batch-object")) {
    choices.unshift(choice("mode", "announce", "batch-object", "Choose the Action effect to negate"));
  }
  if (card.number === 152) {
    const existing = choices.find((item) => item.id === "discardCardIds");
    if (existing) existing.timing = "pay";
    else choices.push(choice("discardCardIds", "pay", "hand-card", "Choose the additional-cost discard", false, "controller", "private"));
  }
  return {
    choices,
    costModifiers: costModifiersFor(card),
    evolvesFrom: evoIdentities(card),
    sourceZones: card.type === "Flip" ? ["damage-reveal"] : ["hand"],
  };
}

function abilityDefinitions(card: GameCard): AbilityDefinition[] {
  const instructions = splitInstructions(card, card.effect);
  const triggered = instructions.filter((instruction) => instruction.effects.some((effect) => effect.kind === "trigger"));
  const ordinary = instructions.filter((instruction) => !triggered.includes(instruction));
  const result: AbilityDefinition[] = [];
  if (ordinary.length || !triggered.length) result.push({
    id: `${cardId(card)}:${card.type === "Character" ? "character" : "spell"}`,
    kind: card.type === "Character" ? "character" : card.type === "Hero" && ordinary.some((instruction) => instruction.effects.some((effect) => effect.kind === "continuous")) ? "static" : "spell",
    instructions: ordinary.length ? ordinary : instructions,
  });
  for (const instruction of triggered) {
    const trigger = instruction.effects.find((effect): effect is Extract<RuleAction, { kind: "trigger" }> => effect.kind === "trigger")!;
    result.push({ id: `${cardId(card)}:trigger:${result.length}`, kind: "triggered", trigger: trigger.definition, instructions: [instruction] });
  }
  return result;
}

function definitionForCard(card: GameCard): RuleDefinition {
  const abilities = abilityDefinitions(card);
  return {
    cardId: cardId(card),
    printingId: cardId(card),
    sourceText: card.effect,
    sourceTextFingerprint: textFingerprint(card.effect),
    cardName: card.displayName || card.name,
    cardType: card.type,
    faction: card.faction,
    factions: card.factions,
    implementationStatus: "complete",
    rulesVersion: RULES_PROFILE_VERSION,
    contentVersion: CARD_CATALOGUE_VERSION,
    play: playDefinition(card),
    abilities,
    provenance: provenanceForDefinition(card, abilities),
    goldenTestIds: [`card-golden:${cardId(card)}`],
  };
}
export function authorRuleDefinitionForCard(
  card: GameCard,
): RuleDefinition & { implementationStatus: "draft" } {
  const definition = definitionForCard(card);
  return {
    ...definition,
    implementationStatus: "draft",
    provenance: {
      authorityOrder: [...definition.provenance.authorityOrder],
      citations: definition.provenance.citations.map((citation) => ({ ...citation })),
      reviewed: false,
    },
    goldenTestIds: [],
  };
}

const DEFINITIONS = Object.freeze(CARDS.map(definitionForCard));
const BY_ID = new Map(DEFINITIONS.map((definition) => [definition.cardId, definition]));

export class UnsupportedCardTextError extends Error {
  constructor(public readonly code: "UNKNOWN_CARD_DEFINITION" | "CARD_TEXT_MISMATCH" | "UNSUPPORTED_RULE_NODE", message: string) {
    super(message);
    this.name = "UnsupportedCardTextError";
  }
}

export function allRuleDefinitions(): readonly RuleDefinition[] {
  return DEFINITIONS;
}

export function ruleDefinitionForCard(card: GameCard): RuleDefinition {
  const definition = BY_ID.get(cardId(card));
  if (!definition) throw new UnsupportedCardTextError("UNKNOWN_CARD_DEFINITION", `No typed rule definition exists for ${card.catalogId || card.name}.`);
  if (definition.sourceText !== card.effect) throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} does not match the reviewed rules text for ${definition.cardId}.`);
  return definition;
}

export function validateCardAgainstRules(card: GameCard) {
  const definition = ruleDefinitionForCard(card);
  if (definition.implementationStatus !== "complete") throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} is not a reviewed production definition.`);
  if (definition.sourceTextFingerprint !== textFingerprint(card.effect)) throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} has an invalid text fingerprint.`);
  const provenanceErrors = validateDefinitionProvenance(definition);
  if (provenanceErrors.length) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", provenanceErrors.join(" "));
  for (const ability of definition.abilities) for (const instruction of ability.instructions) {
    if (!instruction.effects.length) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} has an empty typed instruction.`);
    if (instruction.effects.some((effect) => effect.kind === "unsupported")) throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} contains an unsupported rule node.`);
  }
  return true;
}

export function programForCard(card: GameCard, source = card.effect): RuleProgram {
  const definition = ruleDefinitionForCard(card);
  const instructions = definition.abilities.flatMap((ability) => ability.instructions);
  const selected = source === card.effect
    ? instructions
    : instructions.filter((instruction) => instruction.sourceText === source || source.includes(instruction.sourceText));
  if (!selected.length && source.trim()) {
    throw new UnsupportedCardTextError("CARD_TEXT_MISMATCH", `${card.name} attempted to execute unreviewed derived text.`);
  }
  return { cardId: definition.cardId, source, instructions: selected.length ? selected : instructions };
}
