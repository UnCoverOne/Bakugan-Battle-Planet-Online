"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import type { ComponentProps } from "react";
import { fingerprintedAsset } from "../../lib/assets";
import {
  CARD_ART_PLACEHOLDER,
  isFlipCardType,
  type CardArtPresentation,
} from "../../lib/content/card-art";
import styles from "./CardArt.module.css";

type OriginalImageProps = ComponentProps<typeof OriginalImage>;

export type CardArtProps = Omit<OriginalImageProps, "src"> & {
  src: string;
  cardType?: string | null;
  presentation?: CardArtPresentation;
};

/** The single rendering contract for card faces in every application surface. */
export function CardArt({
  src,
  cardType,
  presentation = "physical",
  className,
  onError,
  ...props
}: CardArtProps) {
  const isPlaceholder = src.includes(CARD_ART_PLACEHOLDER);
  const isFlip = isFlipCardType(cardType) && !isPlaceholder;
  return (
    <OriginalImage
      {...props}
      className={[styles.image, className].filter(Boolean).join(" ")}
      src={fingerprintedAsset(src)}
      data-card-art-kind={isFlip ? "flip" : "standard"}
      data-card-art-presentation={presentation}
      onError={(event) => {
        if (!event.currentTarget.src.includes(CARD_ART_PLACEHOLDER)) {
          event.currentTarget.src = fingerprintedAsset(CARD_ART_PLACEHOLDER);
        }
        onError?.(event);
      }}
    />
  );
}
