"use client";

import { useEffect } from "react";
import type { DeckRecord } from "../../lib/data";
import {
  OFFLINE_PUBLIC_DECKS_UPDATED_EVENT,
  writeOfflinePublicDeckCache,
} from "../../lib/public-deck-cache";

type PublicDeckResponse = {
  offlineFallbackDecks?: DeckRecord[];
  offlineFallbackRevision?: number;
};

export function PublicDeckFallbackSync() {
  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!navigator.onLine) return;
      try {
        const response = await fetch("/api/public-decks", { cache: "no-store" });
        const result = await response.json() as PublicDeckResponse;
        if (!response.ok || !Array.isArray(result.offlineFallbackDecks) || !active) return;
        writeOfflinePublicDeckCache(
          localStorage,
          result.offlineFallbackDecks,
          Number(result.offlineFallbackRevision ?? Date.now()),
        );
      } catch {
        // Offline fallback synchronization is best-effort and never blocks application startup.
      }
    };
    const onOnline = () => { void sync(); };
    const onUpdated = () => { void sync(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void sync();
    };
    void sync();
    addEventListener("online", onOnline);
    addEventListener(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT, onUpdated);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      removeEventListener("online", onOnline);
      removeEventListener(OFFLINE_PUBLIC_DECKS_UPDATED_EVENT, onUpdated);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return null;
}
