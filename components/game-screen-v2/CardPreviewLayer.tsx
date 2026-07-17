"use client";

import { useEffect, useState } from "react";
import {
  cardPreviewKind,
  cardPreviewSide,
  type CardPreviewOrigin,
  type CardPreviewSide,
} from "./cardPreviewState";
import styles from "./CardPreviewLayer.module.css";

type CardPreview = {
  src: string;
  label: string;
  side: CardPreviewSide;
};

type PreviewTarget = {
  image: HTMLImageElement;
  origin: CardPreviewOrigin;
};

const CHARACTER_ZONE_SELECTOR = '[data-zone-kind="character-card"]';
const EXCLUDED_ZONE_SELECTOR = [
  '[data-zone-kind="deck"]',
  '[data-zone-kind="discard-pile"]',
].join(",");

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "";
}

function isPreviewableCardImage(image: HTMLImageElement | null): image is HTMLImageElement {
  return Boolean(image && cardPreviewKind(imageSource(image)));
}

function previewTargetFromPointer(target: EventTarget | null): PreviewTarget | null {
  if (!(target instanceof Element)) return null;

  // The deck and discard pile keep their existing hover glow but never open an
  // enlarged card preview, even when their image is the pointer target.
  if (target.closest(EXCLUDED_ZONE_SELECTOR)) return null;

  // Hand cards are individually wrapped, including hidden opponent cards. Read
  // from the nearest hand item before considering generic card images so every
  // hand preview can use the same fixed left-side location.
  const handCard = target.closest("li");
  if (handCard?.closest('[data-zone-kind="hand"]')) {
    const handImage = handCard.querySelector<HTMLImageElement>("img");
    if (isPreviewableCardImage(handImage)) {
      return { image: handImage, origin: "hand" };
    }
  }

  const directImage = target instanceof HTMLImageElement
    ? target
    : target.closest<HTMLImageElement>("img");
  if (isPreviewableCardImage(directImage)) {
    return { image: directImage, origin: "board" };
  }

  // Character artwork deliberately ignores pointer events so the entire card
  // receives its existing hover treatment. Read the card image from the zone.
  const characterZone = target.closest<HTMLElement>(CHARACTER_ZONE_SELECTOR);
  if (!characterZone) return null;
  const image = Array.from(characterZone.querySelectorAll<HTMLImageElement>("img"))
    .find(isPreviewableCardImage);
  return image ? { image, origin: "board" } : null;
}

function samePreview(previous: CardPreview | null, next: CardPreview | null) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return previous.src === next.src
    && previous.label === next.label
    && previous.side === next.side;
}

export function CardPreviewLayer() {
  const [preview, setPreview] = useState<CardPreview | null>(null);

  useEffect(() => {
    const clearPreview = () => setPreview((previous) => previous ? null : previous);

    const updatePreview = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        clearPreview();
        return;
      }

      const target = previewTargetFromPointer(event.target);
      if (!target) {
        clearPreview();
        return;
      }

      const src = imageSource(target.image);
      const kind = cardPreviewKind(src);
      if (!kind) {
        clearPreview();
        return;
      }

      const rect = target.image.getBoundingClientRect();
      const next: CardPreview = {
        src,
        label: target.image.alt.trim() || (kind === "back" ? "Hidden card" : "Card"),
        side: cardPreviewSide(
          rect.left + rect.width / 2,
          window.innerWidth,
          target.origin,
        ),
      };
      setPreview((previous) => samePreview(previous, next) ? previous : next);
    };

    const clearWhenLeavingWindow = (event: PointerEvent) => {
      if (event.relatedTarget == null) clearPreview();
    };

    document.addEventListener("pointermove", updatePreview, { passive: true });
    document.addEventListener("pointerout", clearWhenLeavingWindow, { passive: true });
    window.addEventListener("blur", clearPreview);
    return () => {
      document.removeEventListener("pointermove", updatePreview);
      document.removeEventListener("pointerout", clearWhenLeavingWindow);
      window.removeEventListener("blur", clearPreview);
    };
  }, []);

  if (!preview) return null;

  return (
    <aside
      className={`${styles.preview} ${
        preview.side === "left" ? styles.previewLeft : styles.previewRight
      }`}
      aria-label={`${preview.label} enlarged preview`}
      data-card-preview-side={preview.side}
    >
      <img
        className={styles.previewImage}
        src={preview.src}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </aside>
  );
}
