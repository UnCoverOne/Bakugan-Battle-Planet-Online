from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


PRIMITIVES = r'''import type { CardChoices, CardType, Faction, MatchState } from "../game";

/** Players affected by an effect, independent of who makes any choices for it. */
export type PlayerScope =
  | "controller"
  | "opponent"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any-player";

/** Player(s) responsible for making a choice. */
export type ChooserOwner = "controller" | "opponent" | "chosen-player" | "each-player";

/** Owner of the zone/object pool from which a choice may select. */
export type ZoneOwner =
  | "controller"
  | "opponent"
  | "chooser"
  | "chosen-player"
  | "each-player"
  | "all-players"
  | "any";

export type OwnershipContext = {
  controllerId: string;
  chooserId?: string;
  chosenPlayerId?: string;
  choices?: CardChoices;
};

function knownPlayerIds(match: MatchState) {
  return match.players.map((player) => player.id);
}

function uniqueKnownPlayers(match: MatchState, values: Array<string | undefined>) {
  const known = new Set(knownPlayerIds(match));
  return values.filter((value): value is string => Boolean(value && known.has(value)))
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function playerIdsForScope(
  match: MatchState,
  scope: PlayerScope,
  context: OwnershipContext,
): string[] {
  const chosen = context.chosenPlayerId ?? context.choices?.targetPlayerId;
  if (scope === "controller") return uniqueKnownPlayers(match, [context.controllerId]);
  if (scope === "opponent") return knownPlayerIds(match).filter((id) => id !== context.controllerId);
  if (scope === "chosen-player") return uniqueKnownPlayers(match, [chosen]);
  return knownPlayerIds(match);
}

export function chooserIdsFor(
  match: MatchState,
  chooser: ChooserOwner,
  context: OwnershipContext,
): string[] {
  if (chooser === "controller") return playerIdsForScope(match, "controller", context);
  if (chooser === "opponent") return playerIdsForScope(match, "opponent", context);
  if (chooser === "chosen-player") return playerIdsForScope(match, "chosen-player", context);
  return playerIdsForScope(match, "each-player", context);
}

export function zoneOwnerIdsFor(
  match: MatchState,
  owner: ZoneOwner,
  context: OwnershipContext,
): string[] {
  if (owner === "chooser") return uniqueKnownPlayers(match, [context.chooserId]);
  if (owner === "any" || owner === "all-players") return knownPlayerIds(match);
  if (owner === "each-player") {
    return context.chooserId
      ? uniqueKnownPlayers(match, [context.chooserId])
      : knownPlayerIds(match);
  }
  return playerIdsForScope(match, owner, context);
}

export type AmountCountSource =
  | "hand"
  | "deck"
  | "discard"
  | "energy"
  | "hero"
  | "bakugan"
  | "open-bakugan"
  | "held-bakucore"
  | "cards-played"
  | "factions-played";

export type AmountExpression =
  | { kind: "constant"; value: number }
  | { kind: "choice-value"; choiceId: keyof CardChoices; fallback?: number }
  | { kind: "choice-count"; choiceId: keyof CardChoices }
  | {
      kind: "count";
      source: AmountCountSource;
      owner?: ZoneOwner;
      cardType?: CardType;
      faction?: Faction;
      offset?: number;
      minimum?: number;
    }
  | { kind: "sum"; terms: AmountExpression[] }
  | { kind: "product"; factors: AmountExpression[] }
  | { kind: "minimum"; values: AmountExpression[] }
  | { kind: "maximum"; values: AmountExpression[] };

export type AmountEvaluationContext = OwnershipContext;

function countForPlayer(
  match: MatchState,
  playerId: string,
  expression: Extract<AmountExpression, { kind: "count" }>,
) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return 0;
  const cardMatches = (card: { type: CardType; factions: Faction[] }) => (
    (!expression.cardType || card.type === expression.cardType)
    && (!expression.faction || card.factions.includes(expression.faction))
  );
  switch (expression.source) {
    case "hand": return player.hand.filter(cardMatches).length;
    case "deck": return player.deckCards.filter(cardMatches).length;
    case "discard": return player.discard.filter(cardMatches).length;
    case "energy": return player.energyZone.filter(cardMatches).length;
    case "hero": return player.heroes.filter(cardMatches).length;
    case "bakugan": return player.bakugan.filter((bakugan) => !expression.faction || bakugan.faction === expression.faction).length;
    case "open-bakugan": return player.bakugan.filter((bakugan) => bakugan.open && (!expression.faction || bakugan.faction === expression.faction)).length;
    case "held-bakucore": return player.bakugan.reduce((sum, bakugan) => sum + bakugan.heldCoreCells.length, 0);
    case "cards-played": return player.cardsPlayedThisTurn;
    case "factions-played": return player.factionsPlayedThisTurn?.length ?? 0;
  }
}

export function evaluateAmountExpression(
  match: MatchState,
  expression: AmountExpression,
  context: AmountEvaluationContext,
): number {
  let value = 0;
  switch (expression.kind) {
    case "constant": value = expression.value; break;
    case "choice-value": {
      const selected = context.choices?.[expression.choiceId];
      value = typeof selected === "number"
        ? selected
        : typeof selected === "string" && Number.isFinite(Number(selected))
          ? Number(selected)
          : expression.fallback ?? 0;
      break;
    }
    case "choice-count": {
      const selected = context.choices?.[expression.choiceId];
      value = Array.isArray(selected) ? selected.length : selected == null || selected === false ? 0 : 1;
      break;
    }
    case "count": {
      const ownerIds = zoneOwnerIdsFor(match, expression.owner ?? "controller", context);
      value = ownerIds.reduce((sum, playerId) => sum + countForPlayer(match, playerId, expression), 0);
      value += expression.offset ?? 0;
      value = Math.max(expression.minimum ?? 0, value);
      break;
    }
    case "sum": value = expression.terms.reduce((sum, term) => sum + evaluateAmountExpression(match, term, context), 0); break;
    case "product": value = expression.factors.reduce((product, factor) => product * evaluateAmountExpression(match, factor, context), 1); break;
    case "minimum": value = expression.values.length ? Math.min(...expression.values.map((item) => evaluateAmountExpression(match, item, context))) : 0; break;
    case "maximum": value = expression.values.length ? Math.max(...expression.values.map((item) => evaluateAmountExpression(match, item, context))) : 0; break;
  }
  return Number.isFinite(value) ? value : 0;
}

const multiply = (value: number, expression: AmountExpression): AmountExpression => ({
  kind: "product",
  factors: [{ kind: "constant", value }, expression],
});

/** Convert the catalogue's common "for each" grammar into a serializable amount AST. */
export function amountExpressionForScale(
  text: string,
  baseAmount: number,
  scale?: string,
): AmountExpression | undefined {
  if (!scale) return undefined;
  const grammar = `${scale} ${text}`;
  if (/sacrificed-card|sacrifice/i.test(scale)) {
    return multiply(baseAmount, { kind: "choice-count", choiceId: "discardCardIds" });
  }
  if (/other-card-played/i.test(scale) || /other card.*played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "cards-played", owner: "controller", offset: -1, minimum: 0 });
  }
  const faction = grammar.match(/\[(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\]\s+Bakugan/i)?.[1] as Faction | undefined;
  if (faction && /Bakugan on your team/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "bakugan", owner: "controller", faction });
  }
  if (/Flip card.*discard/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "discard", owner: "controller", cardType: "Flip" });
  }
  if (/Hero(?: card)?s? (?:you )?(?:have|control)?\s*in play|Hero you have in play/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "hero", owner: "controller" });
  }
  if (/Energy card.*you have|Energy cards? in play/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "energy", owner: "controller" });
  }
  if (/BakuCore.*your Bakugan hold/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "held-bakucore", owner: "controller" });
  }
  if (/open Bakugan/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "open-bakugan", owner: "controller" });
  }
  if (/cards? (?:you have )?played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "cards-played", owner: "controller" });
  }
  if (/different factions?.*played this turn/i.test(grammar)) {
    return multiply(baseAmount, { kind: "count", source: "factions-played", owner: "controller" });
  }
  return undefined;
}

export function playerScopeForText(text: string): PlayerScope {
  if (/\beach player\b/i.test(text)) return "each-player";
  if (/\ball players\b|\bboth players\b/i.test(text)) return "all-players";
  if (/\b(?:your )?opponent\b|\bopposing player\b/i.test(text)) return "opponent";
  return "controller";
}
'''
write("lib/rules/primitives.ts", PRIMITIVES)

