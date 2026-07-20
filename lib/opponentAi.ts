import {
  beginCorePlacement,
  cancelCardChoice,
  discardToHandLimit,
  energizeCard,
  legalPlacementCells,
  orderTriggers,
  placeCore,
  prepareCardPlay,
  selectBakugan,
  submitCardChoice,
  totalDamage,
  totalPower,
  type CardChoices,
  type GameCard,
  type MatchState,
} from "./game";
import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";
import { flipDamageCard, passPriorityWithManualDamage, resolveManualDamage } from "./manualDamage";
import { availableRollTargets, confirmRoll, playerCanConfirmRoll, playerCanSelectRollTarget, selectRollTarget } from "./rolling";
import { drawTurnCard, playerCanDrawTurnCard } from "./turnStart";
import { buildChoiceSchema, type ChoiceField } from "./rules/choices";
import { compileCardEffect, estimateProgramValue } from "./rules/effects";

const PRIORITY_PHASES = new Set<MatchState["phase"]>(["preRoll", "power", "victor", "postDamage", "endPlay"]);

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function opponentOf(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id !== playerId);
}

function cardValue(match: MatchState, playerId: string, card: GameCard, choices: CardChoices = {}) {
  const program = compileCardEffect(card);
  const printedCost = card.cost === "X" ? choices.xValue ?? 0 : card.cost;
  let value = estimateProgramValue(program, match, playerId, choices) - printedCost * 0.72;
  if (card.type === "Hero") value += 2.4 + Math.max(0, 4 - match.turn) * 0.35;
  if (card.type === "Evo") value += 3.2;
  if (card.type === "Flip") value += match.pendingDamage > 0 ? 5 : -10;
  if (/negate/i.test(card.effect)) value += match.batch.length ? 6 : -5;
  if (/\+\d+ \[B\]/i.test(card.effect) && match.phase === "power") {
    const gap = totalPower(match, playerId) - totalPower(match, opponentOf(match, playerId)?.id ?? "");
    value += gap < 0 ? 3 : -0.8;
  }
  if (/\+\d+ \[Damage Rating\]/i.test(card.effect) && ["victor", "power"].includes(match.phase)) value += 1.5;
  return value;
}

function setChoice(choices: CardChoices, field: ChoiceField, values: string[]) {
  if (field.id === "discardCardIds" || field.id === "handCardIds" || field.id === "targetEnergyIds") {
    Object.assign(choices, { [field.id]: values });
  } else if (field.id === "xValue") choices.xValue = Number(values[0] ?? 0);
  else if (field.id === "confirmed") choices.confirmed = values[0] !== "no";
  else Object.assign(choices, { [field.id]: values[0] });
}

function optionScore(match: MatchState, playerId: string, card: GameCard, field: ChoiceField, id: string) {
  const player = playerById(match, playerId)!;
  const opponent = opponentOf(match, playerId)!;
  if (field.kind === "bakugan") {
    const bakugan = [...player.bakugan, ...opponent.bakugan].find((candidate) => candidate.id === id);
    if (!bakugan) return -100;
    const enemy = opponent.bakugan.includes(bakugan);
    const strength = bakugan.bPower * 0.01 + bakugan.damage;
    return enemy ? -strength : strength;
  }
  if (field.kind === "hero") {
    const hero = [...player.heroes, ...opponent.heroes].find((candidate) => candidate.id === id);
    return hero ? (hero.cost === "X" ? 0 : hero.cost) + estimateProgramValue(compileCardEffect(hero), match, playerId) : 0;
  }
  if (field.kind === "evo") {
    const evo = [...player.bakugan, ...opponent.bakugan].flatMap((bakugan) => bakugan.evoStack).find((candidate) => candidate.id === id);
    return evo ? (evo.bPower ?? 0) * 0.01 + (evo.damage ?? 0) : 0;
  }
  if (field.kind === "core") {
    const placement = match.placements.find((candidate) => candidate.cell === id);
    return placement ? placement.core.bonus * 0.01 + placement.core.damageBonus : 0;
  }
  if (field.kind === "hand-cards") {
    const selected = player.hand.find((candidate) => candidate.id === id);
    return selected ? -cardValue(match, playerId, selected) : 0;
  }
  if (field.kind === "number") {
    const amount = Number(id);
    return amount <= Math.min(5, player.energyZone.length || player.energy) ? amount * 0.8 : -amount;
  }
  if (field.kind === "mode") {
    const powerGap = totalPower(match, playerId) - totalPower(match, opponent.id);
    if (id === "power") return powerGap < 0 ? 5 : 1;
    if (id === "damage") return powerGap >= 0 ? 4 : 1;
    if (id === "yes") return cardValue(match, playerId, card) > 0 ? 3 : -3;
  }
  if (field.kind === "player") return id === opponent.id ? 2 : 0;
  return 0;
}

