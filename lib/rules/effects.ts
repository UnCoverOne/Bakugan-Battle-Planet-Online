import type { CardChoices, GameCard, MatchState } from "../game";

export type Duration = "instant" | "turn" | "while-source-in-play" | "next-card";
export type RuleCondition =
  | { kind: "always" }
  | { kind: "fury" }
  | { kind: "turbo" }
  | { kind: "domination" }
  | { kind: "flow" }
  | { kind: "victor" }
  | { kind: "faction"; faction: string }
  | { kind: "printed"; text: string };

export type RuleAction =
  | { kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: number; scale?: string; duration: Duration; scope?: "target" | "all-enemy" | "all-friendly" }
  | { kind: "grant-keyword"; keyword: "DoubleStrike" | "ShadowStrike" | "FrostStrike" | "Victor" | "Stop"; value?: number; duration: Duration }
  | { kind: "draw"; amount: number; scale?: string }
  | { kind: "discard"; amount: number; minimum: number; maximum: number; repeated?: boolean }
  | { kind: "energize"; amount: number; source: "hand" | "deck" | "hero" | "self" }
  | { kind: "generate-energy"; amount: number; scale?: string }
  | { kind: "set-stat"; stat: "power" | "damage"; value: number }
  | { kind: "set-rule"; rule: "victor-stat"; value: "power" | "damage"; duration: Duration }
  | { kind: "damage-to-hand" }
  | { kind: "end-turn"; recharge: boolean }
  | { kind: "shuffle-deck" }
  | { kind: "move"; object: "card" | "hero" | "evo" | "energy" | "bakucore" | "bakugan"; verb: "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control"; amount: number }
  | { kind: "reveal"; object: "bakucore" | "deck-top"; amount: number }
  | { kind: "reorder-deck"; amount: number }
  | { kind: "play"; source: "revealed-deck" | "hand" | "self"; free: boolean }
  | { kind: "attack"; amount: number; faction?: string }
  | { kind: "negate"; cardType: "Action" | "Hero" | "any"; copy: boolean }
  | { kind: "search"; cardType?: string; amount: number }
  | { kind: "copy"; target: "next-action" | "batch-action" }
  | { kind: "cost"; amount: number; operation: "reduce" | "increase" | "free"; duration: Duration }
  | { kind: "choice"; mode: "may" | "up-to" | "any-number" | "x" | "modes" | "opponent" | "simultaneous" | "target" }
  | { kind: "trigger"; event: string }
  | { kind: "continuous"; text: string }
  | { kind: "rules-text"; text: string };

export type RuleInstruction = {
  condition: RuleCondition;
  actions: RuleAction[];
  sourceText: string;
};

export type RuleProgram = {
  cardId: string;
  source: string;
  instructions: RuleInstruction[];
};

const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numberValue = (value?: string) => WORDS[String(value).toLowerCase()] ?? Math.max(0, Number(value) || 1);

function conditionFor(text: string): RuleCondition {
  if (/\bFury\b/i.test(text)) return { kind: "fury" };
  if (/\bTurbo\b/i.test(text)) return { kind: "turbo" };
  if (/\bDomination\b/i.test(text)) return { kind: "domination" };
  if (/\bFlow\b/i.test(text)) return { kind: "flow" };
  if (/\bVictor\b/i.test(text)) return { kind: "victor" };
  const faction = text.match(/If \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]/i)?.[1];
  if (faction) return { kind: "faction", faction };
  if (/\bif\b/i.test(text) && !/chooses? if (?:it|they|that)/i.test(text)) return { kind: "printed", text };
  return { kind: "always" };
}

function scaleFor(text: string) {
  return text.match(/for each ([^.,]+)/i)?.[1]?.trim();
}

function durationFor(text: string): Duration {
  if (/next (?:Action|card|Gear)/i.test(text)) return "next-card";
  if (/this turn|until end of turn/i.test(text)) return "turn";
  if (/your Bakugan have|opposing Bakugan|while|as long as/i.test(text)) return "while-source-in-play";
  return "instant";
}

