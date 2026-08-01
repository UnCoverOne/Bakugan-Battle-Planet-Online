import type { CardType, CoreType, Faction, GameCard } from "../game";
import type { RuleAction, RuleCondition, RulesCardId, RulesDuration, TriggerDefinition, TriggerEventName } from "./model";

const NUMBER_WORDS: Record<string, number> = {
  no: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function numberValue(value: string | undefined, fallback = 1) {
  if (!value) return fallback;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || fallback);
}

export function ruleCardId(card: GameCard): RulesCardId {
  return (card.catalogId || `bb-${card.number}`) as RulesCardId;
}

export function durationFor(text: string): RulesDuration {
  if (/next (?:Action|card|Gear)/i.test(text)) return "next-card";
  if (/this turn|until end of turn|rest of the turn/i.test(text)) return "turn";
  if (/your (?:\[[^\]]+\]\s+)?Bakugan (?:have|get)|opposing Bakugan|to your (?:\[[^\]]+\]\s+)?Bakugan|to your attacks|your attacks have|\bthis (?:has|gets)\b|while|as long as|Treat all BakuCores/i.test(text)) return "while-source-active";
  return "instant";
}

const CORE_TYPE_BY_SYMBOL: Record<string, CoreType> = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
};

function coreTypesFor(value: string) {
  return [...value.matchAll(/\[(FT|FF|SD|MS|HE)\]/gi)]
    .map((match) => CORE_TYPE_BY_SYMBOL[match[1].toUpperCase()])
    .filter((coreType, index, values) => values.indexOf(coreType) === index);
}

