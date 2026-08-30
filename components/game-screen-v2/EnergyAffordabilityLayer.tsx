"use client";

import { useEffect } from "react";
import type { MatchState } from "../../lib/game";
import { cardEnergyPaymentState } from "../../lib/cardPayment";
import {
  defaultCardChoices,
  isPriorityWindow,
  resolveHudPlayers,
} from "./matchHudState";

const HAND_CARD_SELECTOR = '[data-zone-kind="hand"][data-zone-owner="player"] [data-card-id]';
const ENERGY_ZONE_SELECTOR = '[data-zone-id="player-energy"]';

function handCardFromTarget(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>(HAND_CARD_SELECTOR)
    : null;
}

export function EnergyAffordabilityLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  useEffect(() => {
    const { player } = resolveHudPlayers(match, playerId);
    if (!player) return;
    let frame = window.requestAnimationFrame(() => {
      frame = 0;
      for (const cardElement of document.querySelectorAll<HTMLElement>(HAND_CARD_SELECTOR)) {
        const card = player.hand.find((candidate) => candidate.id === cardElement.dataset.cardId);
        if (card) cardElement.dataset.cardType = card.type;
      }
    });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      for (const cardElement of document.querySelectorAll<HTMLElement>(HAND_CARD_SELECTOR)) {
        delete cardElement.dataset.cardType;
      }
    };
  }, [match, playerId]);

  useEffect(() => {
    const energyZone = document.querySelector<HTMLElement>(ENERGY_ZONE_SELECTOR);
    if (!energyZone) return;

    const clear = () => {
      delete energyZone.dataset.paymentState;
      delete energyZone.dataset.paymentCost;
      delete energyZone.dataset.paymentShortfall;
      for (const card of energyZone.querySelectorAll<HTMLElement>("[data-card-id]")) {
        delete card.dataset.autoTapNeeded;
      }
    };

    const update = (target: EventTarget | null) => {
      const handCard = handCardFromTarget(target);
      const { player } = resolveHudPlayers(match, playerId);
      const card = player?.hand.find((candidate) => candidate.id === handCard?.dataset.cardId);
      if (
        !match
        || !player
        || !card
        || card.type === "Flip"
        || card.type === "Flip Hero"
        || card.type === "Character"
        || !isPriorityWindow(match)
        || match.priority !== player.id
      ) {
        clear();
        return;
      }

      const choices = defaultCardChoices(match, player.id, card);
      const payment = cardEnergyPaymentState(match, player.id, card, choices);
      if (!payment) {
        clear();
        return;
      }

      energyZone.dataset.paymentState = payment.kind;
      energyZone.dataset.paymentCost = String(payment.cost);
      energyZone.dataset.paymentShortfall = String(payment.shortfall);
      const autoTapIds = new Set(payment.autoTapCardIds);
      for (const energyCard of energyZone.querySelectorAll<HTMLElement>("[data-card-id]")) {
        if (autoTapIds.has(energyCard.dataset.cardId ?? "")) {
          energyCard.dataset.autoTapNeeded = "true";
        } else {
          delete energyCard.dataset.autoTapNeeded;
        }
      }
    };

    const onPointerOver = (event: PointerEvent) => update(event.target);
    const onPointerOut = (event: PointerEvent) => {
      const current = handCardFromTarget(event.target);
      const next = handCardFromTarget(event.relatedTarget);
      if (current && next === current) return;
      if (!next) clear();
      else update(next);
    };
    const onFocusIn = (event: FocusEvent) => update(event.target);
    const onFocusOut = (event: FocusEvent) => {
      const next = handCardFromTarget(event.relatedTarget);
      if (next) update(next);
      else clear();
    };

    clear();
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerout", onPointerOut, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      clear();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [match, playerId]);

  return null;
}