export function chooseCardChoices(match: MatchState, playerId: string, card: GameCard, chooserId = playerId): CardChoices {
  const schema = buildChoiceSchema(match, playerId, card);
  const choices: CardChoices = {};
  for (const field of schema.fields.filter((candidate) => candidate.chooserId === chooserId)) {
    const ranked = [...field.options].sort((a, b) => (
      optionScore(match, playerId, card, field, b.id) - optionScore(match, playerId, card, field, a.id)
    ));
    let count = field.minimum;
    if (field.maximum > field.minimum && /any number/i.test(card.effect)) {
      count = Math.min(field.maximum, Math.max(field.minimum, cardValue(match, playerId, card) > 4 ? 2 : 0));
    }
    setChoice(choices, field, ranked.slice(0, count || (field.kind === "number" || field.kind === "mode" || field.kind === "confirm" ? 1 : 0)).map((candidate) => candidate.id));
  }
  return choices;
}

function bestEnergyCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return [...player.hand].sort((a, b) => cardValue(match, playerId, a) - cardValue(match, playerId, b))[0];
}

function bestBakugan(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return player.bakugan
    .filter((bakugan) => !bakugan.open)
    .sort((a, b) => (b.bPower * 0.01 + b.damage + b.rollAccuracy * 0.03) - (a.bPower * 0.01 + a.damage + a.rollAccuracy * 0.03))[0]
    ?? player.bakugan[0];
}

function bestRollTarget(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  const bakugan = player.bakugan.find((candidate) => candidate.id === match.selected[playerId]) ?? player.bakugan[0];
  const opponentTarget = Object.entries(match.targets).find(([id]) => id !== playerId)?.[1];
  return [...availableRollTargets(match)].sort((a, b) => {
    const bonus = (placement: typeof a) => {
      const conditional = !placement.core.conditionalFactions?.length || placement.core.conditionalFactions.includes(bakugan.faction);
      const value = placement.core.bonus + (conditional ? placement.core.conditionalBonus ?? 0 : 0);
      const damage = placement.core.damageBonus + (conditional ? placement.core.conditionalDamage ?? 0 : 0);
      return value * 0.01 + damage + (placement.cell === opponentTarget ? -0.75 : 0);
    };
    return bonus(b) - bonus(a);
  })[0];
}

function bestPlayableCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return player.hand
    .filter((card) => card.type !== "Flip" && card.type !== "Character")
    .map((card) => {
      const choices = chooseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      return { card, choices, payment, score: cardValue(match, playerId, card, choices) };
    })
    .filter((candidate) => candidate.payment && candidate.payment.kind !== "insufficient")
    .sort((a, b) => b.score - a.score)[0];
}

export function opponentAiCanAct(match: MatchState, playerId: string) {
  if (!playerById(match, playerId)) return false;
  if (match.pendingChoice?.schema.fields.some((field) => field.chooserId === playerId && !match.pendingChoice?.answers[playerId])) return true;
  if (match.triggerOrders.some((request) => request.controllerId === playerId && !request.orderedIds)) return true;
  if (match.phase === "startingPlayer" && Date.now() >= match.startingPlayerRevealedAt) return true;
  if (match.phase === "placement" && match.priority === playerId) return true;
  if (playerCanDrawTurnCard(match, playerId)) return true;
  const player = playerById(match, playerId)!;
  if (match.phase === "energize" && !player.energizedThisTurn) return true;
  if (match.phase === "selection" && !match.selected[playerId]) return true;
  if (match.phase === "target" && (playerCanSelectRollTarget(match, playerId) || playerCanConfirmRoll(match, playerId))) return true;
  if (match.phase === "damage" && match.pendingLoser === playerId) return true;
  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;
  return match.phase === "handLimit" && match.priority === playerId;
}