function controlledCardNames(text: string) {
  const list = text.match(
    /\bif you control (.+?)(?=,\s*(?:you|this|that|your|the)\b|[.;]|$)/i,
  )?.[1];
  if (!list) return [];
  return list
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

export function conditionFor(text: string): RuleCondition {
  if (/if you open on the Reroll/i.test(text)) return { kind: "reroll-opened" };
  const heldCorePrefix = text.match(
    /^\s*(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)\s*:/i,
  )?.[1];
  if (heldCorePrefix) {
    return { kind: "held-core-type", coreTypes: coreTypesFor(heldCorePrefix) };
  }
  const heldCoreCondition = text.match(
    /\bif\s+(?:that|your|the)\s+Bakugan\s+(?:is\s+)?holding\s+(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  )?.[1];
  if (heldCoreCondition) return { kind: "held-core-type", coreTypes: coreTypesFor(heldCoreCondition) };
  if (/\bFury\b/i.test(text)) return { kind: "fury" };
  if (/\bTurbo\b/i.test(text)) return { kind: "turbo" };
  if (/\bDomination\b/i.test(text)) return { kind: "domination" };
  if (/\bFlow\b/i.test(text)) return { kind: "flow" };
  if (/\bVictor\b/i.test(text)) return { kind: "victor" };
  if (/\bSacrifice\b/i.test(text)) return { kind: "selection-made", choiceId: "discardCardIds" };
  if (/two or more cards this turn/i.test(text)) return { kind: "cards-played", comparison: "at-least", amount: 2 };
  const playedFactionCount = text.match(/played a card from (no|a|an|one|two|three|four|five|six|\d+) different factions? this turn/i);
  if (playedFactionCount) return { kind: "factions-played", comparison: "at-least", amount: numberValue(playedFactionCount[1], 1) };
  const heroCount = text.match(/if you have (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more Hero cards? in play/i);
  if (heroCount) return { kind: "hero-count", comparison: "at-least", amount: numberValue(heroCount[1], 1) };
  const energyCount = text.match(/if you have (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more Energy cards in play/i);
  if (energyCount) return { kind: "energy-count", comparison: "at-least", amount: numberValue(energyCount[1], 1) };
  const requiredCards = controlledCardNames(text);
  if (requiredCards.length) return { kind: "controls-named-cards", names: requiredCards };
  const openBakuganCount = text.match(
    /\bif you\s+(only have|have only|have exactly|have at least|have at most|have more than|have fewer than|have)\s+(no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(\s+or more)?\s+open Bakugan\b/i,
  );
  if (openBakuganCount) {
    const wording = openBakuganCount[1].toLowerCase();
    const amount = numberValue(openBakuganCount[2], 0);
    let comparison: Extract<RuleCondition, { kind: "open-bakugan-count" }>["comparison"] = "at-least";
    if (/only|exactly/.test(wording) || amount === 0) comparison = "exactly";
    else if (/at most/.test(wording)) comparison = "at-most";
    else if (/more than/.test(wording)) comparison = "more-than";
    else if (/fewer than/.test(wording)) comparison = "fewer-than";
    else if (/at least/.test(wording) || openBakuganCount[3]) comparison = "at-least";
    return { kind: "open-bakugan-count", comparison, amount };
  }
  const targetFaction = text.match(/\bIf\s+\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i)?.[1] as Faction | undefined;
  if (targetFaction) return { kind: "faction", faction: targetFaction, subject: "target" };
  const teamFaction = text.match(/\bIf\s+(?:you have )?(?:an? )?\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\](?:\s+Bakugan)?/i)?.[1] as Faction | undefined;
  if (teamFaction) return { kind: "faction", faction: teamFaction, subject: "team" };
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
    [/at (?:the )?end of (?:your |the )?turn/i, "TURN_ENDED", "controller"],
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
  if (/sacrifice/i.test(text)) return "sacrificed-card";
  if (/for each other card .*played this turn/i.test(text)) return "other-card-played";
  return text.match(/for each ([^.,]+)/i)?.[1]?.trim();
}

function scopeFor(text: string): "target" | "all-enemy" | "all-friendly" | "all-bakugan" {
  if (/non-\[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i.test(text)) return "all-bakugan";
  if (/all enemy Bakugan|(?:enemy|opposing) Bakugan (?:have|get)/i.test(text)) return "all-enemy";
  if (/all (?:of )?your Bakugan|your (?:\[[^\]]+\]\s+)?Bakugan (?:have|get)|to your (?:\[[^\]]+\]\s+)?Bakugan|to your attacks|your attacks have/i.test(text)) return "all-friendly";
  return "target";
}

function scaleForStat(text: string, match: RegExpMatchArray) {
  const index = match.index ?? 0;
  const trailingClause = text.slice(index + match[0].length).split(/[.;]/, 1)[0] ?? "";
  if (/\bfor each\b/i.test(trailingClause)) return scaleFor(trailingClause);
  const leadingClause = text.slice(0, index).split(/[.;]/).at(-1) ?? "";
  if (/\bfor each\b[^,]*,\s*$/i.test(leadingClause)) return scaleFor(leadingClause);
  return undefined;
}

export function parseAtomicEffects(card: GameCard, text: string): RuleAction[] {
  const actions: RuleAction[] = [];
  const duration = durationFor(text);
  const scale = scaleFor(text);
  const scope = scopeFor(text);

  for (const match of text.matchAll(/([+-]\d+)\s*\[B\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "power", amount: Number(match[1]), scale: scaleForStat(text, match), duration, scope });
  }
  for (const match of text.matchAll(/([+-]\d+)\s*\[Damage (?:Rating|Power)\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "damage", amount: Number(match[1]), scale: scaleForStat(text, match), duration, scope });
  }
  for (const match of text.matchAll(/\+?(\d+)\s*\[FrostStrike\]/gi)) {
    actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale: scaleForStat(text, match), duration, scope });
  }
  if (/\+?\[Double\s*Strike\]|\bDouble\s*Strike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "DoubleStrike", duration });
  if (/\+?\[ShadowStrike\]|\bShadowStrike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });
  if (/\[Stop\]/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });

  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) actions.push({ kind: "draw", amount: numberValue(draw[1]), scale });
  const discard = text.match(/discard (a|an|one|two|three|any|up to|\d+) cards?/i);
  const delayedVictorDiscard = /if you open on the Reroll/i.test(text) && /\bVictor\s*:/i.test(text);
  if (discard && !delayedVictorDiscard) {
    const amount = numberValue(discard[1]);
    const optional = /may discard|any number|up to/i.test(text);
    actions.push({ kind: "discard", amount, minimum: optional ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text) });
  }
  if (/discard (?:their|your) entire hand/i.test(text)) actions.push({ kind: "discard", amount: 99, minimum: 0, maximum: 99 });

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
  if (/\byou win the game\b/i.test(text)) actions.push({
    kind: "win-game",
    reason: `${card.displayName || card.name}'s alternate win condition`,
  });

  const movement: Array<[RegExp, Extract<RuleAction, { kind: "move" }>["verb"], Extract<RuleAction, { kind: "move" }>["object"]]> = [
    [/destroy .*hero/i, "destroy", "hero"], [/destroy .*evo/i, "destroy", "evo"], [/destroy .*energy/i, "destroy", "energy"],
    [/return .*hand/i, "return", "card"], [/retract .*bakugan/i, "retract", "bakugan"], [/attach .*bakucore/i, "attach", "bakucore"],
    [/remove .*bakucore/i, "remove", "bakucore"], [/return .*bakucore.*field face down/i, "return", "bakucore"],
    [/shuffle .*discard/i, "shuffle", "card"], [/take control .*hero/i, "control", "hero"], [/put this into .*hand/i, "return", "card"],
  ];
  for (const [pattern, verb, object] of movement) {
    if (pattern.test(text)) actions.push({ kind: "move", verb, object, amount: /three|two|all/i.test(text) ? (/three/i.test(text) ? 3 : /two/i.test(text) ? 2 : 99) : 1 });
  }
  if (/destroy this/i.test(text)) actions.push({ kind: "move", verb: "destroy", object: "hero", amount: 1 });
  if (/turn a BakuCore .*face up/i.test(text)) actions.push({ kind: "reveal", object: "bakucore", amount: 1 });
  const reorder = text.match(/(?:look at|reveal) the top (a|an|one|two|three|four|five|\d+) cards?.*put them on top.*any order/i);
  if (reorder) actions.push({ kind: "reorder-deck", amount: numberValue(reorder[1]) });
  if (/reveal the top card of (?:your|an opponent's|your opponent's) deck/i.test(text)) actions.push({ kind: "reveal", object: "deck-top", amount: 1 });
  if (/play (?:it|this card) for free/i.test(text)) actions.push({ kind: "play", source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck", free: true });
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play a card from your hand for free|play that Bakugan(?:'s|’s) Evo card for free/i.test(text)) actions.push({ kind: "play", source: "hand", free: true });
  const attack = text.match(/makes? an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] attack for (\d+) \[Damage Rating\]/i);
  if (attack) actions.push({ kind: "attack", faction: attack[1] as Faction, amount: Number(attack[2]) });
  if (/draw all remaining damage from an attack/i.test(text)) actions.push({ kind: "damage-to-hand" });
  if (/^end the turn|nothing else can happen this turn/i.test(text)) actions.push({ kind: "end-turn", recharge: false });
  if (/shuffle your deck/i.test(text)) actions.push({ kind: "shuffle-deck" });
  if (/negate (?:a|an) Hero or Action card/i.test(text)) actions.push({ kind: "negate", cardType: "any", copy: false, targetChoiceId: "mode" });
  else if (/negate an action/i.test(text)) actions.push({ kind: "negate", cardType: "Action", copy: /copy/i.test(text), targetChoiceId: "mode" });
  else if (/negate a hero/i.test(text)) actions.push({ kind: "negate", cardType: "Hero", copy: false, targetChoiceId: "mode" });
  if (/search your deck/i.test(text)) actions.push({ kind: "search", cardType: text.match(/for an? (Action|Hero|Evo|Flip)/i)?.[1], amount: 1 });
  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action", independentChoices: true });
  if (/copy the effect of an Action card/i.test(text)) actions.push({ kind: "copy", target: "batch-action", independentChoices: true });

  const nextCardReduction = text.match(/next card you play(?: this turn)? costs? (\d+) \[Energy\] less/i);
  if (nextCardReduction) actions.push({
    kind: "cost",
    amount: Number(nextCardReduction[1]),
    operation: "reduce",
    duration: "next-card",
  });

  const intrinsicReroll = ["Character", "Evo"].includes(card.type)
    && /(?:once each turn|any time).*miss a Roll|miss a Roll.*(?:once each turn|any time)/i.test(text);
  const rerollDirective = /\b(?:may|must)\s+Reroll\b|\bto\s+Reroll\b/i.test(text);
  if (rerollDirective && !intrinsicReroll) actions.push({
    kind: "reroll",
    target: /opponent(?:'s)?|opposing Bakugan|their Bakugan/i.test(text) ? "opponent" : "controller",
    mandatory: /\bmust Reroll\b/i.test(text),
    requiresDiscard: /discard (?:a|an|one|two|three|\d+) cards? to Reroll/i.test(text),
  });

  const trigger = triggerFor(text);
  if (trigger) actions.push({ kind: "trigger", event: trigger.event, definition: trigger });
  if (!actions.length) actions.push({ kind: "sequence", effects: [] });
  return actions;
}