# model.ts
replace_once(
    "lib/rules/model.ts",
    'import type { CardChoices, CardType, CoreType, Faction, GameCard } from "../game";\n',
    'import type { CardChoices, CardType, CoreType, Faction, GameCard } from "../game";\nimport type { AmountExpression, ChooserOwner, PlayerScope, ZoneOwner } from "./primitives";\n',
)
replace_once(
    "lib/rules/model.ts",
    '  | "batch-object"\n  | "chosen-card"\n',
    '  | "batch-object"\n  | "player"\n  | "chosen-card"\n',
)
replace_once(
    "lib/rules/model.ts",
    '  chooser: "controller" | "opponent" | "each-player";\n',
    '  chooser: ChooserOwner;\n',
)
replace_once(
    "lib/rules/model.ts",
    '  targetOwner?: "controller" | "opponent" | "any";\n',
    '  /** Preferred ownership primitive for the zone/object pool being selected. */\n  owner?: ZoneOwner;\n  /** @deprecated Compatibility alias. New definitions should use owner. */\n  targetOwner?: ZoneOwner;\n',
)
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: number; scale?: string; duration: RulesDuration; scope?: "target" | "all-enemy" | "all-friendly" | "all-bakugan"; targetChoiceId?: keyof CardChoices }\n',
    '  | { kind: "modify-stat"; stat: "power" | "damage" | "frost"; amount: number; amountExpression?: AmountExpression; scale?: string; duration: RulesDuration; scope?: "target" | "all-enemy" | "all-friendly" | "all-bakugan"; targetChoiceId?: keyof CardChoices }\n',
)
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "draw"; amount: number; scale?: string }\n  | { kind: "discard"; amount: number; minimum: number; maximum: number; repeated?: boolean }\n',
    '  | { kind: "draw"; amount: number; amountExpression?: AmountExpression; scale?: string; playerScope?: PlayerScope }\n  | { kind: "discard"; amount: number; amountExpression?: AmountExpression; minimum: number; maximum: number; repeated?: boolean; playerScope?: PlayerScope }\n',
)
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "generate-energy"; amount: number; scale?: string }\n',
    '  | { kind: "generate-energy"; amount: number; amountExpression?: AmountExpression; scale?: string; playerScope?: PlayerScope }\n',
)
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "copy"; target: "next-action" | "batch-action"; independentChoices: true }\n',
    '  | { kind: "copy"; target: "next-action" | "batch-action" | "chosen-batch-object"; independentChoices: boolean; targetChoiceId?: keyof CardChoices; count?: AmountExpression; controller?: PlayerScope }\n',
)
replace_once(
    "lib/rules/model.ts",
    '  independentChoiceSetId: string;\n};\n',
    '  independentChoiceSetId: string;\n  copiedFromObjectId?: string;\n};\n',
)

