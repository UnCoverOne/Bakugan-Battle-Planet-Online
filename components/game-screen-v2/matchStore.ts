"use client";

import { useEffect, useSyncExternalStore } from "react";
import { normalizeMatchState, type MatchState } from "../../lib/game";

export const MATCH_KEY = "bbp-active-match-v1";
export const PREVIOUS_MATCH_KEY = "bbp-previous-match-v2";
export const ROUTE_KEY = "bbp-route-v1";
export const SETTINGS_KEY = "bbp-settings";
export const ONLINE_KEY = "bbp-active-match-online-v1";
export const PLAYER_KEY = "bbp-player-id";
export const CAPABILITY_KEY = "bbp-match-capability-v2";
export const MATCH_UPDATE_EVENT = "bbp-match-state-updated";

export type MatchClientSettings = Record<string, unknown> & {
  automaticDraw?: boolean;
  automaticPass?: boolean;
  soundEnabled?: boolean;
  sound?: boolean;
  soundVolume?: number;
};

export type MatchStoreSnapshot = {
  route: string;
  online: boolean;
  playerId?: string;
  capability?: string;
  settings: MatchClientSettings;
  match: MatchState | null;
};

const EMPTY: MatchStoreSnapshot = {
  route: "entry",
  online: false,
  settings: {},
  match: null,
};

function parse<T>(value: string | null, fallback: T): T {
  if (value == null) return fallback;
  try { return JSON.parse(value) as T; }
  catch { return fallback; }
}

export function readMatchStore(): MatchStoreSnapshot {
  if (typeof window === "undefined") return EMPTY;
  const settings = parse<MatchClientSettings>(localStorage.getItem(SETTINGS_KEY), {});
  const storedMatch = parse<MatchState | null>(localStorage.getItem(MATCH_KEY), null);
  return {
    route: parse(localStorage.getItem(ROUTE_KEY), "entry"),
    online: parse(localStorage.getItem(ONLINE_KEY), false),
    playerId: parse<string | undefined>(localStorage.getItem(PLAYER_KEY), undefined),
    capability: parse<string | undefined>(localStorage.getItem(CAPABILITY_KEY), undefined),
    settings,
    match: storedMatch ? normalizeMatchState(storedMatch) : null,
  };
}

let snapshot = EMPTY;
let initialized = false;
const listeners = new Set<() => void>();

function refresh() {
  if (typeof window === "undefined") return;
  const next = readMatchStore();
  const unchanged = snapshot.route === next.route
    && snapshot.online === next.online
    && snapshot.playerId === next.playerId
    && snapshot.capability === next.capability
    && snapshot.match?.id === next.match?.id
    && snapshot.match?.version === next.match?.version
    && JSON.stringify(snapshot.settings) === JSON.stringify(next.settings);
  if (unchanged) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  snapshot = readMatchStore();
  window.addEventListener("storage", refresh);
  window.addEventListener(MATCH_UPDATE_EVENT, refresh as EventListener);
}

function subscribe(listener: () => void) {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  initialize();
  return snapshot;
}

export function useMatchSelector<T>(selector: (state: MatchStoreSnapshot) => T) {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return selector(state);
}

export function publishMatch(next: MatchState, rememberPrevious = true) {
  const current = readMatchStore().match;
  if (current && current.id === next.id && next.version <= current.version) return false;
  if (rememberPrevious && current) localStorage.setItem(PREVIOUS_MATCH_KEY, JSON.stringify(current));
  localStorage.setItem(MATCH_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: next }));
  refresh();
  return true;
}

export function publishRoute(route: string) {
  localStorage.setItem(ROUTE_KEY, JSON.stringify(route));
  refresh();
}

export function publishSettings(settings: MatchClientSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  refresh();
}

export function localUndoSnapshot() {
  return parse<MatchState | null>(localStorage.getItem(PREVIOUS_MATCH_KEY), null);
}

let transport: WebSocket | null = null;
let fallbackTimer = 0;
let transportIdentity = "";

function stopTransport() {
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  fallbackTimer = 0;
  transport?.close();
  transport = null;
  transportIdentity = "";
}

async function pollOnce(state: MatchStoreSnapshot) {
  if (!state.match || !state.playerId) return;
  const response = await fetch("/api/game", {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json", ...(state.capability ? { "x-match-capability": state.capability } : {}) },
    body: JSON.stringify({ action: "get", code: state.match.code, playerId: state.playerId }),
  });
  const data = await response.json() as { state?: MatchState };
  if (data.state) publishMatch(data.state, false);
}

function startFallback(state: MatchStoreSnapshot) {
  if (fallbackTimer) return;
  void pollOnce(state);
  fallbackTimer = window.setInterval(() => void pollOnce(readMatchStore()), document.hidden ? 5_000 : 2_500);
}

function startTransport(state: MatchStoreSnapshot) {
  if (!state.online || !state.match || !state.playerId || !["lobby", "match"].includes(state.route)) return stopTransport();
  const identity = `${state.match.code}:${state.playerId}:${state.capability ?? ""}`;
  if (transportIdentity === identity && (transport || fallbackTimer)) return;
  stopTransport();
  transportIdentity = identity;
  const url = new URL("/api/game/socket", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("code", state.match.code);
  url.searchParams.set("playerId", state.playerId);
  try {
    transport = new WebSocket(url, state.capability ? ["bbp-match-v1", `cap.${state.capability}`] : ["bbp-match-v1"]);
    transport.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; state?: MatchState };
        if (message.state) publishMatch(message.state, false);
      } catch { /* Ignore malformed transport frames. */ }
    });
    transport.addEventListener("open", () => {
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = 0;
    });
    transport.addEventListener("close", () => {
      startFallback(readMatchStore());
    });
    transport.addEventListener("error", () => {
      startFallback(readMatchStore());
    });
  } catch {
    startFallback(state);
  }
}

export function useMatchTransport() {
  const identity = useMatchSelector((state) => `${state.online}:${state.route}:${state.match?.code ?? ""}:${state.playerId ?? ""}:${state.capability ?? ""}`);
  useEffect(() => {
    startTransport(readMatchStore());
    return () => stopTransport();
  }, [identity]);
}
