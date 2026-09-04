"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import { useEffect, useState } from "react";
import { fingerprintedAsset } from "../../lib/assets";

export function ResponsiveCardImage({
  src,
  alt,
  className,
  eager = false,
  draggable = false,
  style,
  ariaHidden,
  dataCardId,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  draggable?: boolean;
  style?: React.CSSProperties;
  ariaHidden?: boolean;
  dataCardId?: string;
}) {
  const [artOrientation, setArtOrientation] = useState<"portrait" | "landscape" | null>(null);

  useEffect(() => {
    setArtOrientation(null);
  }, [src]);

  return <OriginalImage
    className={className}
    src={fingerprintedAsset(src)}
    sizes="(max-width: 700px) 80px, (max-width: 1100px) 128px, 192px"
    width="384"
    height="536"
    alt={alt}
    aria-hidden={ariaHidden}
    data-card-id={dataCardId}
    data-art-orientation={artOrientation ?? undefined}
    onLoad={(event) => {
      setArtOrientation(
        event.currentTarget.naturalHeight > event.currentTarget.naturalWidth
          ? "portrait"
          : "landscape",
      );
    }}
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