# objects.ts
replace_once(
    "lib/rules/objects.ts",
    'export function copyRuleObject(source: RuleObject, controllerId: string): RuleObject {\n  const id = objectId(`${source.definitionId}-copy`);\n  return {\n    ...structuredClone(source),\n    id,\n    controllerId,\n    kind: "copy",\n    status: "pending",\n    negated: false,\n    cursor: { instructionIndex: 0, effectIndex: 0 },\n    resolvedChoices: {},\n    choices: {},\n    independentChoiceSetId: `${id}:choices`,\n  };\n}\n',
    'export function copyRuleObject(\n  source: RuleObject,\n  controllerId: string,\n  options: { independentChoices?: boolean } = {},\n): RuleObject {\n  const id = objectId(`${source.definitionId}-copy`);\n  const independentChoices = options.independentChoices ?? true;\n  return {\n    ...structuredClone(source),\n    id,\n    controllerId,\n    kind: "copy",\n    status: "pending",\n    negated: false,\n    cursor: { instructionIndex: 0, effectIndex: 0 },\n    resolvedChoices: independentChoices ? {} : structuredClone(source.resolvedChoices ?? {}),\n    choices: independentChoices ? {} : structuredClone(source.choices),\n    independentChoiceSetId: `${id}:choices`,\n    copiedFromObjectId: source.id,\n  };\n}\n\nexport function copyRuleObjects(\n  source: RuleObject,\n  controllerId: string,\n  count: number,\n  options: { independentChoices?: boolean } = {},\n): RuleObject[] {\n  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => copyRuleObject(source, controllerId, options));\n}\n',
)

# choices.ts
replace_once(
    "lib/rules/choices.ts",
    'import type { ChoiceSpec, ChoiceTiming } from "./model";\n',
    'import type { ChoiceSpec, ChoiceTiming } from "./model";\nimport { chooserIdsFor, zoneOwnerIdsFor } from "./primitives";\n',
)
replace_once(
    "lib/rules/choices.ts",
    'function chooserFor(match: MatchState, controllerId: string, spec: ChoiceSpec) {\n  if (spec.chooser === "opponent") return opponentOf(match, controllerId).id;\n  return controllerId;\n}\n',
    '',
)
replace_once(
    "lib/rules/choices.ts",
    'function targetOwners(match: MatchState, controllerId: string, spec: ChoiceSpec) {\n  const controller = playerById(match, controllerId);\n  const opponent = opponentOf(match, controllerId);\n  if (spec.targetOwner === "controller") return [controller];\n  if (spec.targetOwner === "opponent") return [opponent];\n  return match.players;\n}\n',
    'function targetOwners(\n  match: MatchState,\n  controllerId: string,\n  spec: ChoiceSpec,\n  chooserId = controllerId,\n  priorChoices: CardChoices = {},\n) {\n  const owner = spec.owner ?? spec.targetOwner ?? "any";\n  const ownerIds = new Set(zoneOwnerIdsFor(match, owner, { controllerId, chooserId, choices: priorChoices }));\n  return match.players.filter((player) => ownerIds.has(player.id));\n}\n',
)
replace_once(
    "lib/rules/choices.ts",
    '  spec: ChoiceSpec,\n  priorChoices: CardChoices = {},\n): ChoiceOption[] {\n',
    '  spec: ChoiceSpec,\n  priorChoices: CardChoices = {},\n  chooserId = controllerId,\n): ChoiceOption[] {\n',
)
replace_once(
    "lib/rules/choices.ts",
    '      const owners = new Set(targetOwners(match, controllerId, {\n        ...spec,\n        targetOwner: spec.targetOwner ?? "opponent",\n      }).map((owner) => owner.id));\n',
    '      const owners = new Set(targetOwners(match, controllerId, {\n        ...spec,\n        owner: spec.owner ?? spec.targetOwner ?? "opponent",\n      }, chooserId, priorChoices).map((owner) => owner.id));\n',
)
replace_once(
    "lib/rules/choices.ts",
    '      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy" ? [opponent]\n        : evoSourceChoice ? [controller]\n          : targetOwners(match, controllerId, spec);\n',
    '      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy"\n        ? match.players.filter((owner) => owner.id !== controllerId)\n        : spec.selector === "active-friendly" || spec.selector === "all-friendly" || evoSourceChoice\n          ? [controller]\n          : targetOwners(match, controllerId, spec, chooserId, priorChoices);\n',
)
replace_once(
    "lib/rules/choices.ts",
    '    case "controller":\n    case "opponent":\n      return match.players.map((player) => option(player.id, player.name, player.id));\n',
    '    case "player":\n      return match.players.map((candidate) => option(candidate.id, candidate.name, candidate.id));\n    case "controller":\n      return [option(controller.id, controller.name, controller.id)];\n    case "opponent":\n      return match.players.filter((candidate) => candidate.id !== controllerId)\n        .map((candidate) => option(candidate.id, candidate.name, candidate.id));\n',
)
for old in [
    'targetOwners(match, controllerId, spec).flatMap((owner) => owner.heroes',
    'targetOwners(match, controllerId, spec).flatMap((owner) => owner.bakugan.flatMap((bakugan) => {',
    'targetOwners(match, controllerId, spec).flatMap((owner) => [',
    'targetOwners(match, controllerId, spec).flatMap((owner) => {',
    'targetOwners(match, controllerId, spec).map((owner) => owner.id)',
]:
    content = read("lib/rules/choices.ts")
    if old not in content:
        raise RuntimeError(f"choices targetOwners call missing: {old}")
    write("lib/rules/choices.ts", content.replace(old, old.replace('targetOwners(match, controllerId, spec)', 'targetOwners(match, controllerId, spec, chooserId, priorChoices)'), 1))
