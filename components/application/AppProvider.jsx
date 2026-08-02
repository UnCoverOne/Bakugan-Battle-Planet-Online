"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createEmptyAccountSnapshot,
  createRegistrationSnapshot,
  DEFAULT_APP_SETTINGS,
  DEFAULT_BRAWLER_PROFILE,
  mergeSnapshots,
  normalizeSnapshot,
  selectSnapshot,
  toCloudSnapshot,
} from "../../lib/persistence";
import {
  buildChangedAccountSyncRequests,
  changedAccountEntityKeys,
  isAccountCacheDirty,
  readAccountCache,
  removeAccountCache,
  resolveEntityConflicts,
  retryDelayMs,
  writeAccountCache,
} from "../../lib/account-sync";
import { summarizeGuestData } from "../../lib/guest-data";
import { readJsonResponse } from "../../lib/json-response";
import { completedMatchKey } from "../../lib/match-result-navigation";

const STORAGE_EVENT = "bbp-storage-status";
const AUTO_SYNC_DELAY_MS = 500;
const DURABLE_DIRTY_DELAY_MS = 100;
const defaults = {
  profile: DEFAULT_BRAWLER_PROFILE,
  settings: DEFAULT_APP_SETTINGS,
};
const paths = { entry: "/", dashboard: "/", decks: "/decks", "deck-detail": "/decks", builder: "/builder/new", compendium: "/compendium", play: "/play", lobby: "/play/lobby", placement: "/play/match", match: "/play/match", result: "/play/result", history: "/profile/records", profile: "/profile", settings: "/settings", admin: "/admin" };

let storageReportTimer = null;
let pendingStorageDetail = null;

export function routeForPath(pathname) {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return "dashboard";
  if (first === "decks") return second ? "deck-detail" : "decks";
  if (first === "builder") return "builder";
  if (first === "compendium") return "compendium";
  if (first === "admin") return "admin";
  if (first === "history") return "history";
  if (["dashboard", "profile", "settings"].includes(first)) return first;
  if (first === "play") return second === "lobby" ? "lobby" : second === "match" ? "match" : second === "result" ? "result" : "play";
  return "dashboard";
}

function dispatchStorage(detail) {
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail }));
}

function reportStorage(detail) {
  if (detail.status === "error") {
    if (storageReportTimer) clearTimeout(storageReportTimer);
    pendingStorageDetail = null;
    dispatchStorage(detail);
    return;
  }
  pendingStorageDetail = detail;
  if (storageReportTimer) clearTimeout(storageReportTimer);
  storageReportTimer = setTimeout(() => {
    if (pendingStorageDetail) dispatchStorage(pendingStorageDetail);
    pendingStorageDetail = null;
    storageReportTimer = null;
  }, 250);
}

const LOCAL_SNAPSHOT_KEYS = {
  profile: "bbp-profile",
  decks: "bbp-decks-complete-set-v4",
  deletedDecks: "bbp-deleted-decks-v1",
  history: "bbp-history",
  settings: "bbp-settings",
  selectedDeckId: "bbp-selected-deck-v1",
  builderDeck: "bbp-builder-draft-v1",
  format: "bbp-match-format-v1",
  matchMode: "bbp-match-mode-v1",
  match: "bbp-active-match-v1",
  online: "bbp-active-match-online-v1",
  playerId: "bbp-player-id",
  updatedAt: "bbp-local-modified-at-v1",
};

function readGuestSnapshot(fallback) {
  try {
    const stored = {};
    for (const [field, key] of Object.entries(LOCAL_SNAPSHOT_KEYS)) {
      const value = localStorage.getItem(key);
      if (value !== null) stored[field] = JSON.parse(value);
    }
    return normalizeSnapshot({
      ...fallback,
      ...stored,
      profile: { ...(stored.profile ?? fallback.profile), signedIn: false },
    }, fallback);
  } catch {
    return fallback;
  }
}

function useStoredState(key, initial, options = {}) {
  const { storage = "local", debounceMs = 500, report = true, migrateFromLocal = false, writeEnabled = true } = options;
  const initialRef = useRef(initial);
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const lastSerialized = useRef(null);
  const blocked = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const store = storage === "session" ? sessionStorage : localStorage;
        let saved = store.getItem(key);
        if (saved === null && storage === "session" && migrateFromLocal) {
          saved = localStorage.getItem(key);
          if (saved !== null) {
            store.setItem(key, saved);
            localStorage.removeItem(key);
          }
        }
        if (saved !== null) {
          lastSerialized.current = saved;
          setValue(JSON.parse(saved));
        } else {
          lastSerialized.current = JSON.stringify(initialRef.current);
        }
      } catch (error) {
        blocked.current = true;
        reportStorage({ status: "error", message: error instanceof SyntaxError ? "Saved browser data is corrupted. It has not been overwritten." : "Browser storage is unavailable. Changes may be lost when this tab closes.", savedAt: null });
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, [key, migrateFromLocal, storage]);

  useEffect(() => {
    if (!ready || blocked.current || !writeEnabled) return;
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch {
      reportStorage({ status: "error", message: "The latest browser changes could not be prepared for storage.", savedAt: null });
      return;
    }
    if (serialized === lastSerialized.current) return;
    const id = setTimeout(() => {
      try {
        const store = storage === "session" ? sessionStorage : localStorage;
        store.setItem(key, serialized);
        lastSerialized.current = serialized;
        if (report) reportStorage({ status: "saved", message: "Saved on this device after changes settled.", savedAt: Date.now() });
      } catch {
        reportStorage({ status: "error", message: "The latest browser changes could not be saved.", savedAt: null });
      }
    }, debounceMs);
    return () => clearTimeout(id);
  }, [debounceMs, key, ready, report, storage, value, writeEnabled]);

  return [value, setValue, ready];
}