function compileClause(text: string): RuleAction[] {
  const actions: RuleAction[] = [];
  const duration = durationFor(text);
  const scale = /sacrifice/i.test(text) ? "sacrificed-card" : scaleFor(text);
  const scope = /all enemy Bakugan/i.test(text) ? "all-enemy" as const
    : /all (?:of )?your Bakugan/i.test(text) ? "all-friendly" as const
      : "target" as const;
  for (const match of text.matchAll(/([+-]\d+)\s*\[B\]/gi)) actions.push({ kind: "modify-stat", stat: "power", amount: Number(match[1]), scale, duration, scope });
  for (const match of text.matchAll(/([+-]\d+)\s*\[Damage (?:Rating|Power)\]/gi)) actions.push({ kind: "modify-stat", stat: "damage", amount: Number(match[1]), scale, duration, scope });
  for (const match of text.matchAll(/\+?(\d+)\s*\[FrostStrike\]/gi)) actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale, duration, scope });
  if (/Double\s*Strike/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "DoubleStrike", duration });
  if (/ShadowStrike/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });
  if (/\[Stop\]/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });

  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (draw) actions.push({ kind: "draw", amount: numberValue(draw[1]), scale });
  const discard = text.match(/discard (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  if (discard) {
    const amount = numberValue(discard[1]);
    actions.push({
      kind: "discard",
      amount,
      minimum: /any number|up to/i.test(text) ? 0 : amount,
      maximum: /any number/i.test(text) ? 99 : amount,
      repeated: /repeat|again|any number/i.test(text),
    });
  }
  if (/any number/i.test(text)) actions.push({ kind: "choice", mode: "any-number" });
  if (/up to/i.test(text)) actions.push({ kind: "choice", mode: "up-to" });
  if (/\bmay\b/i.test(text)) actions.push({ kind: "choice", mode: "may" });
  if (/\bX\b/.test(text)) actions.push({ kind: "choice", mode: "x" });
  if (/\sor\s/i.test(text)) actions.push({ kind: "choice", mode: "modes" });
  if (/opponent chooses|chosen by an opponent/i.test(text)) actions.push({ kind: "choice", mode: "opponent" });
  if (/simultaneously|both players .*choose|each player .*chooses/i.test(text)) actions.push({ kind: "choice", mode: "simultaneous" });
  if (/^choose (?:a|an|one) /i.test(text)) actions.push({ kind: "choice", mode: "target" });

  const energize = text.match(/energize (?:the top )?(a|an|one|two|three|\d+)?\s*cards?/i);
  if (energize) actions.push({ kind: "energize", amount: numberValue(energize[1]), source: /top/i.test(energize[0]) ? "deck" : "hand" });
  if (/Energize (?:it|that Hero)/i.test(text)) actions.push({ kind: "energize", amount: 1, source: "hero" });
  if (/Energize this(?: uncharged|\b)/i.test(text)) actions.push({ kind: "energize", amount: 1, source: "self" });
  if (/Energize this and the top card of your deck/i.test(text)) actions.push({ kind: "energize", amount: 1, source: "deck" });

  const generatedEnergy = text.match(/\+(\d+) \[Energy\]/i);
  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: Number(generatedEnergy[1]), scale });
  const setPower = text.match(/\[B\] becomes (\d+)/i);
  if (setPower) actions.push({ kind: "set-stat", stat: "power", value: Number(setPower[1]) });
  if (/Victor is decided by highest \[Damage Rating\]/i.test(text)) {
    actions.push({ kind: "set-rule", rule: "victor-stat", value: "damage", duration });
  }

  const movement: Array<[
    RegExp,
    "destroy" | "return" | "retract" | "attach" | "remove" | "shuffle" | "control",
    "card" | "hero" | "evo" | "energy" | "bakucore" | "bakugan",
  ]> = [
    [/destroy .*hero/i, "destroy", "hero"], [/destroy .*evo/i, "destroy", "evo"], [/destroy .*energy/i, "destroy", "energy"],
    [/return .*hand/i, "return", "card"], [/retract .*bakugan/i, "retract", "bakugan"], [/attach .*bakucore/i, "attach", "bakucore"],
    [/remove .*bakucore/i, "remove", "bakucore"], [/return .*bakucore.*field face down/i, "return", "bakucore"],
    [/shuffle .*discard/i, "shuffle", "card"], [/take control .*hero/i, "control", "hero"], [/put this into .*hand/i, "return", "card"],
  ];
  for (const [pattern, verb, object] of movement) if (pattern.test(text)) actions.push({ kind: "move", verb, object, amount: /two|all/i.test(text) ? (/two/i.test(text) ? 2 : 99) : 1 });
  if (/destroy this/i.test(text)) actions.push({ kind: "move", verb: "destroy", object: "hero", amount: 1 });

  if (/turn a BakuCore .*face up/i.test(text)) actions.push({ kind: "reveal", object: "bakucore", amount: 1 });
  const reorder = text.match(/(?:look at|reveal) the top (a|an|one|two|three|four|five|\d+) cards?.*put them on top.*any order/i);
  if (reorder) actions.push({ kind: "reorder-deck", amount: numberValue(reorder[1]) });
  if (/reveal the top card of your deck/i.test(text)) actions.push({ kind: "reveal", object: "deck-top", amount: 1 });
  if (/play (?:it|this card) for free/i.test(text)) actions.push({
    kind: "play",
    source: /(?:this is discarded|discard this card)/i.test(text) ? "self" : "revealed-deck",
    free: true,
  });
  if (/play a card from your hand for free/i.test(text)) actions.push({ kind: "play", source: "hand", free: true });
  const attack = text.match(/makes? an? \[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\] attack for (\d+) \[Damage Rating\]/i);
  if (attack) actions.push({ kind: "attack", faction: attack[1], amount: Number(attack[2]) });
  if (/draw all remaining damage from an attack/i.test(text)) actions.push({ kind: "damage-to-hand" });
  if (/^end the turn|nothing else can happen this turn/i.test(text)) actions.push({ kind: "end-turn", recharge: false });
  if (/shuffle your deck/i.test(text)) actions.push({ kind: "shuffle-deck" });

  if (/negate an action/i.test(text)) actions.push({ kind: "negate", cardType: "Action", copy: /copy/i.test(text) });
  if (/negate a hero/i.test(text)) actions.push({ kind: "negate", cardType: "Hero", copy: false });
  if (/search your deck/i.test(text)) actions.push({ kind: "search", cardType: text.match(/for an? (Action|Hero|Evo|Flip)/i)?.[1], amount: 1 });
  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action" });

  const reduction = text.match(/costs? (\d+) \[Energy\] less/i);
  if (reduction) actions.push({ kind: "cost", amount: Number(reduction[1]), operation: "reduce", duration });
  if (/play this for free|this is free/i.test(text)) actions.push({ kind: "cost", amount: 0, operation: "free", duration });

  const trigger = text.match(/\bwhen ([^,:.]+)/i)
    ?? text.match(/\bVictor\s*[-:]/i)
    ?? text.match(/\bif this is discarded\b/i)
    ?? text.match(/\bif you deal \d+ or more damage\b/i)
    ?? text.match(/\bwhen (?:you have no cards in hand|your hand is empty)\b/i)
    ?? text.match(/\bat the end of (?:your |the )?turn\b/i);
  const damageTakenTrigger = text.match(/\bif you take damage\b/i);
  if (trigger || damageTakenTrigger) actions.push({ kind: "trigger", event: trigger?.[1]?.trim() ?? trigger?.[0].trim() ?? damageTakenTrigger![0] });
  if (/your Bakugan have|opposing Bakugan|while|as long as|costs? .* less|additional card each turn|first Action card you play each turn/i.test(text)) actions.push({ kind: "continuous", text });
  if (!actions.length && text.trim()) actions.push({ kind: "rules-text", text: text.trim() });
  return actions;
}

