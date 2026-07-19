"use client";

import { useLayoutEffect } from "react";
import type { MatchState } from "../../lib/game";

const MATCH_KEY = "bbp-active-match-v1";
const ROUTE_KEY = "bbp-route-v1";
const SETTINGS_KEY = "bbp-settings";
export const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

declare global {
  interface Window {
    __bbpMatchStorageCoordinated?: boolean;
    __bbpAuthorizedMatchWrite?: boolean;
  }
}

function parseValue<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

function parseMatch(value: string | null): MatchState | null {
  return parseValue<MatchState | null>(value, null);
}

function incomingStateIsNewer(current: MatchState | null, incoming: MatchState | null) {
  if (!incoming) return true;
  if (!current) return true;
  if (incoming.id !== current.id || incoming.code !== current.code) return true;
  return incoming.version > current.version;
}

function experimentalClientOwnsMatch() {
  const settings = parseValue<Record<string, unknown>>(
    window.localStorage.getItem(SETTINGS_KEY),
    {},
  );
  const route = parseValue(window.localStorage.getItem(ROUTE_KEY), "entry");
  return Boolean(settings.useNewGameScreen) && route === "match";
}

/**
 * All experimental gameplay actions use this write path. While the standalone
 * battlefield is active, background effects from the hidden legacy match screen
 * are deliberately denied write access so a divergent Training AI or polling
 * response cannot eventually overtake the live match merely by reaching a
 * higher version number.
 */
export function writeCoordinatedMatch(next: MatchState) {
  const current = parseMatch(window.localStorage.getItem(MATCH_KEY));
  if (!incomingStateIsNewer(current, next)) return false;

  const coordinated = Boolean(window.__bbpMatchStorageCoordinated);
  window.__bbpAuthorizedMatchWrite = true;
  try {
    window.localStorage.setItem(MATCH_KEY, JSON.stringify(next));
  } finally {
    window.__bbpAuthorizedMatchWrite = false;
  }

  // The global coordinator normally emits this event. Keep the helper usable in
  // isolated component tests and previews where the coordinator is not mounted.
  if (!coordinated) {
    window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, {
      detail: next,
    }));
  }
  return true;
}

/**
 * The legacy screen, experimental screen, BakuCore layer, and Brawl layer all
 * share one localStorage match document. This guard makes that document
 * monotonic and gives the experimental client exclusive ownership while it is
 * visible. Every accepted write emits a same-tab event so all gameplay layers
 * update immediately instead of waiting for their polling loop.
 */
export function MatchStateCoordinator() {
  useLayoutEffect(() => {
    if (window.__bbpMatchStorageCoordinated) return;
    window.__bbpMatchStorageCoordinated = true;

    const originalSetItem = Storage.prototype.setItem;
    const coordinatedSetItem: typeof Storage.prototype.setItem = function setItem(key, value) {
      if (this === window.localStorage && key === MATCH_KEY) {
        if (experimentalClientOwnsMatch() && !window.__bbpAuthorizedMatchWrite) return;

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
      window.__bbpAuthorizedMatchWrite = false;
    };
  }, []);

  return null;
}
