"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useEffect, useState } from "react";
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
  onLoad,
  ...props
}: ResponsiveCardImageProps) {
  const full = cardArtSource(card, "full");
  const [artOrientation, setArtOrientation] = useState<"portrait" | "landscape" | null>(null);
  const portraitFlip = card.type === "Flip"
    && card.hasProvidedScan
    && artOrientation === "portrait";

  useEffect(() => {
    setArtOrientation(null);
  }, [full]);

  return (
    <OriginalImage
      {...props}
      className={[styles.image, styles[presentation], portraitFlip ? styles.portraitFlip : "", className].filter(Boolean).join(" ")}
      src={full}
      sizes={presentationSizes[presentation]}
      alt={alt ?? card.displayName}
      data-art-orientation={artOrientation ?? undefined}
      width={360}
      height={504}
      loading={loading ?? (presentation === "inspector" ? "eager" : "lazy")}
      decoding="async"
      onLoad={(event) => {
        setArtOrientation(
          event.currentTarget.naturalHeight > event.currentTarget.naturalWidth
            ? "portrait"
            : "landscape",
        );
        onLoad?.(event);
      }}
      onError={(event) => {
        if (!event.currentTarget.src.endsWith(CARD_ART_PLACEHOLDER)) {
          event.currentTarget.src = CARD_ART_PLACEHOLDER;
        }
        onError?.(event);
      }}
    />
  );
}
