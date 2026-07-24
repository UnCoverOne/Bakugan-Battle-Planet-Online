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
  return ["PREPARE_CARD_PLAY", "PLAY_CARD", "REVEAL_DAMAGE_FLIP", "PLAY_DAMAGE_FLIP"].includes(command.type);
}

/** Describes zone, payment, priority, and destination semantics for UI/events. */
export function playContextFor(command: PlayPipelineCommand): PlayContext {
  switch (command.type) {
    case "PREPARE_CARD_PLAY": return { stage: "prepare", sourceZone: "hand", paymentMode: "normal", isCopy: false, opensPriority: false, destinationAfterResolution: "none" };
    case "PLAY_CARD": return { stage: "announce-and-pay", sourceZone: "hand", paymentMode: "normal", isCopy: false, opensPriority: true, destinationAfterResolution: "discard" };
    case "REVEAL_DAMAGE_FLIP": return { stage: "reveal", sourceZone: "damage-reveal", paymentMode: "alternative", isCopy: false, opensPriority: false, destinationAfterResolution: "none" };
    case "PLAY_DAMAGE_FLIP": return { stage: "announce-and-pay", sourceZone: "damage-reveal", paymentMode: "alternative", isCopy: false, opensPriority: true, destinationAfterResolution: "discard" };
  }
}
