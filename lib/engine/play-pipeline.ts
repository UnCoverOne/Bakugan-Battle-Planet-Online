import { playCardWithAutoEnergy } from "../cardPayment";
import { prepareCardPlay, type CardChoices, type MatchState } from "../game";
import { flipDamageCard, resolveManualDamage } from "../manualDamage";
import type { GameCommand } from "./types";

export type PlaySourceZone = "hand" | "damage-reveal" | "deck" | "discard" | "copy";
export type PaymentMode = "normal" | "free" | "alternative";

export type PlayContext = {
  stage: "prepare" | "announce-and-pay" | "reveal";
  sourceZone: PlaySourceZone;
  paymentMode: PaymentMode;
  isCopy: boolean;
  opensPriority: boolean;
  destinationAfterResolution: "discard" | "play" | "owner-hand" | "none";
};

export type PlayPipelineCommand = Extract<GameCommand,
  | { type: "PREPARE_CARD_PLAY" }
  | { type: "PLAY_CARD" }
  | { type: "REVEAL_DAMAGE_FLIP" }
  | { type: "PLAY_DAMAGE_FLIP" }
>;

export function isPlayPipelineCommand(command: GameCommand): command is PlayPipelineCommand {
  return command.type === "PREPARE_CARD_PLAY"
    || command.type === "PLAY_CARD"
    || command.type === "REVEAL_DAMAGE_FLIP"
    || command.type === "PLAY_DAMAGE_FLIP";
}

export function playContextFor(command: PlayPipelineCommand): PlayContext {
  switch (command.type) {
    case "PREPARE_CARD_PLAY":
      return {
        stage: "prepare",
        sourceZone: "hand",
        paymentMode: "normal",
        isCopy: false,
        opensPriority: false,
        destinationAfterResolution: "none",
      };
    case "PLAY_CARD":
      return {
        stage: "announce-and-pay",
        sourceZone: "hand",
        paymentMode: "normal",
        isCopy: false,
        opensPriority: true,
        destinationAfterResolution: "discard",
      };
    case "REVEAL_DAMAGE_FLIP":
      return {
        stage: "reveal",
        sourceZone: "damage-reveal",
        paymentMode: "alternative",
        isCopy: false,
        opensPriority: false,
        destinationAfterResolution: "none",
      };
    case "PLAY_DAMAGE_FLIP":
      return {
        stage: "announce-and-pay",
        sourceZone: "damage-reveal",
        paymentMode: "alternative",
        isCopy: false,
        opensPriority: true,
        destinationAfterResolution: "discard",
      };
  }
}

/**
 * Compatibility play pipeline. Every server-originated card-play command enters
 * through this function, even while the legacy card resolver remains behind the
 * adapter. Free plays and copies produced during resolution are represented by
 * the same PlayContext shape as they migrate into the typed rules engine.
 */
export function executePlayPipeline(
  input: MatchState,
  playerId: string,
  command: PlayPipelineCommand,
): MatchState {
  switch (command.type) {
    case "PREPARE_CARD_PLAY":
      return prepareCardPlay(input, playerId, command.cardId);
    case "PLAY_CARD":
      return playCardWithAutoEnergy(input, playerId, command.cardId, command.choices);
    case "REVEAL_DAMAGE_FLIP":
      return flipDamageCard(input, playerId);
    case "PLAY_DAMAGE_FLIP":
      return resolveManualDamage(input, playerId, command.cardId, command.choices as CardChoices);
  }
}
