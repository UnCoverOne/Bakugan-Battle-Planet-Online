"use client";

import type { CSSProperties, ComponentProps } from "react";
import { OriginalImage } from "@/components/media/OriginalImage";
import type { Core } from "@/lib/game";
import styles from "./BakuCoreArt.module.css";

type OriginalImageProps = ComponentProps<typeof OriginalImage>;

/** Render the supplied physical BakuCore artwork without synthesized effect overlays. */
export function BakuCoreArt({
  core, alt, className, style, width, height, ...imageProps
}: Omit<OriginalImageProps, "src" | "alt"> & { core: Core; alt?: string }) {
  const wrapperStyle: CSSProperties = {
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
    ...style,
  };
  return (
    <span className={`${styles.art} ${className ?? ""}`} style={wrapperStyle}>
      <OriginalImage
        {...imageProps}
        className={styles.image}
        src={core.art}
        alt={alt ?? `${core.name} front`}
        {...(width !== undefined && height !== undefined ? { width, height } : {})}
      />
    </span>
  );
}
