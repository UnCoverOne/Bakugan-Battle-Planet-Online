"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { normalizeMatchState, type MatchState } from "../../lib/game";
import { isCompletedSeriesResult } from "../../lib/match-result-navigation";
import { MATCH_UPDATE_EVENT } from "../../lib/match-state-events";

export { MATCH_UPDATE_EVENT };

export const MATCH_KEY = "bbp-active-match-v1";
export const PREVIOUS_MATCH_KEY = "bbp-previous-match-v2";
export const ROUTE_KEY = "bbp-route-v1";
export const SETTINGS_KEY = "bbp-settings";
export const ONLINE_KEY = "bbp-active-match-online-v1";
export const PLAYER_KEY = "bbp-player-id";
export const CAPABILITY_KEY = "bbp-match-capability-v2";

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

export function gameplayRouteForPathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/play/match" || normalized.startsWith("/play/match/")) return "match";
  if (normalized === "/play/lobby" || normalized.startsWith("/play/lobby/")) return "lobby";
  if (normalized === "/play/result" || normalized.startsWith("/play/result/")) return "result";
  if (normalized === "/play" || normalized.startsWith("/play/")) return "play";
  return null;
}

function readPersistedMatchStore(): MatchStoreSnapshot {
  if (typeof window === "undefined") return EMPTY;
  const routeFromLocation = gameplayRouteForPathname(window.location.pathname);
  const settings = parse<MatchClientSettings>(readStorage(localStorage, SETTINGS_KEY), {});
  const storedMatch = parse<MatchState | null>(readStorage(localStorage, MATCH_KEY), null);
  const capability = parse<string | undefined>(
    readStorage(sessionStorage, CAPABILITY_KEY) ?? readStorage(localStorage, CAPABILITY_KEY),
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
  const persisted = readPersistedMatchStore();
  const inMemoryMatch = snapshot.match;
  const persistedMatch = persisted.match;
  const keepNewerInMemoryMatch = Boolean(
    pendingPersistedMatch
    && inMemoryMatch
    && pendingPersistedMatch.id === inMemoryMatch.id
    && pendingPersistedMatch.version === inMemoryMatch.version
    && (!persistedMatch || inMemoryMatch.id !== persistedMatch.id || inMemoryMatch.version > persistedMatch.version)
  );
  const next = keepNewerInMemoryMatch ? { ...persisted, match: inMemoryMatch } : persisted;
  if (snapshotsMatch(snapshot, next)) return;
  snapshot = next;
  notify();
}

function receiveMatchUpdate(event: Event) {
  const detail = (event as CustomEvent<MatchState>).detail;
  if (!detail) return refresh();
  const normalized = normalizeMatchState(detail);
  if (snapshot.match?.id === normalized.id && snapshot.match.version >= normalized.version) return;
  snapshot = { ...snapshot, match: normalized };
  notify();
}

function initialize() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  snapshot = readPersistedMatchStore();
  window.addEventListener("storage", refresh);
  window.addEventListener(MATCH_UPDATE_EVENT, receiveMatchUpdate as EventListener);
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

export function readMatchStore(): MatchStoreSnapshot {
  return getSnapshot();
}

function shallowSelectorEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftPrototype = Object.getPrototypeOf(left);
  const rightPrototype = Object.getPrototypeOf(right);
  const supported = leftPrototype === Object.prototype || leftPrototype === Array.prototype;
  if (!supported || leftPrototype !== rightPrototype) return false;
  const leftKeys = Object.keys(left as object);
  const rightKeys = Object.keys(right as object);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.is(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
    ));
}

export function useMatchSelector<T>(
  selector: (state: MatchStoreSnapshot) => T,
  equality: (left: T, right: T) => boolean = shallowSelectorEqual,
) {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equality);
  const selectedRef = useRef<{ ready: boolean; value: T }>({ ready: false, value: undefined as T });
  selectorRef.current = selector;
  equalityRef.current = equality;

  const selectedSnapshot = useCallback(() => {
    const next = selectorRef.current(getSnapshot());
    const previous = selectedRef.current;
    if (previous.ready && equalityRef.current(previous.value, next)) return previous.value;
    selectedRef.current = { ready: true, value: next };
    return next;
  }, []);
  const serverSnapshot = useCallback(() => selectorRef.current(EMPTY), []);
  return useSyncExternalStore(subscribe, selectedSnapshot, serverSnapshot);
}

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
    route: next.route ?? gameplayRouteForPathname(window.location.pathname) ?? snapshot.route,
    online: next.online ?? snapshot.online,
    playerId: next.playerId ?? snapshot.playerId,
    capability: next.capability ?? snapshot.capability,
    settings: next.settings ? { ...snapshot.settings, ...next.settings } : snapshot.settings,
    match: primedMatch,
  };

  if (next.route !== undefined) writeStorage(localStorage, ROUTE_KEY, primed.route);
  if (next.online !== undefined) writeStorage(localStorage, ONLINE_KEY, primed.online);
  if (next.playerId !== undefined) writeStorage(localStorage, PLAYER_KEY, primed.playerId);
  if (next.capability !== undefined) {
    writeStorage(sessionStorage, CAPABILITY_KEY, primed.capability);
    try { localStorage.removeItem(CAPABILITY_KEY); } catch {}
  }
  if (next.match !== undefined && acceptedMatch) writeStorage(localStorage, MATCH_KEY, primed.match);

  if (!snapshotsMatch(snapshot, primed)) {
    snapshot = primed;
    notify();
  }
  return snapshot;
}