replace_once(
    "lib/rules/choices.ts",
    '          if (spec.targetOwner === "any" || !spec.targetOwner) return true;\n',
    '          const requestedOwner = spec.owner ?? spec.targetOwner;\n          if (requestedOwner === "any" || !requestedOwner) return true;\n',
)
replace_once(
    "lib/rules/choices.ts",
    '    case "hand-card": {\n      const owner = spec.chooser === "opponent" ? opponent : controller;\n      const active = owner.bakugan.find((bakugan) => bakugan.id === match.selected[owner.id]);\n      return owner.hand\n        .filter((candidate) => candidate.id !== card.id && (!spec.cardType || candidate.type === spec.cardType))\n        .filter((candidate) => candidate.type !== "Evo" || !spec.cardType || Boolean(active && canonicalEvoTargetAllowed(ruleDefinitionForCard(candidate), active)))\n        .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));\n    }\n    case "deck-card": {\n      const count = topDeckCount(spec);\n      const candidates = (count ? controller.deckCards.slice(0, count) : controller.deckCards)\n        .filter((candidate) => !spec.cardType || candidate.type === spec.cardType);\n      return candidates.map((candidate, index) => option(\n        candidate.id,\n        candidate.displayName || candidate.name,\n        controller.id,\n        count ? `Top card ${index + 1} of ${candidates.length}` : undefined,\n        cardPreview(candidate),\n      ));\n    }\n    case "number": {\n      const maximum = Math.max(0, controller.energyZone.length + controller.energy);\n      return Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value), controller.id));\n    }\n',
    '    case "hand-card": {\n      const ownerSpec: ChoiceSpec = { ...spec, owner: spec.owner ?? spec.targetOwner ?? "controller" };\n      return targetOwners(match, controllerId, ownerSpec, chooserId, priorChoices).flatMap((owner) => {\n        const active = owner.bakugan.find((bakugan) => bakugan.id === match.selected[owner.id]);\n        return owner.hand\n          .filter((candidate) => candidate.id !== card.id && cardMatchesSpec(candidate, spec))\n          .filter((candidate) => candidate.type !== "Evo" || !spec.cardType || Boolean(active && canonicalEvoTargetAllowed(ruleDefinitionForCard(candidate), active)))\n          .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));\n      });\n    }\n    case "deck-card": {\n      const count = topDeckCount(spec);\n      const ownerSpec: ChoiceSpec = { ...spec, owner: spec.owner ?? spec.targetOwner ?? "controller" };\n      return targetOwners(match, controllerId, ownerSpec, chooserId, priorChoices).flatMap((owner) => {\n        const candidates = (count ? owner.deckCards.slice(0, count) : owner.deckCards)\n          .filter((candidate) => cardMatchesSpec(candidate, spec));\n        return candidates.map((candidate, index) => option(\n          candidate.id,\n          candidate.displayName || candidate.name,\n          owner.id,\n          count ? `Top card ${index + 1} of ${candidates.length}` : undefined,\n          cardPreview(candidate),\n        ));\n      });\n    }\n    case "number": {\n      const chooser = playerById(match, chooserId);\n      const maximum = Math.max(0, chooser.energyZone.length + chooser.energy);\n      return Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value), chooser.id));\n    }\n',
)
replace_once(
    "lib/rules/choices.ts",
    '  if (spec.selector === "controller" || spec.selector === "opponent") return "player";\n',
    '  if (spec.selector === "player" || spec.selector === "controller" || spec.selector === "opponent") return "player";\n',
)
old_build = '''  const selected = specs.filter((spec) => spec.timing === timing);\n  const fields = selected.map((original): ChoiceField => {\n    let spec = original;\n    if (card.catalogId === "bb-97" && spec.id === "targetEnergyIds" && timing === "announce") {\n      const projectedHandSize = playerById(match, controllerId).hand.filter((candidate) => candidate.id !== card.id).length;\n      const amount = projectedHandSize === 0 ? 2 : 1;\n      spec = { ...spec, minimum: amount, maximum: amount };\n    }\n    const options = optionsFor(match, controllerId, card, spec, priorChoices);\n    const range = rangeFor(spec, options.length);\n    return {\n      id: spec.id,\n      kind: kindFor(spec),\n      label: spec.label,\n      chooserId: chooserFor(match, controllerId, spec),\n      visibility: spec.visibility ?? "public",\n      timing,\n      minimum: range.minimum,\n      maximum: range.maximum,\n      required: range.minimum > 0,\n      options,\n      ...(kindFor(spec) === "deck-order" && topDeckCount(spec) > 0\n        ? { requestedWindowSize: topDeckCount(spec) }\n        : {}),\n    };\n  });\n  const simultaneous = selected.some((spec) => spec.chooser === "each-player");\n  if (simultaneous) {\n    const templates = [...fields];\n    fields.length = 0;\n    for (const player of match.players) {\n      for (const template of templates) fields.push({ ...template, chooserId: player.id, visibility: "secret-until-reveal" });\n    }\n  }\n'''
new_build = '''  const selected = specs.filter((spec) => spec.timing === timing);\n  const simultaneous = selected.some((spec) => spec.chooser === "each-player");\n  const fields = selected.flatMap((original): ChoiceField[] => {\n    let spec = original;\n    if (card.catalogId === "bb-97" && spec.id === "targetEnergyIds" && timing === "announce") {\n      const projectedHandSize = playerById(match, controllerId).hand.filter((candidate) => candidate.id !== card.id).length;\n      const amount = projectedHandSize === 0 ? 2 : 1;\n      spec = { ...spec, minimum: amount, maximum: amount };\n    }\n    const chooserIds = chooserIdsFor(match, spec.chooser, { controllerId, choices: priorChoices });\n    return chooserIds.map((chooserId) => {\n      const options = optionsFor(match, controllerId, card, spec, priorChoices, chooserId);\n      const range = rangeFor(spec, options.length);\n      return {\n        id: spec.id,\n        kind: kindFor(spec),\n        label: spec.label,\n        chooserId,\n        visibility: spec.chooser === "each-player" ? "secret-until-reveal" : spec.visibility ?? "public",\n        timing,\n        minimum: range.minimum,\n        maximum: range.maximum,\n        required: range.minimum > 0,\n        options,\n        ...(kindFor(spec) === "deck-order" && topDeckCount(spec) > 0\n          ? { requestedWindowSize: topDeckCount(spec) }\n          : {}),\n      };\n    });\n  });\n'''
replace_once("lib/rules/choices.ts", old_build, new_build)