export function compileCardEffect(card: GameCard, source = card.effect): RuleProgram {
  const normalized = source
    .replace(/\.\s*You may use this any number of times\.?/gi, " You may use this any number of times.")
    .replace(/(Look at the top (?:a|an|one|two|three|four|five|\d+) cards? of your deck)\.\s*(Put them on top of your deck in any order)\.?/gi, "$1 and $2.")
    .replace(/(Draw all remaining damage from an attack)\.\s*\(Instead of flipping the cards into your discard pile, put them into your hand\.\)/gi, "$1.")
    .replace(/End the turn\.\s*Nothing else can happen this turn, start the next turn\.\s*\(Cards cannot be played, remaining damage vanishes, and Energy Cards do not recharge\.\)/gi, "End the turn without recharging Energy.");
  const clauses = normalized.split(/(?<=\.)\s+|\n+/).map((clause) => clause.trim()).filter(Boolean);
  return {
    cardId: card.catalogId,
    source,
    instructions: clauses.map((clause) => ({
      condition: conditionFor(clause),
      actions: compileClause(clause),
      sourceText: clause,
    })),
  };
}

export function cardProgramIsExecutable(program: RuleProgram) {
  return program.instructions.every((instruction) => (
    instruction.actions.length > 0
    && instruction.actions.every((action) => action.kind !== "rules-text")
  ));
}

export function estimateProgramValue(program: RuleProgram, match: MatchState, playerId: string, choices: CardChoices = {}) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  const opponent = match.players.find((candidate) => candidate.id !== playerId);
  if (!player || !opponent) return -Infinity;
  let value = 0;
  for (const instruction of program.instructions) for (const action of instruction.actions) {
    if (action.kind === "modify-stat") value += action.amount * (action.stat === "power" ? 0.012 : action.stat === "damage" ? 0.9 : 0.65);
    else if (action.kind === "draw") value += action.amount * 2.4;
    else if (action.kind === "discard") value -= action.amount * 1.4;
    else if (action.kind === "energize") value += action.amount * 2;
    else if (action.kind === "grant-keyword") value += action.keyword === "DoubleStrike" ? 4 : 2.5;
    else if (action.kind === "move") value += ["destroy", "control", "remove"].includes(action.verb) ? action.amount * 3 : 1.5;
    else if (action.kind === "negate") value += match.batch.length ? 5 : -3;
    else if (action.kind === "search") value += 3;
    else if (action.kind === "copy") value += 3.5;
    else if (action.kind === "cost") value += action.operation === "increase" ? -action.amount : Math.max(1, action.amount);
    else if (action.kind === "rules-text") value += 0.4;
  }
  if (choices.confirmed === false) value = 0;
  return value;
}
