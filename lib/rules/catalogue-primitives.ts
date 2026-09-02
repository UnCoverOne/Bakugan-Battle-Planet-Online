import type { CardType, CoreType, Faction, GameCard } from "../game";
import type { RuleAction, RuleCondition, RulesCardId, RulesDuration, TriggerDefinition, TriggerEventName } from "./model";
import { drawPlayerScopeForText, playerScopeForText } from "./primitives";
import type { NumberValue } from "./values";

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
  if (/for the\s+first turn/i.test(text)) return "turn";
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
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (/\bplay this(?: card)? for free on the first turn of the game\b/i.test(normalizedText)) return { kind: "first-turn" };
  if (/^Empower\s*:/i.test(normalizedText)) return { kind: "empower-selected" };
  if (/if an opposing player reduced damage with Armor Rating this turn/i.test(normalizedText)) {
    return { kind: "armor-damage-reduced", subject: "opponent" };
  }
  if (/\bif heads\b/i.test(text)) return { kind: "coin-result", result: "heads" };
  if (/\bif tails\b/i.test(text)) return { kind: "coin-result", result: "tails" };
  if (/\bif that player has no cards in their hand\b/i.test(text)) return {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "property", subject: { kind: "player", owner: "chosen-player" }, property: "hand-size" },
      operator: "==",
      right: 0,
    },
  };
  if (/if you open on the Reroll/i.test(text)) return { kind: "reroll-opened" };
  if (/\bSync:/i.test(text)) return { kind: "selection-made", choiceId: "syncCardId" };
  if (/\bTrifecta:\s*If your Bakugan have three or more BakuCores? (?:attached|attaced) to them\b/i.test(normalizedText)) {
    return {
      kind: "expression",
      expression: {
        kind: "compare-number",
        left: { kind: "count", source: "held-bakucore", owner: "controller" },
        operator: ">=",
        right: 3,
      },
    };
  }
  const heldCorePrefix = text.match(
    /^\s*(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)\s*:/i,
  )?.[1];
  if (heldCorePrefix) {
    return { kind: "held-core-type", coreTypes: coreTypesFor(heldCorePrefix), subject: "target" };
  }
  const stopHeldCoreCondition = text.match(
    /\[Stop\]\s+(?:an?|the)\s+Bakugan\s+(?:is\s+)?holding\s+(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  )?.[1];
  if (stopHeldCoreCondition) {
    return { kind: "held-core-type", coreTypes: coreTypesFor(stopHeldCoreCondition), subject: "attacker" };
  }
  const teamHeldCoreCondition = text.match(
    /\bif\s+(?:one|any)\s+of\s+your\s+Bakugan\s+(?:is|are)\s+holding\s+(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  )?.[1];
  if (teamHeldCoreCondition) {
    return { kind: "held-core-type", coreTypes: coreTypesFor(teamHeldCoreCondition), subject: "controller-team" };
  }
  const selfHeldCoreCondition = text.match(
    /\bif\s+it\s+is\s+holding\s+(?:an?\s+)?(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  )?.[1];
  if (selfHeldCoreCondition) {
    return { kind: "held-core-type", coreTypes: coreTypesFor(selfHeldCoreCondition), subject: "target" };
  }
  const heldCoreCondition = text.match(
    /\bif\s+(that|your|the|an?|opposing|enemy)\s+Bakugan\s+(?:is\s+)?holding\s+(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)/i,
  );
  if (heldCoreCondition) {
    const subject = /opposing|enemy/i.test(heldCoreCondition[1]) ? "opponent-active" : "target";
    return { kind: "held-core-type", coreTypes: coreTypesFor(heldCoreCondition[2]), subject };
  }
  const attachedCoreCount = text.match(
    /\bif this has (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+(or more))?\s+BakuCores? attached to it\b/i,
  );
  if (attachedCoreCount) return {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "property", subject: { kind: "bakugan", selector: "source" }, property: "held-bakucore-count" },
      operator: attachedCoreCount[2] ? ">=" : "==",
      right: numberValue(attachedCoreCount[1], 0),
    },
  };
  const fusionAttachment = /\bif you attach this to a\s+<Fusion>\s+Bakugan/i.test(text);
  if (fusionAttachment) return { kind: "fusion", subject: "target" };
  const attachedGearCount = text.match(
    /\b(?:if|while)\s+(this(?: Bakugan)?|that Bakugan)\s+has\s+(no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s+(or more))?\s+Baku-Gear(?:s)?\s+attached\s+to\s+(?:it|this)\b/i,
  );
  if (attachedGearCount) {
    return {
      kind: "expression",
      expression: {
        kind: "compare-number",
        left: {
          kind: "property",
          subject: { kind: "bakugan", selector: attachedGearCount[1].toLowerCase().startsWith("this") ? "source" : "chosen" },
          property: "baku-gear-count",
        },
        operator: attachedGearCount[3] || /^(?:a|an)$/i.test(attachedGearCount[2]) ? ">=" : "==",
        right: numberValue(attachedGearCount[2], 0),
      },
    };
  }
  if (/\bUnderdog\b|if it has lower \[B\] than the opposing Bakugan/i.test(text)) return { kind: "underdog" };
  if (/\bFury\b/i.test(text)) return { kind: "fury" };
  if (/if your opponent plays a Flip card this turn/i.test(text)) return { kind: "card-type-played", cardType: "Flip", owner: "opponent" };
  if (/if your opponent has no cards in (?:their|his or her) hand/i.test(text)) return {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "property", subject: { kind: "player", owner: "opponent" }, property: "hand-size" },
      operator: "==",
      right: 0,
    },
  };
  if (/\bTurbo\b/i.test(text)) return { kind: "turbo" };
  if (/\bDomination\b/i.test(text)) return { kind: "domination" };
  if (/\bFlow\b/i.test(text)) return { kind: "flow" };
  if (/\bmay discard\b[^.]*\bfor\s+\+/i.test(text)) return { kind: "selection-made", choiceId: "discardCardIds" };
  if (/\bBoost\s*:/i.test(text) && /(?:\[?Victor\]?)[\s]*[-,:]/i.test(text)) return {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "energy", owner: "controller" },
      operator: ">=",
      right: 7,
    },
  };
  if (/(?:\[?Victor\]?)[\s]*[-,:]/i.test(text)) return { kind: "victor" };
  if (/\bSacrifice\b/i.test(text)) return { kind: "selection-made", choiceId: "discardCardIds" };
  if (/two or more cards this turn/i.test(text)) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "cards-played", owner: "controller" }, operator: ">=", right: 2 } };
  const playedFactionCount = text.match(/(?:played a card|play cards) from (no|a|an|one|two|three|four|five|six|\d+) different factions? (?:in the same turn|this turn)/i);
  if (playedFactionCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "factions-played", owner: "controller" }, operator: ">=", right: numberValue(playedFactionCount[1], 1) } };
  const heroCount = text.match(/if you (?:have|control) (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more Hero cards? in play/i);
  if (heroCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "hero", owner: "controller" }, operator: ">=", right: numberValue(heroCount[1], 1) } };
  const energyCount = text.match(/if you have (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(\s+or more)? Energy cards in play/i);
  if (energyCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "energy", owner: "controller" }, operator: energyCount[2] ? ">=" : "==", right: numberValue(energyCount[1], 1) } };
  const discardCount = text.match(/if (?:there are|you have) (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) or more cards? in your discard pile/i);
  if (discardCount) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "count", source: "discard", owner: "controller" }, operator: ">=", right: numberValue(discardCount[1], 1) } };
  const playedCost = text.match(/if you(?: have|\'ve)? played a card that costs? (no|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) \[Energy\] or more this turn/i);
  if (playedCost) return { kind: "expression", expression: { kind: "compare-number", left: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "maximum-played-card-cost" }, operator: ">=", right: numberValue(playedCost[1], 1) } };
  const requiredCards = controlledCardNames(text);
  if (requiredCards.length) return { kind: "controls-named-cards", names: requiredCards };
  if (/\bif this is your only open Bakugan\b/i.test(text)) return { kind: "source-only-open-bakugan" };
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
    const operator = comparison === "exactly" ? "=="
      : comparison === "at-least" ? ">="
        : comparison === "at-most" ? "<="
          : comparison === "more-than" ? ">"
            : "<";
    return { kind: "expression", expression: {
      kind: "compare-number",
      left: { kind: "count", source: "open-bakugan", owner: "controller" },
      operator,
      right: amount,
    } };
  }
  const targetFaction = text.match(/\bIf\s+\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i)?.[1] as Faction | undefined;
  if (targetFaction) return { kind: "faction", faction: targetFaction, subject: "target" };
  const teamFaction = text.match(/\bIf\s+(?:you have )?(?:an? )?\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\](?:\s+Bakugan)?/i)?.[1] as Faction | undefined;
  if (teamFaction) return { kind: "faction", faction: teamFaction, subject: "team" };
  if (/\bBoost\s*:/i.test(text)) return {
    kind: "expression",
    expression: {
      kind: "compare-number",
      left: { kind: "count", source: "energy", owner: "controller" },
      operator: ">=",
      right: 7,
    },
  };
  return { kind: "always" };
}

