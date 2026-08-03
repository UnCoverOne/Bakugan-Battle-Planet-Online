"use client";

import { useEffect } from "react";

const VIEWPORT_STABLE_EVENT = "bbp-viewport-stable";
type ViewportSample = { width: number; height: number; scale: number };

function sampleViewport(): ViewportSample {
  const viewport = window.visualViewport;
  return {
    width: viewport?.width ?? window.innerWidth,
    height: viewport?.height ?? window.innerHeight,
    scale: viewport?.scale ?? 1,
  };
}

/** Mark only meaningful geometry changes. Routine visualViewport scrolling and
 * small browser-chrome height adjustments no longer pause active effects. */
export function ViewportStabilityGuard() {
  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;
    let previous = sampleViewport();

    const markChanging = (force = false) => {
      const next = sampleViewport();
      const widthChanged = Math.abs(next.width - previous.width) >= 1;
      const scaleChanged = Math.abs(next.scale - previous.scale) >= 0.01;
      const materialHeightChange = Math.abs(next.height - previous.height) >= 140;
      previous = next;
      if (!force && !widthChanged && !scaleChanged && !materialHeightChange) return;

      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.dataset.viewportChanging = "true";
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          delete document.documentElement.dataset.viewportChanging;
          window.dispatchEvent(new Event(VIEWPORT_STABLE_EVENT));
        }, 180);
      });
    };

    const resize = () => markChanging(false);
    const orientation = () => markChanging(true);
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("orientationchange", orientation, { passive: true });
    window.visualViewport?.addEventListener("resize", resize, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      delete document.documentElement.dataset.viewportChanging;
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", orientation);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, []);
  return null;
}