let persistTimer = 0;
let pendingPersistedMatch: MatchState | null = null;
let pendingPreviousMatch: MatchState | null = null;
let pendingRememberPrevious = false;

function scheduleMatchPersistence(next: MatchState, previous: MatchState | null, rememberPrevious: boolean) {
  pendingPersistedMatch = next;
  if (rememberPrevious && previous) {
    pendingPreviousMatch = previous;
    pendingRememberPrevious = true;
  }
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const match = pendingPersistedMatch;
    const prior = pendingPreviousMatch;
    const remember = pendingRememberPrevious;
    pendingPersistedMatch = null;
    pendingPreviousMatch = null;
    pendingRememberPrevious = false;
    if (remember && prior) writeStorage(localStorage, PREVIOUS_MATCH_KEY, prior);
    if (match) writeStorage(localStorage, MATCH_KEY, match);
  }, 0);
}

export function persistCurrentMatch() {
  initialize();
  const match = snapshot.match;
  if (!match) return false;
  const prior = pendingPreviousMatch;
  const remember = pendingRememberPrevious;
  window.clearTimeout(persistTimer);
  persistTimer = 0;
  pendingPersistedMatch = null;
  pendingPreviousMatch = null;
  pendingRememberPrevious = false;
  if (remember && prior) writeStorage(localStorage, PREVIOUS_MATCH_KEY, prior);
  return writeStorage(localStorage, MATCH_KEY, match);
}

/** Persist the exact completed snapshot and publish the result route atomically. */
export function finalizeCompletedMatchExit() {
  initialize();
  if (!isCompletedSeriesResult(snapshot.match)) return false;
  if (!persistCurrentMatch()) return false;
  if (!writeStorage(localStorage, ROUTE_KEY, "result")) return false;
  snapshot = { ...snapshot, route: "result" };
  notify();
  return true;
}

export function publishMatch(next: MatchState, rememberPrevious = true) {
  initialize();
  const normalized = normalizeMatchState(next);
  const current = snapshot.match;
  if (current && current.id === normalized.id && normalized.version <= current.version) return false;
  snapshot = { ...snapshot, match: normalized };
  notify();
  scheduleMatchPersistence(normalized, current, rememberPrevious);
  window.dispatchEvent(new CustomEvent<MatchState>(MATCH_UPDATE_EVENT, { detail: normalized }));
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

type SocketListeners = {
  open: EventListener;
  message: EventListener;
  close: EventListener;
  error: EventListener;
};

let transport: WebSocket | null = null;
let transportListeners: SocketListeners | null = null;
let transportIdentity = "";
let transportGeneration = 0;
let intentionalClose = false;
let reconnectTimer = 0;
let pollTimer = 0;
let pollController: AbortController | null = null;
let reconnectAttempt = 0;
let pollFailureCount = 0;
let lastPollFailureLogAt = 0;

function clearReconnectTimer() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = 0;
}

function clearPollTimer() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = 0;
}

function abortPoll() {
  pollController?.abort();
  pollController = null;
}

function detachSocketListeners(socket: WebSocket) {
  if (!transportListeners) return;
  socket.removeEventListener("open", transportListeners.open);
  socket.removeEventListener("message", transportListeners.message);
  socket.removeEventListener("close", transportListeners.close);
  socket.removeEventListener("error", transportListeners.error);
  transportListeners = null;
}

function closeSocketIntentionally() {
  const socket = transport;
  transport = null;
  if (!socket) return;
  intentionalClose = true;
  detachSocketListeners(socket);
  try { socket.close(1000, "Transport replaced"); } catch {}
  intentionalClose = false;
}

function stopTransport() {
  transportGeneration += 1;
  clearReconnectTimer();
  clearPollTimer();
  abortPoll();
  closeSocketIntentionally();
  transportIdentity = "";
  reconnectAttempt = 0;
  pollFailureCount = 0;
}

function transportEligible(state: MatchStoreSnapshot) {
  return Boolean(state.online && state.match && state.playerId && ["lobby", "match"].includes(state.route));
}

function pollDelay() {
  const base = document.hidden ? 12_000 : 2_500;
  return Math.min(30_000, base * Math.max(1, 2 ** Math.min(pollFailureCount, 3)));
}

