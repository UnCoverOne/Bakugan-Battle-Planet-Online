"use client";

import { useEffect, useState } from "react";
import type { CardType, GameCard, MatchState } from "../../lib/game";
import {
  cardPreviewKind,
  cardPreviewSideForZone,
  cardPreviewZoneAllowed,
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
  cardType?: CardType;
  details?: CardDetails;
  signature: string;
};

type PreviewTarget = {
  image: HTMLImageElement;
  cardId: string;
  side: CardPreviewSide;
  fallbackLabel: string;
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

function imageCanIdentifyCard(image: HTMLImageElement, cardId: string) {
  return Boolean(cardPreviewKind(imageSource(image)) || cardId || image.getAttribute("src"));
}

function zoneMetadata(target: Element) {
  const explicitZone = target.closest<HTMLElement>("[data-zone-kind]");
  if (explicitZone) {
    return {
      zoneKind: explicitZone.dataset.zoneKind,
      zoneOwner: explicitZone.dataset.zoneOwner,
      zone: explicitZone,
    };
  }

  const batch = target.closest<HTMLElement>('[aria-label$="effects in the batch"]');
  if (batch) {
    return {
      zoneKind: "batch",
      zoneOwner: target.closest<HTMLElement>("figure")?.dataset.owner,
      zone: batch,
    };
  }

  return { zoneKind: undefined, zoneOwner: undefined, zone: null };
}

function previewTargetFromPointer(target: EventTarget | null): PreviewTarget | null {
  if (!(target instanceof Element)) return null;
  const metadata = zoneMetadata(target);
  if (!cardPreviewZoneAllowed(metadata.zoneKind)) return null;
  if (
    metadata.zoneKind === "hand"
    && metadata.zoneOwner === "opponent"
    && metadata.zone?.dataset.hidden === "true"
  ) {
    return null;
  }
  const side = cardPreviewSideForZone(metadata.zoneKind, metadata.zoneOwner);

  const handCard = target.closest("li");
  if (handCard?.closest('[data-zone-kind="hand"]')) {
    const handImage = handCard.querySelector<HTMLImageElement>("img");
    const cardId = nearestCardId(handCard);
    if (handImage && imageCanIdentifyCard(handImage, cardId)) {
      return {
        image: handImage,
        cardId,
        side,
        fallbackLabel: handCard.getAttribute("title") ?? "Card",
      };
    }
  }

  const characterZone = target.closest<HTMLElement>(CHARACTER_ZONE_SELECTOR);
  if (characterZone) {
    const image = characterZone.querySelector<HTMLImageElement>("img");
    const cardId = characterZone.dataset.cardId ?? "";
    return image && imageCanIdentifyCard(image, cardId)
      ? {
        image,
        cardId,
        side,
        fallbackLabel: characterZone.getAttribute("aria-label") ?? "Character Card",
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
        cardId,
        side,
        fallbackLabel: image.alt || "Discarded card",
      }
      : null;
  }

  const directImage = target instanceof HTMLImageElement
    ? target
    : target.closest<HTMLImageElement>("img");
  if (!directImage) return null;
  const cardId = nearestCardId(directImage);
  const batchName = directImage.closest("figure")
    ?.querySelector<HTMLElement>("figcaption strong")
    ?.textContent
    ?.trim();
  return imageCanIdentifyCard(directImage, cardId)
    ? {
      image: directImage,
      cardId,
      side,
      fallbackLabel: directImage.alt.trim() || batchName || "Card",
    }
    : null;
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

function normalizedPath(source: string) {
  try {
    return new URL(source, "https://bakugan-preview.invalid").pathname;
  } catch {
    return source.split(/[?#]/, 1)[0] ?? "";
  }
}

function resolveCard(
  match: MatchState | null,
  cardId: string,
  label: string,
  source: string,
): GameCard | null {
  const cards = cardsInMatch(match);
  if (cardId) {
    const byId = cards.find((card) => card.id === cardId);
    if (byId) return byId;
  }
  const sourcePath = normalizedPath(source);
  if (sourcePath) {
    const byArt = cards.find((card) => normalizedPath(card.art) === sourcePath);
    if (byArt) return byArt;
  }
  const normalized = label.trim().toLowerCase();
  if (!normalized) return null;
  return cards.find((card) => (
    card.displayName.toLowerCase() === normalized
    || card.name.toLowerCase() === normalized
    || normalized.endsWith(`: ${card.displayName.toLowerCase()}`)
    || normalized.endsWith(`: ${card.name.toLowerCase()}`)
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

  useEffect(() => {
    const clearPreview = () => setPreview((previous) => previous ? null : previous);

    const updateFromTarget = (eventTarget: EventTarget | null) => {
      const target = previewTargetFromPointer(eventTarget);
      if (!target) {
        clearPreview();
        return;
      }

      const src = imageSource(target.image);
      const kind = cardPreviewKind(src);
      const label = target.image.alt.trim() || target.fallbackLabel || (kind === "back" ? "Hidden card" : "Card");
      const card = resolveCard(match ?? null, target.cardId, label, src);
      const failedImage = !src
        || /card-missing\.svg(?:$|[?#])/i.test(src)
        || (target.image.complete && target.image.naturalWidth === 0);
      const loadedImage = target.image.complete && target.image.naturalWidth > 0;

      if (card && (failedImage || (!kind && !loadedImage))) {
        const details = detailsForCard(card);
        const next: CardPreview = {
          mode: "placeholder",
          src: "",
          label: details.name,
          side: target.side,
          cardType: card.type,
          details,
          signature: `placeholder:${card.id}:${target.side}:${details.effect}`,
        };
        setPreview((previous) => samePreview(previous, next) ? previous : next);
        return;
      }

      if (!kind && !loadedImage) {
        clearPreview();
        return;
      }

      const next: CardPreview = {
        mode: "image",
        src,
        label: card?.displayName || card?.name || label,
        side: target.side,
        cardType: card?.type,
        signature: `image:${src}:${label}:${target.side}:${card?.type ?? "unknown"}`,
      };
      setPreview((previous) => samePreview(previous, next) ? previous : next);
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
      className={`${styles.preview} ${preview.side === "left" ? styles.previewLeft : styles.previewRight}`}
      aria-label={`${preview.label} enlarged preview`}
      data-card-preview="true"
      data-card-preview-side={preview.side}
      data-card-preview-mode={preview.mode}
      data-card-preview-type={preview.cardType}
      key={`${preview.side}:${preview.signature}`}
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
