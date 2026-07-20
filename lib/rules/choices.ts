import type { CardChoices, GameCard, MatchState, PlayerState } from "../game";

export type ChoiceKind =
  | "confirm"
  | "bakugan"
  | "player"
  | "hero"
  | "evo"
  | "energy"
  | "core"
  | "hand-cards"
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
  kind: "card-play" | "trigger";
  controllerId: string;
  cardId: string;
  schema: ChoiceSchema;
  answers: Record<string, CardChoices>;
  createdVersion: number;
  beforeState?: string;
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
  const owner = targetOwner(match, controllerId, card.effect);
  if (card.type === "Evo") {
    return owner.bakugan
      .filter((bakugan) => bakugan.name === card.evolvesFrom && bakugan.faction === card.faction)
      .map((bakugan) => option(bakugan.id, `${bakugan.name} • ${bakugan.faction}`, owner.id));
  }
  return owner.bakugan.map((bakugan) => option(
    bakugan.id,
    `${bakugan.name} • ${bakugan.open ? "Open" : "Closed"}`,
    owner.id,
  ));
}

function cardUsesBakuganTarget(card: GameCard) {
  const text = card.effect;
  return card.type === "Evo"
    || /(?:choose|target|your|enemy|opposing|non-\[[a-z]+\]) (?:an? )?bakugan|on this|this bakugan/i.test(text);
}

function handChoiceRange(card: GameCard, player: PlayerState) {
  const available = player.hand.filter((candidate) => candidate.id !== card.id).length;
  return selectionRange(card.effect, available);
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
): ChoiceSchema {
  const player = playerById(match, controllerId);
  const opponent = opponentOf(match, controllerId);
  const text = card.effect;
  const chooserId = choiceController(match, controllerId, text);
  const fields: ChoiceField[] = [];

  if (/\bmay\b/i.test(text)) {
    fields.push(field("confirmed", "confirm", "Use this optional effect?", chooserId, [
      option("yes", "Yes"),
      option("no", "No"),
    ]));
  }

  if (cardUsesBakuganTarget(card)) {
    fields.push(field("targetBakuganId", "bakugan", "Choose a Bakugan", chooserId, bakuganOptions(match, controllerId, card)));
  }
  if (/choose a player/i.test(text)) {
    fields.push(field("targetPlayerId", "player", "Choose a player", chooserId, match.players.map((candidate) => option(candidate.id, candidate.name, candidate.id))));
  }
  if (/destroy a hero|choose a hero|take control of a hero|energize (?:it|that hero)/i.test(text)) {
    const owners = /enemy|opponent/i.test(text) ? [opponent] : match.players;
    fields.push(field("targetHeroId", "hero", "Choose a Hero", chooserId, owners.flatMap((owner) => owner.heroes.map((hero) => option(hero.id, hero.name, owner.id)))));
  }
  if (/destroy an evo|choose an evo/i.test(text)) {
    fields.push(field("targetEvoId", "evo", "Choose an Evo", chooserId, match.players.flatMap((owner) => owner.bakugan.flatMap((bakugan) => bakugan.evoStack.map((evo) => option(evo.id, evo.name, owner.id))))));
  }
  if (/destroy (?:an?|two) (?:enemy )?energy|choose an energy/i.test(text)) {
    const owners = /enemy|opponent/i.test(text) ? [opponent] : match.players;
    const amount = /two energy/i.test(text) ? 2 : 1;
    fields.push(field("targetEnergyIds", "energy", "Choose Energy", chooserId, owners.flatMap((owner) => owner.energyZone.map((energy) => option(energy.id, "Face-down Energy", owner.id))), amount, amount, "private"));
  }
  if (/attach a bakucore|remove (?:an|a) (?:enemy )?bakugan(?:'s)? bakucore|choose a bakucore/i.test(text)) {
    const remove = /remove/i.test(text);
    const options = remove
      ? match.players.flatMap((owner) => owner.bakugan.flatMap((bakugan) => bakugan.heldCoreCells.map((cell) => option(cell, `Core held by ${bakugan.name}`, owner.id))))
      : match.placements.filter((placement) => !placement.attachedTo).map((placement) => option(placement.cell, `${placement.core.type} Core`, placement.playerId));
    fields.push(field("coreCell", "core", "Choose a BakuCore", chooserId, options));
  }

  const selectsHandCards = /sacrifice|discard (?:a|an|one|two|three|any|up to)|cards? from your hand|play a card from your hand for free|shuffle .*cards? from your hand/i.test(text);
  if (selectsHandCards) {
    const range = handChoiceRange(card, player);
    fields.push(field(
      /sacrifice|discard/i.test(text) ? "discardCardIds" : "handCardIds",
      "hand-cards",
      /sacrifice/i.test(text) ? "Choose cards to sacrifice" : /discard/i.test(text) ? "Choose cards to discard" : "Choose cards",
      chooserId,
      player.hand.filter((candidate) => candidate.id !== card.id).map((candidate) => option(candidate.id, candidate.displayName || candidate.name, player.id)),
      range.minimum,
      range.maximum,
      "private",
    ));
  }

  if (card.cost === "X" || /choose (?:a value for )?x|\bX\b/i.test(text)) {
    const maximum = Math.max(0, player.energyZone.length || player.energy);
    fields.push(field("xValue", "number", "Choose X", chooserId, Array.from({ length: maximum + 1 }, (_, value) => option(String(value), String(value))), 1, 1));
  }

  const modes = modeOptions(card);
  if (modes.length && !fields.some((candidate) => candidate.id === "confirmed" && modes.every((candidate) => candidate.id === "yes" || candidate.id === "no"))) {
    fields.push(field("mode", "mode", "Choose an effect", chooserId, modes));
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
    id: `${match.id}:${match.version}:${card.id}:choices`,
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