function triggerFor(text: string): TriggerDefinition | undefined {
  if (/^at the start of the game\b/i.test(text)) {
    return { event: "GAME_STARTED", relationship: "controller" };
  }
  if (/if another card causes you to reveal this(?: card)? from your hand/i.test(text)) {
    return {
      event: "CARD_REVEALED_FROM_HAND",
      relationship: "controller",
      source: "self",
      causedByCard: true,
      optional: /\bmay\b/i.test(text),
    };
  }
  if (/when you\s+<Fusion>\s+(?:(?:a|an|another)\s+)?Bakugan/i.test(text)) {
    return { event: "FUSION_COMPLETED", relationship: "controller" };
  }
  if (/when you play your second card with Rapid Fire this turn/i.test(text)) {
    return {
      event: "CARD_PLAYED",
      relationship: "controller",
      cardMechanic: "Rapid Fire",
      interveningCondition: {
        kind: "expression",
        expression: {
          kind: "compare-number",
          left: { kind: "count", source: "cards-played-with-mechanic", owner: "controller", mechanic: "Rapid Fire" },
          operator: "==",
          right: 2,
        },
      },
    };
  }
  const damageThreshold = text.match(/if you deal (\d+) or more damage in an attack/i);
  if (damageThreshold) {
    return {
      event: "ATTACK_DAMAGE_DEALT",
      relationship: "controller",
      optional: /\bmay\b/i.test(text),
      minimumEventAmount: Number(damageThreshold[1]),
    };
  }
  if (/when (?:you flip this|this flips) from your deck/i.test(text)) {
    return {
      event: "CARD_FLIPPED_FROM_DECK",
      relationship: "controller",
      source: "self",
      optional: /\bmay\b/i.test(text),
    };
  }
  const table: Array<[RegExp, TriggerEventName, TriggerDefinition["relationship"], TriggerDefinition["source"]?]> = [
    [/when you\s+Energize\s+a\s+card/i, "ENERGY_CARD_ENERGIZED", "controller"],
    [/when you attach a Baku-Gear to this/i, "BAKU_GEAR_ATTACHED", "controller"],
    [/copy the first Action card you play each turn/i, "CARD_PLAYED", "controller"],
    [/when (?:your |an )?opponent plays/i, "CARD_PLAYED", "opponent"],
    [/when you play this(?: card)?|when this is played/i, "CARD_PLAYED", "controller", "self"],
    [/when you play/i, "CARD_PLAYED", "controller"],
    [/when you select a Bakugan/i, "BAKUGAN_SELECTED", "controller"],
    [/when this opens|when you open a Bakugan/i, "BAKUGAN_OPENED", "controller"],
    [/when you discard|if this is discarded/i, "CARD_DISCARDED", "controller"],
    [/(?:\[?Victor\]?)[\s]*[-,:]/i, "VICTOR_DECLARED", "controller"],
    [/when one of your Bakugan attacks/i, "ATTACK_CREATED", "controller"],
    [/if you take damage/i, "DAMAGE_TAKEN", "controller"],
    [/when you have no cards in hand|when your hand is empty/i, "HAND_EMPTIED", "controller"],
    [/at (?:the )?end of (?:your |the )?turn/i, "TURN_ENDED", "controller"],
  ];
  for (const [pattern, event, relationship, source] of table) {
    if (!pattern.test(text)) continue;
    const printedCardType = text.match(/plays? an? (Action|Hero|Evo|Flip)/i)?.[1];
    const cardType = printedCardType
      ? `${printedCardType[0].toUpperCase()}${printedCardType.slice(1).toLowerCase()}` as CardType
      : undefined;
    const triggerClause = text.split(",", 1)[0] ?? text;
    const factions = event === "CARD_PLAYED"
      ? [...triggerClause.matchAll(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/gi)]
        .map((match) => `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}` as Faction)
        .filter((faction, index, values) => values.indexOf(faction) === index)
      : [];
    return {
      event,
      relationship,
      source,
      cardType,
      ...(/copy the first Action card you play each turn/i.test(text) ? {
        cardType: "Action" as const,
        limit: { kind: "first-each-turn" as const, key: "first-action" },
      } : {}),
      ...(text.match(/costs? (\d+) \[Energy\] or more/i)?.[1]
        ? { minimumPrintedCost: Number(text.match(/costs? (\d+) \[Energy\] or more/i)![1]) }
        : {}),
      ...(/with Battle Mastery/i.test(text) ? { cardMechanic: "Battle Mastery" } : {}),
      ...(factions.length ? { factions } : {}),
      optional: /\bmay\b/i.test(text),
      interveningCondition: /\bif\b/i.test(text) ? conditionFor(text) : undefined,
    };
  }
  return undefined;
}

