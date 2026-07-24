import type { CardChoices, GameCard, MatchState } from "../game";

export type ChoiceKind =
  | "confirm"
  | "bakugan"
  | "player"
  | "hero"
  | "evo"
  | "energy"
  | "core"
  | "hand-cards"
  | "deck-card"
  | "deck-order"
  | "number"
  | "mode";

export type ChoiceVisibility = "public" | "private";

export type ChoiceOption = {
  id: string;
  label: string;
  description?: string;
  ownerId?: string;
};

export type ChoiceField = {
  id: keyof CardChoices;
  kind: ChoiceKind;
  label: string;
  chooserId: string;
  visibility: ChoiceVisibility;
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
  fields: ChoiceField[];
  simultaneous: boolean;
};

export type PendingCardChoice = {
  id: string;
  kind: "card-play" | "trigger" | "resolution";
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
  /** Set as soon as an opponent/private answer makes rewind unsafe. */
  irreversibleInformation?: boolean;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function numberValue(value: string | undefined, fallback = 1) {
  if (!value) return fallback;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || fallback);
}

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

function field(
  id: keyof CardChoices,
  kind: ChoiceKind,
  label: string,
  chooserId: string,
  options: ChoiceOption[],
  minimum = 1,
  maximum = 1,
  visibility: ChoiceVisibility = "public",
): ChoiceField {
  return {
    id,
    kind,
    label,
    chooserId,
    visibility,
    minimum,
    maximum,
    required: minimum > 0,
    options,
  };
}

function selectionRange(text: string, available: number) {
  if (/any number/i.test(text)) return { minimum: 0, maximum: available };
  const upTo = text.match(/up to (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)/i);
  if (upTo) return { minimum: 0, maximum: Math.min(available, numberValue(upTo[1])) };
  const exact = text.match(/(?:discard|sacrifice|choose|shuffle) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/i);
  const amount = Math.min(available, numberValue(exact?.[1]));
  return { minimum: amount, maximum: amount };
}

function choiceController(match: MatchState, controllerId: string, text: string) {
  return /opponent chooses|opponent may choose|chosen by an opponent|your opponent chooses/i.test(text)
    ? opponentOf(match, controllerId).id
    : controllerId;
}

