import type { CardChoices, MatchState } from "../game";
import type { ChoiceField } from "../rules/choices";

type TimeoutMetadata = {
  timeoutStrikes?: Record<string, { decision: number; connectionGrace: number }>;
};
type TimeoutTrackedState = MatchState & { __engine?: TimeoutMetadata };

function recordFor(state: TimeoutTrackedState, playerId: string) {
  state.__engine ??= {};
  state.__engine.timeoutStrikes ??= {};
  state.__engine.timeoutStrikes[playerId] ??= { decision: 0, connectionGrace: 0 };
  return state.__engine.timeoutStrikes[playerId];
}

function lowImpactOptions(state: MatchState, playerId: string, field: ChoiceField) {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const byId = new Map(player?.hand.map((card) => [card.id, card]) ?? []);
  return [...field.options].sort((left, right) => {
    const leftCard = byId.get(left.id);
    const rightCard = byId.get(right.id);
    const leftCost = leftCard ? (leftCard.cost === "X" ? 0 : leftCard.cost) : 0;
    const rightCost = rightCard ? (rightCard.cost === "X" ? 0 : rightCard.cost) : 0;
    return leftCost - rightCost || left.id.localeCompare(right.id);
  });
}

export function timeoutChoicesForFields(state: MatchState, playerId: string, fields: readonly ChoiceField[]): CardChoices {
  const answers: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.id === "confirmed" && field.options.some((option) => option.id === "no")) {
      answers.confirmed = false;
      continue;
    }
    const options = lowImpactOptions(state, playerId, field);
    const selected = options.slice(0, field.minimum).map((option) => option.id);
    if (field.id === "xValue") answers[field.id] = Number(selected[0] ?? 0);
    else if (field.id === "confirmed") answers[field.id] = selected[0] !== "no";
    else if (field.id === "orderedCardIds") answers[field.id] = field.options.map((option) => option.id);
    else if (["targetEnergyIds", "discardCardIds", "handCardIds"].includes(field.id)) answers[field.id] = selected;
    else if (selected[0] != null) answers[field.id] = selected[0];
  }
  return answers as CardChoices;
}

export function applyConnectionGrace(state: TimeoutTrackedState, playerId: string, now: number) {
  const record = recordFor(state, playerId);
  if (record.connectionGrace >= 2) return false;
  record.connectionGrace += 1;
  state.deadline = now + 30_000;
  return true;
}

export function recordDecisionTimeout(state: TimeoutTrackedState, playerId: string) {
  const record = recordFor(state, playerId);
  record.decision += 1;
  return record.decision;
}

export function clearDecisionTimeouts(state: TimeoutTrackedState, playerId: string) {
  const record = recordFor(state, playerId);
  record.decision = 0;
  record.connectionGrace = 0;
}
