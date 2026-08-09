import type { CardChoices, PlayerState } from "../game";
import type { GameCommand } from "./types";

export type ApiAction =
  | "ready"
  | "lobby-ready"
  | "start-match"
  | "lobby-settings"
  | "lobby-deck"
  | "begin-placement"
  | "place"
  | "draw"
  | "energize"
  | "tap-energy"
  | "select"
  | "target"
  | "roll"
  | "reroll"
  | "prepare-play"
  | "play"
  | "choice"
  | "cancel-choice"
  | "order-triggers"
  | "pass"
  | "flip-damage"
  | "damage"
  | "hand-limit"
  | "chat"
  | "concede"
  | "next-turn"
  | "next-game"
  | "undo";

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

export function apiActionToCommand(
  action: ApiAction,
  payload: Record<string, unknown>,
): GameCommand {
  const choices = (payload.choices ?? {}) as CardChoices;
  switch (action) {
    case "ready": return { type: "SET_READY" };
    case "lobby-ready": return { type: "SET_LOBBY_READY", ready: payload.ready === true };
    case "start-match": return { type: "START_MATCH" };
    case "lobby-settings": return {
      type: "UPDATE_LOBBY_SETTINGS",
      rulesFormat: stringValue(payload.rulesFormat) as "standard" | "singleton" | "competitive",
      meta: stringValue(payload.meta) as "battle-brawlers",
    };
    case "lobby-deck": return { type: "UPDATE_LOBBY_DECK", player: payload.player as PlayerState };
    case "begin-placement": return { type: "BEGIN_CORE_PLACEMENT" };
    case "place": return { type: "PLACE_CORE", coreId: stringValue(payload.coreId), cell: stringValue(payload.cell) };
    case "draw": return { type: "DRAW_TURN_CARD" };
    case "energize": return { type: "ENERGIZE", cardId: payload.cardId ? stringValue(payload.cardId) : undefined };
    case "tap-energy": return { type: "TAP_ENERGY_CARD", cardId: stringValue(payload.cardId) };
    case "select": return { type: "SELECT_BAKUGAN", bakuganId: stringValue(payload.bakuganId) };
    case "target": return { type: "SELECT_ROLL_TARGET", cell: stringValue(payload.cell) };
    case "roll": return { type: "CONFIRM_ROLL" };
    case "reroll": return { type: "ACTIVATE_REROLL" };
    case "prepare-play": return { type: "PREPARE_CARD_PLAY", cardId: stringValue(payload.cardId) };
    case "play": return { type: "PLAY_CARD", cardId: stringValue(payload.cardId), choices };
    case "choice": return { type: "SUBMIT_CARD_CHOICE", choices };
    case "cancel-choice": return { type: "CANCEL_CARD_CHOICE" };
    case "order-triggers": return {
      type: "ORDER_TRIGGERS",
      requestId: stringValue(payload.requestId),
      orderedIds: stringArray(payload.orderedIds),
    };
    case "pass": return { type: "PASS_PRIORITY" };
    case "flip-damage": return { type: "REVEAL_DAMAGE_FLIP" };
    case "damage": return {
      type: "PLAY_DAMAGE_FLIP",
      cardId: payload.cardId ? stringValue(payload.cardId) : undefined,
      choices,
    };
    case "hand-limit": return { type: "DISCARD_TO_HAND_LIMIT", cardIds: stringArray(payload.cardIds) };
    case "chat": return { type: "CHAT", message: stringValue(payload.message) };
    case "concede": return { type: "CONCEDE" };
    case "next-turn": return { type: "NEXT_TURN" };
    case "next-game": return { type: "START_NEXT_SERIES_GAME" };
    case "undo": return { type: "UNDO" };
  }
}

export function canonicalJson(value: unknown): string {
  if (value === undefined) return "\"__undefined__\"";
  if (typeof value === "number" && !Number.isFinite(value)) return JSON.stringify(String(value));
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