function reportPollFailure(error: unknown) {
  const now = Date.now();
  if (now - lastPollFailureLogAt < 30_000) return;
  lastPollFailureLogAt = now;
  console.warn("Match polling failed; retrying with backoff.", error instanceof Error ? error.message : String(error));
}

async function pollOnce(state: MatchStoreSnapshot, generation: number) {
  if (generation !== transportGeneration || !transportEligible(state) || !state.match || !state.playerId) return;
  abortPoll();
  const controller = new AbortController();
  pollController = controller;
  try {
    const response = await fetch("/api/game", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(state.capability ? { "x-match-capability": state.capability } : {}),
      },
      body: JSON.stringify({ action: "get", code: state.match.code, playerId: state.playerId }),
    });
    const data = await response.json().catch(() => ({})) as { state?: MatchState; error?: string };
    if (!response.ok) throw new Error(data.error || `Match polling returned HTTP ${response.status}.`);
    if (generation !== transportGeneration) return;
    if (data.state) publishMatch(data.state, false);
    pollFailureCount = 0;
  } catch (error) {
    if (controller.signal.aborted || generation !== transportGeneration) return;
    pollFailureCount += 1;
    reportPollFailure(error);
  } finally {
    if (pollController === controller) pollController = null;
  }
}

function schedulePoll(generation: number, immediate = false) {
  if (generation !== transportGeneration || pollTimer) return;
  pollTimer = window.setTimeout(async () => {
    pollTimer = 0;
    await pollOnce(readMatchStore(), generation);
    if (generation === transportGeneration && !transport && transportEligible(readMatchStore())) {
      schedulePoll(generation);
    }
  }, immediate ? 0 : pollDelay());
}

function scheduleReconnect(generation: number) {
  if (generation !== transportGeneration || reconnectTimer || !transportEligible(readMatchStore())) return;
  const exponential = Math.min(30_000, 1_000 * (2 ** Math.min(reconnectAttempt, 5)));
  const jitter = Math.floor(Math.random() * Math.max(250, exponential * 0.3));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0;
    connectTransport(readMatchStore(), generation);
  }, exponential + jitter);
}

function connectTransport(state: MatchStoreSnapshot, generation: number) {
  if (generation !== transportGeneration || !transportEligible(state) || !state.match || !state.playerId) return;
  closeSocketIntentionally();
  const url = new URL("/api/game/socket", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("code", state.match.code);
  url.searchParams.set("playerId", state.playerId);

  try {
    const socket = new WebSocket(url, state.capability ? ["bbp-match-v1", `cap.${state.capability}`] : ["bbp-match-v1"]);
    transport = socket;
    let disconnected = false;
    const handleDisconnect = () => {
      if (disconnected || generation !== transportGeneration || intentionalClose) return;
      disconnected = true;
      if (transport === socket) transport = null;
      detachSocketListeners(socket);
      try { socket.close(); } catch {}
      schedulePoll(generation, true);
      scheduleReconnect(generation);
    };
    const listenersForSocket: SocketListeners = {
      open: (() => {
        if (generation !== transportGeneration) return handleDisconnect();
        reconnectAttempt = 0;
        pollFailureCount = 0;
        clearReconnectTimer();
        clearPollTimer();
        abortPoll();
      }) as EventListener,
      message: ((event: MessageEvent) => {
        if (generation !== transportGeneration) return;
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; state?: MatchState };
          if (message.state) publishMatch(message.state, false);
        } catch { /* Ignore malformed transport frames. */ }
      }) as EventListener,
      close: handleDisconnect as EventListener,
      error: handleDisconnect as EventListener,
    };
    transportListeners = listenersForSocket;
    socket.addEventListener("open", listenersForSocket.open);
    socket.addEventListener("message", listenersForSocket.message);
    socket.addEventListener("close", listenersForSocket.close);
    socket.addEventListener("error", listenersForSocket.error);
  } catch (error) {
    reportPollFailure(error);
    schedulePoll(generation, true);
    scheduleReconnect(generation);
  }
}

function startTransport(state: MatchStoreSnapshot) {
  if (!transportEligible(state) || !state.match || !state.playerId) return stopTransport();
  const identity = `${state.match.code}:${state.playerId}:${state.capability ?? ""}`;
  if (transportIdentity === identity && (transport || reconnectTimer || pollTimer)) return;
  stopTransport();
  transportIdentity = identity;
  const generation = transportGeneration;
  connectTransport(state, generation);
}

export function useMatchTransport() {
  const identity = useMatchSelector((state) => `${state.online}:${state.route}:${state.match?.code ?? ""}:${state.playerId ?? ""}:${state.capability ?? ""}`);
  useEffect(() => {
    startTransport(readMatchStore());
    return () => stopTransport();
  }, [identity]);
}
