"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { MatchState } from "../../lib/game";
import { energizeTransitions } from "./energizeAnimationState";
import { isLiveMatchTransition } from "./presentationContinuity";

const ENERGIZE_ANIMATION_MS = 1120;
type ZoneOwner = "player" | "opponent";

function energyCardElement(zone: HTMLElement, cardId: string) {
  return [...zone.querySelectorAll<HTMLElement>("[data-card-id]")]
    .find((element) => element.dataset.cardId === cardId) ?? null;
}

export function EnergyArrivalLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const previousMatch = useRef<MatchState | null>(null);
  const activeElements = useRef<HTMLElement[]>([]);
  const clearTimer = useRef(0);

  const clearPresentation = () => {
    window.clearTimeout(clearTimer.current);
    clearTimer.current = 0;
    for (const element of activeElements.current) delete element.dataset.energizing;
    activeElements.current = [];
  };

  useEffect(() => clearPresentation, []);

  useLayoutEffect(() => {
    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!isLiveMatchTransition(previous, match, document.visibilityState)) {
      clearPresentation();
      return;
    }

    const transitions = energizeTransitions(previous, match);
    if (!transitions.length) return;

    clearPresentation();
    const localPlayerId = playerId ?? match.players[0]?.id;
    const activated: HTMLElement[] = [];

    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const zone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-energy"]`);
      if (!zone) continue;
      zone.dataset.energizing = "true";
      activated.push(zone);
      for (const card of transition.cards) {
        const element = energyCardElement(zone, card.id);
        if (!element) continue;
        element.dataset.energizing = "true";
        activated.push(element);
      }
    }

    if (!activated.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    activeElements.current = activated;
    clearTimer.current = window.setTimeout(clearPresentation, ENERGIZE_ANIMATION_MS);
  }, [match, playerId]);

  return null;
}