# catalogue-structure.ts
replace_once(
    "lib/rules/catalogue-structure.ts",
    '  const normalized = source.replace(/\\s*\\n\\s*/g, " ").trim();\n',
    '  const normalized = source.replace(/\\s*\\n\\s*/g, " ").trim().replace(\n    /(\\bNegate an Action card\\.)\\s+(You may copy its effect(?: and make your own selections for it)?\\.)/gi,\n    "$1 $2",\n  );\n',
)
content = read("lib/rules/catalogue-structure.ts")
if '.targetOwner =' not in content:
    raise RuntimeError("catalogue-structure.ts: no targetOwner assignments found")
content = content.replace('.targetOwner =', '.owner =')
write("lib/rules/catalogue-structure.ts", content)
replace_once(
    "lib/rules/catalogue-structure.ts",
    '  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "controller", "Choose a player"));\n',
    '  if (/choose a player/i.test(text)) result.push(choice("targetPlayerId", timing, "player", "Choose a player"));\n',
)
negate_block = '''  if (negateMatch) {\n    const selected = choice("targetEffectId", defaultTiming, "batch-object", "Choose the card effect to negate");\n    selected.cardTypes = /Hero or Action/i.test(negateMatch[1])\n      ? ["Hero", "Action"]\n      : [negateMatch[1] as GameCard["type"]];\n    selected.objectKinds = ["card"];\n    selected.owner = "opponent";\n    selected.maximumCost = printedMaximum;\n    result.push(selected);\n  }\n\n'''
copy_block = negate_block + '''  if (!negateMatch && /copy (?:the effect of )?an? Action card|copy an? Action card(?:'s|’s) effect/i.test(text)) {\n    const selected = choice("targetEffectId", targetTiming, "batch-object", "Choose an Action effect to copy");\n    selected.cardTypes = ["Action"];\n    selected.objectKinds = ["card", "copy"];\n    selected.owner = "any";\n    result.push(selected);\n  }\n\n'''
replace_once("lib/rules/catalogue-structure.ts", negate_block, copy_block)
old_discard = '''    const selected = choice(\n      "discardCardIds",\n      "resolve",\n      "hand-card",\n      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard",\n      optional,\n      /opponent/i.test(text) ? "opponent" : "controller",\n      "private",\n    );\n'''
new_discard = '''    const eachPlayerChooses = /\\beach player\\b|\\ball players\\b|\\bboth players\\b/i.test(text);\n    const opponentOwnsZone = /opponent(?:'s|’s)\\s+hand|opponent\\s+(?:may\\s+)?discards?/i.test(text);\n    const opponentChooses = /(?:your\\s+)?opponent\\s+(?:may\\s+)?discards?/i.test(text);\n    const selected = choice(\n      "discardCardIds",\n      "resolve",\n      "hand-card",\n      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : "Choose cards to discard",\n      optional,\n      eachPlayerChooses ? "each-player" : opponentChooses ? "opponent" : "controller",\n      "private",\n    );\n    selected.owner = eachPlayerChooses ? "chooser" : opponentOwnsZone ? "opponent" : "controller";\n'''
replace_once("lib/rules/catalogue-structure.ts", old_discard, new_discard)

