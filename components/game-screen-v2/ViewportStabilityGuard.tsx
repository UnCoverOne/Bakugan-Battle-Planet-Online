"use client";

import { useEffect } from "react";

/**
 * Browser zoom can emit many resize and visualViewport events in a few frames.
 * Mark that short window so gameplay CSS can suspend decorative transitions
 * while layout measurements settle, avoiding repeated GPU layer flashes.
 */
export function ViewportStabilityGuard() {
  useEffect(() => {
    let frame = 0;
    let settleTimer = 0;

    const markChanging = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.dataset.viewportChanging = "true";
        window.clearTimeout(settleTimer);
        settleTimer = window.setTimeout(() => {
          delete document.documentElement.dataset.viewportChanging;
        }, 180);
      });
    };

    window.addEventListener("resize", markChanging, { passive: true });
    window.addEventListener("orientationchange", markChanging, { passive: true });
    window.visualViewport?.addEventListener("resize", markChanging, { passive: true });
    window.visualViewport?.addEventListener("scroll", markChanging, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      delete document.documentElement.dataset.viewportChanging;
      window.removeEventListener("resize", markChanging);
      window.removeEventListener("orientationchange", markChanging);
      window.visualViewport?.removeEventListener("resize", markChanging);
      window.visualViewport?.removeEventListener("scroll", markChanging);
    };
  }, []);

  return null;
}

