"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { MatchState } from "../../lib/game";
import { energizeTransitions } from "./energizeAnimationState";

const ENERGIZE_ANIMATION_MS = 1120;
const DECK_ENERGIZE_REVEAL_MS = 5000;
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
  const activeAnimationElements = useRef<HTMLElement[]>([]);
  const animationTimer = useRef(0);
  const revealedElements = useRef(new Set<HTMLElement>());
  const revealTimers = useRef(new Map<HTMLElement, number>());

  const clearAnimationPresentation = () => {
    window.clearTimeout(animationTimer.current);
    animationTimer.current = 0;
    for (const element of activeAnimationElements.current) delete element.dataset.energizing;
    activeAnimationElements.current = [];
  };

  const clearDeckReveals = () => {
    for (const timer of revealTimers.current.values()) window.clearTimeout(timer);
    revealTimers.current.clear();
    for (const element of revealedElements.current) delete element.dataset.deckReveal;
    revealedElements.current.clear();
  };

  const revealDeckEnergizedCard = (element: HTMLElement) => {
    const previousTimer = revealTimers.current.get(element);
    if (previousTimer) window.clearTimeout(previousTimer);
    element.dataset.deckReveal = "true";
    revealedElements.current.add(element);
    const timer = window.setTimeout(() => {
      delete element.dataset.deckReveal;
      revealedElements.current.delete(element);
      revealTimers.current.delete(element);
    }, DECK_ENERGIZE_REVEAL_MS);
    revealTimers.current.set(element, timer);
  };

  useEffect(() => () => {
    clearAnimationPresentation();
    clearDeckReveals();
  }, []);

  useLayoutEffect(() => {
    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!match || !previous || previous.id !== match.id) {
      clearAnimationPresentation();
      clearDeckReveals();
      return;
    }

    const transitions = energizeTransitions(previous, match);
    if (!transitions.length) return;

    clearAnimationPresentation();
    const localPlayerId = playerId ?? match.players[0]?.id;
    const activated: HTMLElement[] = [];

    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const zone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-energy"]`);
      if (!zone) continue;
      zone.dataset.energizing = "true";
      activated.push(zone);
      const deckCardIds = transition.playerId === localPlayerId
        ? new Set(transition.deckCards.map((card) => card.id))
        : new Set<string>();
      for (const card of transition.cards) {
        const element = energyCardElement(zone, card.id);
        if (!element) continue;
        element.dataset.energizing = "true";
        activated.push(element);
        if (deckCardIds.has(card.id)) revealDeckEnergizedCard(element);
      }
    }

    if (!activated.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    activeAnimationElements.current = activated;
    animationTimer.current = window.setTimeout(
      clearAnimationPresentation,
      ENERGIZE_ANIMATION_MS,
    );
  }, [match?.id, match?.version, playerId]);

  return null;
}