function dynamicSourceFor(text: string) {
  if (/sacrifice/i.test(text)) return "sacrificed-card";
  if (/for (?:each|every) other card\b.*\bplayed this turn/i.test(text)) return "other-card-played";
  return text.match(/for each ([^.,]+)/i)?.[1]?.trim();
}

function scopeFor(text: string): "target" | "all-enemy" | "all-friendly" | "all-bakugan" {
  if (/non-\[(?:Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i.test(text)) return "all-bakugan";
  if (/all enemy Bakugan|(?:enemy|opposing) Bakugan (?:have|get)/i.test(text)) return "all-enemy";
  if (/all (?:of )?your Bakugan|your (?:\[[^\]]+\]\s+)?Bakugan (?:have|get)|to your (?:\[[^\]]+\]\s+)?Bakugan|to your attacks|your attacks have/i.test(text)) return "all-friendly";
  return "target";
}

function dynamicSourceForStat(text: string, match: RegExpMatchArray) {
  const index = match.index ?? 0;
  const trailingClause = text.slice(index + match[0].length).split(/[.;]/, 1)[0] ?? "";
  if (/\bfor (?:each|every)\b/i.test(trailingClause)) return dynamicSourceFor(trailingClause);
  const leadingClause = text.slice(0, index).split(/[.;]/).at(-1) ?? "";
  if (/\bfor (?:each|every)\b[^,]*,\s*$/i.test(leadingClause)) return dynamicSourceFor(leadingClause);
  return undefined;
}

const multiplyValue = (baseAmount: number, factor: NumberValue): NumberValue => ({
  kind: "product",
  factors: [baseAmount, factor],
});

