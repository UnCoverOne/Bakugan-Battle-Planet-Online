"use client";

import { useEffect } from "react";
import { useAppFields } from "./AppProvider";
import { cachedResponse, invalidateResponse, publicDeckResponseKey } from "../../lib/response-cache";
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
  const { authUser, authChecking } = useAppFields(["authUser", "authChecking"]);
  useEffect(() => {
    if (authChecking) return;
    let active = true;
    let inFlight = false;
    let lastSyncedAt = 0;
    const sync = async (force = false) => {
      if (!navigator.onLine || inFlight || (!force && Date.now() - lastSyncedAt < 60_000)) return;
      inFlight = true;
      try {
        if (force) invalidateResponse("public-decks:");
        const result = await cachedResponse<PublicDeckResponse>(publicDeckResponseKey(authUser?.id), "/api/public-decks");
        if (!Array.isArray(result.offlineFallbackDecks) || !active) return;
        lastSyncedAt = Date.now();
        writeOfflinePublicDeckCache(
          localStorage,
          result.offlineFallbackDecks,
          Number(result.offlineFallbackRevision ?? Date.now()),
        );
      } catch {
        // Offline fallback synchronization is best-effort and never blocks application startup.
      } finally {
        inFlight = false;
      }
    };
    const onOnline = () => { void sync(); };
    const onUpdated = () => { void sync(true); };
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
  }, [authChecking, authUser?.id]);
  return null;
}
