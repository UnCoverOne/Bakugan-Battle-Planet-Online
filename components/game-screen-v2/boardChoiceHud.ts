"use client";

import { useSyncExternalStore } from "react";

export type BoardChoiceHudState = {
  id: string;
  matchId: string;
  playerId: string;
  prompt: string;
  canCancel: boolean;
  canConfirm: boolean;
  busy: boolean;
  error: string;
  confirm: () => void;
  cancel: () => void;
  clearError: () => void;
};

type BoardChoicePromptInput = {
  sourceName: string;
  fieldLabel: string;
  targetKind: string;
  selectedNames: string[];
  minimum: number;
  maximum: number;
  complete: boolean;
  canCancel: boolean;
};

function targetName(kind: string, plural: boolean) {
  const names: Record<string, [string, string]> = {
    "batch-object": ["Batch object", "Batch objects"],
    hero: ["Hero", "Heroes"],
    evo: ["Character Card", "Character Cards"],
    energy: ["Energy card", "Energy cards"],
    bakugan: ["Character Card", "Character Cards"],
    core: ["BakuCore", "BakuCores"],
    card: ["card", "cards"],
  };
  const pair = names[kind] ?? ["target", "targets"];
  return plural ? pair[1] : pair[0];
}

export function boardChoicePrompt(input: BoardChoicePromptInput) {
  const selected = input.selectedNames.join(", ");
  if (input.complete && selected) {
    const action = input.canCancel
      ? "Confirm the target or cancel the card"
      : "Confirm the target";
    return input.sourceName + " — Selected: " + selected + ". " + action + " in the Action HUD.";
  }
  const remaining = Math.max(0, input.minimum - input.selectedNames.length);
  const amount = input.maximum === 1
    ? "an eligible"
    : String(remaining || input.minimum) + " eligible";
  const noun = targetName(input.targetKind, input.maximum !== 1);
  const progress = selected ? " Selected: " + selected + "." : "";
  return input.sourceName + " — " + input.fieldLabel + "." + progress
    + " Select " + amount + " highlighted " + noun + " on the play area.";
}

let snapshot: BoardChoiceHudState | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function publishBoardChoiceHud(next: BoardChoiceHudState) {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function clearBoardChoiceHud(id: string) {
  if (snapshot?.id !== id) return;
  snapshot = null;
  for (const listener of listeners) listener();
}

export function useBoardChoiceHud() {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
