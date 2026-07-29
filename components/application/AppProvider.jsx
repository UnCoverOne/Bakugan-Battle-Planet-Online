"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { normalizeSnapshot, selectSnapshot, toCloudSnapshot } from "../../lib/persistence";
import { summarizeGuestData } from "../../lib/guest-data";

const STORAGE_EVENT = "bbp-storage-status";
const AUTO_SYNC_DELAY_MS = 8_000;
const DURABLE_DIRTY_DELAY_MS = 750;
const defaults = {
  profile: {
    name: "DanBrawler",
    faction: "Pyrus",
    signedIn: false,
    avatar: "",
    titleId: "battle-planet-brawler",
    coverId: "battle-planet",
    showcaseAchievementIds: [],
    showcaseDeckIds: [],
  },
  settings: { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone", replayLinks: true },
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

function useStoredState(key, initial, options = {}) {
  const { storage = "local", debounceMs = 500, report = true, migrateFromLocal = false } = options;
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
    if (!ready || blocked.current) return;
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
  }, [debounceMs, key, ready, report, storage, value]);

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
  const [profile, setProfile, profileReady] = useStoredState("bbp-profile", defaults.profile);
  const [decks, setDecks, decksReady] = useStoredState("bbp-decks-complete-set-v4", [], { debounceMs: 750 });
  const [history, setHistory, historyReady] = useStoredState("bbp-history", [], { debounceMs: 750 });
  const [settings, setSettings, settingsReady] = useStoredState("bbp-settings", defaults.settings);
  const [selectedDeckId, setSelectedDeckId, selectedDeckReady] = useStoredState("bbp-selected-deck-v1", "", { debounceMs: 300 });
  const [builderDeck, setBuilderDeck, builderReady] = useStoredState("bbp-builder-draft-v1", null, { debounceMs: 750 });
  const [deckQuery, setDeckQuery, deckQueryReady] = useStoredState("bbp-deck-query-v1", "", { storage: "session", debounceMs: 500, report: false, migrateFromLocal: true });
  const [compendiumQuery, setCompendiumQuery, compendiumQueryReady] = useStoredState("bbp-compendium-query-v1", "", { storage: "session", debounceMs: 500, report: false, migrateFromLocal: true });
  const [compendiumTab, setCompendiumTab, compendiumTabReady] = useStoredState("bbp-compendium-tab-v1", "cards", { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true });
  const [format, setFormat, formatReady] = useStoredState("bbp-match-format-v1", "bo1", { debounceMs: 300 });
  const [matchMode, setMatchMode, matchModeReady] = useStoredState("bbp-match-mode-v1", "solo", { debounceMs: 300 });
  const [joinCode, setJoinCode, joinCodeReady] = useStoredState("bbp-join-code-v1", "", { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true });
  const [match, setMatch, matchReady] = useStoredState("bbp-active-match-v1", null, { debounceMs: 300, report: false });
  const [online, setOnline, onlineReady] = useStoredState("bbp-active-match-online-v1", false, { debounceMs: 300, report: false });
  const [replay, setReplay, replayReady] = useStoredState("bbp-open-replay-v1", null, { storage: "session", debounceMs: 300, report: false, migrateFromLocal: true });
  const [replayIndex, setReplayIndex, replayIndexReady] = useStoredState("bbp-replay-index-v1", 0, { storage: "session", debounceMs: 250, report: false, migrateFromLocal: true });
  const [playerId, setPlayerId, playerReady] = useStoredState("bbp-player-id", "player", { debounceMs: 300, report: false });
  const [matchCapability, setMatchCapability, capabilityReady] = useStoredState("bbp-match-capability-v2", "", { storage: "session", debounceMs: 100, report: false, migrateFromLocal: true });
  const [modifiedAt, setModifiedAt, modifiedReady] = useStoredState("bbp-local-modified-at-v1", 0, { debounceMs: 500, report: false });
  const [authUser, setAuthUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState("checking");
  const [syncConflict, setSyncConflict] = useState(null);
  const [storageHealth, setStorageHealth] = useState({ status: "checking", message: "Checking whether this browser can save data…", savedAt: null });
  const [matchError, setMatchError] = useState("");
  const [toast, setToast] = useState("");
  const [accountPrompt, setAccountPrompt] = useState(null);
  const [accountAccessMode, setAccountAccessMode] = useState(null);
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const snapshotRef = useRef(null);
  const booted = useRef(false);
  const applying = useRef(false);
  const cloudLoaded = useRef(false);
  const cloudRevision = useRef(0);
  const syncing = useRef(false);
  const lastSynced = useRef(-1);
  const durableFingerprint = useRef(null);
  const promptedAccountMoments = useRef(new Set());
  const ready = [profileReady, decksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, replayReady, replayIndexReady, playerReady, capabilityReady, modifiedReady].every(Boolean);
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

  const snapshot = useMemo(() => ({ schemaVersion: 1, updatedAt: modifiedAt, profile, decks, history: history.slice(0, 200), settings, route, selectedDeckId, builderDeck, deckQuery, compendiumQuery, compendiumTab, format, matchMode, joinCode, match, online, selectedCore: "", logFilter: "all", replay, replayIndex, playerId }), [builderDeck, compendiumQuery, compendiumTab, deckQuery, decks, format, history, joinCode, match, matchMode, modifiedAt, online, playerId, profile, replay, replayIndex, route, selectedDeckId, settings]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  const guestData = useMemo(
    () => summarizeGuestData({ profile, decks, history, settings, builderDeck, match }),
    [builderDeck, decks, history, match, profile, settings],
  );

  const durableStateFingerprint = useMemo(() => JSON.stringify({ profile, decks, history, settings, selectedDeckId, builderDeck, format, matchMode }), [builderDeck, decks, format, history, matchMode, profile, selectedDeckId, settings]);

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
    if (ready && storageHealth.status === "checking") setStorageHealth({ status: "ready", message: "Local storage is ready. Changes are saved after a short pause.", savedAt: null });
  }, [ready, storageHealth.status]);
  useEffect(() => {
    if (ready && playerId === "player") setPlayerId(crypto.randomUUID?.() ?? `player-${Date.now().toString(36)}`);
  }, [playerId, ready, setPlayerId]);
  useEffect(() => {
    if (!ready) return;
    try {
      const serialized = JSON.stringify(route);
      if (localStorage.getItem("bbp-route-v1") !== serialized) localStorage.setItem("bbp-route-v1", serialized);
    } catch {}
  }, [ready, route]);
  useEffect(() => {
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
  }, [setMatch, setOnline]);
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
    applying.current = true;
    setProfile({ ...next.profile, signedIn: signedIn || next.profile.signedIn });
    setDecks(next.decks); setHistory(next.history); setSettings(next.settings); setSelectedDeckId(next.selectedDeckId);
    setBuilderDeck(next.builderDeck); setDeckQuery(next.deckQuery); setCompendiumQuery(next.compendiumQuery); setCompendiumTab(next.compendiumTab);
    setFormat(next.format); setMatchMode(next.matchMode); setJoinCode(next.joinCode); setMatch(next.match); setOnline(next.online);
    setReplay(next.replay); setReplayIndex(next.replayIndex); setPlayerId(next.playerId); setModifiedAt(next.updatedAt);
    setTimeout(() => { applying.current = false; }, 120);
  }, [setBuilderDeck, setCompendiumQuery, setCompendiumTab, setDeckQuery, setDecks, setFormat, setHistory, setJoinCode, setMatch, setMatchMode, setModifiedAt, setOnline, setPlayerId, setProfile, setReplay, setReplayIndex, setSelectedDeckId, setSettings]);

  const putCloud = useCallback(async (data, revision, allowConflictChoice = true) => {
    const response = await fetch("/api/user-data", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedRevision: revision, data: toCloudSnapshot(data) }),
    });
    const result = await response.json();
    if (response.status === 409 && result.data) {
      const remote = normalizeSnapshot(result.data, data);
      const pending = { local: data, cloud: remote, revision: result.revision ?? revision };
      cloudRevision.current = pending.revision;
      if (!allowConflictChoice) throw new Error("Cloud data changed again. Review both copies before retrying.");
      setSyncConflict(pending);
      setSyncStatus("conflict");
      return { snapshot: data, conflict: true, pending: true };
    }
    if (!response.ok) throw new Error(result.error ?? "Could not save cloud data.");
    cloudRevision.current = result.revision ?? revision + 1;
    return { snapshot: data, conflict: false, pending: false };
  }, []);

  const loadCloud = useCallback(async (strategy = "merge") => {
    cloudLoaded.current = false;
    setSyncStatus("loading");
    const response = await fetch("/api/user-data", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load cloud data.");
    cloudRevision.current = result.revision ?? 0;
    const local = snapshotRef.current;
    if (!local) throw new Error("Local data is still loading.");
    const remote = result.data ? normalizeSnapshot(result.data, local) : null;
    const restored = remote ? selectSnapshot(local, remote, strategy) : { ...local, updatedAt: Math.max(local.updatedAt, Date.now()) };
    const accountCopy = { ...restored, profile: { ...restored.profile, signedIn: true } };
    applySnapshot(accountCopy, true);
    const localCloudCopy = JSON.stringify(toCloudSnapshot(accountCopy));
    const remoteCloudCopy = remote ? JSON.stringify(toCloudSnapshot(remote)) : null;
    let syncedCopy = accountCopy;
    if (!remote || localCloudCopy !== remoteCloudCopy) {
      const saved = await putCloud(accountCopy, cloudRevision.current);
      if (saved.pending) {
        cloudLoaded.current = true;
        return accountCopy;
      }
      syncedCopy = saved.snapshot;
    }
    lastSynced.current = syncedCopy.updatedAt;
    cloudLoaded.current = true;
    setAuthError("");
    setSyncStatus("synced");
    return syncedCopy;
  }, [applySnapshot, putCloud]);

  const syncToCloud = useCallback(async (force = false) => {
    if (!authUser || !ready || applying.current || !cloudLoaded.current || syncing.current || syncConflict) return false;
    const current = snapshotRef.current;
    if (!current || (!force && current.updatedAt === lastSynced.current)) return false;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      return false;
    }
    syncing.current = true;
    setSyncStatus("saving");
    try {
      const saved = await putCloud(current, cloudRevision.current);
      if (saved.pending) return false;
      lastSynced.current = saved.snapshot.updatedAt;
      setAuthError("");
      setSyncStatus("synced");
      return true;
    } catch (error) {
      setAuthError(error.message);
      setSyncStatus(navigator.onLine ? "error" : "offline");
      return false;
    } finally {
      syncing.current = false;
    }
  }, [authUser, putCloud, ready, syncConflict]);

  useEffect(() => {
    if (!ready || booted.current) return;
    booted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth", { cache: "no-store" });
        const result = await response.json();
        if (!cancelled && response.ok && result.user) {
          setAuthUser(result.user); setProfile((current) => ({ ...current, signedIn: true }));
          try { await loadCloud("merge"); } catch (error) { setAuthError(error.message); setSyncStatus(navigator.onLine ? "error" : "offline"); }
        } else if (!cancelled) setSyncStatus("local");
      } catch { if (!cancelled) setSyncStatus(profile.signedIn ? "offline" : "local"); }
      finally { if (!cancelled) setAuthChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [loadCloud, profile.signedIn, ready, setProfile]);

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
    if (!authUser || !ready || !cloudLoaded.current || modifiedAt === lastSynced.current || syncConflict) return;
    const id = setTimeout(() => { void syncToCloud(false); }, AUTO_SYNC_DELAY_MS);
    return () => clearTimeout(id);
  }, [authUser, modifiedAt, ready, syncConflict, syncToCloud]);

  const authenticate = useCallback(async (action, payload) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await response.json();
      if (!response.ok || !result.user) throw new Error(result.error ?? "Account request failed.");
      setAuthUser(result.user);
      setProfile((current) => ({
        ...current,
        name: action === "signup" ? payload.displayName || current.name : current.name,
        faction: action === "signup" ? payload.faction || current.faction : current.faction,
        signedIn: true,
      }));
      await loadCloud(action === "signup" ? "local" : payload.syncStrategy ?? "merge");
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
      setSyncStatus("local");
      return { ok: false, error: message };
    } finally {
      setAuthBusy(false);
    }
  }, [loadCloud, pathname, router, setProfile]);
  const continueAsGuest = useCallback(() => {
    setProfile((current) => ({ ...current, signedIn: false }));
    setSyncStatus("local");
    router.push("/");
  }, [router, setProfile]);
  const signOutAccount = useCallback(async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    cloudLoaded.current = false;
    setSyncConflict(null);
    setAuthUser(null);
    setProfile((current) => ({ ...current, signedIn: false }));
    setSyncStatus("local");
    router.push("/");
  }, [router, setProfile]);
  const saveAccountProfile = useCallback(async () => { if (!authUser) return notify("Profile changes are saved on this device."); const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-profile", displayName: profile.name, faction: profile.faction }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not update account profile."); setAuthUser(result.user); setModifiedAt(Date.now()); }, [authUser, notify, profile.faction, profile.name, setModifiedAt]);
  const changePassword = useCallback(async (currentPassword, newPassword) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-password", currentPassword, newPassword }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not change password."); notify("Password changed. Other sessions were signed out."); }, [notify]);
  const deleteAccount = useCallback(async (confirmation) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete-account", confirmation }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not delete account."); cloudLoaded.current = false; setAuthUser(null); setProfile((current) => ({ ...current, signedIn: false })); router.push("/"); }, [router, setProfile]);

  useEffect(() => {
    if (match?.phase !== "result" || !match.winner) return;
    const id = `${match.id}-${match.gameNumber}`;
    if (!history.some((item) => item.id === id)) {
      const record = { id, result: match.winner === playerId ? "Victor" : "Defeat", opponent: match.players.find((player) => player.id !== playerId)?.name ?? "Opponent", score: Object.values(match.series).join("–"), reason: match.resultReason, at: new Date().toISOString(), startedAt: new Date(match.log[0]?.at ?? Date.now()).toISOString(), format: match.format, mode: online ? "online" : "training", schemaVersion: 1, log: match.log };
      setHistory((items) => [record, ...items]); setReplay(record); setReplayIndex(Math.max(0, record.log.length - 1));
    }
    const promptKey = `match:${match.id}:${match.gameNumber}`;
    if (!authUser && !promptedAccountMoments.current.has(promptKey)) {
      promptedAccountMoments.current.add(promptKey);
      setAccountPrompt("match-complete");
    }
    if (pathname !== "/play/result") router.replace("/play/result");
  }, [authUser, history, match, online, pathname, playerId, router, setHistory, setReplay, setReplayIndex]);

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
  const resolveSyncConflict = useCallback(async (preference) => {
    const pending = syncConflict;
    if (!pending || syncing.current) return false;
    const selected = { ...selectSnapshot(pending.local, pending.cloud, preference), updatedAt: Date.now() };
    syncing.current = true;
    setSyncConflict(null);
    setSyncStatus("saving");
    applySnapshot(selected, true);
    try {
      const saved = await putCloud(selected, pending.revision, false);
      lastSynced.current = saved.snapshot.updatedAt;
      cloudLoaded.current = true;
      setAuthError("");
      setSyncStatus("synced");
      return true;
    } catch (error) {
      setSyncConflict(pending);
      setAuthError(error.message);
      setSyncStatus(navigator.onLine ? "conflict" : "offline");
      return false;
    } finally {
      syncing.current = false;
    }
  }, [applySnapshot, putCloud, syncConflict]);
  const syncNow = useCallback(() => { void syncToCloud(true); }, [syncToCloud]);

  const value = useMemo(() => ({ ready, route, profile, setProfile, decks, setDecks, history, setHistory, settings, setSettings, selectedDeckId, setSelectedDeckId, selectedDeck, builderDeck, setBuilderDeck, deckQuery, setDeckQuery, compendiumQuery, setCompendiumQuery, compendiumTab, setCompendiumTab, format, setFormat, matchMode, setMatchMode, joinCode, setJoinCode, match, setMatch, online, setOnline, replay, setReplay, replayIndex, setReplayIndex, playerId, matchError, toast, notify, authUser, authChecking, authBusy, authError, syncStatus, syncConflict, resolveSyncConflict, storageHealth, guestData, accountPrompt, promptAccount, dismissAccountPrompt, accountAccessMode, requestAccountAccess, closeAccountAccess, authenticate, continueAsGuest, signOutAccount, saveAccountProfile, changePassword, deleteAccount, syncNow, startSolo, createOnline, joinOnline, readyMatch, nextSeriesGame, leaveMatch, catalogueRevision }), [accountAccessMode, accountPrompt, authBusy, authChecking, authError, authUser, authenticate, builderDeck, catalogueRevision, changePassword, compendiumQuery, closeAccountAccess, compendiumTab, continueAsGuest, createOnline, dismissAccountPrompt, deckQuery, decks, deleteAccount, format, history, joinCode, guestData, joinOnline, leaveMatch, match, matchError, matchMode, nextSeriesGame, notify, online, promptAccount, playerId, requestAccountAccess, profile, ready, readyMatch, replay, replayIndex, route, saveAccountProfile, selectedDeck, selectedDeckId, settings, signOutAccount, startSolo, storageHealth, syncConflict, resolveSyncConflict, syncNow, syncStatus, toast]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
