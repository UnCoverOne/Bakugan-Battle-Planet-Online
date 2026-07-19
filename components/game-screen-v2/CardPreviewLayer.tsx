"use client";

import { useEffect, useRef, useState } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import {
  cardPreviewKind,
  cardPreviewSide,
  cardPreviewSideForZoneOwner,
  cardPreviewZoneAllowed,
  type CardPreviewOrigin,
  type CardPreviewSide,
} from "./cardPreviewState";
import styles from "./CardPreviewLayer.module.css";

type CardDetails = {
  name: string;
  type: string;
  faction: string;
  cost: string;
  effect: string;
  mechanics: string;
  stats: string;
  cores: string;
};

type CardPreview = {
  mode: "image" | "placeholder";
  src: string;
  label: string;
  side: CardPreviewSide;
  details?: CardDetails;
  signature: string;
};

type PreviewTarget = {
  image: HTMLImageElement;
  origin: CardPreviewOrigin;
  cardId: string;
  fixedSide: CardPreviewSide | null;
};

const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"]';
const DISCARD_ZONE_SELECTOR = '[data-zone-kind="discard-pile"]';
const CARD_PREVIEW_CLEAR_EVENT = "bbp-card-preview-clear";

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "";
}

function nearestCardId(target: Element): string {
  return target.closest<HTMLElement>("[data-card-id]")?.dataset.cardId ?? "";
}

function fixedSideForElement(target: Element) {
  const owner = target.closest<HTMLElement>("[data-zone-owner]")?.dataset.zoneOwner;
  return cardPreviewSideForZoneOwner(owner);
}

function imageCanIdentifyCard(image: HTMLImageElement, cardId: string) {
  return Boolean(cardPreviewKind(imageSource(image)) || cardId);
}

function previewTargetFromPointer(target: EventTarget | null): PreviewTarget | null {
  if (!(target instanceof Element)) return null;

  const zoneKind = target.closest<HTMLElement>("[data-zone-kind]")
    ?.getAttribute("data-zone-kind");
  if (!cardPreviewZoneAllowed(zoneKind)) return null;

  const handCard = target.closest("li");
  if (handCard?.closest('[data-zone-kind="hand"]')) {
    const handImage = handCard.querySelector<HTMLImageElement>("img");
    const cardId = nearestCardId(handCard);
    if (handImage && imageCanIdentifyCard(handImage, cardId)) {
      return { image: handImage, origin: "hand", cardId, fixedSide: null };
    }
  }

  // Resolve complete zones before individual images. Character artwork moves on
  // hover, so deriving its side from the animated image rectangle can briefly
  // put the preview on the wrong edge of the viewport.
  const characterZone = target.closest<HTMLElement>(CHARACTER_ZONE_SELECTOR);
  if (characterZone) {
    const image = characterZone.querySelector<HTMLImageElement>("img");
    const cardId = characterZone.dataset.cardId ?? "";
    return image && imageCanIdentifyCard(image, cardId)
      ? {
        image,
        origin: "board",
        cardId,
        fixedSide: fixedSideForElement(characterZone),
      }
      : null;
  }

  const discardZone = target.closest<HTMLElement>(DISCARD_ZONE_SELECTOR);
  if (discardZone) {
    const image = discardZone.querySelector<HTMLImageElement>("img");
    const cardId = discardZone.dataset.topCardId ?? "";
    return image && imageCanIdentifyCard(image, cardId)
      ? {
        image,
        origin: "board",
        cardId,
        fixedSide: fixedSideForElement(discardZone),
      }
      : null;
  }

  const directImage = target instanceof HTMLImageElement
    ? target
    : target.closest<HTMLImageElement>("img");
  if (directImage) {
    const cardId = nearestCardId(directImage);
    if (imageCanIdentifyCard(directImage, cardId)) {
      return {
        image: directImage,
        origin: "board",
        cardId,
        fixedSide: fixedSideForElement(directImage),
      };
    }
  }

  return null;
}

function cardsInMatch(match: MatchState | null): GameCard[] {
  if (!match) return [];
  const cards = match.players.flatMap((player) => [
    ...player.hand,
    ...player.deckCards,
    ...player.discard,
    ...player.energyZone,
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.character, ...bakugan.evoStack]),
  ]);
  cards.push(...match.batch.map((pending) => pending.card));
  if (match.revealedFlip) cards.push(match.revealedFlip);
  return cards;
}

function resolveCard(
  match: MatchState | null,
  cardId: string,
  label: string,
): GameCard | null {
  const cards = cardsInMatch(match);
  if (cardId) {
    const byId = cards.find((card) => card.id === cardId);
    if (byId) return byId;
  }
  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;
  return cards.find((card) => (
    card.displayName.toLowerCase() === normalized
    || card.name.toLowerCase() === normalized
  )) ?? null;
}

function detailsForCard(card: GameCard): CardDetails {
  const stats = [
    card.bPower != null ? `${card.bPower} B-Power` : "",
    card.damage != null ? `${card.damage} Damage` : "",
  ].filter(Boolean).join(" • ");
  return {
    name: card.displayName || card.name || "Unknown Card",
    type: card.type || "Card",
    faction: card.factions?.length ? card.factions.join(" / ") : card.faction,
    cost: card.type === "Character" ? "" : `Cost ${card.cost}`,
    effect: card.effect?.trim() || "No effect text is available for this card.",
    mechanics: card.mechanics?.filter(Boolean).join(" • ") ?? "",
    stats,
    cores: card.coreTypes?.length ? card.coreTypes.join(" • ") : "",
  };
}

