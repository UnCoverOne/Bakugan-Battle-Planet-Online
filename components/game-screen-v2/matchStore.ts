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

export type MatchStoreBootstrap = Partial<Omit<MatchStoreSnapshot, "match">> & {
  match?: MatchState | null;
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

function readStorage(storage: Storage, key: string) {
  try { return storage.getItem(key); }
  catch { return null; }
}

function writeStorage(storage: Storage, key: string, value: unknown) {
  try {
    if (value == null || value === "") storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Match routes are authoritative while their client bundle is mounted. This
 * prevents a stale, debounced route value in localStorage from making the
 * gameplay tree render nothing after App Router navigation.
 */
export function gameplayRouteForPathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/play/match" || normalized.startsWith("/play/match/")) return "match";
  if (normalized === "/play/lobby" || normalized.startsWith("/play/lobby/")) return "lobby";
  if (normalized === "/play/result" || normalized.startsWith("/play/result/")) return "result";
  if (normalized === "/play" || normalized.startsWith("/play/")) return "play";
  return null;
}

export function readMatchStore(): MatchStoreSnapshot {
  if (typeof window === "undefined") return EMPTY;
  const routeFromLocation = gameplayRouteForPathname(window.location.pathname);
  const settings = parse<MatchClientSettings>(readStorage(localStorage, SETTINGS_KEY), {});
  const storedMatch = parse<MatchState | null>(readStorage(localStorage, MATCH_KEY), null);
  const capability = parse<string | undefined>(
    readStorage(sessionStorage, CAPABILITY_KEY)
      ?? readStorage(localStorage, CAPABILITY_KEY),
    undefined,
  );
  return {
    route: routeFromLocation ?? parse(readStorage(localStorage, ROUTE_KEY), "entry"),
    online: parse(readStorage(localStorage, ONLINE_KEY), false),
    playerId: parse<string | undefined>(readStorage(localStorage, PLAYER_KEY), undefined),
    capability,
    settings,
    match: storedMatch ? normalizeMatchState(storedMatch) : null,
  };
}

let snapshot = EMPTY;
let initialized = false;
const listeners = new Set<() => void>();

function snapshotsMatch(left: MatchStoreSnapshot, right: MatchStoreSnapshot) {
  return left.route === right.route
    && left.online === right.online
    && left.playerId === right.playerId
    && left.capability === right.capability
    && left.match?.id === right.match?.id
    && left.match?.version === right.match?.version
    && JSON.stringify(left.settings) === JSON.stringify(right.settings);
}

function notify() {
  for (const listener of listeners) listener();
}

function refresh() {
  if (typeof window === "undefined") return;
  const next = readMatchStore();
  if (snapshotsMatch(snapshot, next)) return;
  snapshot = next;
  notify();
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

/**
 * Atomically hands the AppProvider's in-memory match state to the route-local
 * gameplay store before GameplayRuntime mounts. The provider intentionally
 * debounces durable browser writes, so relying on localStorage alone creates a
 * race where /play/match sees route="play" and match=null and renders a blank
 * immersive shell.
 */
export function primeMatchStore(next: MatchStoreBootstrap) {
  if (typeof window === "undefined") return EMPTY;
  initialize();

  let primedMatch = snapshot.match;
  let acceptedMatch = false;
  if (next.match !== undefined) {
    const candidate = next.match ? normalizeMatchState(next.match) : null;
    acceptedMatch = candidate == null
      || snapshot.match == null
      || snapshot.match.id !== candidate.id
      || candidate.version >= snapshot.match.version;
    if (acceptedMatch) primedMatch = candidate;
  }

  const primed: MatchStoreSnapshot = {
    route: next.route
      ?? gameplayRouteForPathname(window.location.pathname)
      ?? snapshot.route,
    online: next.online ?? snapshot.online,
    playerId: next.playerId ?? snapshot.playerId,
    capability: next.capability ?? snapshot.capability,
    settings: next.settings
      ? { ...snapshot.settings, ...next.settings }
      : snapshot.settings,
    match: primedMatch,
  };

  if (next.route !== undefined) writeStorage(localStorage, ROUTE_KEY, primed.route);
  if (next.online !== undefined) writeStorage(localStorage, ONLINE_KEY, primed.online);
  if (next.playerId !== undefined) writeStorage(localStorage, PLAYER_KEY, primed.playerId);
  if (next.capability !== undefined) {
    writeStorage(sessionStorage, CAPABILITY_KEY, primed.capability);
    try { localStorage.removeItem(CAPABILITY_KEY); } catch {}
  }
  if (next.settings !== undefined) writeStorage(localStorage, SETTINGS_KEY, primed.settings);
  if (next.match !== undefined && acceptedMatch) writeStorage(localStorage, MATCH_KEY, primed.match);

  if (!snapshotsMatch(snapshot, primed)) {
    snapshot = primed;
    notify();
  }
  return snapshot;
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
