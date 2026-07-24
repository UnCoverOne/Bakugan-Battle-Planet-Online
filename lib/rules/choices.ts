import type { CardChoices, GameCard, MatchState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { canonicalEvoTargetAllowed } from "./identity";
import type { ChoiceSpec, ChoiceTiming } from "./model";

export type ChoiceKind =
  | "confirm" | "bakugan" | "player" | "hero" | "evo" | "energy" | "core"
  | "hand-cards" | "deck-card" | "deck-order" | "number" | "mode" | "batch-object";
export type ChoiceVisibility = "public" | "private" | "secret-until-reveal";
export type ChoiceOption = { id: string; label: string; description?: string; ownerId?: string };
export type ChoiceField = {
  id: keyof CardChoices;
  kind: ChoiceKind;
  label: string;
  chooserId: string;
  visibility: ChoiceVisibility;
  timing: ChoiceTiming;
  minimum: number;
  maximum: number;
  required: boolean;
  options: ChoiceOption[];
};
export type ChoiceSchema = {
  id: string;
  sourceId: string;
  sourceName: string;
  controllerId: string;
  timing: ChoiceTiming;
  fields: ChoiceField[];
  simultaneous: boolean;
};
export type PendingCardChoice = {
  id: string;
  kind: "card-play" | "trigger" | "resolution" | "payment";
  controllerId: string;
  cardId: string;
  schema: ChoiceSchema;
  answers: Record<string, CardChoices>;
  createdVersion: number;
  beforeState?: string;
  pendingEffectId?: string;
  instructionIndex?: number;
  resumePriority?: string;
  resumeDeadline?: number;
  resumeStepLabel?: string;
  irreversibleInformation?: boolean;
};

function playerById(match: MatchState, playerId: string) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");
  return player;
}
function opponentOf(match: MatchState, playerId: string) {
  const opponent = match.players.find((candidate) => candidate.id !== playerId);
  if (!opponent) throw new Error("An opponent is required for this choice.");
  return opponent;
}
function option(id: string, label: string, ownerId?: string, description?: string): ChoiceOption {
  return { id, label, ownerId, description };
}
function chooserFor(match: MatchState, controllerId: string, spec: ChoiceSpec) {
  if (spec.chooser === "opponent") return opponentOf(match, controllerId).id;
  return controllerId;
}
function rangeFor(spec: ChoiceSpec, available: number) {
  const minimum = Math.max(0, Math.min(available, spec.minimum ?? (spec.optional ? 0 : 1)));
  const maximum = Math.max(minimum, Math.min(available, spec.maximum ?? 1));
  return { minimum, maximum };
}

function optionsFor(match: MatchState, controllerId: string, card: GameCard, spec: ChoiceSpec): ChoiceOption[] {
  const controller = playerById(match, controllerId);
  const opponent = opponentOf(match, controllerId);
  switch (spec.selector) {
    case "batch-object":
      return match.batch
        .filter((object) => object.controllerId !== controllerId && (!spec.cardType || object.card.type === spec.cardType))
        .map((object) => option(object.id, `${object.card.displayName || object.card.name} on the batch`, object.controllerId));
    case "chosen-bakugan":
    case "active-friendly":
    case "active-enemy":
    case "all-friendly":
    case "all-enemy": {
      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy" ? [opponent]
        : card.type === "Evo" ? [controller] : match.players;
      return owners.flatMap((owner) => owner.bakugan
        .filter((bakugan) => card.type !== "Evo" || canonicalEvoTargetAllowed(ruleDefinitionForCard(card), bakugan))
        .map((bakugan) => option(bakugan.id, `${bakugan.name} • ${bakugan.open ? "Open" : "Closed"}`, owner.id)));
    }
    case "controller":
    case "opponent":
      return match.players.map((player) => option(player.id, player.name, player.id));
    case "hero":
      return match.players.flatMap((owner) => owner.heroes.map((hero) => option(hero.id, hero.displayName || hero.name, owner.id)));
    case "evo":
      return match.players.flatMap((owner) => owner.bakugan.flatMap((bakugan) => bakugan.evoStack.map((evo) => option(evo.id, evo.displayName || evo.name, owner.id))));
    case "energy-card": {
      const owner = spec.chooser === "opponent" ? opponent : controller;
      return owner.energyZone.map((energy) => option(energy.id, "Face-down Energy", owner.id));
    }
    case "bakucore":
      return match.placements
        .filter((placement) => !placement.attachedTo || /remove|return/i.test(spec.label))
        .map((placement) => option(placement.cell, placement.attachedTo ? `Attached ${placement.core.type} Core` : `${placement.core.type} Core`, placement.playerId));
    case "hand-card": {
      const owner = spec.chooser === "opponent" ? opponent : controller;
      return owner.hand.filter((candidate) => candidate.id !== card.id).map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));
    }
    case "deck-card":
      return controller.deckCards
        .filter((candidate) => !spec.cardType || candidate.type === spec.cardType)
        .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, controller.id));
    case "number": {
      const maximum = Math.max(0, controller.energyZone.length + controller.energy);
      return Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value), controller.id));
    }
    case "mode":
      return spec.id === "confirmed"
        ? [option("yes", "Yes"), option("no", "No")]
        : [option("power", "B-Power"), option("damage", "Damage")];
    case "chosen-card":
    case "self":
      return [option(card.id, card.displayName || card.name, controller.id)];
  }
}