function numberValueForDynamicAmount(text: string, baseAmount: number, dynamicSource?: string): NumberValue {
  if (!dynamicSource) return baseAmount;
  const grammar = `${dynamicSource} ${text}`;
  if (/sacrificed-card|sacrifice/i.test(dynamicSource)) return multiplyValue(baseAmount, { kind: "choice-count", choiceId: "discardCardIds" });
  if (/\b(?:destroyed|discarded|shuffled)(?: this way)?\b/i.test(dynamicSource)) {
    return multiplyValue(baseAmount, { kind: "previous-result", property: "amount", scope: "total" });
  }
  if (/other-card-played/i.test(dynamicSource) || /other card.*played this turn/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "cards-played", owner: "controller", offset: -1, minimum: 0 });
  const faction = grammar.match(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\](?:\s+Bakugan)?/i)?.[1] as Faction | undefined;
  if (faction && /Bakugan on your team/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "bakugan", owner: "controller", faction });
  if (faction && /\[[^\]]+\]\s+on your team/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "bakugan", owner: "controller", faction });
  if (/\[FrostStrike\].*Bakugan has|point of \[FrostStrike\]/i.test(grammar)) return multiplyValue(baseAmount, {
    kind: "property",
    subject: { kind: "bakugan", selector: "active", owner: "controller" },
    property: "frost",
  });
  if (/\[Damage Rating\].*Bakugan has|Damage Rating\] your Bakugan has/i.test(grammar)) return multiplyValue(baseAmount, {
    kind: "property",
    subject: { kind: "bakugan", selector: "active", owner: "controller" },
    property: "damage",
  });
  if (/Flip card.*discard/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "discard", owner: "controller", cardType: "Flip" });
  if (/Hero(?: card)?s? (?:you )?(?:have|control)?\s*in play|Hero you have in play|Hero cards? you control/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "hero", owner: "controller" });
  if (/Energy card.*you have|Energy cards? in play/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "energy", owner: "controller" });
  if (/BakuCore.*your Bakugan hold/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "held-bakucore", owner: "controller" });
  if (/Baku-Gear.*attached/i.test(grammar)) return multiplyValue(baseAmount, {
    kind: "property",
    subject: { kind: "bakugan", selector: /attached to this\b/i.test(grammar) ? "source" : "chosen" },
    property: "baku-gear-count",
  });
  if (/<Fusion>\s+Bakugan on your team/i.test(grammar)) return multiplyValue(baseAmount, {
    kind: "count",
    source: "fusion-bakugan",
    owner: "controller",
  });
  if (/open Bakugan/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "open-bakugan", owner: "controller" });
  if (/cards? (?:you have )?played this turn/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "cards-played", owner: "controller" });
  if (/different factions?.*played this turn/i.test(grammar)) return multiplyValue(baseAmount, { kind: "count", source: "factions-played", owner: "controller" });
  return baseAmount;
}

