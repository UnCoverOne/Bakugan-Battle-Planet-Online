"use client";

import { useEffect } from "react";
import { fingerprintedAsset, optimizedCardSource, responsiveCardSourceSet } from "../../lib/assets";

export function ResponsiveCardImage({
  src,
  alt,
  className,
  eager = false,
  draggable = false,
  style,
  ariaHidden,
}: {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
  draggable?: boolean;
  style?: React.CSSProperties;
  ariaHidden?: boolean;
}) {
  const vector = src.endsWith(".svg");
  return <img
    className={className}
    src={vector ? fingerprintedAsset(src) : optimizedCardSource(src)}
    srcSet={responsiveCardSourceSet(src)}
    sizes="(max-width: 700px) 80px, (max-width: 1100px) 128px, 192px"
    width="384"
    height="536"
    alt={alt}
    aria-hidden={ariaHidden}
    loading={eager ? "eager" : "lazy"}
    fetchPriority={eager ? "high" : "auto"}
    decoding="async"
    draggable={draggable}
    style={style}
  />;
}

export function LikelyCardImagePreloader({ sources }: { sources: readonly string[] }) {
  const signature = sources.slice(0, 2).join("|");
  useEffect(() => {
    for (const source of sources.slice(0, 2)) {
      const image = new Image();
      image.src = optimizedCardSource(source, 128);
      image.srcset = responsiveCardSourceSet(source) ?? "";
      image.sizes = "128px";
    }
  }, [signature]);
  return null;
}
