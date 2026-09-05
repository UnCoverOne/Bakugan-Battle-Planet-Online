"use client";

import { useEffect } from "react";
import { fingerprintedAsset } from "../../lib/assets";
import type { CardArtPresentation } from "../../lib/content/card-art";
import { CardArt } from "../cards/CardArt";

export function ResponsiveCardImage({
  src,
  alt,
  className,
  eager = false,
  draggable = false,
  style,
  ariaHidden,
  dataCardId,
  cardType,
  presentation = "physical",
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  draggable?: boolean;
  style?: React.CSSProperties;
  ariaHidden?: boolean;
  dataCardId?: string;
  cardType?: string | null;
  presentation?: CardArtPresentation;
}) {
  return <CardArt
    className={className}
    src={src}
    cardType={cardType}
    presentation={presentation}
    sizes="(max-width: 700px) 80px, (max-width: 1100px) 128px, 192px"
    width="384"
    height="536"
    alt={alt}
    aria-hidden={ariaHidden}
    data-card-id={dataCardId}
    loading={eager ? "eager" : "lazy"}
    fetchPriority={eager ? "high" : "auto"}
    decoding="async"
    draggable={draggable}
    style={style}
  />;
}

export function LikelyCardImagePreloader({ sources }: { sources: readonly string[] }) {
  const firstSource = sources[0] ?? "";
  const secondSource = sources[1] ?? "";
  useEffect(() => {
    for (const source of [firstSource, secondSource].filter(Boolean)) {
      const image = new Image();
      image.src = fingerprintedAsset(source);
    }
  }, [firstSource, secondSource]);
  return null;
}