function targetOwner(match: MatchState, controllerId: string, text: string) {
  return /enemy|opposing|opponent(?:'s)?|non-\[[a-z]+\]/i.test(text)
    ? opponentOf(match, controllerId)
    : playerById(match, controllerId);
}

function bakuganOptions(match: MatchState, controllerId: string, card: GameCard) {
  if (/retract a Bakugan/i.test(card.effect)) {
    return match.players.flatMap((owner) => owner.bakugan
      .filter((bakugan) => !/didn'?t open this turn/i.test(card.effect) || bakugan.openedTurn !== match.turn)
      .map((bakugan) => option(bakugan.id, `${bakugan.name} • ${bakugan.open ? "Open" : "Closed"}`, owner.id)));
  }
  const owner = targetOwner(match, controllerId, card.effect);
  if (card.type === "Evo") {
    const normalized = (value: string | null | undefined) => String(value ?? "")
      .replace(/\s*\(Battle Brawlers\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    return owner.bakugan
      .filter((bakugan) => normalized(bakugan.name) === normalized(card.evolvesFrom) && bakugan.faction === card.faction)
      .map((bakugan) => option(bakugan.id, `${bakugan.name} • ${bakugan.faction}`, owner.id));
  }
  return owner.bakugan.map((bakugan) => option(
    bakugan.id,
    `${bakugan.name} • ${bakugan.open ? "Open" : "Closed"}`,
    owner.id,
  ));
}

function cardUsesBakuganTarget(card: GameCard, includeIntrinsicCardTarget: boolean) {
  const selectionText = card.effect
    .replace(/\b(?:all (?:of )?)?your Bakugan (?:have|get)\b[^.]*\.?/gi, "")
    .replace(/\b(?:all )?(?:enemy|opposing) Bakugan (?:have|get)\b[^.]*\.?/gi, "");
  return (includeIntrinsicCardTarget && card.type === "Evo")
    || /(?:choose(?:s)?|target|your|enemy|opposing|non-\[[a-z]+\]) (?:an? )?bakugan|retract a bakugan|on this|this bakugan/i.test(selectionText);
}

function modeOptions(card: GameCard) {
  if (card.name === "Endless Growth" || /\[B\].*or.*\[Damage Rating\]|power.*or.*damage/i.test(card.effect)) {
    return [option("power", "B-Power"), option("damage", "Damage")];
  }
  if (/you may|may choose/i.test(card.effect)) return [option("yes", "Use effect"), option("no", "Decline")];
  const clauses = card.effect.split(/\s+or\s+/i);
  return clauses.length > 1
    ? clauses.slice(0, 4).map((clause, index) => option(`mode-${index + 1}`, clause.trim()))
    : [];
}

export function buildChoiceSchema(
  match: MatchState,
  controllerId: string,
  card: GameCard,
  sourceText = card.effect,
  priorChoices: CardChoices = {},
): ChoiceSchema {
  const player = playerById(match, controllerId);
  const opponent = opponentOf(match, controllerId);
  const text = sourceText;
  const contextualCard = sourceText === card.effect ? card : { ...card, effect: sourceText };
  const chooserId = choiceController(match, controllerId, text);
  const controllerChooser = controllerId;
  const opponentChooser = opponent.id;
  const fields: ChoiceField[] = [];

  if (/\bmay\b/i.test(text)) {
    fields.push(field("confirmed", "confirm", "Use this optional effect?", /opponent may/i.test(text) ? opponentChooser : controllerChooser, [
      option("yes", "Yes"),
      option("no", "No"),
    ]));
  }

  const includeIntrinsicCardTarget = sourceText === card.effect && !priorChoices.targetBakuganId;
  if (cardUsesBakuganTarget(contextualCard, includeIntrinsicCardTarget)) {
    const bakuganChooser = /opponent chooses (?:an? )?Bakugan/i.test(text) ? opponentChooser : controllerChooser;
    fields.push(field("targetBakuganId", "bakugan", "Choose a Bakugan", bakuganChooser, bakuganOptions(match, controllerId, contextualCard)));
  }
  if (/choose a player/i.test(text)) {
    fields.push(field("targetPlayerId", "player", "Choose a player", controllerChooser, match.players.map((candidate) => option(candidate.id, candidate.name, candidate.id))));
  }
  if (/destroy a hero|choose a hero|take control of a hero|energize (?:it|that hero)/i.test(text)) {
    const owners = /enemy|opponent/i.test(text) ? [opponent] : match.players;
    const maximumCost = text.match(/cost (\d+) \[Energy\] or less/i)?.[1];
    fields.push(field("targetHeroId", "hero", "Choose a Hero", chooserId, owners.flatMap((owner) => owner.heroes
      .filter((hero) => maximumCost == null || (typeof hero.cost === "number" && hero.cost <= Number(maximumCost)))
      .map((hero) => option(hero.id, hero.name, owner.id)))));
  }
  if (/destroy an evo|choose an evo/i.test(text)) {
    fields.push(field("targetEvoId", "evo", "Choose an Evo", chooserId, match.players.flatMap((owner) => owner.bakugan.flatMap((bakugan) => bakugan.evoStack
      .filter((evo) => !/not played this turn/i.test(text) || evo.playedTurn !== match.turn)
      .map((evo) => option(evo.id, evo.name, owner.id))))));
  }
  if (/destroy (?:an?|two) (?:enemy )?energy|choose an energy/i.test(text)) {
    const owners = /enemy|opponent/i.test(text) ? [opponent] : match.players;
    const amount = /two energy/i.test(text) ? 2 : 1;
    fields.push(field("targetEnergyIds", "energy", "Choose Energy", chooserId, owners.flatMap((owner) => owner.energyZone.map((energy) => option(energy.id, "Face-down Energy", owner.id))), amount, amount, "private"));
  }
  if (/attach a bakucore|remove (?:an|a) (?:enemy )?bakugan(?:'s)? bakucore|choose a bakucore|turn a bakucore .*face up/i.test(text)) {
    const remove = /remove/i.test(text);
    const options = remove
      ? match.players.flatMap((owner) => owner.bakugan.flatMap((bakugan) => bakugan.heldCoreCells.map((cell) => option(cell, `Core held by ${bakugan.name}`, owner.id))))
      : match.placements.filter((placement) => !placement.attachedTo && !placement.revealed).map((placement) => option(placement.cell, `${placement.core.type} Core`, placement.playerId));
    fields.push(field("coreCell", "core", "Choose a BakuCore", chooserId, options));
  }

  const selectsHandCards = /sacrifice|discard (?:a|an|one|two|three|any|up to)|cards? from your hand|play a card from your hand for free|shuffle .*cards? from your hand/i.test(text);
  if (selectsHandCards) {
    const affectedPlayer = priorChoices.targetPlayerId
      ? playerById(match, priorChoices.targetPlayerId)
      : /your opponent discards|opponent discards/i.test(text) ? opponent : player;
    const range = selectionRange(text, affectedPlayer.hand.filter((candidate) => candidate.id !== card.id).length);
    fields.push(field(
      /sacrifice|discard/i.test(text) ? "discardCardIds" : "handCardIds",
      "hand-cards",
      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : /discard/i.test(text) ? "Choose cards to discard" : "Choose cards",
      affectedPlayer.id,
      affectedPlayer.hand.filter((candidate) => candidate.id !== card.id).map((candidate) => option(candidate.id, candidate.displayName || candidate.name, affectedPlayer.id)),
      range.minimum,
      range.maximum,
      "private",
    ));
  }

  if (/search your deck/i.test(text)) {
    const requestedType = text.match(/for an? (Action|Hero|Evo|Flip)/i)?.[1];
    const options = player.deckCards
      .filter((candidate) => !requestedType || candidate.type === requestedType)
      .map((candidate) => option(candidate.id, candidate.displayName || candidate.name, player.id));
    fields.push(field("deckCardId", "deck-card", "Choose a card from your deck", controllerChooser, options, options.length ? 1 : 0, 1, "private"));
  }

  const reorder = text.match(/(?:look at|reveal) the top (a|an|one|two|three|four|five|\d+) cards?.*any order/i);
  if (reorder) {
    const amount = Math.min(numberValue(reorder[1]), player.deckCards.length);
    fields.push(field(
      "orderedCardIds",
      "deck-order",
      "Choose the new top-to-bottom order",
      controllerChooser,
      player.deckCards.slice(0, amount).map((candidate) => option(candidate.id, candidate.displayName || candidate.name, player.id)),
      amount,
      amount,
      "private",
    ));
  }

  if (card.cost === "X" || /choose (?:a value for )?x|\bX\b/i.test(text)) {
    const maximum = Math.max(0, player.energyZone.length || player.energy);
    fields.push(field("xValue", "number", "Choose X", chooserId, Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value))), 1, 1));
  }

  const modes = modeOptions(contextualCard);
  if (modes.length && !fields.some((candidate) => candidate.id === "confirmed" && modes.every((candidate) => candidate.id === "yes" || candidate.id === "no"))) {
    const modeChooser = /opponent chooses|chosen by an opponent/i.test(text) ? opponentChooser : controllerChooser;
    fields.push(field("mode", "mode", "Choose an effect", modeChooser, modes));
  }

  const simultaneous = /each player (?:secretly )?chooses|both players (?:secretly )?choose|simultaneously/i.test(text);
  if (simultaneous) {
    for (const item of fields) item.visibility = "private";
    const templates = [...fields];
    for (const chooser of match.players.filter((candidate) => candidate.id !== chooserId)) {
      for (const template of templates) {
        let options = template.options;
        if (template.kind === "hand-cards") options = chooser.hand.map((candidate) => option(candidate.id, candidate.displayName || candidate.name, chooser.id));
        if (template.kind === "bakugan") options = chooser.bakugan.map((candidate) => option(candidate.id, candidate.name, chooser.id));
        if (template.kind === "energy") options = chooser.energyZone.map((candidate) => option(candidate.id, "Face-down Energy", chooser.id));
        fields.push({ ...template, chooserId: chooser.id, options });
      }
    }
  }

  return {
    id: `${match.id}:${match.version}:${card.id}:${sourceText}:choices`,
    sourceId: card.id,
    sourceName: card.displayName || card.name,
    controllerId,
    fields,
    simultaneous,
  };
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
    if (values.length < item.minimum || values.length > item.maximum) {
      throw new Error(`${item.label} requires ${item.minimum === item.maximum ? item.minimum : `${item.minimum}–${item.maximum}`} selection${item.maximum === 1 ? "" : "s"}.`);
    }
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
  const chooserIds = [...new Set(schema.fields.map((item) => item.chooserId))];
  return chooserIds.every((chooserId) => {
    const answer = answers[chooserId];
    if (!answer) return false;
    try { return validateChoices(schema, chooserId, answer); }
    catch { return false; }
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

