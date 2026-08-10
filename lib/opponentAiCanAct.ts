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
import {
  availableRollTargets,
  confirmRoll,
  playerCanConfirmRoll,
  playerCanSelectRollTarget,
  selectRollTarget,
} from "./rolling";
import { drawTurnCard, playerCanDrawTurnCard } from "./turnStart";

const PRIORITY_PHASES = new Set<MatchState["phase"]>([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
]);

/**
 * Lightweight readiness check used by the UI. Tactical planning stays
 * inside the opponent worker and is not bundled into the render thread.
 */
export function opponentAiCanAct(match: MatchState, playerId: string) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return false;
  if (match.pendingChoice?.schema.fields.some(
    (field) => field.chooserId === playerId && !match.pendingChoice?.answers[playerId],
  )) return true;
  if (match.triggerOrders.some(
    (request) => request.controllerId === playerId && !request.orderedIds,
  )) return true;
  if (
    match.phase === "startingPlayer"
    && Date.now() >= match.startingPlayerRevealedAt
  ) return true;
  if (match.phase === "placement" && match.priority === playerId) return true;
  if (playerCanDrawTurnCard(match, playerId)) return true;
  if (match.phase === "energize" && !player.energizedThisTurn) return true;
  if (match.phase === "selection" && !match.selected[playerId]) return true;
  if (
    (match.phase === "target" || match.phase === "reroll")
    && (
      playerCanSelectRollTarget(match, playerId)
      || playerCanConfirmRoll(match, playerId)
    )
  ) return true;
  if (match.phase === "damage" && match.pendingLoser === playerId) return true;
  if (
    match.phase === "reset"
    && match.batch.length > 0
    && match.priority === playerId
  ) return true;
  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;
  return match.phase === "handLimit" && match.priority === playerId;
}

function conservativeChoiceAnswers(match: MatchState, playerId: string) {
  const choices: CardChoices = {};
  const pending = match.pendingChoice;
  if (!pending) return choices;
  for (const field of pending.schema.fields.filter((candidate) => (
    candidate.chooserId === playerId
  ))) {
    const scalar = ["number", "mode", "confirm"].includes(field.kind);
    const count = Math.min(field.maximum, Math.max(field.minimum, scalar ? 1 : 0));
    const values = field.options.slice(0, count).map((option) => option.id);
    if (
      field.id === "discardCardIds"
      || field.id === "handCardIds"
      || field.id === "targetEnergyIds"
      || field.id === "orderedCardIds"
    ) {
      Object.assign(choices, { [field.id]: values });
    } else if (field.id === "xValue") {
      choices.xValue = Number(values[0] ?? 0);
    } else if (field.id === "confirmed") {
      choices.confirmed = values[0] !== "no";
    } else {
      Object.assign(choices, { [field.id]: values[0] });
    }
  }
  return choices;
}

/**
 * A failed, empty, or timed-out tactical worker must not strand a Training
 * match. Use only deterministic legal actions here: optional priority windows
 * pass, while mandatory game windows take their simplest valid action.
 */
export function recoverOpponentAiFailure(
  match: MatchState,
  playerId: string,
): MatchState | null {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player || !opponentAiCanAct(match, playerId)) return null;

  try {
    const pending = match.pendingChoice;
    if (
      pending
      && pending.schema.fields.some((field) => (
        field.chooserId === playerId && !pending.answers[playerId]
      ))
    ) {
      return submitCardChoice(
        match,
        playerId,
        conservativeChoiceAnswers(match, playerId),
      );
    }

    const triggerOrder = match.triggerOrders.find((request) => (
      request.controllerId === playerId && !request.orderedIds
    ));
    if (triggerOrder) {
      return orderTriggers(
        match,
        playerId,
        triggerOrder.id,
        triggerOrder.triggers.map((trigger) => trigger.id),
      );
    }

    if (
      match.phase === "startingPlayer"
      && Date.now() >= match.startingPlayerRevealedAt
    ) return beginCorePlacement(match);

    if (match.phase === "placement" && match.priority === playerId) {
      const used = new Set(
        match.placements
          .filter((placement) => placement.playerId === playerId)
          .map((placement) => placement.core.id),
      );
      const core = player.cores.find((candidate) => !used.has(candidate.id));
      const cell = legalPlacementCells(match)[0];
      return core && cell ? placeCore(match, playerId, core.id, cell) : null;
    }

    if (playerCanDrawTurnCard(match, playerId)) {
      return drawTurnCard(match, playerId);
    }
    if (match.phase === "energize" && !player.energizedThisTurn) {
      return energizeCard(match, playerId);
    }
    if (match.phase === "selection" && !match.selected[playerId]) {
      const bakugan = player.bakugan.find((candidate) => !candidate.open)
        ?? player.bakugan[0];
      return bakugan ? selectBakugan(match, playerId, bakugan.id) : null;
    }
    if (match.phase === "target" || match.phase === "reroll") {
      if (playerCanSelectRollTarget(match, playerId)) {
        const target = availableRollTargets(match)[0];
        return target ? selectRollTarget(match, playerId, target.cell) : null;
      }
      if (playerCanConfirmRoll(match, playerId)) {
        return confirmRoll(match, playerId);
      }
    }
    if (match.phase === "damage" && match.pendingLoser === playerId) {
      if (match.revealedFlip) return resolveManualDamage(match, playerId);
      if (match.pendingDamage > 0) return flipDamageCard(match, playerId);
    }
    if (
      match.phase === "reset"
      && match.batch.length > 0
      && match.priority === playerId
    ) return passPriority(match, playerId);
    if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) {
      return passPriority(match, playerId);
    }
    if (match.phase === "handLimit" && match.priority === playerId) {
      const amount = Math.max(0, player.hand.length - 7);
      return discardToHandLimit(
        match,
        playerId,
        player.hand.slice(0, amount).map((card) => card.id),
      );
    }
  } catch {
    return null;
  }
  return null;
}
