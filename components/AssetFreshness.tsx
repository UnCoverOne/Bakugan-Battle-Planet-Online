"use client";

import { useEffect } from "react";
import { BUILD_ID } from "../lib/build";

export const VERSION_MISMATCH_EVENT = "bbp-version-mismatch";

/**
 * Keep unfingerprinted artwork fresh and surface a blocking update state when
 * a newer service worker takes control. The user chooses the refresh so work
 * is never discarded by an unexplained automatic reload.
 */
export function AssetFreshness() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const wasControlled = Boolean(navigator.serviceWorker.controller);
    const existingBrowserData = Boolean(
      localStorage.getItem("bbp-settings") ||
      localStorage.getItem("bbp-profile") ||
      localStorage.getItem("bbp-active-match-v1"),
    );
    const notifyAfterClaim = wasControlled || existingBrowserData;
    const mismatchKey = `bbp-version-mismatch:${BUILD_ID}`;
    const onControllerChange = () => {
      if (!notifyAfterClaim || sessionStorage.getItem(mismatchKey) === "shown")
        return;
      sessionStorage.setItem(mismatchKey, "shown");
      window.dispatchEvent(
        new CustomEvent(VERSION_MISMATCH_EVENT, {
          detail: { buildId: BUILD_ID },
        }),
      );
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    void navigator.serviceWorker
      .register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => registration.update())
      .catch(() => {
        // Asset freshness is progressive enhancement; the application remains
        // usable in browsers and privacy modes that disable service workers.
      });

    return () =>
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
  }, []);

  return null;
}
