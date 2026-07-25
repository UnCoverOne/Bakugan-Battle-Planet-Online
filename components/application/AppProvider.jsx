"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { mergeSnapshots, normalizeSnapshot } from "../../lib/persistence";

const STORAGE_EVENT = "bbp-storage-status";
const MATCH_EVENT = "bbp-match-state-updated";
const defaults = {
  profile: { name: "DanBrawler", faction: "Pyrus", signedIn: false },
  settings: { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone", replayLinks: true },
};
const paths = { entry: "/", dashboard: "/dashboard", decks: "/decks", "deck-detail": "/decks", builder: "/builder/new", compendium: "/compendium", play: "/play", lobby: "/play/lobby", placement: "/play/match", match: "/play/match", result: "/play/result", history: "/history", profile: "/profile", settings: "/settings" };

export function routeForPath(pathname) {
  const [first, second] = pathname.split("/").filter(Boolean);
  if (!first) return "entry";
  if (first === "decks") return second ? "deck-detail" : "decks";
  if (first === "builder") return "builder";
  if (first === "compendium") return "compendium";
  if (first === "history") return "history";
  if (["dashboard", "profile", "settings"].includes(first)) return first;
  if (first === "play") return second === "lobby" ? "lobby" : second === "match" ? "match" : second === "result" ? "result" : "play";
  return "dashboard";
}

function reportStorage(detail) {
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail }));
}

