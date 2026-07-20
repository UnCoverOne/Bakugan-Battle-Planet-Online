"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Bakugan, MatchState } from "../../lib/game";
import { MATCH_UPDATE_EVENT } from "./MatchStateCoordinator";
import styles from "./GameplayCardPresentationLayer.module.css";

const MATCH_KEY = "bbp-active-match-v1";
const PLAYER_KEY = "bbp-player-id";
const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"]';
const HAND_CARD_SELECTOR = '[data-zone-kind="hand"] li[data-card-id]';

type StoredPresentationState = {
  match: MatchState | null;
  playerId?: string;
};

type EvoPortalTarget = {
  key: string;
  element: HTMLElement;
  bakugan: Bakugan;
};

function parseStoredValue<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function readStoredState(): StoredPresentationState {
  return {
    match: parseStoredValue<MatchState | null>(localStorage.getItem(MATCH_KEY), null),
    playerId: parseStoredValue<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
  };
}

function sameTargets(previous: readonly EvoPortalTarget[], next: readonly EvoPortalTarget[]) {
  return previous.length === next.length && previous.every((target, index) => (
    target.key === next[index]?.key
    && target.element === next[index]?.element
    && target.bakugan.evoStack.map((card) => card.id).join("|")
      === next[index]?.bakugan.evoStack.map((card) => card.id).join("|")
  ));
}

function playerPair(match: MatchState, playerId?: string) {
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0];
  const opponent = match.players.find((candidate) => candidate.id !== player?.id);
  return { player, opponent };
}

export function GameplayCardPresentationLayer() {
  const [stored, setStored] = useState<StoredPresentationState>({ match: null, playerId: undefined });
  const [targets, setTargets] = useState<readonly EvoPortalTarget[]>([]);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  useEffect(() => {
    const update = () => setStored(readStoredState());
    update();
    const interval = window.setInterval(update, 500);
    window.addEventListener("storage", update);
    window.addEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener(MATCH_UPDATE_EVENT, update as EventListener);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const synchronize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const { match, playerId } = storedRef.current;
        if (!match) {
          setTargets([]);
          return;
        }
        const { player, opponent } = playerPair(match, playerId);
        const nextTargets: EvoPortalTarget[] = [];
        const zones = document.querySelectorAll<HTMLElement>(CHARACTER_ZONE_SELECTOR);
        for (const zone of zones) {
          const owner = zone.dataset.zoneOwner;
          const slotIndex = Math.max(0, Number(zone.dataset.slot ?? 1) - 1);
          const ownerPlayer = owner === "player" ? player : opponent;
          const bakugan = ownerPlayer?.bakugan[slotIndex];
          if (!bakugan) continue;
          const topCard = bakugan.evoStack.at(-1) ?? bakugan.character;
          zone.dataset.cardId = topCard.id;
          zone.dataset.cardType = topCard.type;
          zone.dataset.evoCount = String(bakugan.evoStack.length);
          zone.dataset.evoTopId = bakugan.evoStack.at(-1)?.id ?? "";
          if (bakugan.evoStack.length) {
            nextTargets.push({
              key: `${owner}-${slotIndex + 1}-${bakugan.id}`,
              element: zone,
              bakugan,
            });
          }
        }

        const cards = new Map(match.players.flatMap((candidate) => (
          candidate.hand.map((card) => [card.id, card] as const)
        )));
        for (const element of document.querySelectorAll<HTMLElement>(HAND_CARD_SELECTOR)) {
          const card = cards.get(element.dataset.cardId ?? "");
          if (card) element.dataset.cardType = card.type;
          else delete element.dataset.cardType;
        }

        setTargets((previous) => sameTargets(previous, nextTargets) ? previous : nextTargets);
      });
    };

    synchronize();
    const observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [stored.match?.id, stored.match?.version, stored.playerId]);

  return (
    <>
      {targets.map(({ key, element, bakugan }) => createPortal(
        <div
          className={styles.evoStack}
          data-evo-stack="true"
          data-evo-count={bakugan.evoStack.length}
          aria-label={`${bakugan.name} Evo stack, ${bakugan.evoStack.length} card${bakugan.evoStack.length === 1 ? "" : "s"}`}
        >
          {bakugan.evoStack.map((card, index) => {
            const depth = bakugan.evoStack.length - index - 1;
            const style = {
              "--evo-order": index,
              "--evo-offset-x": `${Math.min(4, depth) * -1.2}%`,
              "--evo-offset-y": `${Math.min(4, depth) * -0.8}%`,
            } as CSSProperties;
            return (
              <img
                className={styles.evoCard}
                src={card.art}
                alt={card.displayName || card.name}
                draggable={false}
                data-card-id={card.id}
                style={style}
                key={card.id}
              />
            );
          })}
          <span className={styles.evoBadge} aria-hidden="true">EVO {bakugan.evoStack.length}</span>
        </div>,
        element,
        key,
      ))}
    </>
  );
}
