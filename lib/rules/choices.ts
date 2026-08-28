import type { CardChoices, GameCard, MatchState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import { canonicalEvoTargetAllowed } from "./identity";
import { activeUnchargedEnergyIds, cardPaymentModes } from "./costs";
import type { ChoiceSpec, ChoiceTiming } from "./model";
import { chooserIdsFor, zoneOwnerIdsFor } from "./primitives";
import { evaluateNumberValue, type NumberValue } from "./values";
import { bakuganHasFaction, effectiveCardFactions } from "./derived-characteristics";
import { hasActiveRulePermission } from "./permissions";

export type ChoiceKind =
  | "confirm" | "bakugan" | "player" | "hero" | "evo" | "energy" | "core" | "card"
  | "hand-cards" | "deck-card" | "deck-order" | "number" | "mode" | "batch-object";
export type ChoiceVisibility = "public" | "private" | "secret-until-reveal";
export type ChoiceCardPreview = Pick<
  GameCard,
  "id" | "catalogId" | "name" | "displayName" | "art" | "type" | "faction" | "cost"
>;
export type ChoiceOption = {
  id: string;
  label: string;
  description?: string;
  ownerId?: string;
  card?: ChoiceCardPreview;
  /** Visible but not selectable; description explains why it is unavailable. */
  disabled?: boolean;
};
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
  /** Printed size of a top-deck inspection window before deck scarcity is applied. */
  requestedWindowSize?: number;
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
  kind: "card-play" | "trigger" | "resolution" | "payment" | "forced-discard";
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
  playRequest?: import("./model").PendingCardPlay;
  playStage?: "declare" | "additional-cost";
  cancellable?: boolean;
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
function cardPreview(card: GameCard): ChoiceCardPreview {
  return {
    id: card.id,
    catalogId: card.catalogId,
    name: card.name,
    displayName: card.displayName,
    art: card.art,
    type: card.type,
    faction: card.faction,
    cost: card.cost,
  };
}
function option(
  id: string,
  label: string,
  ownerId?: string,
  description?: string,
  card?: ChoiceCardPreview,
): ChoiceOption {
  return { id, label, ownerId, description, card };
}
function choiceNumber(
  match: MatchState,
  controllerId: string,
  value: NumberValue | undefined,
  priorChoices: CardChoices,
  chooserId = controllerId,
  fallback = 0,
) {
  if (value == null) return fallback;
  return evaluateNumberValue(match, value, {
    controllerId,
    chooserId,
    chosenPlayerId: priorChoices.targetPlayerId,
    choices: priorChoices,
    moment: "announce",
  });
}
function rangeFor(
  match: MatchState,
  controllerId: string,
  spec: ChoiceSpec,
  available: number,
  priorChoices: CardChoices,
  chooserId: string,
) {
  const printedMinimum = Math.max(0, Math.floor(choiceNumber(match, controllerId, spec.minimum, priorChoices, chooserId, spec.optional ? 0 : 1)));
  const printedMaximum = Math.max(printedMinimum, Math.floor(choiceNumber(match, controllerId, spec.maximum, priorChoices, chooserId, 1)));
  const scarcityBounded = spec.selector === "deck-card" && topDeckCount(match, controllerId, spec, priorChoices, chooserId) > 0;
  const availableMaximum = Math.min(available, printedMaximum);
  const maximum = scarcityBounded
    ? availableMaximum
    : Math.max(printedMinimum, availableMaximum);
  const minimum = scarcityBounded ? Math.min(printedMinimum, maximum) : printedMinimum;
  return { minimum, maximum };
}
function topDeckCount(
  match: MatchState,
  controllerId: string,
  spec: ChoiceSpec,
  priorChoices: CardChoices,
  chooserId = controllerId,
) {
  if (spec.id === "orderedCardIds" && spec.maximum != null) {
    return Math.max(0, Math.floor(choiceNumber(match, controllerId, spec.maximum, priorChoices, chooserId)));
  }
  const numeric = spec.label.match(/\btop\s+(\d+)\s+cards?\b/i)?.[1];
  return numeric ? Math.max(0, Number(numeric)) : 0;
}

function targetOwners(
  match: MatchState,
  controllerId: string,
  spec: ChoiceSpec,
  chooserId = controllerId,
  priorChoices: CardChoices = {},
) {
  const owner = spec.owner ?? spec.targetOwner ?? "any";
  const ownerIds = new Set(zoneOwnerIdsFor(match, owner, { controllerId, chooserId, choices: priorChoices }));
  return match.players.filter((player) => ownerIds.has(player.id));
}

function cardMatchesSpecValue(
  match: MatchState,
  controllerId: string,
  candidate: GameCard,
  spec: ChoiceSpec,
  priorChoices: CardChoices,
  chooserId: string,
) {
  const types = spec.cardTypes?.length ? spec.cardTypes : spec.cardType ? [spec.cardType] : [];
  if (types.length && !types.includes(candidate.type)) return false;
  if (spec.factions?.length && !effectiveCardFactions(candidate).some((faction) => spec.factions!.includes(faction))) return false;
  if (spec.cardName) {
    const normalize = (value: string) => value
      .replace(/[\[\]]/g, "")
      .replace(/^(Aquos|Pyrus|Darkus|Haos|Ventus|Aurelus)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const wanted = normalize(spec.cardName);
    if (![candidate.displayName, candidate.name].some((value) => normalize(value) === wanted)) return false;
  }
  const printedCost = candidate.cost === "X" ? Number.POSITIVE_INFINITY : candidate.cost;
  const maximumCost = spec.maximumCost == null ? undefined : choiceNumber(match, controllerId, spec.maximumCost, priorChoices, chooserId);
  const minimumCost = spec.minimumCost == null ? undefined : choiceNumber(match, controllerId, spec.minimumCost, priorChoices, chooserId);
  if (maximumCost != null && printedCost > maximumCost) return false;
  if (minimumCost != null && printedCost < minimumCost) return false;
  return true;
}

function optionsFor(
  match: MatchState,
  controllerId: string,
  card: GameCard,
  spec: ChoiceSpec,
  priorChoices: CardChoices = {},
  chooserId = controllerId,
): ChoiceOption[] {
  const controller = playerById(match, controllerId);
  const opponent = opponentOf(match, controllerId);
  const cardMatchesSpec = (candidate: GameCard, candidateSpec: ChoiceSpec = spec) => cardMatchesSpecValue(
    match, controllerId, candidate, candidateSpec, priorChoices, chooserId,
  );
  switch (spec.selector) {
    case "batch-object": {
      const owners = new Set(targetOwners(match, controllerId, {
        ...spec,
        owner: spec.owner ?? spec.targetOwner ?? "opponent",
      }, chooserId, priorChoices).map((owner) => owner.id));
      return match.batch
        .filter((object) => owners.has(object.controllerId))
        .filter((object) => !object.negated && object.status !== "negated" && object.status !== "resolved")
        .filter((object) => !spec.objectKinds?.length || spec.objectKinds.includes(object.kind))
        .filter((object) => cardMatchesSpec(object.card, spec))
        .map((object) => option(
          object.id,
          object.card.displayName || object.card.name,
          object.controllerId,
          `${object.kind === "card" ? "Card play" : object.kind} • ${object.card.type} • ${object.card.cost === "X" ? "X" : object.card.cost} Energy`,
          cardPreview(object.card),
        ));
    }
    case "discarded-card-this-turn":
    return targetOwners(match, controllerId, spec, chooserId, priorChoices).flatMap((owner) => {
      const discardedThisTurn = new Set(owner.discardedCardIdsThisTurn ?? []);
      return owner.discard
        .filter((candidate) => discardedThisTurn.has(candidate.id) && cardMatchesSpec(candidate, spec))
        .map((candidate) => option(
          candidate.id,
          candidate.displayName || candidate.name,
          owner.id,
          `Discarded this turn • ${candidate.type} • ${candidate.cost === "X" ? "X" : candidate.cost} Energy`,
          cardPreview(candidate),
        ));
    });
    case "chosen-bakugan":
    case "active-friendly":
    case "active-enemy":
    case "all-friendly":
    case "all-enemy": {
      const evoSourceChoice = card.type === "Evo"
        && (spec.id === "sourceBakuganId" || spec.label === "Choose the matching Character");
      const owners = spec.selector === "active-enemy" || spec.selector === "all-enemy"
        ? match.players.filter((owner) => owner.id !== controllerId)
        : spec.selector === "active-friendly" || spec.selector === "all-friendly" || evoSourceChoice
          ? [controller]
          : targetOwners(match, controllerId, spec, chooserId, priorChoices);
      return owners.flatMap((owner) => owner.bakugan
        .filter((bakugan) => !evoSourceChoice || canonicalEvoTargetAllowed(ruleDefinitionForCard(card), bakugan))
        .filter((bakugan) => !spec.openState || (spec.openState === "open" ? bakugan.open : !bakugan.open))
        .filter((bakugan) => !spec.notOpenedThisTurn || bakugan.openedTurn !== match.turn)
        .filter((bakugan) => !spec.excludeSourceBakugan || bakugan.id !== priorChoices.sourceBakuganId)
        .filter((bakugan) => !spec.factions?.length || spec.factions.some((faction) => bakuganHasFaction(bakugan, faction)))
        .map((bakugan) => option(bakugan.id, `${bakugan.name} • ${bakugan.open ? "Open" : "Closed"}`, owner.id)));
    }
    case "player":
      return match.players.map((candidate) => option(candidate.id, candidate.name, candidate.id));
    case "controller":
      return [option(controller.id, controller.name, controller.id)];
    case "opponent":
      return match.players.filter((candidate) => candidate.id !== controllerId)
        .map((candidate) => option(candidate.id, candidate.name, candidate.id));
    case "hero":
      return targetOwners(match, controllerId, spec, chooserId, priorChoices).flatMap((owner) => owner.heroes
        .filter((hero) => cardMatchesSpec(hero, spec))
        .filter((hero) => !spec.notPlayedThisTurn || hero.playedTurn !== match.turn)
        .map((hero) => option(hero.id, hero.displayName || hero.name, owner.id, `${hero.cost === "X" ? "X" : hero.cost} Energy`, cardPreview(hero))));
    case "evo":
      return targetOwners(match, controllerId, spec, chooserId, priorChoices).flatMap((owner) => owner.bakugan.flatMap((bakugan) => {
        const evo = bakugan.evoStack.at(-1);
        return evo && cardMatchesSpec(evo, spec) && (!spec.notPlayedThisTurn || evo.playedTurn !== match.turn)
          ? [option(evo.id, evo.displayName || evo.name, owner.id, `${evo.cost === "X" ? "X" : evo.cost} Energy`, cardPreview(evo))]
          : [];
      }));
    case "card-in-play":
      return targetOwners(match, controllerId, spec, chooserId, priorChoices).flatMap((owner) => [
        ...owner.heroes
          .filter((candidate) => cardMatchesSpec(candidate, spec))
          .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id, "Hero in play", cardPreview(candidate))),
        ...owner.bakugan.flatMap((bakugan) => {
          const candidate = bakugan.evoStack.at(-1);
          return candidate && cardMatchesSpec(candidate, spec)
            ? [option(candidate.id, candidate.displayName || candidate.name, owner.id, "Top Evo in play", cardPreview(candidate))]
            : [];
        }),
      ]);
    case "energy-card":
      return targetOwners(match, controllerId, spec, chooserId, priorChoices).flatMap((owner) => {
        const uncharged = new Set(activeUnchargedEnergyIds(owner, match.turn));
        return owner.energyZone
          .filter((energy) => cardMatchesSpec(energy, spec))
          .filter((energy) => !spec.energyState
            || (spec.energyState === "uncharged" ? uncharged.has(energy.id) : !uncharged.has(energy.id)))
          .map((energy) => option(energy.id, spec.energyState === "uncharged" ? "Uncharged Energy" : spec.energyState === "charged" ? "Charged Energy" : "Face-down Energy", owner.id));
      });
    case "bakucore": {
      const ownerIds = new Set(targetOwners(match, controllerId, spec, chooserId, priorChoices).map((owner) => owner.id));
      const attachedBakuganId = spec.attachedToBakugan === "controller-active"
        ? match.selected[controllerId]
        : spec.attachedToBakugan === "source-bakugan"
          ? priorChoices.sourceBakuganId
          : spec.attachedToBakugan === "opponent-active"
            ? match.selected[opponent.id]
            : undefined;
      return match.placements
        .filter((placement) => !spec.attachedToBakugan || placement.attachedTo === attachedBakuganId)
        .filter((placement) => spec.attachmentState !== "attached" || Boolean(placement.attachedTo))
        .filter((placement) => spec.attachmentState !== "unattached" || !placement.attachedTo)
        .filter((placement) => !spec.coreTypes?.length || spec.coreTypes.includes(placement.core.type))
        .filter((placement) => {
          const requestedOwner = spec.owner ?? spec.targetOwner;
          if (requestedOwner === "any" || !requestedOwner) return true;
          const attachedOwner = placement.attachedTo
            ? match.players.find((owner) => owner.bakugan.some((bakugan) => bakugan.id === placement.attachedTo))?.id
            : placement.playerId;
          return Boolean(attachedOwner && ownerIds.has(attachedOwner));
        })
        .map((placement) => option(placement.cell, placement.attachedTo ? `Attached ${placement.core.type} Core` : `${placement.core.type} Core`, placement.playerId));
    }
    case "hand-card": {
      const ownerSpec: ChoiceSpec = { ...spec, owner: spec.owner ?? spec.targetOwner ?? "controller" };
      return targetOwners(match, controllerId, ownerSpec, chooserId, priorChoices).flatMap((owner) => {
        const active = owner.bakugan.find((bakugan) => bakugan.id === match.selected[owner.id]);
        return owner.hand
          .filter((candidate) => candidate.id !== card.id && cardMatchesSpec(candidate, spec))
          .filter((candidate) => candidate.type !== "Evo" || !spec.cardType || Boolean(active && canonicalEvoTargetAllowed(ruleDefinitionForCard(candidate), active)))
          .filter((candidate) => !spec.playForFree || cardPaymentModes(match, controllerId, candidate, {}, { forcedFreeBase: true }).some((mode) => mode.legal))
          .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, owner.id));
      });
    }
    case "deck-card": {
      const count = topDeckCount(match, controllerId, spec, priorChoices, chooserId);
      const ownerSpec: ChoiceSpec = { ...spec, owner: spec.owner ?? spec.targetOwner ?? "controller" };
      return targetOwners(match, controllerId, ownerSpec, chooserId, priorChoices).flatMap((owner) => {
        const candidates = (count ? owner.deckCards.slice(0, count) : owner.deckCards)
          .filter((candidate) => cardMatchesSpec(candidate, spec));
        return candidates.map((candidate, index) => option(
          candidate.id,
          candidate.displayName || candidate.name,
          owner.id,
          count ? `Top card ${index + 1} of ${candidates.length}` : undefined,
          cardPreview(candidate),
        ));
      });
    }
    case "number": {
      const chooser = playerById(match, chooserId);
      const maximum = Math.max(0, chooser.energyZone.length + chooser.energy);
      return Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value), chooser.id));
    }
    case "mode": {
      if (spec.id === "confirmed") return [option("yes", "Yes"), option("no", "No")];
      return spec.options?.map((candidate) => option(candidate.id, candidate.label, controller.id, candidate.description))
        ?? [option("power", "B-Power"), option("damage", "Damage")];
    }
    case "chosen-card":
    case "self":
      return [option(card.id, card.displayName || card.name, controller.id)];
  }
}

