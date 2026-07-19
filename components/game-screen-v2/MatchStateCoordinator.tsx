"use client";

import { useLayoutEffect } from "react";
import type { MatchState } from "../../lib/game";

const MATCH_KEY = "bbp-active-match-v1";
export const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

declare global {
  interface Window {
    __bbpMatchStorageCoordinated?: boolean;
  }
}

function parseMatch(value: string | null): MatchState | null {
  if (!value) return null;
  try { return JSON.parse(value) as MatchState; }
  catch { return null; }
}

function incomingStateIsNewer(current: MatchState | null, incoming: MatchState | null) {
  if (!incoming) return true;
  if (!current) return true;
  if (incoming.id !== current.id || incoming.code !== current.code) return true;
  return incoming.version > current.version;
}

/**
 * The legacy screen, experimental screen, BakuCore layer, and Brawl layer all
 * share one localStorage match document. This guard makes that document
 * monotonic: delayed polling responses and stale React effects cannot replace a
 * newer match version. Every accepted write also emits a same-tab event so all
 * gameplay layers update immediately instead of waiting for their polling loop.
 */
export function MatchStateCoordinator() {
  useLayoutEffect(() => {
    if (window.__bbpMatchStorageCoordinated) return;
    window.__bbpMatchStorageCoordinated = true;

    const originalSetItem = Storage.prototype.setItem;
    const coordinatedSetItem: typeof Storage.prototype.setItem = function setItem(key, value) {
      if (this === window.localStorage && key === MATCH_KEY) {
        const currentRaw = window.localStorage.getItem(MATCH_KEY);
        if (currentRaw === value) return;
        const current = parseMatch(currentRaw);
        const incoming = parseMatch(value);
        if (!incomingStateIsNewer(current, incoming)) return;
        originalSetItem.call(this, key, value);
        window.dispatchEvent(new CustomEvent<MatchState | null>(MATCH_UPDATE_EVENT, {
          detail: incoming,
        }));
        return;
      }
      originalSetItem.call(this, key, value);
    };

    Storage.prototype.setItem = coordinatedSetItem;
    return () => {
      if (Storage.prototype.setItem === coordinatedSetItem) {
        Storage.prototype.setItem = originalSetItem;
      }
      window.__bbpMatchStorageCoordinated = false;
    };
  }, []);

  return null;
}