function samePreview(previous: CardPreview | null, next: CardPreview | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.signature === next.signature;
}

export function CardPreviewLayer({ match }: { match?: MatchState | null }) {
  const [preview, setPreview] = useState<CardPreview | null>(null);
  const activeTarget = useRef("");
  const previewFrame = useRef<number | null>(null);

  useEffect(() => {
    const cancelPendingPreview = () => {
      if (previewFrame.current == null) return;
      window.cancelAnimationFrame(previewFrame.current);
      previewFrame.current = null;
    };

    const clearPreview = () => {
      activeTarget.current = "";
      cancelPendingPreview();
      setPreview((previous) => previous ? null : previous);
    };

    const presentPreview = (targetKey: string, next: CardPreview) => {
      if (targetKey === activeTarget.current) {
        setPreview((previous) => samePreview(previous, next) ? previous : next);
        return;
      }

      // Remove the old card before the next target is painted. Without this
      // hand-to-board and animated-zone transitions can expose the old side for
      // one frame before React applies the new target's fixed placement.
      activeTarget.current = targetKey;
      cancelPendingPreview();
      setPreview(null);
      previewFrame.current = window.requestAnimationFrame(() => {
        previewFrame.current = null;
        if (activeTarget.current !== targetKey) return;
        setPreview((previous) => samePreview(previous, next) ? previous : next);
      });
    };

    const updateFromTarget = (eventTarget: EventTarget | null) => {
      const target = previewTargetFromPointer(eventTarget);
      if (!target) {
        clearPreview();
        return;
      }

      const src = imageSource(target.image);
      const kind = cardPreviewKind(src);
      const label = target.image.alt.trim() || (kind === "back" ? "Hidden card" : "Card");
      const card = resolveCard(match ?? null, target.cardId, label);
      const failedImage = !src
        || /card-missing\.svg(?:$|[?#])/i.test(src)
        || (target.image.complete && target.image.naturalWidth === 0);
      const loadedImage = target.image.complete && target.image.naturalWidth > 0;
      const rect = target.image.getBoundingClientRect();
      const side = target.fixedSide ?? cardPreviewSide(
        rect.left + rect.width / 2,
        window.innerWidth,
        target.origin,
      );
      const targetKey = [
        target.origin,
        target.cardId || src || label,
        side,
      ].join(":");

      if (card && (failedImage || (!kind && !loadedImage))) {
        const details = detailsForCard(card);
        presentPreview(targetKey, {
          mode: "placeholder",
          src: "",
          label: details.name,
          side,
          details,
          signature: `placeholder:${card.id}:${side}:${details.effect}`,
        });
        return;
      }

      if (!kind && !loadedImage) {
        clearPreview();
        return;
      }

      presentPreview(targetKey, {
        mode: "image",
        src,
        label,
        side,
        signature: `image:${src}:${label}:${side}`,
      });
    };

    const updatePreview = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        clearPreview();
        return;
      }
      updateFromTarget(event.target);
    };

    const refreshImageState = (event: Event) => {
      if (event.target instanceof HTMLImageElement) updateFromTarget(event.target);
    };

    const clearWhenLeavingWindow = (event: PointerEvent) => {
      if (event.relatedTarget == null) clearPreview();
    };

    document.addEventListener("pointermove", updatePreview, { passive: true });
    document.addEventListener("pointerover", updatePreview, { passive: true });
    document.addEventListener("error", refreshImageState, true);
    document.addEventListener("load", refreshImageState, true);
    document.addEventListener("pointerout", clearWhenLeavingWindow, { passive: true });
    window.addEventListener("blur", clearPreview);
    window.addEventListener(CARD_PREVIEW_CLEAR_EVENT, clearPreview);
    return () => {
      cancelPendingPreview();
      document.removeEventListener("pointermove", updatePreview);
      document.removeEventListener("pointerover", updatePreview);
      document.removeEventListener("error", refreshImageState, true);
      document.removeEventListener("load", refreshImageState, true);
      document.removeEventListener("pointerout", clearWhenLeavingWindow);
      window.removeEventListener("blur", clearPreview);
      window.removeEventListener(CARD_PREVIEW_CLEAR_EVENT, clearPreview);
    };
  }, [match]);

  if (!preview) return null;

  return (
    <aside
      className={`${styles.preview} ${
        preview.side === "left" ? styles.previewLeft : styles.previewRight
      }`}
      aria-label={`${preview.label} enlarged preview`}
      data-card-preview-side={preview.side}
      data-card-preview-mode={preview.mode}
    >
      {preview.mode === "image" ? (
        <img
          className={styles.previewImage}
          src={preview.src}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      ) : preview.details ? (
        <article className={styles.placeholder}>
          <span className={styles.placeholderLabel}>ARTWORK UNAVAILABLE</span>
          <header>
            <strong>{preview.details.name}</strong>
            <span>{[preview.details.faction, preview.details.type, preview.details.cost].filter(Boolean).join(" • ")}</span>
          </header>
          {preview.details.stats ? <p className={styles.placeholderStats}>{preview.details.stats}</p> : null}
          {preview.details.cores ? <p className={styles.placeholderCores}>{preview.details.cores}</p> : null}
          <p className={styles.placeholderEffect}>{preview.details.effect}</p>
          {preview.details.mechanics ? <p className={styles.placeholderMechanics}>{preview.details.mechanics}</p> : null}
        </article>
      ) : null}
    </aside>
  );
}
