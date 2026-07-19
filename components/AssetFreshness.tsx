"use client";

import { useEffect } from "react";
import { BUILD_ID } from "../lib/build";

/**
 * Install a tiny network-first service worker for the un-fingerprinted artwork
 * under /assets. The script URL includes the deployment build id, so existing
 * browsers activate the newest worker and reload once when a deployment changes.
 */
export function AssetFreshness() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const reloadKey = `bbp-asset-worker-reload:${BUILD_ID}`;
    const onControllerChange = () => {
      if (sessionStorage.getItem(reloadKey) === "done") return;
      sessionStorage.setItem(reloadKey, "done");
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(BUILD_ID)}`, {
      scope: "/",
      updateViaCache: "none",
    }).then((registration) => registration.update()).catch(() => {
      // Asset freshness is progressive enhancement; gameplay remains available
      // in browsers or privacy modes that disable service workers.
    });

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
