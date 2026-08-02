import {
  cancelCardChoice,
  orderTriggers,
  prepareCardPlay,
  submitCardChoice,
  type MatchState,
} from "../game";
import { playCardWithAutoEnergy } from "../cardPayment";
import { tapEnergyCard } from "../energy";
import { flipDamageCard, resolveManualDamage, resumeDamageAfterFlipWindow } from "../manualDamage";
import {
  flipTieBreakCard,
  manualTieBreakState,
  passPriorityWithTieBreak,
} from "../manualTieBreak";
import type { GameCommand } from "../engine/types";
import { normalizeRuleObjects } from "./state";
import { emitRuleEvent } from "./triggers";

export type RulesCommand = Extract<GameCommand,
  | { type: "PREPARE_CARD_PLAY" }
  | { type: "PLAY_CARD" }
  | { type: "SUBMIT_CARD_CHOICE" }
  | { type: "CANCEL_CARD_CHOICE" }
  | { type: "ORDER_TRIGGERS" }
  | { type: "REVEAL_DAMAGE_FLIP" }
  | { type: "PLAY_DAMAGE_FLIP" }
  | { type: "TAP_ENERGY_CARD" }
  | { type: "PASS_PRIORITY" }
>;

export function isRulesCommand(command: GameCommand): command is RulesCommand {
  return [
    "PREPARE_CARD_PLAY", "PLAY_CARD", "SUBMIT_CARD_CHOICE", "CANCEL_CARD_CHOICE",
    "ORDER_TRIGGERS", "REVEAL_DAMAGE_FLIP", "PLAY_DAMAGE_FLIP", "TAP_ENERGY_CARD",
    "PASS_PRIORITY",
  ].includes(command.type);
}

function replaceLegacyTriggeredObjects(before: MatchState, next: MatchState, actorId: string, command: RulesCommand) {
  if (command.type !== "PLAY_CARD") return next;
  const existing = new Set(before.batch.map((object) => object.id));
  const played = before.players.find((player) => player.id === actorId)?.hand.find((card) => card.id === command.cardId);
  if (!played) return next;
  next.batch = next.batch.filter((object) => existing.has(object.id) || object.kind !== "trigger");
  emitRuleEvent(next, {
    id: `${next.turn}:typed-card-play:${played.id}`,
    name: "CARD_PLAYED",
    actorId,
    controllerId: actorId,
    card: played,
    cardType: played.type,
    targetBakuganId: command.choices.targetBakuganId,
    createdAt: Date.now(),
  });
  return next;
}

export function dispatchRulesCommand(input: MatchState, actorId: string, command: RulesCommand): MatchState {
  normalizeRuleObjects(input);
  let next: MatchState;
  switch (command.type) {
    case "PREPARE_CARD_PLAY": next = prepareCardPlay(input, actorId, command.cardId); break;
    case "PLAY_CARD": next = playCardWithAutoEnergy(input, actorId, command.cardId, command.choices); break;
    case "SUBMIT_CARD_CHOICE": next = submitCardChoice(input, actorId, command.choices); break;
    case "CANCEL_CARD_CHOICE": next = cancelCardChoice(input, actorId); break;
    case "ORDER_TRIGGERS": next = orderTriggers(input, actorId, command.requestId, command.orderedIds); break;
    case "REVEAL_DAMAGE_FLIP": {
      const tieBreak = manualTieBreakState(input);
      next = tieBreak?.status === "resolved"
        ? passPriorityWithTieBreak(input, actorId)
        : tieBreak
          ? flipTieBreakCard(input, actorId)
          : flipDamageCard(input, actorId);
      break;
    }
    case "PLAY_DAMAGE_FLIP": next = resolveManualDamage(input, actorId, command.cardId, command.choices); break;
    case "TAP_ENERGY_CARD": next = tapEnergyCard(input, actorId, command.cardId); break;
    case "PASS_PRIORITY": next = resumeDamageAfterFlipWindow(passPriorityWithTieBreak(input, actorId)); break;
  }
  replaceLegacyTriggeredObjects(input, next, actorId, command);
  return normalizeRuleObjects(next);
}
