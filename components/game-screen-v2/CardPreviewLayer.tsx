"use client";

import { useEffect, useState } from "react";
import {
  cardPreviewKind,
  cardPreviewSide,
  type CardPreviewSide,
} from "./cardPreviewState";
import styles from "./CardPreviewLayer.module.css";

type CardPreview = {
  src: string;
  label: string;
  side: CardPreviewSide;
};

const DIRECT_ZONE_SELECTOR = [
  '[data-zone-kind="character-card"]',
  '[data-zone-kind="deck"]',
  '[data-zone-kind="discard-pile"]',
].join(",");

function imageSource(image: HTMLImageElement): string {
  return image.currentSrc || image.getAttribute("src") || "";
}

function isPreviewableCardImage(image: HTMLImageElement | null): image is HTMLImageElement {
  return Boolean(image && cardPreviewKind(imageSource(image)));
}

function previewImageFromTarget(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null;

  const directImage = target instanceof HTMLImageElement
    ? target
    : target.closest<HTMLImageElement>("img");
  if (isPreviewableCardImage(directImage)) return directImage;

  // Hand cards are individually wrapped, including hidden opponent cards. Use
  // the nearest list item so moving over a card's surface never selects a
  // different overlapping card from the same hand.
  const handCard = target.closest("li");
  if (handCard?.closest('[data-zone-kind="hand"]')) {
    const handImage = handCard.querySelector<HTMLImageElement>("img");
    if (isPreviewableCardImage(handImage)) return handImage;
  }

  // Character, deck, and discard artwork deliberately ignores pointer events
  // so the entire physical piece receives its existing hover treatment. Read
  // the card image from that hovered piece instead of requiring the image to
  // be the pointer target.
  const zone = target.closest<HTMLElement>(DIRECT_ZONE_SELECTOR);
  if (!zone) return null;
  const images = Array.from(zone.querySelectorAll<HTMLImageElement>("img"))
    .filter(isPreviewableCardImage);
  return images.at(-1) ?? null;
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

      const image = previewImageFromTarget(event.target);
      if (!image) {
        clearPreview();
        return;
      }

      const src = imageSource(image);
      const kind = cardPreviewKind(src);
      if (!kind) {
        clearPreview();
        return;
      }

      const rect = image.getBoundingClientRect();
      const next: CardPreview = {
        src,
        label: image.alt.trim() || (kind === "back" ? "Hidden card" : "Card"),
        side: cardPreviewSide(rect.left + rect.width / 2, window.innerWidth),
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
