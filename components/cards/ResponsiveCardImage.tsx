"use client";

import type { ImgHTMLAttributes } from "react";
import { cardArtSource } from "../../lib/content/card-art";
import type { GameCard } from "../../lib/game";
import { CardArt } from "./CardArt";
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
  return (
    <CardArt
      {...props}
      className={[styles.image, styles[presentation], className].filter(Boolean).join(" ")}
      src={full}
      cardType={card.type}
      presentation="readable"
      sizes={presentationSizes[presentation]}
      alt={alt ?? card.displayName}
      width={360}
      height={504}
      loading={loading ?? (presentation === "inspector" ? "eager" : "lazy")}
      decoding="async"
      onError={onError}
    />
  );
}
