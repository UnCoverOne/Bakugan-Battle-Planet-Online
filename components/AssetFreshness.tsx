"use client";

import { useEffect } from "react";
import { BUILD_ID } from "../lib/build";
import { hasClientVersionMismatch } from "../lib/client-status";

export const VERSION_MISMATCH_EVENT = "bbp-version-mismatch";
const VERSION_CHECK_COOLDOWN_MS = 60_000;

/**
 * Own the single service-worker registration and compare the loaded client
 * against the server's authoritative build identity. Service-worker lifecycle
 * events only trigger a recheck; they are not themselves proof of an update.
 */
export function AssetFreshness() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    let active = true;
    let checking = false;
    let lastCheckedAt = 0;
    const announcedBuilds = new Set<string>();

    const checkForNewBuild = async (force = false) => {
      const now = Date.now();
      if (
        !active ||
        checking ||
        (!force && now - lastCheckedAt < VERSION_CHECK_COOLDOWN_MS)
      )
        return;

      checking = true;
      lastCheckedAt = now;
      try {
        const response = await fetch(
          `/api/version?client=${encodeURIComponent(BUILD_ID)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const result = (await response.json()) as { buildId?: unknown };
        const serverBuildId =
          typeof result.buildId === "string" ? result.buildId : "";
        if (!hasClientVersionMismatch(BUILD_ID, serverBuildId)) return;

        const mismatchKey = `bbp-version-mismatch:${BUILD_ID}:${serverBuildId}`;
        let wasShown = announcedBuilds.has(serverBuildId);
        try {
          wasShown ||= sessionStorage.getItem(mismatchKey) === "shown";
        } catch {
          // In-memory deduplication still prevents repeated alerts when session
          // storage is unavailable or blocked by browser privacy settings.
        }
        if (wasShown) return;

        announcedBuilds.add(serverBuildId);
        try {
          sessionStorage.setItem(mismatchKey, "shown");
        } catch {
          // Version detection remains functional without session storage.
        }
        window.dispatchEvent(
          new CustomEvent(VERSION_MISMATCH_EVENT, {
            detail: { clientBuildId: BUILD_ID, serverBuildId },
          }),
        );
      } catch {
        // Being offline must not turn a best-effort freshness check into an
        // application error. The next online/focus event will retry it.
      } finally {
        checking = false;
      }
    };

    const onFocus = () => void checkForNewBuild(false);
    const onOnline = () => void checkForNewBuild(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForNewBuild(false);
    };
    const onControllerChange = () => void checkForNewBuild(true);

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void checkForNewBuild(true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
      );
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {
          // Offline support is progressive enhancement; version comparison
          // remains available even when service workers are disabled.
        });
    }

    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener(
          "controllerchange",
          onControllerChange,
        );
      }
    };
  }, []);

  return null;
}