# catalogue-primitives.ts
replace_once(
    "lib/rules/catalogue-primitives.ts",
    'import type { RuleAction, RuleCondition, RulesCardId, RulesDuration, TriggerDefinition, TriggerEventName } from "./model";\n',
    'import type { RuleAction, RuleCondition, RulesCardId, RulesDuration, TriggerDefinition, TriggerEventName } from "./model";\nimport { amountExpressionForScale, playerScopeForText } from "./primitives";\n',
)
for stat in ["power", "damage"]:
    if stat == "power":
        old = '''      amount: Number(match[1]),\n      scale: scaleForStat(text, match),\n      duration,\n      scope,\n      targetChoiceId: ruleCardId(card) === "aa-50" ? "targetBakuganId" : undefined,\n'''
        new = '''      amount: Number(match[1]),\n      scale: scaleForStat(text, match),\n      amountExpression: amountExpressionForScale(text, Number(match[1]), scaleForStat(text, match)),\n      duration,\n      scope,\n      targetChoiceId: ruleCardId(card) === "aa-50" ? "targetBakuganId" : undefined,\n'''
    else:
        old = '''      amount: Number(match[1]),\n      scale: scaleForStat(text, match),\n      duration,\n      scope,\n      targetChoiceId: ruleCardId(card) === "aa-50" ? "secondaryTargetBakuganId" : undefined,\n'''
        new = '''      amount: Number(match[1]),\n      scale: scaleForStat(text, match),\n      amountExpression: amountExpressionForScale(text, Number(match[1]), scaleForStat(text, match)),\n      duration,\n      scope,\n      targetChoiceId: ruleCardId(card) === "aa-50" ? "secondaryTargetBakuganId" : undefined,\n'''
    replace_once("lib/rules/catalogue-primitives.ts", old, new)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  for (const match of text.matchAll(/\\+?(\\d+)\\s*\\[FrostStrike\\]/gi)) {\n    actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale: scaleForStat(text, match), duration, scope });\n  }\n',
    '  for (const match of text.matchAll(/\\+?(\\d+)\\s*\\[FrostStrike\\]/gi)) {\n    const frostScale = scaleForStat(text, match);\n    actions.push({ kind: "modify-stat", stat: "frost", amount: Number(match[1]), scale: frostScale, amountExpression: amountExpressionForScale(text, Number(match[1]), frostScale), duration, scope });\n  }\n',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  const draw = text.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+) cards?/i);\n  if (draw) actions.push({ kind: "draw", amount: numberValue(draw[1]), scale });\n',
    '  const draw = text.match(/draws? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+) cards?/i);\n  if (draw) {\n    const fixedAmount = /^x$/i.test(draw[1]) ? 0 : numberValue(draw[1]);\n    actions.push({\n      kind: "draw",\n      amount: fixedAmount,\n      scale,\n      amountExpression: /^x$/i.test(draw[1])\n        ? { kind: "choice-value", choiceId: "xValue" }\n        : amountExpressionForScale(text, fixedAmount, scale),\n      playerScope: playerScopeForText(text),\n    });\n  }\n',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '    actions.push({ kind: "discard", amount, minimum: optional ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text) });\n',
    '    actions.push({ kind: "discard", amount, minimum: optional ? 0 : amount, maximum: /any number/i.test(text) ? 99 : amount, repeated: /repeat|again|any number/i.test(text), playerScope: playerScopeForText(text) });\n',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  if (/discard (?:their|your) entire hand/i.test(text)) actions.push({ kind: "discard", amount: 99, minimum: 0, maximum: 99 });\n',
    '  if (/discard (?:their|your) entire hand/i.test(text)) actions.push({ kind: "discard", amount: 99, minimum: 0, maximum: 99, playerScope: playerScopeForText(text) });\n',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: Number(generatedEnergy[1]), scale });\n',
    '  if (generatedEnergy) actions.push({ kind: "generate-energy", amount: Number(generatedEnergy[1]), scale, amountExpression: amountExpressionForScale(text, Number(generatedEnergy[1]), scale), playerScope: playerScopeForText(text) });\n',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action", independentChoices: true });\n  if (/copy the effect of an Action card/i.test(text)) actions.push({ kind: "copy", target: "batch-action", independentChoices: true });\n',
    '  if (/copy the next action/i.test(text)) actions.push({ kind: "copy", target: "next-action", independentChoices: true, count: { kind: "constant", value: 1 }, controller: "controller" });\n  if (/copy the effect of an Action card|copy an? Action card(?:\'s|’s) effect/i.test(text)) actions.push({ kind: "copy", target: "batch-action", independentChoices: true, targetChoiceId: "targetEffectId", count: { kind: "constant", value: 1 }, controller: "controller" });\n',
)