export function parseAtomicEffects(card: GameCard, text: string): RuleAction[] {
  const actions: RuleAction[] = [];
  // In “When you <Fusion> another Bakugan, <Fusion> this”, the first token
  // describes the trigger. Only the second token is an executable effect.
  const executableText = text.replace(/^When you\s+<Fusion>[^,]+,\s*/i, "");
  const intrinsicCharacteristic = ["Character", "Evo"].includes(card.type)
    && !/\b(?:when|victor\s*[-:]|at (?:the )?end of|play this)\b/i.test(text);
  const duration = /^at the start of the game\b/i.test(text)
    ? durationFor(text)
    : intrinsicCharacteristic ? "while-source-active" : durationFor(text);
  const scale = dynamicSourceFor(text);
  const scope = scopeFor(text);
  const unfuse = /turn\s+(?:one of your|a|an|one of the)\s+<Fusion>\s+Bakugan\s+face down/i.test(text);
  const fusionAction = !unfuse && /(?:^|[,;:]|\bthen\b|\bmay\b|\bmust\b)\s*<Fusion>(?!\s+Bakugan)/i.test(executableText);
  const fusionEffect: RuleAction | undefined = unfuse
    ? { kind: "fusion", operation: "unfuse", targetChoiceId: "targetBakuganId" }
    : fusionAction ? {
    kind: "fusion",
    operation: "fuse",
    targetChoiceId: /^<Fusion>\s+this\b/i.test(executableText) ? "sourceBakuganId" : undefined,
  } : undefined;

  for (const match of text.matchAll(/([+-]\d+)\s*\[B\]/gi)) {
    actions.push({
      kind: "modify-stat",
      stat: "power",
      amount: numberValueForDynamicAmount(text, Number(match[1]), dynamicSourceForStat(text, match)),
      duration,
      scope,
      targetChoiceId: ruleCardId(card) === "aa-50" ? "targetBakuganId" : undefined,
    });
  }
  for (const match of text.matchAll(/([+-]\d+)\s*\[Damage(?: (?:Rating|Power))?\]/gi)) {
    actions.push({
      kind: "modify-stat",
      stat: "damage",
      amount: numberValueForDynamicAmount(text, Number(match[1]), dynamicSourceForStat(text, match)),
      duration,
      scope,
      targetChoiceId: ruleCardId(card) === "aa-50" ? "secondaryTargetBakuganId" : undefined,
    });
  }
  for (const match of text.matchAll(/(?:^|[&,]\s*)(\d+)\s*\[Damage(?: (?:Rating|Power))?\]/gi)) {
    actions.push({
      kind: "modify-stat",
      stat: "damage",
      amount: Number(match[1]),
      duration,
      scope,
    });
  }
  const previousCardCostDamage = text.match(
    /\+\[Damage (?:Rating|Power)\]\s+equal to\s+(?:(twice)\s+)?the\s+(?:discarded|revealed)\s+card(?:'s|’s)\s+(?:\[Energy\]|Energy)\s+cost/i,
  );
  if (previousCardCostDamage) actions.push({
    kind: "modify-stat",
    stat: "damage",
    amount: multiplyValue(previousCardCostDamage[1] ? 2 : 1, { kind: "previous-result", property: "card-cost" }),
    duration,
    scope,
  });
  for (const match of text.matchAll(/\+?(\d+)\s*\[FrostStrike\]/gi)) {
    const frostScale = dynamicSourceForStat(text, match);
    actions.push({ kind: "modify-stat", stat: "frost", amount: numberValueForDynamicAmount(text, Number(match[1]), frostScale), duration, scope });
  }
  if (/\+?\[Double\s*Strike\]|\bDouble\s*Strike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "DoubleStrike", duration });
  if (/\+?\[ShadowStrike\]|\bShadowStrike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });
  // Armor negation is explicitly bounded by the printed “this turn” clause;
  // do not let intrinsic Evo characteristics widen it to source-active.
  if (/ignore\s+Armor Rating/i.test(text)) actions.push({ kind: "ignore-armor-rating", duration: "turn" });
  if (/\bflip a coin\b/i.test(text)) actions.push({ kind: "coin-flip" });
  if (/\[Stop\]|\bstop the attack\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });

  const drawScope = drawPlayerScopeForText(text);
  const drawThatMany = /\bdraws?\s+that many(?:\s+cards?)?\b/i.test(text);
  const draw = text.match(/(?:\[Draw\]|\bdraws?)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\d+)(?: cards?)?/i);
  const drawToOpponentHandSize = /draw cards until you have as many as your opponent/i.test(text);
  if (drawToOpponentHandSize) {
    actions.push({
      kind: "draw",
      amount: {
        kind: "clamp",
        value: {
          kind: "subtract",
          left: { kind: "property", subject: { kind: "player", owner: "opponent" }, property: "hand-size" },
          right: { kind: "property", subject: { kind: "player", owner: "controller" }, property: "hand-size" },
        },
        minimum: 0,
      },
      playerScope: "controller",
    });
  } else if (drawThatMany) {
    actions.push({
      kind: "draw",
      amount: {
        kind: "previous-result",
        property: "amount",
        scope: drawScope === "all-players" || drawScope === "each-player" ? "chooser" : "total",
      },
      playerScope: drawScope,
    });
  } else if (draw) {
    const fixedAmount = /^x$/i.test(draw[1]) ? 0 : numberValue(draw[1]);
    actions.push({
      kind: "draw",
      amount: /^x$/i.test(draw[1])
        ? { kind: "choice-value", choiceId: "xValue" }
        : numberValueForDynamicAmount(text, fixedAmount, scale),
      playerScope: drawScope,
    });
  }
  const heroEvoProtection = /\bYour\s+(?:Evo cards?\s+and\s+Hero cards?|Hero cards?\s+and\s+Evo cards?)\s+(?:can't|cannot)\s+be\s+destroyed\s+this\s+turn\b/i.test(text);
  if (heroEvoProtection) {
    actions.push({ kind: "prevention", event: "DESTROY", object: "evo", playerScope: "controller" });
    actions.push({ kind: "prevention", event: "DESTROY", object: "hero", playerScope: "controller" });
  }
  const discard = text.match(/\bdiscards?\s+(a|an|one|two|three|any|up to|\d+)(?:\s+(?:Action|Evo|Flip|Hero|Character))?\s+cards?/i);
  const delayedVictorDiscard = /if you open on the Reroll/i.test(text) && /\bVictor\s*:/i.test(text);
  const discardPaysPlayCost = /\bdiscard\s+(?:a|an|one|two|three|\d+)\s+cards?\s+to play this for free\b/i.test(text);
  if (discard && !delayedVictorDiscard && !discardPaysPlayCost) {
    const amount = numberValue(discard[1]);
    const optional = /may discard|any number|up to/i.test(text);
    actions.push({ kind: "discard", amount, minimum: optional ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text), playerScope: playerScopeForText(text) });
  }
  if (/discard(?:s)? all cards of the chosen faction/i.test(text)) {
    actions.push({
      kind: "discard",
      amount: 99,
      minimum: 0,
      maximum: 99,
      playerScope: "opponent",
      factionChoiceId: "mode",
    });
  }
  if (/discard (?:their|your) entire hand/i.test(text)) actions.push({ kind: "discard", amount: 99, minimum: 0, maximum: 99, playerScope: playerScopeForText(text) });
  if (/\bdiscard your hand\b/i.test(text)) actions.push({ kind: "discard", amount: 99, minimum: 0, maximum: 99, playerScope: "controller" });

  const energizeEntryState = /\buncharged\b/i.test(text) ? "uncharged" as const : "charged" as const;
  const energize = /when you\s+Energize\s+a\s+card/i.test(text)
    ? null
    : text.match(/energize(?:s)? (?:the top )?(a|an|one|two|three|\d+)?\s*cards?/i);
  if (energize) {
    const eachPlayer = /\beach player\b|\ball players\b|\bboth players\b/i.test(text);
    actions.push({
      kind: "energize",
      amount: numberValueForDynamicAmount(text, numberValue(energize[1]), scale),
      source: /from\s+the\s+top\s+of\s+your\s+deck|the\s+top\s+card\s+of\s+your\s+deck/i.test(text) ? "deck" : /top/i.test(energize[0]) ? "deck" : "hand",
      enters: energizeEntryState,
      playerScope: eachPlayer ? "each-player" : "controller",
      sourceOwner: eachPlayer ? "each-player" : "controller",
      destinationOwner: eachPlayer ? "each-player" : "controller",
    });
  }
  if (/Energize (?:it|that Hero)/i.test(text)) actions.push({
    kind: "energize",
    amount: 1,
    source: "hero",
    enters: energizeEntryState,
  });
  if (/Energize this(?: uncharged|\b)/i.test(text)) actions.push({
    kind: "energize",
    amount: 1,
    source: "self",
    enters: energizeEntryState,
  });
  if (/Energize each card in your discard pile/i.test(text)) actions.push({
    kind: "energize",
    amount: { kind: "count", source: "discard", owner: "controller" },
    source: "discard",
    enters: energizeEntryState,
    playerScope: "controller",
    sourceOwner: "controller",
    destinationOwner: "controller",
  });
  if (/Energize any number of cards in your hand/i.test(text)) actions.push({
    kind: "energize",
    amount: { kind: "choice-count", choiceId: "handCardIds" },
    source: "hand",
    enters: energizeEntryState,
    playerScope: "controller",
    sourceOwner: "controller",
    destinationOwner: "controller",
  });

  const uncharge = text.match(/\buncharge\s+(?:(all)\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)?\s*Energy cards?\b/i);
  if (uncharge) actions.push({
    kind: "uncharge-energy",
    amount: uncharge[1] ? "all" : numberValue(uncharge[2]),
    playerScope: /\bopponent\b/i.test(text) ? "opponent" : playerScopeForText(text),
    producesEnergy: false,
    preventChargeStepRecharge: /do not recharge at the end of the turn|does not recharge at the end of the turn/i.test(text),
  });
  const recharge = text.match(/\brecharge\s+(?:(?:all\s+of\s+)?your\s+)?(?:(up to)\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)?\s*Energy cards?\b/i);
  if (recharge) actions.push({
    kind: "recharge-energy",
    amount: recharge[2] ? numberValue(recharge[2]) : "all",
  });

  const generatedEnergy = text.match(/\+(\d+) \[Energy\]/i);
  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: numberValueForDynamicAmount(text, Number(generatedEnergy[1]), scale), playerScope: playerScopeForText(text) });
  const paidEnergy = text.match(/\bpay\s+(\d+)\s+\[Energy\]/i);
  if (paidEnergy) actions.unshift({ kind: "pay-energy", amount: Number(paidEnergy[1]) });
  const setPower = text.match(/\[B\] becomes (\d+)/i);
  if (setPower) actions.push({ kind: "set-stat", stat: "power", value: Number(setPower[1]) });
  const setDamage = text.match(/\[Damage Rating\] becomes (\d+)/i);
  if (setDamage) actions.push({ kind: "set-stat", stat: "damage", value: Number(setDamage[1]) });
  if (/Victor is decided by highest \[Damage Rating\]/i.test(text)) actions.push({ kind: "set-rule", rule: "victor-stat", value: "damage", duration });
  if (/\byou win the game\b/i.test(text)) actions.push({
    kind: "win-game",
    reason: `${card.displayName || card.name}'s alternate win condition`,
  });

      const swapsBakucore = /\bswap\b[^.]*BakuCores?/i.test(text) && /opposing Bakugan/i.test(text);
      if (swapsBakucore) actions.push({
        kind: "swap-bakucore",
        leftHolder: /this Bakugan(?:['’]s)?/i.test(text) ? "source-bakugan" : "controller-active",
        rightHolder: "opponent-active",
        leftCoreChoiceId: "coreCell",
        rightCoreChoiceId: "secondaryCoreCell",
      });

      const movement: Array<[RegExp, Extract<RuleAction, { kind: "move" }>["verb"], Extract<RuleAction, { kind: "move" }>["object"]]> = [
    [/destroy .*hero/i, "destroy", "hero"], [/destroy .*evo/i, "destroy", "evo"], [/destroy .*energy/i, "destroy", "energy"], [/destroy .*Baku-Gear/i, "destroy", "baku-gear"],
    [/return (?:one of )?(?:your )?Baku-Gear .*hand/i, "return", "baku-gear"], [/return (?!.*Baku-Gear).*hand/i, "return", "card"], [/retract .*bakugan/i, "retract", "bakugan"], [/attach .*bakucore/i, "attach", "bakucore"], [/attach (?:this|a|an|one) .*Bakugan/i, "attach", "baku-gear"],
    [/remove .*bakucore/i, "remove", "bakucore"], [/(?:return|place) .*bakucore.*field face down/i, "return", "bakucore"],
    [/shuffle .*?(?:discard|from your hand into your deck)/i, "shuffle", "card"], [/take control and attach .*Baku-Gear/i, "control", "baku-gear"], [/take control .*hero/i, "control", "hero"], [/put this into .*hand/i, "return", "card"],
  ];
  if (/(?:return|put|place)\s+this\s+(?:to|on)\s+the\s+bottom\s+of\s+(?:your|its owner['’]s)\s+deck/i.test(text)) {
    actions.push({
      kind: "move",
      verb: "return",
      object: "card",
      amount: 1,
      subject: "self",
      destination: "owner-deck-bottom",
    });
  }
  for (const [pattern, verb, object] of movement) {
    if (!pattern.test(text)) continue;
    if (verb === "destroy" && object === "energy" && /destroy all but/i.test(text)) continue;
    const amount: NumberValue = /any number/i.test(text)
      ? { kind: "choice-count", choiceId: /from your hand/i.test(text) ? "handCardIds" : "discardCardIds" }
      : /\bthree\b|\btwo\b|\ball\b/i.test(text) ? (/\bthree\b/i.test(text) ? 3 : /\btwo\b/i.test(text) ? 2 : 99) : 1;
    const playerScope = verb === "destroy" && object === "hero" && /destroy all Hero cards? in play/i.test(text)
      ? "all-players" as const
      : verb === "destroy" && object === "evo" && /destroy all other Evos/i.test(text)
        ? "all-players" as const
        : undefined;
    const movementAction: Extract<RuleAction, { kind: "move" }> = {
      kind: "move",
      verb,
      object,
      amount,
      ...(playerScope ? { playerScope } : {}),
      ...(/destroy all other Evos/i.test(text) ? { excludeSource: true } : {}),
    };
    actions.push(/after this attack/i.test(text)
      ? { kind: "schedule", timing: "after-attack", effects: [movementAction] }
      : movementAction);
  }
  const destroyAllButEnergy = text.match(/both players must destroy all but (one|two|three|four|five|\d+) Energy cards they have/i);
  if (destroyAllButEnergy) {
    actions.push({
      kind: "move",
      verb: "destroy",
      object: "energy",
      amount: 99,
      playerScope: "each-player",
      retainChoiceId: "targetEnergyIds",
    });
  }
  if (/destroy this/i.test(text)) actions.push({ kind: "move", verb: "destroy", object: "hero", amount: 1 });
  if (/turn a BakuCore .*face up/i.test(text)) actions.push({ kind: "reveal", object: "bakucore", amount: 1 });
  const reorder = text.match(/(?:look at|reveal) the top (a|an|one|two|three|four|five|\d+) cards?.*put them on top.*any order/i);
  if (reorder) actions.push({ kind: "reorder-deck", amount: numberValue(reorder[1]) });
  if (/reveal the top card of (?:your|an opponent's|your opponent's) deck/i.test(text)) actions.push({
    kind: "reveal",
    object: "deck-top",
    amount: 1,
    sourceOwner: /opponent['’]s deck/i.test(text) ? "opponent" : "controller",
  });
  if (/if another card causes you to reveal this(?: card)? from your hand[\s\S]*play this for free/i.test(text)) actions.push({
    kind: "play",
    source: "revealed-hand",
    free: true,
  });
  if (/play (?:it|this card) for free/i.test(text)
    && !/if another card causes you to reveal this(?: card)? from your hand/i.test(text)) actions.push({
    kind: "play",
    source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck",
    free: true,
  });
  if (/play a Rapid Fire in your discard pile for free/i.test(text)) actions.push({
    kind: "play",
    source: "discard",
    free: true,
    cardMechanic: "Rapid Fire",
    sourceOwner: "controller",
  });
  const persistentFreePermission = /for the rest of the turn,\s*both players may play Evo cards from their hand for free/i.test(text);
  const freeFactionPlay = text.match(/play\s+an?\s+\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+card(?:\s+(?:with cost|that costs?)\s+(\d+)\s+\[Energy\]\s+or less)?\s+for free/i);
  if (/play a \[Dual\] Baku-Gear for free/i.test(text)) actions.push({
    kind: "play",
    source: "hand",
    free: true,
    cardType: "Baku-Gear",
    cardMechanic: "Dual Wield",
    sourceOwner: "controller",
  });
  if (freeFactionPlay) actions.push({
    kind: "play",
    source: "hand",
    free: true,
    factions: [freeFactionPlay[1] as Faction],
    maximumCost: freeFactionPlay[2] ? Number(freeFactionPlay[2]) : undefined,
    sourceOwner: "controller",
  });
  const namedFreePlay = !freeFactionPlay
    ? text.match(/play\s+\[([A-Za-z]+)\]\s+([A-Za-z][A-Za-z0-9'’ -]*?)\s+for free/i)
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
  const freeHandPlay = text.match(/play\s+(?:an?|the|any|another)?\s*(Action|Hero|Evo|non-Flip|card)(?:\s+cards?)?(?:\s+from\s+(?:your\s+)?hand|\s+from\s+it|\s+revealed this way)?(?:\s+(?:that costs?|with cost)\s+(\d+)\s+\[Energy\]\s+or less)?\s+for free|play that Bakugan(?:'s|’s) Evo card for free/i);
  if (freeHandPlay && !persistentFreePermission && !freeFactionPlay && !namedFreePlay && !chosenCardFreePlay) actions.push({
    kind: "play",
    source: /revealed this way/i.test(text) ? "revealed-deck" : "hand",
    free: true,
    cardType: /that Bakugan(?:'s|’s) Evo/i.test(text) ? "Evo" : (freeHandPlay[1] && !/^(?:card|non-Flip)$/i.test(freeHandPlay[1]) ? freeHandPlay[1] as CardType : undefined),
    excludedCardTypes: /^non-Flip$/i.test(freeHandPlay[1] ?? "") ? ["Flip", "Flip Hero"] : undefined,
    maximumCost: freeHandPlay[2] ? Number(freeHandPlay[2]) : undefined,
    sourceOwner: /from it|opponent(?:'s|’s) hand/i.test(text) ? "opponent" : "controller",
    destinationOwner: /opponent(?:'s|’s) discard pile/i.test(text) ? "opponent" : undefined,
  });
  const paidHandPlay = text.match(/play\s+an?\s+(Action|Hero|Evo)\s+card\s+that costs?\s+(\d+)\s+\[Energy\]\s+or less(?!\s+for free)/i);
  if (paidHandPlay) actions.push({
    kind: "play",
    source: "hand",
    free: false,
    cardType: paidHandPlay[1] as CardType,
    maximumCost: Number(paidHandPlay[2]),
    sourceOwner: "controller",
  });
  if (persistentFreePermission) actions.push({
    kind: "cost", amount: 0, operation: "free", duration: "turn", cardType: "Evo", playerScope: "all-players",
  });
  const attack = text.match(/makes? an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] attack for (\d+) \[Damage(?: Rating)?\]/i);
  if (attack) actions.push({ kind: "attack", faction: attack[1] as Faction, amount: Number(attack[2]) });
  if (/draw all remaining damage from an attack/i.test(text)) actions.push({ kind: "damage-to-hand" });
  if (/^end the turn|nothing else can happen this turn/i.test(text)) actions.push({ kind: "end-turn", recharge: false });
  if (/shuffle your deck/i.test(text)) actions.push({ kind: "shuffle-deck" });
  const negateMaximumCost = Number(text.match(/costs? (\d+) \[Energy\] or less/i)?.[1] ?? Number.NaN);
  const negateLimit = Number.isFinite(negateMaximumCost) ? negateMaximumCost : undefined;
  if (/negate (?:a|an) Hero or Action card/i.test(text)) actions.push({
    kind: "negate", cardType: "any", copy: false, targetChoiceId: "targetEffectId",
    maximumCost: negateLimit, targetKinds: ["card"],
  });
  else if (/negate a Baku-Gear(?: card)?/i.test(text)) actions.push({
    kind: "negate", cardType: "Baku-Gear", copy: false, targetChoiceId: "targetEffectId",
    maximumCost: negateLimit, targetKinds: ["card"],
  });
  else if (/negate an action/i.test(text)) actions.push({
    kind: "negate", cardType: "Action", copy: /copy/i.test(text), targetChoiceId: "targetEffectId",
    maximumCost: negateLimit, targetKinds: ["card"],
  });
  else if (/negate a hero/i.test(text)) actions.push({
    kind: "negate", cardType: "Hero", copy: false, targetChoiceId: "targetEffectId",
    maximumCost: negateLimit, targetKinds: ["card"],
  });
  if (/search your deck/i.test(text)) actions.push({ kind: "search", cardType: text.match(/for an? (Action|Hero|Evo|Flip)/i)?.[1], amount: 1 });
  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action", independentChoices: true, count: { kind: "constant", value: 1 }, controller: "controller" });
  if (/copy the first Action card you play each turn/i.test(text)) actions.push({ kind: "copy", target: "played-action", independentChoices: true, count: 1, controller: "controller" });
  if (/Action card is revealed this way, you may copy its effect/i.test(text)) actions.push({ kind: "copy", target: "revealed-action", independentChoices: true, count: 1, controller: "controller", sourceOwner: "opponent" });
  if (/copy the effect of an Action card that was discarded this turn/i.test(text)) actions.push({ kind: "copy", target: "discarded-action-this-turn", independentChoices: true, targetChoiceId: "targetCardId", count: { kind: "constant", value: 1 }, controller: "controller" });
  else if (/copy the effect of an Action card|copy an? Action card(?:'s|’s) effect/i.test(text)) actions.push({ kind: "copy", target: "batch-action", independentChoices: true, targetChoiceId: "targetEffectId", count: { kind: "constant", value: 1 }, controller: "controller" });

  const nextEmpowerReduction = text.match(/(?:next card you play(?: this turn)?|your next card) costs? (\d+) \[Energy\] less to Empower/i);
  if (nextEmpowerReduction) actions.push({
    kind: "cost",
    amount: Number(nextEmpowerReduction[1]),
    operation: "reduce",
    duration: "next-card",
    costScope: "empower",
  });
  const nextCardReduction = text.match(/(?:next card you play(?: this turn)?|your next card) costs? (\d+) \[Energy\] less/i);
  if (nextCardReduction && !nextEmpowerReduction) actions.push({
    kind: "cost",
    amount: Number(nextCardReduction[1]),
    operation: "reduce",
    duration: "next-card",
  });
  if (/you may Empower the next card you play(?: this turn)? for free/i.test(text)) actions.push({
    kind: "cost",
    amount: 0,
    operation: "free",
    duration: "next-card",
    costScope: "empower",
  });

  const intrinsicReroll = ["Character", "Evo"].includes(card.type)
    && /(?:once each turn|any time).*miss a Roll|miss a Roll.*(?:once each turn|any time)/i.test(text);
  const rerollDirective = /\b(?:may|must)\s+Reroll\b|\bto\s+Reroll\b|^\s*Reroll\b/i.test(text);
  if (rerollDirective && !intrinsicReroll) actions.push({
    kind: "reroll",
    target: /opponent(?:'s)?|opposing Bakugan|their Bakugan/i.test(text) ? "opponent" : "controller",
    mandatory: /\bmust Reroll\b/i.test(text),
    requiresDiscard: /discard (?:a|an|one|two|three|\d+) cards? to Reroll/i.test(text),
  });

  // In “Sync ... to Draw, then choose ...” the discard action is discovered
  // from the trailing choice wording before the draw action is emitted. Put
  // the executable effects back in the printed order after parsing.
  if (/\bSync:/i.test(text) && /\bthen choose a player to discard/i.test(text)) {
    const drawIndex = actions.findIndex((action) => action.kind === "draw");
    const discardIndex = actions.findIndex((action) => action.kind === "discard");
    if (drawIndex >= 0 && discardIndex >= 0 && discardIndex < drawIndex) {
      const [discardAction] = actions.splice(discardIndex, 1);
      actions.splice(drawIndex - 1, 0, discardAction);
    }
  }

  const syncEvoDamage = /\bSync:/i.test(text)
    && /reveal an? Evo in your hand for \+\[Damage\] equal to that Evo['’]s/i.test(text);
  if (syncEvoDamage) actions.push({
    kind: "modify-stat",
    stat: "damage",
    amount: {
      kind: "property",
      subject: { kind: "card", selector: "chosen", choiceId: "syncCardId" },
      property: "damage",
    },
    duration,
    scope,
  });

  if (fusionEffect) actions.push(fusionEffect);

  // Sync owns its timing through the keyword's gated instruction when it is
  // merely part of another event. A printing such as “Sync: When you play
  // this” still has a real self-entry trigger and must retain it.
  const syncHasSelfEntry = /\bSync:/i.test(text)
    && /when you play this(?: card)?|when this is played/i.test(text);
  const trigger = /\bSync:/i.test(text) && !syncHasSelfEntry ? undefined : triggerFor(text);
  if (trigger) actions.push({ kind: "trigger", event: trigger.event, definition: trigger });
  if (!actions.length) actions.push({ kind: "sequence", effects: [] });
  return actions;
}
