"use client";

import type { ImgHTMLAttributes } from "react";
import { CARD_ART_PLACEHOLDER, cardArtSource } from "../../lib/content/card-art";
import type { GameCard } from "../../lib/game";
import styles from "./ResponsiveCardImage.module.css";

type ResponsiveCardImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height"> & {
  card: GameCard;
  presentation?: "tile" | "inspector" | "thumbnail";
};

const presentationSizes = {
  tile: "(max-width: 700px) 44vw, (max-width: 1200px) 28vw, 184px",
  inspector: "(max-width: 900px) min(82vw, 360px), 340px",
  thumbnail: "80px",
};

export function ResponsiveCardImage({
  card,
  presentation = "tile",
  className,
  alt,
  loading,
  onError,
  ...props
}: ResponsiveCardImageProps) {
  const full = cardArtSource(card, "full");
  const thumbnail = cardArtSource(card, "thumbnail");
  const srcSet = thumbnail !== full ? `${thumbnail} 160w, ${full} 360w` : undefined;
  return (
    <img
      {...props}
      className={[styles.image, styles[presentation], className].filter(Boolean).join(" ")}
      src={full}
      srcSet={srcSet}
      sizes={presentationSizes[presentation]}
      alt={alt ?? card.displayName}
      width={360}
      height={504}
      loading={loading ?? (presentation === "inspector" ? "eager" : "lazy")}
      decoding="async"
      onError={(event) => {
        event.currentTarget.srcset = "";
        if (!event.currentTarget.src.endsWith(CARD_ART_PLACEHOLDER)) {
          event.currentTarget.src = CARD_ART_PLACEHOLDER;
        }
        onError?.(event);
      }}
    />
  );
}