function kindFor(spec: ChoiceSpec): ChoiceKind {
  if (spec.selector === "batch-object") return "batch-object";
  if (spec.selector === "discarded-card-this-turn") return "card";
  if (["chosen-bakugan", "active-friendly", "active-enemy", "all-friendly", "all-enemy"].includes(spec.selector)) return "bakugan";
  if (spec.selector === "player" || spec.selector === "controller" || spec.selector === "opponent") return "player";
  if (spec.selector === "hero") return "hero";
  if (spec.selector === "evo") return "evo";
  if (spec.selector === "card-in-play") return "card";
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
  priorChoices: CardChoices = {},
): ChoiceSchema {
  const selected = specs.filter((spec) => spec.timing === timing);
  const simultaneous = selected.some((spec) => spec.chooser === "each-player");
  const fields = selected.flatMap((original): ChoiceField[] => {
    let spec = original;
    if (card.catalogId === "bb-97" && spec.id === "targetEnergyIds" && timing === "announce") {
      const projectedHandSize = playerById(match, controllerId).hand.filter((candidate) => candidate.id !== card.id).length;
      const amount = projectedHandSize === 0 ? 2 : 1;
      spec = { ...spec, minimum: amount, maximum: amount };
    }
    const chooserIds = chooserIdsFor(match, spec.chooser, { controllerId, choices: priorChoices });
    return chooserIds.map((chooserId) => {
      const options = optionsFor(match, controllerId, card, spec, priorChoices, chooserId);
      if (spec.onlyIfAvailableMoreThan != null && options.length <= spec.onlyIfAvailableMoreThan) return null;
      const range = rangeFor(match, controllerId, spec, options.length, priorChoices, chooserId);
      const kind = kindFor(spec);
      const permissionMaximum = kind === "mode"
        && /\bBattle Mastery\b/i.test(card.effect)
        && hasActiveRulePermission(match, controllerId, "battle-mastery-select-both")
        ? 2
        : range.maximum;
      const maximum = Math.min(options.length, Math.max(range.maximum, permissionMaximum));
      return {
        id: spec.id,
        kind,
        label: spec.label,
        chooserId,
        visibility: spec.chooser === "each-player" ? "secret-until-reveal" : spec.visibility ?? "public",
        timing,
        minimum: range.minimum,
        maximum,
        required: range.minimum > 0,
        options,
        ...(kind === "deck-order" && topDeckCount(match, controllerId, spec, priorChoices, chooserId) > 0
          ? { requestedWindowSize: topDeckCount(match, controllerId, spec, priorChoices, chooserId) }
          : {}),
      };
    }).filter((field): field is ChoiceField => field !== null);
  });
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
  timingOverride?: ChoiceTiming,
): ChoiceSchema {
  const definition = ruleDefinitionForCard(card);
  const timing: ChoiceTiming = timingOverride
    ?? (/choose (?:a value for )?x/i.test(sourceText) ? "pay"
      : sourceText === card.effect ? "announce" : "resolve");
  const instructionSpecs = definition.abilities.flatMap((ability) => ability.instructions)
    .filter((instruction) => instruction.sourceText === sourceText || sourceText.includes(instruction.sourceText))
    .flatMap((instruction) => instruction.choices);
  let specs = timing === "announce" || timing === "pay"
    ? definition.play.choices
    : instructionSpecs;
  const alreadyChosen = (spec: ChoiceSpec) => {
    const value = priorChoices[spec.id];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "";
  };
  if (timing === "resolve") {
    specs = specs.map((spec) => spec.timing === "announce" && !alreadyChosen(spec)
      ? { ...spec, timing: "resolve" as const }
      : spec);
  }
  let filtered = specs.filter((spec) => !alreadyChosen(spec));
  if (/\b(?:may|must)\s+Reroll\b|\bto\s+Reroll\b/i.test(sourceText)) {
    const targetId = /opponent(?:'s)?|opposing Bakugan|their Bakugan/i.test(sourceText)
      ? opponentOf(match, controllerId).id
      : controllerId;
    const bothMissed = match.players.every((player) => match.rolls[player.id]?.result === "miss-closed");
    const rerollUnavailable = match.phase !== "power"
      || bothMissed
      || !match.selected[targetId]
      || !match.rolls[targetId]
      || !match.placements.some((placement) => !placement.attachedTo);
    if (rerollUnavailable) filtered = [];
  }
  return buildChoiceSchemaFromSpecs(match, controllerId, card, filtered, timing, priorChoices);
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
    const legal = new Set(item.options.filter((candidate) => !candidate.disabled).map((candidate) => candidate.id));
    if (values.some((value) => !legal.has(value))) throw new Error(`${item.label} contains an illegal selection.`);
    if (new Set(values).size !== values.length) throw new Error(`${item.label} cannot contain duplicate selections.`);
  }
  return true;
}
export function schemaHasLegalCompletion(schema: ChoiceSchema) {
  if (schema.fields.some((item) => item.id === "confirmed" && item.options.some((candidate) => candidate.id === "no"))) return true;
  return schema.fields.every((item) => item.options.filter((candidate) => !candidate.disabled).length >= item.minimum);
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
    const value = source?.[item.id];
    if (value === undefined) continue;
    // Mode choices are represented as separate printed options in the schema.
    // The resolver currently uses the established "both" mode token to make
    // both branch predicates true; keep that token internal to the engine and
    // never expose it as a selectable option.
    if (item.kind === "mode" && Array.isArray(value) && value.length > 1) {
      Object.assign(merged, { [item.id]: "both" });
    } else {
      Object.assign(merged, { [item.id]: value });
    }
  }
  return merged;
}