# game.ts
replace_once(
    "lib/game.ts",
    'import { turnDrawCounts } from "./rules/turn-draw";\n',
    'import { turnDrawCounts } from "./rules/turn-draw";\nimport { evaluateAmountExpression, playerIdsForScope } from "./rules/primitives";\n',
)
replace_once(
    "lib/game.ts",
    '      let amount = scaleStat(state, player, text, action.amount, action.stat, action.scale);\n      if (action.scale === "sacrificed-card") amount *= choices.discardCardIds?.length ?? 0;\n',
    '      let amount = action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : scaleStat(state, player, text, action.amount, action.stat, action.scale);\n      if (!action.amountExpression && action.scale === "sacrificed-card") amount *= choices.discardCardIds?.length ?? 0;\n',
)
replace_once(
    "lib/game.ts",
    '    case "draw": {\n      const amount = action.scale ? Math.max(0, scaleStat(state, player, text, action.amount, "draw", action.scale)) : action.amount;\n      enqueueEffectDraw(state, player, amount, card.displayName || card.name, pending.id);\n      return;\n    }\n',
    '    case "draw": {\n      const amount = Math.max(0, Math.floor(action.amountExpression\n        ? evaluateAmountExpression(state, action.amountExpression, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : action.scale ? scaleStat(state, player, text, action.amount, "draw", action.scale) : action.amount));\n      const recipientIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });\n      for (const recipientId of recipientIds) enqueueEffectDraw(state, playerById(state, recipientId), amount, card.displayName || card.name, pending.id);\n      return;\n    }\n',
)
replace_once(
    "lib/game.ts",
    '    case "discard": {\n      if (/\\bVictor\\s*:/i.test(text)) return;\n      const affected = choices.targetPlayerId\n        ? playerById(state, choices.targetPlayerId)\n        : /your opponent|opponent discards/i.test(text) ? opponent : player;\n      const selected = choices.discardCardIds ?? choices.handCardIds ?? [];\n      const amount = action.minimum === 0 ? selected.length : selected.length || action.amount;\n      if (amount > 0) discardFromHand(state, affected, Math.min(action.maximum, amount), selected);\n      return;\n    }\n',
    '    case "discard": {\n      if (/\\bVictor\\s*:/i.test(text)) return;\n      const affectedIds = choices.targetPlayerId\n        ? [choices.targetPlayerId]\n        : playerIdsForScope(state, action.playerScope ?? (/your opponent|opponent discards/i.test(text) ? "opponent" : "controller"), { controllerId, choices });\n      for (const affectedId of affectedIds) {\n        const affected = playerById(state, affectedId);\n        const scopedChoices = choices.simultaneousAnswers?.[affectedId] ?? choices;\n        const selected = scopedChoices.discardCardIds ?? scopedChoices.handCardIds ?? [];\n        const expressionAmount = action.amountExpression\n          ? Math.max(0, Math.floor(evaluateAmountExpression(state, action.amountExpression, { controllerId, chooserId: affectedId, chosenPlayerId: affectedId, choices: scopedChoices })))\n          : action.amount;\n        const amount = action.minimum === 0 ? selected.length : selected.length || expressionAmount;\n        if (amount > 0) discardFromHand(state, affected, Math.min(action.maximum, amount), selected);\n      }\n      return;\n    }\n',
)
replace_once(
    "lib/game.ts",
    '    case "generate-energy":\n      player.energy += Math.max(0, scaleStat(state, player, text, action.amount, "draw"));\n      return;\n',
    '    case "generate-energy": {\n      const recipientIds = playerIdsForScope(state, action.playerScope ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });\n      for (const recipientId of recipientIds) {\n        const recipient = playerById(state, recipientId);\n        const amount = action.amountExpression\n          ? evaluateAmountExpression(state, action.amountExpression, { controllerId, chooserId: recipientId, chosenPlayerId: recipientId, choices })\n          : scaleStat(state, player, text, action.amount, "draw", action.scale);\n        recipient.energy += Math.max(0, amount);\n      }\n      return;\n    }\n',
)
replace_once(
    "lib/game.ts",
    '    case "copy":\n      if (action.target === "next-action") state.copyNextAction[controllerId] = (state.copyNextAction[controllerId] ?? 0) + 1;\n      return;\n',
    '    case "copy": {\n      if (choices.confirmed === false) return;\n      const count = Math.max(0, Math.floor(action.count\n        ? evaluateAmountExpression(state, action.count, { controllerId, choices, chosenPlayerId: choices.targetPlayerId })\n        : 1));\n      const copyControllers = playerIdsForScope(state, action.controller ?? "controller", { controllerId, choices, chosenPlayerId: choices.targetPlayerId });\n      if (action.target === "next-action") {\n        for (const copyControllerId of copyControllers) {\n          state.copyNextAction[copyControllerId] = (state.copyNextAction[copyControllerId] ?? 0) + count;\n        }\n        return;\n      }\n      const targetChoiceId = action.targetChoiceId ?? "targetEffectId";\n      const selectedId = choices[targetChoiceId];\n      if (typeof selectedId !== "string") return;\n      const selected = state.batch.find((effect) => effect.id === selectedId && effect.id !== pending.id && !effect.negated);\n      if (!selected) return;\n      const normalized = isRuleObject(selected) ? selected : normalizeRuleObjects({ ...state, batch: [selected] }).batch[0];\n      if (!isRuleObject(normalized)) return;\n      for (const copyControllerId of copyControllers) {\n        for (let copyIndex = 0; copyIndex < count; copyIndex += 1) {\n          state.batch.push(copyRuleObject(normalized, copyControllerId, { independentChoices: action.independentChoices }));\n        }\n      }\n      return;\n    }\n',
)
replace_once(
    "lib/game.ts",
    '        if (action.copy) {\n          const typed = isRuleObject(negated) ? negated : normalizeRuleObjects({ ...state, batch: [negated] }).batch[0];\n          if (isRuleObject(typed)) state.batch.push(copyRuleObject(typed, controllerId));\n        }\n',
    '        if (action.copy && choices.confirmed !== false) {\n          const typed = isRuleObject(negated) ? negated : normalizeRuleObjects({ ...state, batch: [negated] }).batch[0];\n          if (isRuleObject(typed)) state.batch.push(copyRuleObject(typed, controllerId, { independentChoices: true }));\n        }\n',
)

# index.ts
replace_once(
    "lib/rules/index.ts",
    'export { activeExtraTurnDrawModifiers, extraTurnDrawModifiersForCard, extraTurnDrawsForPlayer, turnDrawCountForPlayer, turnDrawCounts } from "./turn-draw";\n',
    'export { activeExtraTurnDrawModifiers, extraTurnDrawModifiersForCard, extraTurnDrawsForPlayer, turnDrawCountForPlayer, turnDrawCounts } from "./turn-draw";\nexport * from "./primitives";\n',
)

