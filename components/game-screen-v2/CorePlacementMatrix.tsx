"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { corePlacementMatrixScale } from "./corePlacementLayout";
import styles from "./CorePlacementLayer.module.css";

export function CorePlacementMatrix({
  label,
  oppositePerspective,
  children,
}: {
  label: string;
  oppositePerspective: boolean;
  children: ReactNode;
}) {
  const [matrixScale, setMatrixScale] = useState(1);
  const matrixRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const matrix = matrixRef.current;
    if (!matrix) return;
    let frame = 0;

    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
        const next = corePlacementMatrixScale({
          containerWidthPx: matrix.clientWidth,
          containerHeightPx: matrix.clientHeight,
          rootFontSizePx: rootFontSize,
        });
        if (next !== null) setMatrixScale(next);
      });
    };

    measure();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    resizeObserver?.observe(matrix);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  const matrixStyle = { "--matrix-scale": matrixScale } as CSSProperties;
  return (
    <div
      ref={matrixRef}
      className={styles.matrix}
      aria-label={label}
      data-perspective={oppositePerspective ? "opposite" : "local"}
    >
      <div className={styles.matrixGrid} style={matrixStyle}>
        {children}
      </div>
    </div>
  );
}