const Context = createContext(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error("useApp must be used inside AppProvider.");
  return value;
}

export function AppProvider({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = routeForPath(pathname);
  const [authUser, setAuthUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [persistenceScope, setPersistenceScope] = useState("checking");
  const [accountDataReady, setAccountDataReady] = useState(false);
  const writeLocal = persistenceScope === "local";
  const [profile, setProfile, profileReady] = useStoredState("bbp-profile", defaults.profile, { writeEnabled: writeLocal });
  const [decks, setStoredDecks, decksReady] = useStoredState("bbp-decks-complete-set-v4", [], { debounceMs: 750, writeEnabled: writeLocal });
  const [deletedDecks, setDeletedDecks, deletedDecksReady] = useStoredState("bbp-deleted-decks-v1", [], { debounceMs: 750, report: false, writeEnabled: writeLocal });
  const [history, setHistory, historyReady] = useStoredState("bbp-history", [], { debounceMs: 750, writeEnabled: writeLocal });
  const [settings, setSettings, settingsReady] = useStoredState("bbp-settings", defaults.settings, { writeEnabled: writeLocal });
  const [selectedDeckId, setSelectedDeckId, selectedDeckReady] = useStoredState("bbp-selected-deck-v1", "", { debounceMs: 300, writeEnabled: writeLocal });
  const [builderDeck, setBuilderDeck, builderReady] = useStoredState("bbp-builder-draft-v1", null, { debounceMs: 750, writeEnabled: writeLocal });
  const [deckQuery, setDeckQuery, deckQueryReady] = useStoredState("bbp-deck-query-v1", "", { storage: "session", debounceMs: 500, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [compendiumQuery, setCompendiumQuery, compendiumQueryReady] = useStoredState("bbp-compendium-query-v1", "", { storage: "session", debounceMs: 500, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [compendiumTab, setCompendiumTab, compendiumTabReady] = useStoredState("bbp-compendium-tab-v1", "cards", { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [format, setFormat, formatReady] = useStoredState("bbp-match-format-v1", "bo1", { debounceMs: 300, writeEnabled: writeLocal });
  const [matchMode, setMatchMode, matchModeReady] = useStoredState("bbp-match-mode-v1", "solo", { debounceMs: 300, writeEnabled: writeLocal });
  const [joinCode, setJoinCode, joinCodeReady] = useStoredState("bbp-join-code-v1", "", { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [match, setMatch, matchReady] = useStoredState("bbp-active-match-v1", null, { debounceMs: 300, report: false, writeEnabled: writeLocal });
  const [online, setOnline, onlineReady] = useStoredState("bbp-active-match-online-v1", false, { debounceMs: 300, report: false, writeEnabled: writeLocal });
  const [replay, setReplay, replayReady] = useStoredState("bbp-open-replay-v1", null, { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [replayIndex, setReplayIndex, replayIndexReady] = useStoredState("bbp-replay-index-v1", 0, { storage: "session", debounceMs: 250, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [playerId, setPlayerId, playerReady] = useStoredState("bbp-player-id", "player", { debounceMs: 300, report: false, writeEnabled: writeLocal });
  const [matchCapability, setMatchCapability, capabilityReady] = useStoredState("bbp-match-capability-v2", "", { storage: "session", debounceMs: 100, report: false, migrateFromLocal: true, writeEnabled: writeLocal });
  const [modifiedAt, setModifiedAt, modifiedReady] = useStoredState("bbp-local-modified-at-v1", 0, { debounceMs: 500, report: false, writeEnabled: writeLocal });
  const decksRef = useRef(decks);
  useEffect(() => { decksRef.current = decks; }, [decks]);
  const setDecks = useCallback((update) => {
    const current = decksRef.current;
    const next = typeof update === "function" ? update(current) : update;
    const nextIds = new Set(next.map((deck) => deck.id));
    const removed = current.filter((deck) => !nextIds.has(deck.id));
    decksRef.current = next;
    if (removed.length || next.length) {
      const deletedAt = new Date().toISOString();
      setDeletedDecks((items) => {
        const tombstones = new Map(items.map((item) => [item.id, item]));
        for (const deck of removed) tombstones.set(deck.id, { id: deck.id, deletedAt });
        for (const deck of next) tombstones.delete(deck.id);
        return [...tombstones.values()]
          .sort((left, right) => Date.parse(right.deletedAt) - Date.parse(left.deletedAt))
          .slice(0, 200);
      });
    }
    setStoredDecks(next);
  }, [setDeletedDecks, setStoredDecks]);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState("checking");
  const [storageHealth, setStorageHealth] = useState({ status: "checking", message: "Checking whether this browser can save data…", savedAt: null });
  const [matchError, setMatchError] = useState("");
  const [toast, setToast] = useState("");
  const [accountPrompt, setAccountPrompt] = useState(null);
  const [accountAccessMode, setAccountAccessMode] = useState(null);
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const snapshotRef = useRef(null);
  const booted = useRef(false);
  const mounted = useRef(false);
  const applying = useRef(false);
  const cloudLoaded = useRef(false);
  const accountRevisions = useRef({});
  const guestSnapshot = useRef(null);
  const syncing = useRef(false);
  const syncRequested = useRef(false);
  const syncRunner = useRef(null);
  const retryTimer = useRef(null);
  const retryAttempt = useRef(0);
  const localVersion = useRef(0);
  const acknowledgedVersion = useRef(0);
  const acknowledgedSnapshot = useRef(null);
  const pendingEntityKeys = useRef(null);
  const acknowledgedHistoryIds = useRef(null);
  const activeAccountId = useRef("");
  const durableFingerprint = useRef(null);
  const promptedAccountMoments = useRef(new Set());
  const ready = [profileReady, decksReady, deletedDecksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, replayReady, replayIndexReady, playerReady, capabilityReady, modifiedReady].every(Boolean);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];
  const notify = useCallback((message) => setToast(message), []);
  const promptAccount = useCallback((reason) => {
    if (!authUser) setAccountPrompt(reason);
  }, [authUser]);
  const dismissAccountPrompt = useCallback(() => setAccountPrompt(null), []);
  const requestAccountAccess = useCallback((mode) => {
    setAccountPrompt(null);
    setAccountAccessMode(mode);
  }, []);
  const closeAccountAccess = useCallback(() => setAccountAccessMode(null), []);

  const snapshot = useMemo(() => ({ schemaVersion: 1, updatedAt: modifiedAt, profile, decks, deletedDecks, history: history.slice(0, 200), settings, route, selectedDeckId, builderDeck, deckQuery, compendiumQuery, compendiumTab, format, matchMode, joinCode, match, online, selectedCore: "", logFilter: "all", replay, replayIndex, playerId }), [builderDeck, compendiumQuery, compendiumTab, deckQuery, decks, deletedDecks, format, history, joinCode, match, matchMode, modifiedAt, online, playerId, profile, replay, replayIndex, route, selectedDeckId, settings]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  const guestData = useMemo(
    () => summarizeGuestData({ profile, decks, history, settings, builderDeck, match }),
    [builderDeck, decks, history, match, profile, settings],
  );

  const durableStateFingerprint = useMemo(() => JSON.stringify({ profile, decks, deletedDecks, history, settings, selectedDeckId, builderDeck, format, matchMode }), [builderDeck, decks, deletedDecks, format, history, matchMode, profile, selectedDeckId, settings]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const eligibleDeckIds = new Set(
      decks
        .filter((deck) => deck.visibility === "Public")
        .map((deck) => deck.id),
    );
    setProfile((current) => {
      const selected = Array.isArray(current.showcaseDeckIds)
        ? current.showcaseDeckIds
        : [];
      const eligible = selected.filter((id) => eligibleDeckIds.has(id)).slice(0, 3);
      if (
        selected.length === eligible.length &&
        selected.every((id, index) => id === eligible[index])
      ) {
        return current;
      }
      return { ...current, showcaseDeckIds: eligible };
    });
  }, [decks, ready, setProfile]);

  useEffect(() => {
    const listener = (event) => setStorageHealth(event.detail);
    addEventListener(STORAGE_EVENT, listener);
    return () => removeEventListener(STORAGE_EVENT, listener);
  }, []);
  useEffect(() => {
    if (ready && writeLocal && storageHealth.status === "checking") setStorageHealth({ status: "ready", message: "Local storage is ready. Changes are saved after a short pause.", savedAt: null });
  }, [ready, storageHealth.status, writeLocal]);
  useEffect(() => {
    if (ready && playerId === "player") setPlayerId(crypto.randomUUID?.() ?? `player-${Date.now().toString(36)}`);
  }, [playerId, ready, setPlayerId]);
  useEffect(() => {
    if (!ready || !writeLocal) return;
    try {
      const serialized = JSON.stringify(route);
      if (localStorage.getItem("bbp-route-v1") !== serialized) localStorage.setItem("bbp-route-v1", serialized);
    } catch {}
  }, [ready, route, writeLocal]);
  useEffect(() => {
    if (!writeLocal) return;
    const listener = (event) => {
      if (event.storageArea !== localStorage) return;
      try {
        if (event.key === "bbp-active-match-v1") {
          const next = JSON.parse(event.newValue || "null");
          setMatch((current) => current?.id === next?.id && current?.version === next?.version ? current : next);
        }
        if (event.key === "bbp-active-match-online-v1") setOnline(JSON.parse(event.newValue || "false"));
      } catch {}
    };
    addEventListener("storage", listener);
    return () => removeEventListener("storage", listener);
  }, [setMatch, setOnline, writeLocal]);
  useEffect(() => {
    document.documentElement.dataset.contrast = settings.highContrast ? "high" : "normal";
    document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
  }, [settings.highContrast, settings.reducedMotion]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const refreshCatalogue = async () => {
      try {
        const response = await fetch("/api/card-overrides", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.overrides)) return;
        const data = await import("../../lib/data");
        data.applyCardOverrides(result.overrides);
        if (active) setCatalogueRevision((value) => value + 1);
      } catch {}
    };
    void refreshCatalogue();
    const listener = () => { void refreshCatalogue(); };
    addEventListener("bbp-card-overrides-updated", listener);
    return () => {
      active = false;
      removeEventListener("bbp-card-overrides-updated", listener);
    };
  }, [ready]);

  const applySnapshot = useCallback((incoming, signedIn = false) => {
    const fallback = snapshotRef.current;
    if (!fallback) return;
    const next = normalizeSnapshot(incoming, fallback);
    snapshotRef.current = next;
    applying.current = true;
    setProfile({ ...next.profile, signedIn: signedIn || next.profile.signedIn });
    decksRef.current = next.decks;
    setStoredDecks(next.decks); setDeletedDecks(next.deletedDecks ?? []); setHistory(next.history); setSettings(next.settings); setSelectedDeckId(next.selectedDeckId);
    setBuilderDeck(next.builderDeck); setDeckQuery(next.deckQuery); setCompendiumQuery(next.compendiumQuery); setCompendiumTab(next.compendiumTab);
    setFormat(next.format); setMatchMode(next.matchMode); setJoinCode(next.joinCode); setMatch(next.match); setOnline(next.online);
    setReplay(next.replay); setReplayIndex(next.replayIndex); setPlayerId(next.playerId); setModifiedAt(next.updatedAt);
    setTimeout(() => { applying.current = false; }, 120);
  }, [setBuilderDeck, setCompendiumQuery, setCompendiumTab, setDeckQuery, setDeletedDecks, setStoredDecks, setFormat, setHistory, setJoinCode, setMatch, setMatchMode, setModifiedAt, setOnline, setPlayerId, setProfile, setReplay, setReplayIndex, setSelectedDeckId, setSettings]);

  const persistAccountRecovery = useCallback((userId, data = snapshotRef.current) => {
    if (!userId || !data) return false;
    try {
      writeAccountCache(localStorage, {
        userId,
        snapshot: toCloudSnapshot(data),
        pendingEntityKeys: changedAccountEntityKeys(
          data,
          acknowledgedSnapshot.current,
        ),
        acknowledgedHistoryIds: (acknowledgedSnapshot.current?.history ?? []).map(
          (record) => record.id,
        ),
        revisions: accountRevisions.current,
        version: localVersion.current,
        acknowledgedVersion: acknowledgedVersion.current,
      });
      return true;
    } catch {
      reportStorage({
        status: "error",
        message: "Account recovery data could not be saved in this browser.",
        savedAt: null,
      });
      return false;
    }
  }, []);

  const leaveAccountLocally = useCallback((message = "", retainSession = false) => {
    const userId = activeAccountId.current || authUser?.id || "";
    persistAccountRecovery(userId);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (retainSession && userId) {
      try { localStorage.setItem("bbp-skipped-account-session-v1", userId); } catch {}
    }
    activeAccountId.current = "";
    cloudLoaded.current = false;
    setAccountDataReady(false);
    setPersistenceScope("local");
    setAuthUser(null);
    if (guestSnapshot.current) applySnapshot(readGuestSnapshot(guestSnapshot.current), false);
    setSyncStatus("local");
    setAuthError("");
    if (message) notify(message);
    router.push("/");
  }, [applySnapshot, authUser?.id, notify, persistAccountRecovery, router]);

  const putCloud = useCallback(async (data, baseline) => {
    let latest = { revisions: accountRevisions.current, data: null, errors: [] };
    for (const batch of buildChangedAccountSyncRequests(
      data,
      baseline,
      accountRevisions.current,
      750_000,
      pendingEntityKeys.current,
      acknowledgedHistoryIds.current,
    )) {
      const response = await fetch("/api/user-data", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
      });
      const result = await readJsonResponse(response, "Cloud save returned an invalid response.");
      if (response.status === 401) {
        const error = new Error("Your account session expired. Unsynced changes remain saved in this browser.");
        error.code = "SESSION_EXPIRED";
        throw error;
      }
      if (response.status === 409 && result.data) {
        return { ...result, conflict: true };
      }
      if (!response.ok) {
        const error = new Error(result.error ?? "Could not save cloud data.");
        error.retryAfter = Number(result.retryAfter) || 0;
        throw error;
      }
      latest = {
        ...result,
        errors: [...latest.errors, ...(Array.isArray(result.errors) ? result.errors : [])],
      };
      accountRevisions.current = result.revisions ?? accountRevisions.current;
    }
    return { ...latest, conflict: false };
  }, []);

  const loadCloud = useCallback(async (strategy = "cloud", user) => {
    if (!user) throw new Error("Sign in is required.");
    activeAccountId.current = user.id;
    cloudLoaded.current = false;
    setSyncStatus("loading");
    const device = snapshotRef.current;
    if (!device) throw new Error("Browser data is still loading.");
    const cached = readAccountCache(localStorage, user.id, device);
    if (cached) {
      accountRevisions.current = cached.revisions;
      localVersion.current = cached.version;
      acknowledgedVersion.current = cached.acknowledgedVersion;
      const cachedCopy = {
        ...selectSnapshot(device, cached.snapshot, "cloud"),
        profile: { ...cached.snapshot.profile, signedIn: true },
      };
      applySnapshot(cachedCopy, true);
      cloudLoaded.current = true;
      setAccountDataReady(true);
    }
    let result = null;
    let loadError = null;
    try {
      const response = await fetch("/api/user-data", {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      result = await readJsonResponse(response, "Cloud data returned an invalid response.");
      if (response.status === 401) {
        const error = new Error("Your account session expired. Unsynced changes remain saved in this browser.");
        error.code = "SESSION_EXPIRED";
        throw error;
      }
      if (!response.ok) throw new Error(result.error ?? "Could not load cloud data.");
    } catch (error) {
      if (error?.code === "SESSION_EXPIRED") {
        leaveAccountLocally(error.message);
        return null;
      }
      loadError = error;
    }
    const emptyAccount = createEmptyAccountSnapshot(device, user, result?.updatedAt || Date.now());
    const remote = result?.data ? normalizeSnapshot(result.data, emptyAccount) : null;
    const cachedDirty = isAccountCacheDirty(cached);
    accountRevisions.current = cachedDirty
      ? cached?.revisions ?? {}
      : result?.revisions ?? cached?.revisions ?? {};
    localVersion.current = cached?.version ?? 0;
    acknowledgedVersion.current = cached?.acknowledgedVersion ?? 0;
    const durableAccount = cached && cachedDirty
      ? cached.snapshot
      : remote ?? cached?.snapshot ?? emptyAccount;
    acknowledgedSnapshot.current = remote
      ?? (!cachedDirty ? cached?.snapshot ?? null : null);
    pendingEntityKeys.current = cachedDirty
      ? cached?.pendingEntityKeys ?? null
      : null;
    acknowledgedHistoryIds.current = cachedDirty
      ? cached?.acknowledgedHistoryIds ?? null
      : null;
    const restored = strategy === "merge" && remote
      ? selectSnapshot(device, mergeSnapshots(durableAccount, remote), "cloud")
      : selectSnapshot(device, durableAccount, "cloud");
    const accountCopy = { ...restored, profile: { ...restored.profile, signedIn: true } };
    applySnapshot(accountCopy, true);
    if (!remote && !cached) {
      localVersion.current = 1;
      acknowledgedVersion.current = 0;
    }
    cloudLoaded.current = true;
    setAccountDataReady(true);
    persistAccountRecovery(user.id, accountCopy);
    if (loadError) {
      setAuthError(loadError instanceof Error ? loadError.message : "Cloud data could not be loaded.");
      setSyncStatus(navigator.onLine ? "error" : "offline");
    } else if (localVersion.current > acknowledgedVersion.current || !remote) {
      setSyncStatus(navigator.onLine ? "saving" : "offline");
      syncRequested.current = true;
      queueMicrotask(() => { void syncRunner.current?.(); });
    } else {
      setAuthError("");
      setSyncStatus("synced");
    }
    return accountCopy;
  }, [applySnapshot, leaveAccountLocally, persistAccountRecovery]);

  const syncToCloud = useCallback(async (force = false) => {
    if (!authUser || !accountDataReady || !ready || applying.current || !cloudLoaded.current) return false;
    if (force) syncRequested.current = true;
    if (syncing.current) {
      syncRequested.current = true;
      return false;
    }
    if (!force && localVersion.current <= acknowledgedVersion.current) return true;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return false;
    }
    syncing.current = true;
    try {
      do {
        syncRequested.current = false;
        const current = snapshotRef.current;
        if (!current) return false;
        const targetVersion = localVersion.current;
        persistAccountRecovery(authUser.id, current);
        setSyncStatus("saving");
        const saved = await putCloud(current, acknowledgedSnapshot.current);
        accountRevisions.current = saved.revisions ?? accountRevisions.current;
        if (saved.conflict && saved.data) {
          const remote = {
            ...normalizeSnapshot(saved.data, current),
            updatedAt: Number(saved.updatedAt) || saved.data.updatedAt || 0,
          };
          const latestLocal = snapshotRef.current ?? current;
          const localWins = [
            ...(Array.isArray(saved.conflicts) ? saved.conflicts : []),
            ...(pendingEntityKeys.current ?? []),
            ...changedAccountEntityKeys(latestLocal, current),
          ];
          acknowledgedSnapshot.current = remote;
          pendingEntityKeys.current = null;
          acknowledgedHistoryIds.current = null;
          const reconciled = resolveEntityConflicts(
            latestLocal,
            remote,
            [...new Set(localWins)],
          );
          const resolved = {
            ...reconciled,
            profile: { ...reconciled.profile, signedIn: true },
          };
          applySnapshot(resolved, true);
          syncRequested.current = true;
          persistAccountRecovery(authUser.id, resolved);
          continue;
        }
        if (Array.isArray(saved.errors) && saved.errors.length) {
          throw new Error(saved.errors.map((item) => item.error).join(" "));
        }
        if (saved.data) {
          const remote = {
            ...normalizeSnapshot(saved.data, current),
            updatedAt: Number(saved.updatedAt) || saved.data.updatedAt || 0,
          };
          const latestLocal = snapshotRef.current ?? current;
          const localWins = changedAccountEntityKeys(latestLocal, current);
          acknowledgedSnapshot.current = remote;
          pendingEntityKeys.current = null;
          acknowledgedHistoryIds.current = null;
          const reconciled = resolveEntityConflicts(
            latestLocal,
            remote,
            localWins,
          );
          applySnapshot(
            { ...reconciled, profile: { ...reconciled.profile, signedIn: true } },
            true,
          );
        } else {
          acknowledgedSnapshot.current = toCloudSnapshot(current);
        }
        acknowledgedVersion.current = Math.max(acknowledgedVersion.current, targetVersion);
        retryAttempt.current = 0;
        setAuthError("");
        persistAccountRecovery(authUser.id, snapshotRef.current ?? current);
      } while (
        syncRequested.current ||
        localVersion.current > acknowledgedVersion.current
      );
      setSyncStatus("synced");
      return true;
    } catch (error) {
      if (error?.code === "SESSION_EXPIRED") {
        leaveAccountLocally(error.message);
        return false;
      }
      const message = error instanceof Error ? error.message : "Could not save cloud data.";
      setAuthError(message);
      setSyncStatus(navigator.onLine ? "error" : "offline");
      const delay = retryDelayMs(retryAttempt.current++, Number(error?.retryAfter) || 0);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        void syncRunner.current?.();
      }, delay);
      return false;
    } finally {
      syncing.current = false;
      if (syncRequested.current && navigator.onLine) {
        queueMicrotask(() => { void syncRunner.current?.(); });
      }
    }
  }, [accountDataReady, applySnapshot, authUser, leaveAccountLocally, persistAccountRecovery, putCloud, ready]);
  useEffect(() => {
    syncRunner.current = syncToCloud;
  }, [syncToCloud]);

  useEffect(() => {
    if (!ready || booted.current) return;
    booted.current = true;
    (async () => {
      try {
        const response = await fetch("/api/auth", {
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        });
        const result = await readJsonResponse(response, "Account session returned an invalid response.");
        if (mounted.current && response.ok && result.user) {
          let skippedSession = "";
          try { skippedSession = localStorage.getItem("bbp-skipped-account-session-v1") || ""; } catch {}
          if (skippedSession === result.user.id) {
            try {
              const logoutResponse = await fetch("/api/auth", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action: "logout" }),
              });
              if (logoutResponse.ok) localStorage.removeItem("bbp-skipped-account-session-v1");
            } catch {}
            setProfile((current) => ({ ...current, signedIn: false }));
            setPersistenceScope("local");
            setSyncStatus("local");
            return;
          }
          guestSnapshot.current = snapshotRef.current
            ? { ...snapshotRef.current, profile: { ...snapshotRef.current.profile, signedIn: false } }
            : null;
          setPersistenceScope("cloud");
          setAuthUser(result.user);
          await loadCloud("cloud", result.user);
        } else if (mounted.current) {
          setProfile((current) => ({ ...current, signedIn: false }));
          setPersistenceScope("local");
          setSyncStatus("local");
        }
      } catch {
        if (mounted.current) {
          setProfile((current) => ({ ...current, signedIn: false }));
          setPersistenceScope("local");
          setSyncStatus("local");
        }
      }
      finally { if (mounted.current) setAuthChecking(false); }
    })();
  }, [loadCloud, ready, setProfile]);

  useEffect(() => {
    if (!ready) return;
    if (durableFingerprint.current === null || applying.current) {
      durableFingerprint.current = durableStateFingerprint;
      return;
    }
    if (durableFingerprint.current === durableStateFingerprint) return;
    durableFingerprint.current = durableStateFingerprint;
    const id = setTimeout(() => setModifiedAt(Date.now()), DURABLE_DIRTY_DELAY_MS);
    return () => clearTimeout(id);
  }, [durableStateFingerprint, ready, setModifiedAt]);
  useEffect(() => {
    if (!authUser || !accountDataReady || !ready || !cloudLoaded.current || applying.current) return;
    const current = snapshotRef.current;
    if (!current) return;
    const dirtySnapshot = { ...current, updatedAt: Date.now() };
    snapshotRef.current = dirtySnapshot;
    setModifiedAt(dirtySnapshot.updatedAt);
    localVersion.current += 1;
    syncRequested.current = true;
    persistAccountRecovery(authUser.id, dirtySnapshot);
    const id = setTimeout(() => { void syncToCloud(false); }, AUTO_SYNC_DELAY_MS);
    return () => clearTimeout(id);
  }, [accountDataReady, authUser, durableStateFingerprint, persistAccountRecovery, ready, setModifiedAt, syncToCloud]);

  useEffect(() => {
    if (!authUser) return;
    const resume = () => {
      if (navigator.onLine && (document.visibilityState === "visible" || document.visibilityState === undefined)) {
        void syncRunner.current?.();
      }
    };
    const preserve = () => { persistAccountRecovery(authUser.id); };
    addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    addEventListener("pagehide", preserve);
    return () => {
      removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      removeEventListener("pagehide", preserve);
    };
  }, [authUser, persistAccountRecovery]);

  const authenticate = useCallback(async (action, payload) => {
    setAuthBusy(true);
    setAuthError("");
    let sessionEstablished = false;
    try {
      const identity = {
        displayName: payload.displayName?.trim().replace(/\s+/g, " ") || defaults.profile.name,
        faction: payload.faction || defaults.profile.faction,
      };
      const registrationData = action === "signup" && snapshotRef.current
        ? createRegistrationSnapshot(snapshotRef.current, identity, Boolean(payload.importLocalData))
        : null;
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          ...payload,
          syncStrategy: undefined,
          importLocalData: undefined,
          ...(registrationData ? { initialData: registrationData } : {}),
        }),
      });
      const result = await readJsonResponse(response, "Account request returned an invalid response.");
      if (!response.ok || !result.user) throw new Error(result.error ?? "Account request failed.");
      sessionEstablished = true;
      guestSnapshot.current = snapshotRef.current
        ? { ...snapshotRef.current, profile: { ...snapshotRef.current.profile, signedIn: false } }
        : null;
      setPersistenceScope("cloud");
      setAuthUser(result.user);
      await loadCloud("cloud", result.user);
      const returnTo =
        typeof payload.returnTo === "string" &&
        payload.returnTo.startsWith("/") &&
        !payload.returnTo.startsWith("//")
          ? payload.returnTo
          : pathname || "/";
      setAccountPrompt(null);
      setAccountAccessMode(null);
      router.replace(returnTo);
      return { ok: true, user: result.user };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account request failed.";
      setAuthError(message);
      setSyncStatus(sessionEstablished ? (navigator.onLine ? "error" : "offline") : "local");
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  }, [loadCloud, pathname, router]);
  const continueAsGuest = useCallback(() => {
    setProfile((current) => ({ ...current, signedIn: false }));
    setSyncStatus("local");
    router.push("/");
  }, [router, setProfile]);
  const signOutAccount = useCallback(async ({ retainUnsynced = false } = {}) => {
    const dirty = localVersion.current > acknowledgedVersion.current;
    if (dirty && !retainUnsynced) {
      await syncToCloud(true);
      if (localVersion.current > acknowledgedVersion.current) {
        persistAccountRecovery(authUser?.id || activeAccountId.current);
        notify("Unsynced account changes are safe in this browser. Confirm recovery logout to continue.");
        return false;
      }
    }
    let serverEnded = false;
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      serverEnded = response.ok || response.status === 401;
      if (!serverEnded) throw new Error("Could not end the account session.");
    } catch (error) {
      if (!retainUnsynced) {
        notify("The server could not end the session. Confirm recovery logout to leave this device safely.");
        return false;
      }
    }
    if (serverEnded) {
      try { localStorage.removeItem("bbp-skipped-account-session-v1"); } catch {}
    }
    leaveAccountLocally(
      retainUnsynced && dirty
        ? "Logged out. Unsynced account recovery data remains on this device."
        : "",
      retainUnsynced && !serverEnded,
    );
    return true;
  }, [authUser?.id, leaveAccountLocally, notify, persistAccountRecovery, syncToCloud]);
  const saveAccountProfile = useCallback(async () => { if (!authUser) return notify("Profile changes are saved on this device."); const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-profile", displayName: profile.name, faction: profile.faction }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not update account profile."); setAuthUser(result.user); setModifiedAt(Date.now()); }, [authUser, notify, profile.faction, profile.name, setModifiedAt]);
  const changePassword = useCallback(async (currentPassword, newPassword) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-password", currentPassword, newPassword }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not change password."); notify("Password changed. Other sessions were signed out."); }, [notify]);
  const deleteAccount = useCallback(async (confirmation) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete-account", confirmation }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not delete account."); if (authUser?.id) { try { removeAccountCache(localStorage, authUser.id); } catch {} } activeAccountId.current = ""; cloudLoaded.current = false; setAccountDataReady(false); setPersistenceScope("local"); setAuthUser(null); if (guestSnapshot.current) applySnapshot(readGuestSnapshot(guestSnapshot.current), false); setSyncStatus("local"); router.push("/"); }, [applySnapshot, authUser?.id, router]);

  useEffect(() => {
    const id = completedMatchKey(match);
    if (!id) return;
    if (!history.some((item) => item.id === id)) {
      const record = { id, result: match.winner === playerId ? "Victor" : "Defeat", opponent: match.players.find((player) => player.id !== playerId)?.name ?? "Opponent", score: Object.values(match.series).join("–"), reason: match.resultReason, at: new Date().toISOString(), startedAt: new Date(match.log[0]?.at ?? Date.now()).toISOString(), format: match.format, mode: online ? "online" : "training", schemaVersion: 1, log: match.log };
      setHistory((items) => [record, ...items]); setReplay(record); setReplayIndex(Math.max(0, record.log.length - 1));
    }
    const promptKey = `match:${match.id}:${match.gameNumber}`;
    if (!authUser && !promptedAccountMoments.current.has(promptKey)) {
      promptedAccountMoments.current.add(promptKey);
      setAccountPrompt("match-complete");
    }
  }, [authUser, history, match, online, playerId, setHistory, setReplay, setReplayIndex]);

  const api = useCallback(async (action, payload, code, selection) => {
    setMatchError("");
    const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json", ...(matchCapability ? { "x-match-capability": matchCapability } : {}) }, body: JSON.stringify({ action, code: action === "create" ? undefined : code ?? match?.code, playerId, expectedVersion: match?.version, format, selection, payload }) });
    const result = await response.json();
    if (!response.ok) { if (result.state) setMatch(result.state); throw new Error(result.error ?? "Match request failed."); }
    if (result.capability) setMatchCapability(result.capability);
    if (result.state) setMatch(result.state);
    return result.state;
  }, [format, match, matchCapability, playerId, setMatch, setMatchCapability]);
  const selection = useCallback((deck) => ({ playerId, name: profile.name, deck: { name: deck.name, bakuganIds: [...deck.bakuganIds], coreIds: [...deck.coreIds], cardIds: [...deck.cardIds], format: deck.format } }), [playerId, profile.name]);
  const startSolo = useCallback(async () => { if (!selectedDeck) { router.push("/decks"); return { ok: false, error: "Select a deck before starting a match." }; } setMatchError(""); try { const [{ createMatch, setReady }, data] = await Promise.all([import("../../lib/game"), import("../../lib/data")]); if (!data.deckIsLegal(selectedDeck)) throw new Error("Select a legal deck first."); let aiDeck = data.STARTER_DECKS[1]; try { const response = await fetch("/api/ai-decks", { cache: "no-store" }); const result = await response.json(); if (response.ok && result.deck && data.deckIsLegal(result.deck)) aiDeck = result.deck; } catch {} const code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(); const state = createMatch(code, format, [data.makePlayer(playerId, profile.name, selectedDeck), data.makePlayer("training-bot", "Mira Nova • Training AI", aiDeck)]); setOnline(false); setMatch(setReady(setReady(state, playerId), "training-bot")); router.push("/play/match"); return { ok: true }; } catch (error) { const message = error instanceof Error ? error.message : "Training match could not be started."; setMatchError(message); return { ok: false, error: message }; } }, [format, playerId, profile.name, router, selectedDeck, setMatch, setOnline]);
  const createOnline = useCallback(async () => { if (!selectedDeck) { router.push("/decks"); return { ok: false, error: "Select a deck before creating a room." }; } try { setMatchCapability(""); const state = await api("create", undefined, undefined, selection(selectedDeck)); setOnline(true); setMatch(state); router.push("/play/lobby"); return { ok: true }; } catch (error) { const message = error instanceof Error ? error.message : "The private room could not be created."; setMatchError(message); return { ok: false, error: message }; } }, [api, router, selectedDeck, selection, setMatch, setMatchCapability, setOnline]);
  const joinOnline = useCallback(async () => { if (!selectedDeck) { router.push("/decks"); return { ok: false, error: "Select a deck before joining a room." }; } try { const state = await api("join", undefined, joinCode.toUpperCase(), selection(selectedDeck)); setOnline(true); setMatch(state); router.push("/play/lobby"); return { ok: true }; } catch (error) { const message = error instanceof Error ? error.message : "The private room could not be joined."; setMatchError(message); return { ok: false, error: message }; } }, [api, joinCode, router, selectedDeck, selection, setMatch, setOnline]);
  const readyMatch = useCallback(async () => { if (!match) return; try { if (online) await api("ready"); else { const { setReady } = await import("../../lib/game"); setMatch(setReady(match, playerId)); } } catch (error) { setMatchError(error.message); } }, [api, match, online, playerId, setMatch]);
  const nextSeriesGame = useCallback(async () => { if (!match) return; try { if (online) await api("next-game"); else { const { startNextSeriesGame } = await import("../../lib/game"); setMatch(startNextSeriesGame(match)); } router.push("/play/match"); } catch (error) { setMatchError(error.message); } }, [api, match, online, router, setMatch]);
  const leaveMatch = useCallback(() => { setMatch(null); setOnline(false); setMatchCapability(""); router.push("/dashboard"); }, [router, setMatch, setMatchCapability, setOnline]);
  const syncNow = useCallback(() => syncToCloud(true), [syncToCloud]);
  const retryCloudLoad = useCallback(async () => {
    if (!authUser) return false;
    setAuthError("");
    try {
      await loadCloud("cloud", authUser);
      return true;
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not load cloud data.");
      setSyncStatus(navigator.onLine ? "error" : "offline");
      return false;
    }
  }, [authUser, loadCloud]);

  const value = useMemo(() => ({ ready, route, profile, setProfile, decks, setDecks, history, setHistory, settings, setSettings, selectedDeckId, setSelectedDeckId, selectedDeck, builderDeck, setBuilderDeck, deckQuery, setDeckQuery, compendiumQuery, setCompendiumQuery, compendiumTab, setCompendiumTab, format, setFormat, matchMode, setMatchMode, joinCode, setJoinCode, match, setMatch, online, setOnline, replay, setReplay, replayIndex, setReplayIndex, playerId, matchError, toast, notify, authUser, authChecking, accountDataReady, authBusy, authError, syncStatus, syncConflict: null, storageHealth, guestData, accountPrompt, promptAccount, dismissAccountPrompt, accountAccessMode, requestAccountAccess, closeAccountAccess, authenticate, continueAsGuest, signOutAccount, saveAccountProfile, changePassword, deleteAccount, syncNow, retryCloudLoad, startSolo, createOnline, joinOnline, readyMatch, nextSeriesGame, leaveMatch, catalogueRevision }), [accountAccessMode, accountDataReady, accountPrompt, authBusy, authChecking, authError, authUser, authenticate, builderDeck, catalogueRevision, changePassword, compendiumQuery, closeAccountAccess, compendiumTab, continueAsGuest, createOnline, dismissAccountPrompt, deckQuery, decks, deleteAccount, format, history, joinCode, guestData, joinOnline, leaveMatch, match, matchError, matchMode, nextSeriesGame, notify, online, promptAccount, playerId, requestAccountAccess, profile, ready, readyMatch, replay, replayIndex, retryCloudLoad, route, saveAccountProfile, selectedDeck, selectedDeckId, settings, signOutAccount, startSolo, storageHealth, syncNow, syncStatus, toast]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