function kindFor(spec: ChoiceSpec): ChoiceKind {
  if (spec.selector === "batch-object") return "batch-object";
  if (["chosen-bakugan", "active-friendly", "active-enemy", "all-friendly", "all-enemy"].includes(spec.selector)) return "bakugan";
  if (spec.selector === "controller" || spec.selector === "opponent") return "player";
  if (spec.selector === "hero") return "hero";
  if (spec.selector === "evo") return "evo";
  if (spec.selector === "energy-card") return "energy";
  if (spec.selector === "bakucore") return "core";
  if (spec.selector === "hand-card") return "hand-cards";
  if (spec.selector === "deck-card" && spec.id === "orderedCardIds") return "deck-order";
  if (spec.selector === "deck-card") return "deck-card";
  if (spec.selector === "number") return "number";
  if (spec.id === "confirmed") return "confirm";
  return "mode";
}

export function buildChoiceSchemaFromSpecs(
  match: MatchState,
  controllerId: string,
  card: GameCard,
  specs: readonly ChoiceSpec[],
  timing: ChoiceTiming,
): ChoiceSchema {
  const selected = specs.filter((spec) => spec.timing === timing);
  const fields = selected.map((spec): ChoiceField => {
    const options = optionsFor(match, controllerId, card, spec);
    const range = rangeFor(spec, options.length);
    return {
      id: spec.id,
      kind: kindFor(spec),
      label: spec.label,
      chooserId: chooserFor(match, controllerId, spec),
      visibility: spec.visibility ?? "public",
      timing,
      minimum: range.minimum,
      maximum: range.maximum,
      required: range.minimum > 0,
      options,
    };
  });
  const simultaneous = selected.some((spec) => spec.chooser === "each-player");
  if (simultaneous) {
    const templates = [...fields];
    fields.length = 0;
    for (const player of match.players) {
      for (const template of templates) fields.push({ ...template, chooserId: player.id, visibility: "secret-until-reveal" });
    }
  }
  return {
    id: `${match.id}:${match.version}:${card.id}:${timing}:choices`,
    sourceId: card.id,
    sourceName: card.displayName || card.name,
    controllerId,
    timing,
    fields,
    simultaneous,
  };
}

export function buildChoiceSchema(
  match: MatchState,
  controllerId: string,
  card: GameCard,
  sourceText = card.effect,
  priorChoices: CardChoices = {},
): ChoiceSchema {
  const definition = ruleDefinitionForCard(card);
  const timing: ChoiceTiming = /choose (?:a value for )?x/i.test(sourceText) ? "pay"
    : sourceText === card.effect ? "announce" : "resolve";
  const instructionSpecs = definition.abilities.flatMap((ability) => ability.instructions)
    .filter((instruction) => instruction.sourceText === sourceText || sourceText.includes(instruction.sourceText))
    .flatMap((instruction) => instruction.choices);
  const specs = timing === "announce" || timing === "pay"
    ? definition.play.choices
    : instructionSpecs;
  const filtered = specs.filter((spec) => !(spec.id === "targetBakuganId" && priorChoices.targetBakuganId));
  return buildChoiceSchemaFromSpecs(match, controllerId, card, filtered, timing);
}

function selectedValues(choices: CardChoices, id: keyof CardChoices): string[] {
  const value = choices[id];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (typeof value === "boolean") return [value ? "yes" : "no"];
  return [];
}
export function validateChoices(schema: ChoiceSchema, chooserId: string, choices: CardChoices) {
  const fields = schema.fields.filter((candidate) => candidate.chooserId === chooserId);
  const confirmation = fields.find((candidate) => candidate.id === "confirmed");
  const declined = confirmation && selectedValues(choices, "confirmed")[0] === "no";
  for (const item of fields) {
    if (declined && item.id !== "confirmed") continue;
    const values = selectedValues(choices, item.id);
    if (values.length < item.minimum || values.length > item.maximum) throw new Error(`${item.label} requires ${item.minimum === item.maximum ? item.minimum : `${item.minimum}–${item.maximum}`} selection${item.maximum === 1 ? "" : "s"}.`);
    const legal = new Set(item.options.map((candidate) => candidate.id));
    if (values.some((value) => !legal.has(value))) throw new Error(`${item.label} contains an illegal selection.`);
    if (new Set(values).size !== values.length) throw new Error(`${item.label} cannot contain duplicate selections.`);
  }
  return true;
}
export function schemaHasLegalCompletion(schema: ChoiceSchema) {
  if (schema.fields.some((item) => item.id === "confirmed" && item.options.some((candidate) => candidate.id === "no"))) return true;
  return schema.fields.every((item) => item.options.length >= item.minimum);
}
export function schemaIsComplete(schema: ChoiceSchema, answers: Record<string, CardChoices>) {
  return [...new Set(schema.fields.map((item) => item.chooserId))].every((chooserId) => {
    const answer = answers[chooserId];
    if (!answer) return false;
    try { return validateChoices(schema, chooserId, answer); } catch { return false; }
  });
}
export function mergeChoiceAnswers(schema: ChoiceSchema, answers: Record<string, CardChoices>): CardChoices {
  const merged: CardChoices = schema.simultaneous ? { simultaneousAnswers: answers } : {};
  for (const item of schema.fields) {
    if (schema.simultaneous && item.chooserId !== schema.controllerId) continue;
    const source = answers[item.chooserId];
    if (source?.[item.id] !== undefined) Object.assign(merged, { [item.id]: source[item.id] });
  }
  return merged;
}