TESTS = r'''import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard, type MatchState } from "../lib/game";
import { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";
import { parseAtomicEffects } from "../lib/rules/catalogue-primitives";
import { ruleDefinitionForCard } from "../lib/rules/catalogue";
import { copyRuleObject, createRuleObject } from "../lib/rules/objects";
import {
  evaluateAmountExpression,
  playerIdsForScope,
  zoneOwnerIdsFor,
  type AmountExpression,
} from "../lib/rules/primitives";
import type { ChoiceSpec } from "../lib/rules/model";

function stateWithPlayers(count = 2): MatchState {
  const players = [
    makePlayer("first", "First", STARTER_DECKS[0]),
    makePlayer("second", "Second", STARTER_DECKS[1]),
    makePlayer("third", "Third", STARTER_DECKS[2]),
  ].slice(0, count);
  const state = createMatch("PRIMITIVES", "bo1", players.slice(0, 2));
  if (count > 2) state.players.push(players[2]);
  return state;
}

function instance(card: GameCard, id: string): GameCard {
  return { ...card, id };
}

test("player scope is independent of two-player opponent assumptions", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(playerIdsForScope(state, "controller", { controllerId: "first" }), ["first"]);
  assert.deepEqual(playerIdsForScope(state, "opponent", { controllerId: "first" }), ["second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "each-player", { controllerId: "first" }), ["first", "second", "third"]);
  assert.deepEqual(playerIdsForScope(state, "chosen-player", { controllerId: "first", chosenPlayerId: "third" }), ["third"]);
});

test("zone ownership can follow the chooser or a separately chosen player", () => {
  const state = stateWithPlayers(3);
  assert.deepEqual(zoneOwnerIdsFor(state, "chooser", { controllerId: "first", chooserId: "second" }), ["second"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "chosen-player", { controllerId: "first", choices: { targetPlayerId: "third" } }), ["third"]);
  assert.deepEqual(zoneOwnerIdsFor(state, "opponent", { controllerId: "first" }), ["second", "third"]);
});

test("dynamic amount expressions evaluate typed counts and arithmetic", () => {
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-a"), instance(CARDS.find((card) => card.type === "Hero")!, "hero-b")];
  const expression: AmountExpression = {
    kind: "product",
    factors: [
      { kind: "constant", value: 100 },
      { kind: "count", source: "hero", owner: "controller" },
    ],
  };
  assert.equal(evaluateAmountExpression(state, expression, { controllerId: "first" }), 200);
  assert.equal(evaluateAmountExpression(state, { kind: "choice-value", choiceId: "xValue" }, { controllerId: "first", choices: { xValue: 4 } }), 4);
});

test("chooser ownership and hidden-zone ownership are independent", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Opponent chooses from controller hand",
    minimum: 1,
    maximum: 1,
    chooser: "opponent",
    owner: "controller",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.fields.length, 1);
  assert.equal(schema.fields[0].chooserId, "second");
  assert.deepEqual(schema.fields[0].options.map((option) => [option.id, option.ownerId]), [["first-hand", "first"]]);
});

test("each-player choices build a distinct legal option pool from each chooser's own zone", () => {
  const state = stateWithPlayers();
  const source = instance(CARDS[0], "source");
  state.players[0].hand = [instance(CARDS[1], "first-hand")];
  state.players[1].hand = [instance(CARDS[2], "second-hand")];
  const spec: ChoiceSpec = {
    id: "discardCardIds",
    timing: "resolve",
    selector: "hand-card",
    label: "Each player discards",
    minimum: 1,
    maximum: 1,
    chooser: "each-player",
    owner: "chooser",
    visibility: "private",
  };
  const schema = buildChoiceSchemaFromSpecs(state, "first", source, [spec], "resolve");
  assert.equal(schema.simultaneous, true);
  assert.deepEqual(schema.fields.map((field) => [field.chooserId, field.options.map((option) => option.id)]), [
    ["first", ["first-hand"]],
    ["second", ["second-hand"]],
  ]);
});

test("catalogue primitives compile player scope, copy and typed dynamic amounts", () => {
  const base = CARDS[0];
  const drawCard = { ...base, effect: "Each player draws two cards." };
  const draw = parseAtomicEffects(drawCard, drawCard.effect).find((action) => action.kind === "draw");
  assert.ok(draw && draw.kind === "draw");
  assert.equal(draw.playerScope, "each-player");
  assert.equal(draw.amount, 2);

  const scaleCard = { ...base, effect: "+100 [B] for each Hero you have in play." };
  const stat = parseAtomicEffects(scaleCard, scaleCard.effect).find((action) => action.kind === "modify-stat");
  assert.ok(stat && stat.kind === "modify-stat" && stat.amountExpression);
  const state = stateWithPlayers();
  state.players[0].heroes = [instance(CARDS.find((card) => card.type === "Hero")!, "hero-scale")];
  assert.equal(evaluateAmountExpression(state, stat.amountExpression, { controllerId: "first" }), 100);

  const copyCard = { ...base, effect: "Copy the effect of an Action card." };
  const copy = parseAtomicEffects(copyCard, copyCard.effect).find((action) => action.kind === "copy");
  assert.deepEqual(copy, {
    kind: "copy",
    target: "batch-action",
    independentChoices: true,
    targetChoiceId: "targetEffectId",
    count: { kind: "constant", value: 1 },
    controller: "controller",
  });
});

test("copy objects keep source identity while supporting independent or inherited selections", () => {
  const card = CARDS.find((candidate) => candidate.type === "Action")!;
  const ability = ruleDefinitionForCard(card).abilities.find((candidate) => candidate.kind !== "triggered")!;
  const source = createRuleObject({ controllerId: "first", card: instance(card, "copy-source"), ability, choices: { targetBakuganId: "bakugan-a" } });
  source.resolvedChoices = { "0": { targetBakuganId: "bakugan-a" } };

  const independent = copyRuleObject(source, "second");
  assert.equal(independent.copiedFromObjectId, source.id);
  assert.deepEqual(independent.choices, {});
  assert.deepEqual(independent.resolvedChoices, {});
  assert.notEqual(independent.independentChoiceSetId, source.independentChoiceSetId);

  const inherited = copyRuleObject(source, "second", { independentChoices: false });
  assert.deepEqual(inherited.choices, source.choices);
  assert.deepEqual(inherited.resolvedChoices, source.resolvedChoices);
});

test("Absorb compiles its optional negate-and-copy sentence as one generalized operation", () => {
  const absorb = CARDS.find((card) => card.catalogId === "bb-1")!;
  const definition = ruleDefinitionForCard(absorb);
  const instruction = definition.abilities.flatMap((ability) => ability.instructions)
    .find((candidate) => /Negate an Action card.*copy its effect/i.test(candidate.sourceText));
  assert.ok(instruction);
  const negate = instruction.effects.find((action) => action.kind === "negate");
  assert.ok(negate && negate.kind === "negate" && negate.copy);
  assert.ok(instruction.choices.some((choice) => choice.id === "targetEffectId"));
  assert.ok(instruction.choices.some((choice) => choice.id === "confirmed"));
});
'''
write("tests/rules-primitives.test.ts", TESTS)

# package scripts
content = read("package.json")
needle = "tests/turn-draw-mechanic.test.ts"
if needle not in content:
    raise RuntimeError("package.json: turn-draw test marker missing")
content = content.replace(needle, f"{needle} tests/rules-primitives.test.ts")
write("package.json", content)

print("Applied generalized player/zone/chooser, copy, and dynamic amount primitives.")
