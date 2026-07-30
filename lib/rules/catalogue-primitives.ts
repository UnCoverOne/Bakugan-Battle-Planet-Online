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
  if (/your Bakugan have|your Bakugan get|opposing Bakugan|while|as long as|Treat all BakuCores/i.test(text)) return "while-source-active";
  return "instant";
}

const CORE_TYPE_BY_SYMBOL: Record<string, CoreType> = {
  FT: "Fist",
  FF: "Flaming Fist",
  SD: "Shield",
  MS: "Magic Shield",
  HE: "Helix",
};

export function conditionFor(text: string): RuleCondition {
  const heldCorePrefix = text.match(
    /^\s*(\[(?:FT|FF|SD|MS|HE)\](?:\s*(?:or|and)\s*\[(?:FT|FF|SD|MS|HE)\])*)\s*:/i,
  )?.[1];
  if (heldCorePrefix) {
    const coreTypes = [...heldCorePrefix.matchAll(/\[(FT|FF|SD|MS|HE)\]/gi)]
      .map((match) => CORE_TYPE_BY_SYMBOL[match[1].toUpperCase()])
      .filter((coreType, index, values) => values.indexOf(coreType) === index);
    return { kind: "held-core-type", coreTypes };
  }
  if (/\bFury\b/i.test(text)) return { kind: "fury" };
  if (/\bTurbo\b/i.test(text)) return { kind: "turbo" };
  if (/\bDomination\b/i.test(text)) return { kind: "domination" };
  if (/\bFlow\b/i.test(text)) return { kind: "flow" };
  if (/\bVictor\b/i.test(text)) return { kind: "victor" };
  if (/two or more cards this turn/i.test(text)) return { kind: "cards-played", comparison: "at-least", amount: 2 };
  if (/three or more Hero/i.test(text)) return { kind: "hero-count", comparison: "at-least", amount: 3 };
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
  const faction = text.match(/If (?:you have )?(?:an? )?\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i)?.[1] as Faction | undefined;
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

function scopeFor(text: string): "target" | "all-enemy" | "all-friendly" {
  if (/all enemy Bakugan|(?:enemy|opposing) Bakugan (?:have|get)/i.test(text)) return "all-enemy";
  if (/all (?:of )?your Bakugan|your Bakugan (?:have|get)/i.test(text)) return "all-friendly";
  return "target";
}

export function parseAtomicEffects(card: GameCard, text: string): RuleAction[] {
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
  if (/\+?\[Double\s*Strike\]|\bDouble\s*Strike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "DoubleStrike", duration });
  if (/\+?\[ShadowStrike\]|\bShadowStrike\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });
  if (/\[Stop\]/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });

  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) actions.push({ kind: "draw", amount: numberValue(draw[1]), scale });
  const discard = text.match(/discard (a|an|one|two|three|any|up to|\d+) cards?/i);
  if (discard) {
    const amount = numberValue(discard[1]);
    actions.push({ kind: "discard", amount, minimum: /any number|up to/i.test(text) ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text) });
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
  if (/play (?:an?|the) (?:Action|Hero|Evo|card).*from (?:your )?hand for free|play a card from your hand for free/i.test(text)) actions.push({ kind: "play", source: "hand", free: true });
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

  const trigger = triggerFor(text);
  if (trigger) actions.push({ kind: "trigger", event: trigger.event, definition: trigger });
  if (/your Bakugan have|your Bakugan get|opposing Bakugan|while|as long as|maximum of \d+ damage|Treat all BakuCores/i.test(text)) {
    const stat = /damage/i.test(text) ? "damage" as const : "power" as const;
    const amount = Number(text.match(/([+-]\d+)/)?.[1] ?? 0);
    actions.push({
      kind: "continuous",
      modifier: {
        id: `${ruleCardId(card)}:continuous:${actions.length}`,
        source: { kind: "card", instanceId: card.id, catalogId: ruleCardId(card) },
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
