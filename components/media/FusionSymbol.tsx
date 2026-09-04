"use client";

import type { ImgHTMLAttributes } from "react";

type FusionSymbolProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
  alt?: string;
};

/**
 * The Fusion mark is rendered as a native image so the supplied artwork
 * keeps its intrinsic aspect ratio in every preview and inspector surface.
 */
export function FusionSymbol({ alt = "", ...props }: FusionSymbolProps) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src="/assets/symbols/fusion.png" alt={alt} decoding="async" />;
}