export function advanceOpponentAi(input: MatchState, playerId: string): MatchState | null {
  const player = playerById(input, playerId);
  if (!player) return null;
  const pending = input.pendingChoice;
  if (pending && pending.schema.fields.some((field) => field.chooserId === playerId) && !pending.answers[playerId]) {
    const card = input.players.flatMap((candidate) => candidate.hand).find((candidate) => candidate.id === pending.cardId);
    return card ? submitCardChoice(input, playerId, chooseCardChoices(input, pending.controllerId, card, playerId)) : cancelCardChoice(input, pending.controllerId);
  }
  const triggerOrder = input.triggerOrders.find((request) => request.controllerId === playerId && !request.orderedIds);
  if (triggerOrder) {
    const ids = [...triggerOrder.triggers].sort((a, b) => (
      estimateProgramValue(compileCardEffect(a.card, a.effect), input, playerId, a.choices)
      - estimateProgramValue(compileCardEffect(b.card, b.effect), input, playerId, b.choices)
    )).map((trigger) => trigger.id);
    return orderTriggers(input, playerId, triggerOrder.id, ids);
  }
  if (input.phase === "startingPlayer" && Date.now() >= input.startingPlayerRevealedAt) return beginCorePlacement(input);
  if (input.phase === "placement" && input.priority === playerId) {
    const used = new Set(input.placements.filter((placement) => placement.playerId === playerId).map((placement) => placement.core.id));
    const core = player.cores.find((candidate) => !used.has(candidate.id));
    const cell = legalPlacementCells(input)[0];
    return core && cell ? placeCore(input, playerId, core.id, cell) : null;
  }
  if (playerCanDrawTurnCard(input, playerId)) return drawTurnCard(input, playerId);
  if (input.phase === "energize" && !player.energizedThisTurn) return energizeCard(input, playerId, bestEnergyCard(input, playerId)?.id);
  if (input.phase === "selection" && !input.selected[playerId]) return selectBakugan(input, playerId, bestBakugan(input, playerId).id);
  if (input.phase === "target") {
    if (playerCanSelectRollTarget(input, playerId)) {
      const target = bestRollTarget(input, playerId);
      return target ? selectRollTarget(input, playerId, target.cell) : null;
    }
    if (playerCanConfirmRoll(input, playerId)) return confirmRoll(input, playerId);
  }
  if (input.phase === "damage" && input.pendingLoser === playerId) {
    if (!input.revealedFlip) return input.pendingDamage > 0 ? flipDamageCard(input, playerId) : null;
    const choices = chooseCardChoices(input, playerId, input.revealedFlip);
    const payment = cardEnergyPaymentState(input, playerId, input.revealedFlip, choices);
    const useful = estimateProgramValue(compileCardEffect(input.revealedFlip), input, playerId, choices) > 0;
    return resolveManualDamage(input, playerId, payment && payment.kind !== "insufficient" && useful ? input.revealedFlip.id : undefined, choices);
  }
  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {
    const best = bestPlayableCard(input, playerId);
    if (best && best.score > 0.75) {
      const schema = buildChoiceSchema(input, playerId, best.card);
      return schema.fields.length ? prepareCardPlay(input, playerId, best.card.id) : playCardWithAutoEnergy(input, playerId, best.card.id, best.choices);
    }
    return passPriorityWithManualDamage(input, playerId);
  }
  if (input.phase === "handLimit" && input.priority === playerId) {
    const amount = Math.max(0, player.hand.length - 7);
    const cards = [...player.hand].sort((a, b) => cardValue(input, playerId, a) - cardValue(input, playerId, b)).slice(0, amount);
    return discardToHandLimit(input, playerId, cards.map((card) => card.id));
  }
  return null;
}