function useStoredState(key, initial) {
  const [value, setValue] = useState(initial);
  const [ready, setReady] = useState(false);
  const skipWrite = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) setValue(JSON.parse(saved));
      } catch (error) {
        skipWrite.current = true;
        reportStorage({ status: "error", message: error instanceof SyntaxError ? "Saved browser data is corrupted. It has not been overwritten." : "Browser storage is unavailable. Changes may be lost when this tab closes.", savedAt: null });
      }
      setReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, [key]);
  useEffect(() => {
    if (!ready || skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      reportStorage({ status: "saved", message: "Saved on this device.", savedAt: Date.now() });
    } catch {
      reportStorage({ status: "error", message: "The latest browser changes could not be saved.", savedAt: null });
    }
  }, [key, ready, value]);
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
  const [decks, setDecks, decksReady] = useStoredState("bbp-decks-complete-set-v4", []);
  const [history, setHistory, historyReady] = useStoredState("bbp-history", []);
  const [settings, setSettings, settingsReady] = useStoredState("bbp-settings", defaults.settings);
  const [selectedDeckId, setSelectedDeckId, selectedDeckReady] = useStoredState("bbp-selected-deck-v1", "");
  const [builderDeck, setBuilderDeck, builderReady] = useStoredState("bbp-builder-draft-v1", null);
  const [deckQuery, setDeckQuery, deckQueryReady] = useStoredState("bbp-deck-query-v1", "");
  const [compendiumQuery, setCompendiumQuery, compendiumQueryReady] = useStoredState("bbp-compendium-query-v1", "");
  const [compendiumTab, setCompendiumTab, compendiumTabReady] = useStoredState("bbp-compendium-tab-v1", "cards");
  const [format, setFormat, formatReady] = useStoredState("bbp-match-format-v1", "bo1");
  const [matchMode, setMatchMode, matchModeReady] = useStoredState("bbp-match-mode-v1", "solo");
  const [joinCode, setJoinCode, joinCodeReady] = useStoredState("bbp-join-code-v1", "");
  const [match, setMatch, matchReady] = useStoredState("bbp-active-match-v1", null);
  const [online, setOnline, onlineReady] = useStoredState("bbp-active-match-online-v1", false);
  const [replay, setReplay, replayReady] = useStoredState("bbp-open-replay-v1", null);
  const [replayIndex, setReplayIndex, replayIndexReady] = useStoredState("bbp-replay-index-v1", 0);
  const [playerId, setPlayerId, playerReady] = useStoredState("bbp-player-id", "player");
  const [matchCapability, setMatchCapability, capabilityReady] = useStoredState("bbp-match-capability-v2", "");
  const [modifiedAt, setModifiedAt, modifiedReady] = useStoredState("bbp-local-modified-at-v1", 0);
  const [authUser, setAuthUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState("checking");
  const [storageHealth, setStorageHealth] = useState({ status: "checking", message: "Checking whether this browser can save data…", savedAt: null });
  const [matchError, setMatchError] = useState("");
  const [toast, setToast] = useState("");
  const [cloudRevision, setCloudRevision] = useState(0);
  const snapshotRef = useRef(null);
  const booted = useRef(false);
  const dirty = useRef(false);
  const applying = useRef(false);
  const lastSynced = useRef(-1);
  const ready = [profileReady, decksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, replayReady, replayIndexReady, playerReady, capabilityReady, modifiedReady].every(Boolean);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];
  const notify = useCallback((message) => setToast(message), []);

  const snapshot = useMemo(() => ({ schemaVersion: 1, updatedAt: modifiedAt, profile, decks, history: history.slice(0, 200), settings, route, selectedDeckId, builderDeck, deckQuery, compendiumQuery, compendiumTab, format, matchMode, joinCode, match, online, selectedCore: "", logFilter: "all", replay, replayIndex, playerId }), [builderDeck, compendiumQuery, compendiumTab, deckQuery, decks, format, history, joinCode, match, matchMode, modifiedAt, online, playerId, profile, replay, replayIndex, route, selectedDeckId, settings]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);

  useEffect(() => {
    const listener = (event) => setStorageHealth(event.detail);
    addEventListener(STORAGE_EVENT, listener);
    return () => removeEventListener(STORAGE_EVENT, listener);
  }, []);
  useEffect(() => {
    if (ready && playerId === "player") setPlayerId(crypto.randomUUID?.() ?? `player-${Date.now().toString(36)}`);
  }, [playerId, ready, setPlayerId]);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem("bbp-route-v1", JSON.stringify(route));
    dispatchEvent(new Event(MATCH_EVENT));
  }, [match, matchCapability, online, playerId, ready, route, settings]);
  useEffect(() => {
    const listener = () => {
      try {
        const next = JSON.parse(localStorage.getItem("bbp-active-match-v1") || "null");
        setMatch((current) => current?.id === next?.id && current?.version === next?.version ? current : next);
      } catch {}
    };
    addEventListener(MATCH_EVENT, listener);
    return () => removeEventListener(MATCH_EVENT, listener);
  }, [setMatch]);
  useEffect(() => {
    document.documentElement.dataset.contrast = settings.highContrast ? "high" : "normal";
    document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
  }, [settings.highContrast, settings.reducedMotion]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  const applySnapshot = useCallback((incoming, signedIn = false) => {
    const next = normalizeSnapshot(incoming, snapshotRef.current ?? snapshot);
    applying.current = true;
    setProfile({ ...next.profile, signedIn: signedIn || next.profile.signedIn });
    setDecks(next.decks); setHistory(next.history); setSettings(next.settings); setSelectedDeckId(next.selectedDeckId);
    setBuilderDeck(next.builderDeck); setDeckQuery(next.deckQuery); setCompendiumQuery(next.compendiumQuery); setCompendiumTab(next.compendiumTab);
    setFormat(next.format); setMatchMode(next.matchMode); setJoinCode(next.joinCode); setMatch(next.match); setOnline(next.online);
    setReplay(next.replay); setReplayIndex(next.replayIndex); setPlayerId(next.playerId); setModifiedAt(next.updatedAt);
    setTimeout(() => { applying.current = false; }, 80);
  }, [setBuilderDeck, setCompendiumQuery, setCompendiumTab, setDeckQuery, setDecks, setFormat, setHistory, setJoinCode, setMatch, setMatchMode, setModifiedAt, setOnline, setPlayerId, setProfile, setReplay, setReplayIndex, setSelectedDeckId, setSettings, snapshot]);

  const putCloud = useCallback(async (data, revision) => {
    const response = await fetch("/api/user-data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: revision, data }) });
    const result = await response.json();
    if (response.status === 409 && result.data) {
      const merged = { ...mergeSnapshots(data, normalizeSnapshot(result.data, data)), updatedAt: Date.now() };
      setCloudRevision(result.revision ?? revision);
      applySnapshot(merged, true);
      return { conflict: true };
    }
    if (!response.ok) throw new Error(result.error ?? "Could not save cloud data.");
    setCloudRevision(result.revision ?? revision + 1);
    return { conflict: false };
  }, [applySnapshot]);

  const loadCloud = useCallback(async (user, strategy = "merge") => {
    setSyncStatus("loading");
    const response = await fetch("/api/user-data", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load cloud data.");
    setCloudRevision(result.revision ?? 0);
    const local = snapshotRef.current ?? snapshot;
    const remote = result.data ? normalizeSnapshot(result.data, local) : null;
    const restored = remote ? (strategy === "cloud" ? remote : strategy === "local" ? local : mergeSnapshots(local, remote)) : local;
    const accountCopy = { ...restored, updatedAt: remote ? restored.updatedAt : Date.now(), profile: { ...restored.profile, signedIn: true } };
    applySnapshot(accountCopy, true);
    if (!remote) await putCloud(accountCopy, 0);
    lastSynced.current = accountCopy.updatedAt;
    setSyncStatus("synced");
    return accountCopy;
  }, [applySnapshot, putCloud, snapshot]);

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
          try { await loadCloud(result.user); } catch (error) { setAuthError(error.message); setSyncStatus(navigator.onLine ? "error" : "offline"); }
        } else if (!cancelled) setSyncStatus("local");
      } catch { if (!cancelled) setSyncStatus(profile.signedIn ? "offline" : "local"); }
      finally { if (!cancelled) setAuthChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [loadCloud, profile.signedIn, ready, setProfile]);

  useEffect(() => {
    if (!ready) return;
    if (!dirty.current) { dirty.current = true; return; }
    if (applying.current) return;
    setModifiedAt(Date.now());
  }, [builderDeck, compendiumQuery, compendiumTab, deckQuery, decks, format, history, joinCode, match?.version, matchMode, online, pathname, playerId, profile, ready, replay, replayIndex, selectedDeckId, setModifiedAt, settings]);
  useEffect(() => {
    if (!authUser || !ready || applying.current) return;
    const id = setTimeout(async () => {
      const current = snapshotRef.current;
      if (!current || current.updatedAt === lastSynced.current) return;
      try {
        setSyncStatus("saving");
        const result = await putCloud({ ...current, profile: { ...current.profile, signedIn: true } }, cloudRevision);
        if (!result.conflict) lastSynced.current = current.updatedAt;
        setSyncStatus(result.conflict ? "loading" : "synced");
      } catch (error) { setAuthError(error.message); setSyncStatus(navigator.onLine ? "error" : "offline"); }
    }, 900);
    return () => clearTimeout(id);
  }, [authUser, cloudRevision, modifiedAt, putCloud, ready]);

  const authenticate = useCallback(async (action, payload) => {
    setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const result = await response.json();
      if (!response.ok || !result.user) throw new Error(result.error ?? "Account request failed.");
      setAuthUser(result.user); setProfile((current) => ({ ...current, name: action === "signup" ? payload.displayName || current.name : current.name, faction: action === "signup" ? payload.faction || current.faction : current.faction, signedIn: true }));
      const restored = await loadCloud(result.user, action === "signup" ? "local" : payload.syncStrategy ?? "merge");
      router.push(restored.route === "entry" ? "/dashboard" : paths[restored.route]);
    } catch (error) { setAuthError(error.message); setSyncStatus("local"); }
    finally { setAuthBusy(false); }
  }, [loadCloud, router, setProfile]);
  const continueAsGuest = useCallback(() => { setProfile((current) => ({ ...current, signedIn: true })); setSyncStatus("local"); router.push("/dashboard"); }, [router, setProfile]);
  const signOutAccount = useCallback(async () => { try { await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); } catch {} setAuthUser(null); setProfile((current) => ({ ...current, signedIn: false })); setSyncStatus("local"); router.push("/"); }, [router, setProfile]);
  const saveAccountProfile = useCallback(async () => { if (!authUser) return notify("Profile changes are saved on this device."); const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-profile", displayName: profile.name, faction: profile.faction }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not update account profile."); setAuthUser(result.user); setModifiedAt(Date.now()); }, [authUser, notify, profile.faction, profile.name, setModifiedAt]);
  const changePassword = useCallback(async (currentPassword, newPassword) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-password", currentPassword, newPassword }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not change password."); notify("Password changed. Other sessions were signed out."); }, [notify]);
  const deleteAccount = useCallback(async (confirmation) => { const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete-account", confirmation }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not delete account."); setAuthUser(null); setProfile((current) => ({ ...current, signedIn: false })); router.push("/"); }, [router, setProfile]);

  useEffect(() => {
    if (match?.phase !== "result" || !match.winner) return;
    const id = `${match.id}-${match.gameNumber}`;
    if (!history.some((item) => item.id === id)) {
      const record = { id, result: match.winner === playerId ? "Victor" : "Defeat", opponent: match.players.find((player) => player.id !== playerId)?.name ?? "Opponent", score: Object.values(match.series).join("–"), reason: match.resultReason, at: new Date().toISOString(), startedAt: new Date(match.log[0]?.at ?? Date.now()).toISOString(), format: match.format, mode: online ? "online" : "training", schemaVersion: 1, log: match.log };
      setHistory((items) => [record, ...items]); setReplay(record); setReplayIndex(Math.max(0, record.log.length - 1));
    }
    if (pathname !== "/play/result") router.replace("/play/result");
  }, [history, match, online, pathname, playerId, router, setHistory, setReplay, setReplayIndex]);

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
  const startSolo = useCallback(async () => { if (!selectedDeck) return router.push("/decks"); try { const [{ createMatch, setReady }, data] = await Promise.all([import("../../lib/game"), import("../../lib/data")]); if (!data.deckIsLegal(selectedDeck)) throw new Error("Select a legal deck first."); const code = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(); const state = createMatch(code, format, [data.makePlayer(playerId, profile.name, selectedDeck), data.makePlayer("training-bot", "Mira Nova • Training AI", data.STARTER_DECKS[1])]); setOnline(false); setMatch(setReady(setReady(state, playerId), "training-bot")); router.push("/play/match"); } catch (error) { setMatchError(error.message); } }, [format, playerId, profile.name, router, selectedDeck, setMatch, setOnline]);
  const createOnline = useCallback(async () => { if (!selectedDeck) return router.push("/decks"); try { setMatchCapability(""); const state = await api("create", undefined, undefined, selection(selectedDeck)); setOnline(true); setMatch(state); router.push("/play/lobby"); } catch (error) { setMatchError(error.message); } }, [api, router, selectedDeck, selection, setMatch, setMatchCapability, setOnline]);
  const joinOnline = useCallback(async () => { if (!selectedDeck) return router.push("/decks"); try { const state = await api("join", undefined, joinCode.toUpperCase(), selection(selectedDeck)); setOnline(true); setMatch(state); router.push("/play/lobby"); } catch (error) { setMatchError(error.message); } }, [api, joinCode, router, selectedDeck, selection, setMatch, setOnline]);
  const readyMatch = useCallback(async () => { if (!match) return; try { if (online) await api("ready"); else { const { setReady } = await import("../../lib/game"); setMatch(setReady(match, playerId)); } } catch (error) { setMatchError(error.message); } }, [api, match, online, playerId, setMatch]);
  const nextSeriesGame = useCallback(async () => { if (!match) return; try { if (online) await api("next-game"); else { const { startNextSeriesGame } = await import("../../lib/game"); setMatch(startNextSeriesGame(match)); } router.push("/play/match"); } catch (error) { setMatchError(error.message); } }, [api, match, online, router, setMatch]);
  const leaveMatch = useCallback(() => { setMatch(null); setOnline(false); setMatchCapability(""); router.push("/dashboard"); }, [router, setMatch, setMatchCapability, setOnline]);

  const value = useMemo(() => ({ ready, route, profile, setProfile, decks, setDecks, history, setHistory, settings, setSettings, selectedDeckId, setSelectedDeckId, selectedDeck, builderDeck, setBuilderDeck, deckQuery, setDeckQuery, compendiumQuery, setCompendiumQuery, compendiumTab, setCompendiumTab, format, setFormat, matchMode, setMatchMode, joinCode, setJoinCode, match, setMatch, online, setOnline, replay, setReplay, replayIndex, setReplayIndex, playerId, matchError, toast, notify, authUser, authChecking, authBusy, authError, syncStatus, storageHealth, authenticate, continueAsGuest, signOutAccount, saveAccountProfile, changePassword, deleteAccount, syncNow: () => setModifiedAt(Date.now()), startSolo, createOnline, joinOnline, readyMatch, nextSeriesGame, leaveMatch }), [authBusy, authChecking, authError, authUser, authenticate, builderDeck, changePassword, compendiumQuery, compendiumTab, continueAsGuest, createOnline, deckQuery, decks, deleteAccount, format, history, joinCode, joinOnline, leaveMatch, match, matchError, matchMode, nextSeriesGame, notify, online, playerId, profile, ready, readyMatch, replay, replayIndex, route, saveAccountProfile, selectedDeck, selectedDeckId, settings, signOutAccount, startSolo, storageHealth, syncStatus, toast]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
