"use client";

import Image from "next/image";
import type { ImgHTMLAttributes } from "react";

type OriginalImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "srcSet" | "width" | "height" | "alt"
> & {
  src: string;
  alt: string;
  width?: number | `${number}`;
  height?: number | `${number}`;
  fill?: boolean;
};

/**
 * Renders the original image asset through Next's layout-aware component
 * without invoking an optimizer, resizing the source, or changing its format.
 *
 * Sized assets use Next's layout-aware component. Animation and user-selected
 * sources without reliable intrinsic metadata retain native sizing so this
 * migration cannot distort them or invent an incorrect aspect ratio.
 */
export function OriginalImage({ src, alt, width, height, fill = false, ...props }: OriginalImageProps) {
  if (fill) {
    return <Image {...props} src={src} alt={alt} fill unoptimized />;
  }
  if (width !== undefined && height !== undefined) {
    return <Image {...props} src={src} alt={alt} width={width} height={height} unoptimized />;
  }
  // Dynamic gameplay artwork can vary between portrait cards, landscape
  // Characters, BakuCores, avatars, and animation layers. A native element is
  // the lossless fallback when the catalogue does not expose intrinsic size.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={src} alt={alt} />;
}
