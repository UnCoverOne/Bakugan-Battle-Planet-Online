import {
  beginCorePlacement,
  discardToHandLimit,
  energizeCard,
  legalPlacementCells,
  orderTriggers,
  passPriority,
  placeCore,
  selectBakugan,
  submitCardChoice,
  type CardChoices,
  type MatchState,
} from "./game";
import { flipDamageCard, resolveManualDamage } from "./manualDamage";
import { confirmRoll, playerCanConfirmRoll, playerCanSelectRollTarget, selectRollTarget } from "./rolling";
import { drawTurnCard, playerCanDrawTurnCard } from "./turnStart";

/** Deterministic timeout policy shared by HTTP recovery and Durable Object alarms. */
export function resolveExpiredDeadline(input: MatchState, now = Date.now()) {
  if (input.phase === "startingPlayer" && now >= input.startingPlayerRevealedAt) return beginCorePlacement(input, now);
  if (now <= input.deadline || ["lobby", "result"].includes(input.phase)) return input;
  const state = structuredClone(input);
  const actorId = state.priority;
  const actor = state.players.find((player) => player.id === actorId);
  if (!actor) return input;
  if (state.pendingChoice) {
    const fields = state.pendingChoice.schema.fields.filter((candidate) => candidate.chooserId === actorId);
    if (!fields.length) return input;
    const timeoutChoices: Record<string, unknown> = {};
    const confirmation = fields.find((field) => field.id === "confirmed");
    if (confirmation?.options.some((option) => option.id === "no")) timeoutChoices.confirmed = false;
    else for (const field of fields) {
      const selected = field.options.slice(0, field.minimum).map((option) => option.id);
      if (field.id === "xValue") timeoutChoices[field.id] = Number(selected[0] ?? 0);
      else if (field.id === "confirmed") timeoutChoices[field.id] = selected[0] !== "no";
      else if (["targetEnergyIds", "discardCardIds", "handCardIds", "orderedCardIds"].includes(field.id)) timeoutChoices[field.id] = selected;
      else if (selected[0] != null) timeoutChoices[field.id] = selected[0];
    }
    return submitCardChoice(state, actorId, timeoutChoices as CardChoices);
  }
  const triggerOrder = state.triggerOrders.find((request) => request.controllerId === actorId && !request.orderedIds);
  if (triggerOrder) return orderTriggers(state, actorId, triggerOrder.id, triggerOrder.triggerIds);
  if (state.phase === "placement") {
    const used = new Set(state.placements.filter((placement) => placement.playerId === actorId).map((placement) => placement.core.id));
    const core = actor.cores.find((candidate) => !used.has(candidate.id));
    const cell = legalPlacementCells(state)[0];
    return core && cell ? placeCore(state, actorId, core.id, cell) : input;
  }
  if (state.phase === "draw" && playerCanDrawTurnCard(state, actorId, now)) return drawTurnCard(state, actorId, now);
  if (state.phase === "energize" && !actor.energizedThisTurn) return energizeCard(state, actorId);
  if (state.phase === "selection" && !state.selected[actorId]) {
    const bakugan = actor.bakugan.find((candidate) => !candidate.open) ?? actor.bakugan[0];
    return bakugan ? selectBakugan(state, actorId, bakugan.id) : input;
  }
  if (state.phase === "target") {
    if (playerCanSelectRollTarget(state, actorId)) {
      const target = state.placements.find((placement) => !placement.attachedTo);
      return target ? selectRollTarget(state, actorId, target.cell) : input;
    }
    if (playerCanConfirmRoll(state, actorId)) return confirmRoll(state, actorId);
  }
  if (state.phase === "damage" && state.pendingLoser === actorId) {
    if (state.revealedFlip) return resolveManualDamage(state, actorId);
    if (state.pendingDamage > 0) return flipDamageCard(state, actorId);
  }
  if (["preRoll", "power", "victor", "postDamage", "endPlay"].includes(state.phase)) return passPriority(state, actorId);
  if (state.phase === "handLimit") {
    const amount = Math.max(0, actor.hand.length - 7);
    return discardToHandLimit(state, actorId, actor.hand.slice(0, amount).map((card) => card.id));
  }
  return input;
}

export function nextMatchAlarmAt(match: MatchState, now = Date.now()) {
  const twoHours = now + 2 * 60 * 60 * 1_000;
  if (match.phase === "lobby" || match.phase === "result") return twoHours;
  const deadline = match.phase === "startingPlayer"
    ? Math.min(match.deadline, match.startingPlayerRevealedAt)
    : match.deadline;
  return Math.max(now + 1_000, Number.isFinite(deadline) ? deadline : now + 30_000);
}

