"use client";

import { useEffect, useRef, useState } from "react";
import {
  createMatch, setReady, startNextSeriesGame, uid, type MatchState,
} from "../lib/game";
import { BAKUGAN, CARDS, CORES, RULE_ENTRIES, STARTER_DECKS, deckErrors, deckIsLegal, makePlayer, type CanonicalPlayerSelection, type DeckFormat, type DeckRecord } from "../lib/data";
import { mergeSnapshots, normalizeSnapshot, type AppRoute as Route, type AppSettings, type BrawlerProfile as Profile, type MatchResultRecord as ResultRecord, type UserSnapshot } from "../lib/persistence";
import { MATCH_UPDATE_EVENT, readMatchStore } from "../components/game-screen-v2/matchStore";

type AuthUser = { id: string; email: string; displayName: string; faction: string; createdAt: number };
type SyncStatus = "checking" | "local" | "loading" | "saving" | "synced" | "offline" | "error";

const NAV: { route: Route; label: string; key: string }[] = [
  { route: "dashboard", label: "Dashboard", key: "01" }, { route: "play", label: "Play", key: "02" },
  { route: "decks", label: "Decks", key: "03" }, { route: "compendium", label: "Compendium", key: "04" },
  { route: "history", label: "History", key: "05" }, { route: "profile", label: "Profile", key: "06" },
];

const factionClass = (name: string) => `faction-${name.toLowerCase()}`;
const randomCode = () => crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) setValue(JSON.parse(raw) as T);
      } catch {}
      setReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, ready, value]);
  return [value, setValue, ready] as const;
}

function AppButton({ children, onClick, tone = "blue", disabled = false, type = "button", title }: { children: React.ReactNode; onClick?: () => void; tone?: "blue" | "red" | "gold" | "ghost"; disabled?: boolean; type?: "button" | "submit"; title?: string }) {
  return <button className={`hex-button ${tone}`} onClick={onClick} disabled={disabled} type={type} title={title}>{children}</button>;
}

function Badge({ children, tone = "blue" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

function Metric({ icon, label, value }: { icon?: string; label: string; value: string | number }) {
  return <div className="metric">{icon && <img src={icon} alt="" />}<div><span>{label}</span><strong>{value}</strong></div></div>;
}

function CardArt({ card, small = false, onClick, selected = false }: { card: typeof CARDS[number]; small?: boolean; onClick?: () => void; selected?: boolean }) {
  return <button className={`card-art ${small ? "small" : ""} ${selected ? "selected" : ""}`} onClick={onClick} title={`${card.name}: ${card.effect}`}><img src={card.art} alt={card.name} /><span>{card.name}</span></button>;
}

function Shell({ route, setRoute, profile, authUser, syncStatus, children, match }: { route: Route; setRoute: (r: Route) => void; profile: Profile; authUser: AuthUser | null; syncStatus: SyncStatus; children: React.ReactNode; match: MatchState | null }) {
  const immersiveMatch = route === "match";
  const syncLabel = authUser ? (syncStatus === "saving" ? "Saving…" : syncStatus === "synced" ? "Cloud synced" : syncStatus === "offline" ? "Offline • queued" : syncStatus === "error" ? "Sync issue" : "Connecting…") : "Saved on this device";
  return <div className={`app-shell ${immersiveMatch ? "immersive-match" : ""}`}>
    {!immersiveMatch && <header className="topbar">
      <button className="brand" onClick={() => setRoute("dashboard")} aria-label="Bakugan Battle Planet Online dashboard"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><span>TCG ONLINE</span></button>
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.route} className={route === item.route ? "active" : ""} onClick={() => setRoute(item.route)}><i>{item.key}</i>{item.label}</button>)}</nav>
      <div className="top-actions">
        {match && !["result"].includes(match.phase) && <button className="resume-chip" onClick={() => setRoute(match.phase === "lobby" ? "lobby" : "match")}><span className="pulse" /> Resume match</button>}
        <span className={`sync-chip ${syncStatus}`} title={authUser ? `Signed in as ${authUser.email}` : "Guest data is stored in this browser"}><i>{authUser ? "☁" : "▣"}</i>{syncLabel}</span>
        <button className="profile-chip" onClick={() => setRoute("profile")}><span>{profile.name.slice(0, 2).toUpperCase()}</span><div>{profile.name}<small>{profile.faction} • {authUser ? "Account" : "Local"}</small></div></button>
        <button className="menu-button" onClick={() => setRoute("settings")} aria-label="Settings">☰</button>
      </div>
    </header>}
    <main className="main-stage">{children}</main>
  </div>;
}

function PageHeader({ eyebrow, title, copy, art, actions }: { eyebrow: string; title: string; copy?: string; art?: string; actions?: React.ReactNode }) {
  return <section className="page-hero"><div className="page-hero-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}<div className="hero-actions">{actions}</div></div>{art && <img className="page-hero-art" src={art} alt="" />}</section>;
}

export default function Home() {
  const defaultSettings: AppSettings = { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone" };
  const [route, setRoute, routeReady] = useStoredState<Route>("bbp-route-v1", "entry");
  const [profile, setProfile, profileReady] = useStoredState<Profile>("bbp-profile", { name: "DanBrawler", faction: "Pyrus", signedIn: false });
  const [decks, setDecks, decksReady] = useStoredState<DeckRecord[]>("bbp-decks-complete-set-v4", STARTER_DECKS);
  const [history, setHistory, historyReady] = useStoredState<ResultRecord[]>("bbp-history", []);
  const [settings, setSettings, settingsReady] = useStoredState<AppSettings>("bbp-settings", defaultSettings);
  const [selectedDeckId, setSelectedDeckId, selectedDeckReady] = useStoredState("bbp-selected-deck-v1", "deck-pyrus");
  const [builderDeck, setBuilderDeck, builderReady] = useStoredState<DeckRecord | null>("bbp-builder-draft-v1", null);
  const [deckQuery, setDeckQuery, deckQueryReady] = useStoredState("bbp-deck-query-v1", "");
  const [compendiumQuery, setCompendiumQuery, compendiumQueryReady] = useStoredState("bbp-compendium-query-v1", "");
  const [compendiumTab, setCompendiumTab, compendiumTabReady] = useStoredState<"cards" | "rules" | "rulings">("bbp-compendium-tab-v1", "cards");
  const [format, setFormat, formatReady] = useStoredState<"bo1" | "bo3">("bbp-match-format-v1", "bo1");
  const [matchMode, setMatchMode, matchModeReady] = useStoredState<"solo" | "online" | "join">("bbp-match-mode-v1", "solo");
  const [joinCode, setJoinCode, joinCodeReady] = useStoredState("bbp-join-code-v1", "");
  const [match, setMatch, matchReady] = useStoredState<MatchState | null>("bbp-active-match-v1", null);
  const [online, setOnline, onlineReady] = useStoredState("bbp-active-match-online-v1", false);
  const [selectedCore, setSelectedCore, selectedCoreReady] = useStoredState("bbp-selected-core-v1", "");
  const [logFilter, setLogFilter, logFilterReady] = useStoredState("bbp-log-filter-v1", "all");
  const [replay, setReplay, replayReady] = useStoredState<ResultRecord | null>("bbp-open-replay-v1", null);
  const [replayIndex, setReplayIndex, replayIndexReady] = useStoredState("bbp-replay-index-v1", 0);
  const [playerId, setPlayerId, playerIdReady] = useStoredState("bbp-player-id", "player");
  const [matchCapability, setMatchCapability, capabilityReady] = useStoredState("bbp-match-capability-v2", "");
  const [localModifiedAt, setLocalModifiedAt, modifiedReady] = useStoredState("bbp-local-modified-at-v1", 0);
  const [matchError, setMatchError] = useState("");
  const [toast, setToast] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("checking");
  const [cloudRevision, setCloudRevision] = useState(0);
  const [cloudReady, setCloudReady] = useState(false);
  const snapshotRef = useRef<UserSnapshot | null>(null);
  const authBooted = useRef(false);
  const dirtyStarted = useRef(false);
  const applyingSnapshot = useRef(false);
  const cloudRevisionRef = useRef(0);
  const lastSyncedModifiedAt = useRef(-1);

  const persistenceReady = [routeReady, profileReady, decksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, selectedCoreReady, logFilterReady, replayReady, replayIndexReady, playerIdReady, capabilityReady, modifiedReady].every(Boolean);

  // The setup/dashboard shell still owns non-game navigation while the typed
  // match store owns live gameplay. Keep the small shared boundary in sync in
  // both directions so entering a match cannot leave GameplayClient looking at
  // the previous `play` route (which renders only the empty gameplay host).
  useEffect(() => {
    const synchronizeFromMatchStore = () => {
      const stored = readMatchStore();
      setRoute((current) => current === stored.route ? current : stored.route as Route);
      setOnline((current) => current === stored.online ? current : stored.online);
      setPlayerId((current) => current === stored.playerId || !stored.playerId ? current : stored.playerId!);
      setMatchCapability((current) => current === (stored.capability ?? "") ? current : stored.capability ?? "");
      setSettings((current) => JSON.stringify(current) === JSON.stringify(stored.settings)
        ? current
        : { ...current, ...stored.settings });
      setMatch((current) => JSON.stringify(current) === JSON.stringify(stored.match) ? current : stored.match);
    };
    window.addEventListener(MATCH_UPDATE_EVENT, synchronizeFromMatchStore);
    return () => window.removeEventListener(MATCH_UPDATE_EVENT, synchronizeFromMatchStore);
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    // useStoredState's persistence effects are registered first and have
    // already written these values by the time this effect runs.
    window.dispatchEvent(new Event(MATCH_UPDATE_EVENT));
  }, [
    persistenceReady,
    route,
    online,
    playerId,
    matchCapability,
    settings,
    match,
  ]);

  const currentSnapshot: UserSnapshot = {
    schemaVersion: 1,
    updatedAt: localModifiedAt,
    profile,
    decks: decks.slice(0, 50),
    history: history.slice(0, 200),
    settings,
    route,
    selectedDeckId,
    builderDeck,
    deckQuery,
    compendiumQuery,
    compendiumTab,
    format,
    matchMode,
    joinCode,
    match,
    online,
    selectedCore,
    logFilter,
    replay,
    replayIndex,
    playerId,
  };
  useEffect(() => { snapshotRef.current = currentSnapshot; cloudRevisionRef.current = cloudRevision; });

  const applyUserSnapshot = (incoming: UserSnapshot, forceEntered = false) => {
    const fallback = snapshotRef.current ?? currentSnapshot;
    const next = normalizeSnapshot(incoming, fallback);
    applyingSnapshot.current = true;
    setProfile({ ...next.profile, signedIn: forceEntered ? true : next.profile.signedIn });
    setDecks(next.decks);
    setHistory(next.history);
    setSettings(next.settings);
    setRoute(forceEntered && next.route === "entry" ? "dashboard" : next.route);
    setSelectedDeckId(next.selectedDeckId);
    setBuilderDeck(next.builderDeck);
    setDeckQuery(next.deckQuery);
    setCompendiumQuery(next.compendiumQuery);
    setCompendiumTab(next.compendiumTab);
    setFormat(next.format);
    setMatchMode(next.matchMode);
    setJoinCode(next.joinCode);
    setMatch(next.match);
    setOnline(next.online);
    setSelectedCore(next.selectedCore);
    setLogFilter(next.logFilter);
    setReplay(next.replay);
    setReplayIndex(next.replayIndex);
    setPlayerId(next.playerId);
    setLocalModifiedAt(next.updatedAt);
    window.setTimeout(() => { applyingSnapshot.current = false; }, 80);
  };

  const putCloudSnapshot = async (snapshot: UserSnapshot, expectedRevision: number) => {
    const response = await fetch("/api/user-data", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedRevision, data: snapshot }) });
    const data = await response.json() as { revision?: number; updatedAt?: number; data?: UserSnapshot | null; error?: string };
    if (!response.ok) {
      if (response.status === 409 && data.data) {
        const remote = normalizeSnapshot(data.data, snapshot);
        const merged = { ...mergeSnapshots(snapshot, remote), updatedAt: Date.now() };
        setCloudRevision(data.revision ?? expectedRevision);
        applyUserSnapshot(merged, true);
        window.setTimeout(() => setLocalModifiedAt(Date.now()), 140);
        return { ...data, conflict: true };
      }
      throw new Error(data.error ?? "Could not save cloud data.");
    }
    setCloudRevision(data.revision ?? expectedRevision + 1);
    return { ...data, conflict: false };
  };

  const loadCloudData = async (user: AuthUser) => {
    setCloudReady(false);
    setSyncStatus("loading");
    const response = await fetch("/api/user-data", { cache: "no-store" });
    const data = await response.json() as { revision?: number; updatedAt?: number; data?: UserSnapshot | null; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load cloud data.");
    const local = snapshotRef.current ?? currentSnapshot;
    setCloudRevision(data.revision ?? 0);
    let restored: UserSnapshot;
    if (data.data) {
      const remote = normalizeSnapshot(data.data, local);
      const merged = mergeSnapshots(local, remote);
      const mergedForAccount: UserSnapshot = { ...merged, profile: { ...merged.profile, signedIn: true } };
      const changedByMerge = JSON.stringify({ ...mergedForAccount, updatedAt: 0 }) !== JSON.stringify({ ...remote, updatedAt: 0, profile: { ...remote.profile, signedIn: true } });
      restored = changedByMerge ? { ...mergedForAccount, updatedAt: Date.now() } : mergedForAccount;
      applyUserSnapshot(restored, true);
      lastSyncedModifiedAt.current = changedByMerge ? -1 : restored.updatedAt;
    } else {
      restored = {
        ...local,
        updatedAt: Math.max(Date.now(), local.updatedAt),
        profile: {
          ...local.profile,
          name: local.profile.name || user.displayName,
          faction: local.profile.faction || user.faction,
          signedIn: true,
        },
      };
      applyUserSnapshot(restored, true);
      await putCloudSnapshot(restored, 0);
      lastSyncedModifiedAt.current = restored.updatedAt;
    }
    setCloudReady(true);
    setSyncStatus("synced");
    return restored;
  };

  const authenticate = async (action: "login" | "signup", payload: { email: string; password: string; displayName?: string; faction?: string }) => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const data = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error ?? "Account request failed.");
      setAuthUser(data.user);
      if (action === "signup") setProfile((current) => ({ ...current, name: payload.displayName || current.name, faction: payload.faction || current.faction, signedIn: true }));
      else setProfile((current) => ({ ...current, signedIn: true }));
      let restored: UserSnapshot | null = null;
      try { restored = await loadCloudData(data.user); }
      catch (syncError) {
        setCloudReady(true);
        setSyncStatus(navigator.onLine ? "error" : "offline");
        setAuthError(syncError instanceof Error ? syncError.message : "Signed in, but cloud data could not be loaded.");
      }
      setRoute(restored && restored.route !== "entry" ? restored.route : "dashboard");
      setToast(action === "signup" ? "Account created. Local data is ready to sync." : "Signed in. Account session restored.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Account request failed.");
      setSyncStatus("local");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOutAccount = async () => {
    try { await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); } catch {}
    setAuthUser(null);
    setCloudReady(false);
    setCloudRevision(0);
    setSyncStatus("local");
    setProfile((current) => ({ ...current, signedIn: false }));
    setRoute("entry");
    setToast("Signed out. A local copy remains on this device.");
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-password", currentPassword, newPassword }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not change password.");
    setToast("Password changed. Other sessions were signed out.");
  };

  const deleteAccount = async (confirmation: string) => {
    const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete-account", confirmation }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not delete account.");
    setAuthUser(null);
    setCloudReady(false);
    setSyncStatus("local");
    setProfile((current) => ({ ...current, signedIn: false }));
    setRoute("entry");
    setToast("Account deleted. The local browser copy has been retained.");
  };

  const saveAccountProfile = async () => {
    if (!authUser) { setToast("Profile changes are saved on this device."); return; }
    const response = await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-profile", displayName: profile.name, faction: profile.faction }) });
    const data = await response.json() as { user?: AuthUser; error?: string };
    if (!response.ok || !data.user) throw new Error(data.error ?? "Could not update account profile.");
    setAuthUser(data.user);
    setLocalModifiedAt(Date.now());
    setToast("Account profile updated and queued for sync.");
  };

  useEffect(() => {
    if (!persistenceReady || playerId !== "player") return;
    setPlayerId(uid());
  }, [persistenceReady, playerId]);

  useEffect(() => {
    if (!persistenceReady) return;
    if (!dirtyStarted.current) { dirtyStarted.current = true; return; }
    if (applyingSnapshot.current) { applyingSnapshot.current = false; return; }
    setLocalModifiedAt(Date.now());
  }, [profile, decks, history, settings, route, selectedDeckId, builderDeck, deckQuery, compendiumQuery, compendiumTab, format, matchMode, joinCode, match?.version, online, selectedCore, logFilter, replay, replayIndex, playerId, persistenceReady]);

  useEffect(() => {
    if (!persistenceReady || authBooted.current) return;
    authBooted.current = true;
    let cancelled = false;
    (async () => {
      setAuthChecking(true);
      try {
        const response = await fetch("/api/auth", { cache: "no-store" });
        const data = await response.json() as { user?: AuthUser | null };
        if (cancelled) return;
        if (response.ok && data.user) {
          setAuthUser(data.user);
          setProfile((current) => ({ ...current, signedIn: true }));
          try { await loadCloudData(data.user); }
          catch (syncError) {
            if (!cancelled) {
              setCloudReady(true);
              setSyncStatus(navigator.onLine ? "error" : "offline");
              setAuthError(syncError instanceof Error ? syncError.message : "Cloud data could not be loaded.");
              if (route === "entry") setRoute("dashboard");
            }
          }
        } else {
          setSyncStatus("local");
          if (!profile.signedIn && route !== "entry") setRoute("entry");
        }
      } catch {
        if (!cancelled) setSyncStatus(profile.signedIn ? "offline" : "local");
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [persistenceReady]);

  useEffect(() => {
    if (!authUser || !cloudReady || !persistenceReady || applyingSnapshot.current) return;
    const id = window.setTimeout(async () => {
      const snapshot = snapshotRef.current;
      if (!snapshot) return;
      setSyncStatus("saving");
      if (snapshot.updatedAt === lastSyncedModifiedAt.current) { setSyncStatus("synced"); return; }
      try {
        const saved = await putCloudSnapshot({ ...snapshot, profile: { ...snapshot.profile, signedIn: true } }, cloudRevisionRef.current);
        if (!saved.conflict) lastSyncedModifiedAt.current = snapshot.updatedAt;
        setSyncStatus(saved.conflict ? "loading" : "synced");
      } catch (error) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        setAuthError(error instanceof Error ? error.message : "Cloud sync failed.");
      }
    }, 900);
    return () => window.clearTimeout(id);
  }, [authUser?.id, cloudReady, localModifiedAt, persistenceReady]);

  useEffect(() => {
    const onlineHandler = () => { if (authUser) { setSyncStatus("loading"); setLocalModifiedAt(Date.now()); } };
    const offlineHandler = () => { if (authUser) setSyncStatus("offline"); };
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => { window.removeEventListener("online", onlineHandler); window.removeEventListener("offline", offlineHandler); };
  }, [authUser?.id]);

  useEffect(() => { document.documentElement.dataset.contrast = settings.highContrast ? "high" : "normal"; document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full"; }, [settings]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2800); return () => clearTimeout(id); }, [toast]);

  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0] ?? STARTER_DECKS[0];
  const pushHistory = (state: MatchState) => {
    if (!state.winner || history.some((h) => h.id === `${state.id}-${state.gameNumber}`)) return;
    const won = state.winner === playerId;
    setHistory((items) => [{ id: `${state.id}-${state.gameNumber}`, result: won ? "Victor" : "Defeat", opponent: state.players.find((p) => p.id !== playerId)?.name ?? "Opponent", score: Object.values(state.series).join("–"), reason: state.resultReason, at: new Date().toLocaleString(), log: state.log }, ...items]);
  };

  useEffect(() => {
    if (match?.phase !== "result") return;
    const id = window.setTimeout(() => { pushHistory(match); if (route !== "result") setRoute("result"); }, 0);
    return () => window.clearTimeout(id);
  }, [match?.phase, match?.version]);
  useEffect(() => {
    if (!match) return;
    const destination: Route = match.phase === "lobby" ? "lobby" : match.phase === "result" ? "result" : "match";
    if (route === destination || !["lobby", "placement", "match", "result"].includes(route)) return;
    const id = window.setTimeout(() => setRoute(destination), 0);
    return () => window.clearTimeout(id);
  }, [match?.phase, match?.version, route]);

  const api = async (action: string, payload?: Record<string, unknown>, explicitCode?: string, selection?: CanonicalPlayerSelection) => {
    setMatchError("");
    const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json", ...(matchCapability ? { "x-match-capability": matchCapability } : {}) }, body: JSON.stringify({ action, code: explicitCode ?? match?.code, playerId, expectedVersion: match?.version, format, selection, payload }) });
    const data = await response.json() as { state?: MatchState; capability?: string; error?: string };
    if (!response.ok) { if (data.state) setMatch(data.state); throw new Error(data.error ?? "Match request failed."); }
    if (data.capability) setMatchCapability(data.capability);
    if (data.state) setMatch(data.state); return data.state!;
  };


  const localAction = (fn: (state: MatchState) => MatchState) => {
    if (!match) return; try { const next = fn(match); setMatch(next); setMatchError(""); } catch (e) { setMatchError(e instanceof Error ? e.message : "Illegal action."); }
  };

  const command = (action: string, payload?: Record<string, unknown>, localFn?: (state: MatchState) => MatchState) => {
    if (online) api(action, payload).catch((e) => setMatchError(e.message)); else if (localFn) localAction(localFn);
  };

  const startSolo = () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    const botDeck = STARTER_DECKS[1]; const state = createMatch(randomCode(), format, [makePlayer(playerId, profile.name, selectedDeck), makePlayer("training-bot", "Mira Nova • Training AI", botDeck)]);
    const ready = setReady(setReady(state, playerId), "training-bot"); setOnline(false); setMatchCapability(""); setMatch(ready); setRoute("match");
  };

  const onlineSelection = (deck: DeckRecord): CanonicalPlayerSelection => ({
    playerId,
    name: profile.name,
    deck: { name: deck.name, bakuganIds: [...deck.bakuganIds], coreIds: [...deck.coreIds], cardIds: [...deck.cardIds], format: deck.format },
  });

  const createOnline = async () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    setMatchCapability("");
    try { const state = await api("create", undefined, undefined, onlineSelection(selectedDeck)); setOnline(true); setMatch(state); setRoute("lobby"); }
    catch (e) { setMatchError(e instanceof Error ? e.message : "Could not create room."); }
  };

  const joinOnline = async () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    try { const state = await api("join", undefined, joinCode.toUpperCase(), onlineSelection(selectedDeck)); setOnline(true); setMatch(state); setRoute("lobby"); }
    catch (e) { setMatchError(e instanceof Error ? e.message : "Could not join room."); }
  };

  const addCard = (cardId: string) => setBuilderDeck((deck) => {
    const card = CARDS.find((candidate) => candidate.catalogId === cardId); const copies = deck?.cardIds.filter((id) => id === cardId).length ?? 0;
    const copyLimit = (deck?.format ?? "standard") === "singleton" ? 1 : 3;
    return deck && card && card.type !== "Character" && deck.cardIds.length < 40 && copies < copyLimit ? { ...deck, cardIds: [...deck.cardIds, cardId] } : deck;
  });
  const removeCard = (cardId: string) => setBuilderDeck((deck) => { if (!deck) return deck; const next = [...deck.cardIds]; const i = next.indexOf(cardId); if (i >= 0) next.splice(i, 1); return { ...deck, cardIds: next }; });
  const saveBuilder = () => {
    if (!builderDeck) return; const existing = decks.some((d) => d.id === builderDeck.id);
    setDecks((items) => existing ? items.map((d) => d.id === builderDeck.id ? { ...builderDeck, updatedAt: "Just now" } : d) : [{ ...builderDeck, updatedAt: "Just now" }, ...items]);
    setSelectedDeckId(builderDeck.id); setToast(deckIsLegal(builderDeck) ? "Deck saved and validated." : "Draft saved with legality issues.");
  };

  if (!persistenceReady) return <BootScreen label="RESTORING LOCAL BRAWLER DATA" />;
  if (route === "entry") return <Entry profile={profile} setProfile={setProfile} authChecking={authChecking} authBusy={authBusy} authError={authError} onGuest={() => { setAuthError(""); setProfile({ ...profile, signedIn: true }); setRoute("dashboard"); setSyncStatus("local"); }} onAuthenticate={authenticate} />;

  let content: React.ReactNode;
  if (route === "dashboard") content = <Dashboard profile={profile} decks={decks} history={history} match={match} setRoute={setRoute} selectDeck={setSelectedDeckId} />;
  else if (route === "decks") content = <DeckLibrary decks={decks} query={deckQuery} setQuery={setDeckQuery} selectedDeckId={selectedDeckId} selectDeck={setSelectedDeckId} setDecks={setDecks} openBuilder={(deck) => { setBuilderDeck(deck); setRoute("builder"); }} />;
  else if (route === "builder") content = <DeckBuilder deck={builderDeck ?? selectedDeck} setDeck={setBuilderDeck} addCard={addCard} removeCard={removeCard} save={saveBuilder} back={() => setRoute("decks")} />;
  else if (route === "compendium") content = <Compendium query={compendiumQuery} setQuery={setCompendiumQuery} tab={compendiumTab} setTab={setCompendiumTab} />;
  else if (route === "play") content = <PlaySetup format={format} setFormat={setFormat} mode={matchMode} setMode={setMatchMode} deck={selectedDeck} decks={decks} selectDeck={setSelectedDeckId} joinCode={joinCode} setJoinCode={setJoinCode} startSolo={startSolo} createOnline={createOnline} joinOnline={joinOnline} error={matchError} />;
  else if (route === "lobby") content = <Lobby match={match} playerId={playerId} error={matchError} ready={() => command("ready", undefined, (s) => setReady(s, playerId))} leave={() => { setMatch(null); setOnline(false); setRoute("dashboard"); }} />;
  else if (route === "match" || route === "placement") content = <div className="gameplay-match-host" aria-label="Tabletop gameplay client" />;
  else if (route === "result") content = <ResultScreen match={match} playerId={playerId} history={history} nextGame={() => command("next-game", undefined, startNextSeriesGame)} dashboard={() => { setMatch(null); setOnline(false); setRoute("dashboard"); }} openReplay={() => { const item = history[0]; if (item) { setReplay(item); setReplayIndex(item.log.length - 1); setRoute("history"); } }} />;
  else if (route === "history") content = <HistoryScreen history={history} replay={replay} setReplay={setReplay} replayIndex={replayIndex} setReplayIndex={setReplayIndex} />;
  else if (route === "profile") content = <ProfileScreen profile={profile} setProfile={setProfile} history={history} decks={decks} authUser={authUser} saveProfile={() => saveAccountProfile().catch((error) => setToast(error instanceof Error ? error.message : "Could not save profile."))} />;
  else content = <SettingsScreen settings={settings} setSettings={setSettings} authUser={authUser} syncStatus={syncStatus} syncError={authError} signOut={signOutAccount} openAccount={() => { setAuthError(""); setRoute("entry"); }} syncNow={() => { setSyncStatus(authUser ? "loading" : "local"); setLocalModifiedAt(Date.now()); }} changePassword={changePassword} deleteAccount={deleteAccount} />;

  return <Shell route={route} setRoute={setRoute} profile={profile} authUser={authUser} syncStatus={syncStatus} match={match}>{content}{toast && <div className="toast" role="status">{toast}</div>}</Shell>;
}

function Entry({ profile, setProfile, authChecking, authBusy, authError, onGuest, onAuthenticate }: { profile: Profile; setProfile: React.Dispatch<React.SetStateAction<Profile>>; authChecking: boolean; authBusy: boolean; authError: string; onGuest: () => void; onAuthenticate: (action: "login" | "signup", payload: { email: string; password: string; displayName?: string; faction?: string }) => Promise<void> }) {
  const [mode, setMode] = useState<"guest" | "login" | "signup">("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (mode === "guest") return;
    if (mode === "signup" && password !== confirmPassword) { setFormError("Passwords do not match."); return; }
    await onAuthenticate(mode, { email, password, displayName: profile.name, faction: profile.faction });
  };
  return <main className="entry-page">
    <header className="public-header"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><nav><a href="#features">Features</a><a href="#rules">Rules</a><a href="#accessibility">Accessibility</a></nav><span>ORIGINAL 2019 RULESET</span></header>
    <section className="entry-hero"><div className="entry-art"><img src="/assets/brawlers.png" alt="The Awesome Brawlers and their Bakugan" /></div><div className="entry-copy"><Badge tone="red">PERSISTENT TCG ACCOUNT SYSTEM</Badge><h1>ANSWER THE CALL<br /><em>TO BRAWL.</em></h1><p>Continue locally on this device, or create an account to sync decks, settings, match history, drafts, and resumable state across devices.</p>
      <div className="auth-tabs" role="tablist" aria-label="Access options"><button className={mode === "guest" ? "active" : ""} onClick={() => { setMode("guest"); setFormError(""); }}>LOCAL PROFILE</button><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setFormError(""); }}>LOG IN</button><button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setFormError(""); }}>SIGN UP</button></div>
      {mode === "guest" ? <form className="signin-panel account-panel" onSubmit={(event) => { event.preventDefault(); onGuest(); }}><div className="storage-callout"><strong>DEVICE-LOCAL MODE</strong><span>Your decks, settings, drafts, history, and active state remain in this browser after refreshes and restarts.</span></div><label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label><AppButton type="submit" tone="red">CONTINUE ON THIS DEVICE</AppButton><small>You can link this local profile to an account later without deleting the browser copy.</small></form>
      : <form className="signin-panel account-panel" onSubmit={submitAccount}>{mode === "signup" && <><label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label></>}<label>EMAIL ADDRESS<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{mode === "signup" && <label>CONFIRM PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}{(formError || authError) && <p className="error-message" role="alert">{formError || authError}</p>}<AppButton type="submit" tone="red" disabled={authBusy || authChecking}>{authChecking ? "CHECKING SESSION…" : authBusy ? "CONNECTING…" : mode === "login" ? "LOG IN & SYNC" : "CREATE ACCOUNT & SYNC"}</AppButton><small>Passwords are hashed on the server. Login sessions use secure, HTTP-only cookies. Local data is merged with the account copy.</small></form>}
    </div></section>
    <section id="features" className="entry-features"><article><strong>01</strong><h2>PERSIST</h2><p>Return to the same page, draft, deck, or active match after restarting the browser.</p></article><article><strong>02</strong><h2>PLAY LOCAL</h2><p>Logged-out Brawlers retain their data using browser storage.</p></article><article><strong>03</strong><h2>SYNC</h2><p>Accounts carry decks, settings, records, and state between devices.</p></article></section>
  </main>;
}

function Dashboard({ profile, decks, history, match, setRoute, selectDeck }: { profile: Profile; decks: DeckRecord[]; history: ResultRecord[]; match: MatchState | null; setRoute: (r: Route) => void; selectDeck: (id: string) => void }) {
  const legal = decks.filter(deckIsLegal);
  return <><PageHeader eyebrow={`WELCOME BACK, ${profile.name.toUpperCase()}`} title="BRAWLER COMMAND" copy="Your next Brawl, legal decks, challenges, and recent results—one decision away." art="/assets/brawlers-group.png" actions={<><AppButton tone="red" onClick={() => setRoute("play")}>PLAY NOW</AppButton><AppButton tone="ghost" onClick={() => setRoute("builder")}>BUILD A DECK</AppButton></>} />
    {match && match.phase !== "result" && <section className="alert-strip"><div><span className="pulse" /><strong>ACTIVE MATCH</strong><p>{match.code} • {match.stepLabel}</p></div><AppButton onClick={() => setRoute(match.phase === "lobby" ? "lobby" : "match")}>RESUME</AppButton></section>}
    <section className="dashboard-grid"><article className="panel play-panel"><span className="panel-index">01</span><h2>READY TO BRAWL?</h2><p>{legal.length} legal decks available • BO1 and BO3 enabled</p><div className="team-silhouette">{BAKUGAN.slice(0, 3).map((b) => <img key={b.id} src={b.art} alt="" />)}</div><AppButton tone="red" onClick={() => setRoute("play")}>CHOOSE THE BATTLE</AppButton></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENT DECKS</span><h2>YOUR ARSENAL</h2></div><button onClick={() => setRoute("decks")}>VIEW ALL →</button></div><div className="mini-decks">{decks.slice(0, 3).map((deck) => <button key={deck.id} onClick={() => { selectDeck(deck.id); setRoute("builder"); }}><span className={factionClass(deck.factions[0])} /><strong>{deck.name}</strong><small>{deck.cardIds.length} cards • {deckIsLegal(deck) ? "LEGAL" : "ISSUES"}</small></button>)}</div></article>
      <article className="panel results-panel"><div className="panel-heading"><div><span className="eyebrow">MATCH ARCHIVE</span><h2>RECENT RESULTS</h2></div><button onClick={() => setRoute("history")}>OPEN HISTORY →</button></div>{history.length ? history.slice(0, 4).map((item) => <div className="result-row" key={item.id}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><span>vs {item.opponent}</span><strong>{item.score}</strong><small>{item.reason}</small></div>) : <div className="empty-state"><strong>NO MATCHES RECORDED</strong><p>Your completed Brawls and replays will appear here.</p></div>}</article>
      <article className="panel ruling-panel"><span className="eyebrow">LATEST PLATFORM RULING</span><h2>ROLL CALCULATION IS PUBLIC</h2><p>Accuracy, Double Core, adjacency weighting, and four-Core rotation results are published in the match log after resolution.</p><button onClick={() => setRoute("compendium")}>OPEN RULING →</button></article></section></>;
}

function DeckLibrary({ decks, query, setQuery, selectedDeckId, selectDeck, setDecks, openBuilder }: { decks: DeckRecord[]; query: string; setQuery: (q: string) => void; selectedDeckId: string; selectDeck: (id: string) => void; setDecks: React.Dispatch<React.SetStateAction<DeckRecord[]>>; openBuilder: (d: DeckRecord) => void }) {
  const filtered = decks.filter((d) => d.name.toLowerCase().includes(query.toLowerCase()));
  const create = () => openBuilder({ id: uid(), name: "Untitled Battle Deck", factions: [...STARTER_DECKS[0].factions], bakuganIds: [...STARTER_DECKS[0].bakuganIds], coreIds: [...STARTER_DECKS[0].coreIds], cardIds: [], updatedAt: "Draft", visibility: "Private", format: "standard" });
  return <><PageHeader eyebrow="DECK MANAGEMENT" title="DECK LIBRARY" copy="Organize, validate, duplicate, publish, and prepare your Battle Planet decks." art="/assets/pyrus.png" actions={<><AppButton tone="red" onClick={create}>+ CREATE DECK</AppButton><AppButton tone="ghost" onClick={() => document.getElementById("deck-search")?.focus()}>IMPORT CODE</AppButton></>} />
    <section className="toolbar"><label className="search-box">⌕<input id="deck-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search decks…" /></label><Badge>{filtered.length} / 50 DECKS</Badge><button>ALL FACTIONS⌄</button><button>ALL LEGALITY⌄</button><button>LAST UPDATED⌄</button></section>
    <section className="deck-grid">{filtered.map((deck) => { const legal = deckIsLegal(deck); return <article key={deck.id} className={`deck-tile ${selectedDeckId === deck.id ? "selected" : ""}`} onClick={() => selectDeck(deck.id)}><div className={`deck-cover ${factionClass(deck.factions[0])}`}><img src={BAKUGAN.find((b) => b.id === deck.bakuganIds[0])?.art} alt="" /><span>{deck.visibility}</span><strong>{deck.name}</strong></div><div className="deck-meta"><div>{deck.factions.map((f) => <i className={factionClass(f)} key={f} title={f} />)}</div><Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL" : `${40 - deck.cardIds.length} CARD ISSUE`}</Badge><p>{deck.cardIds.length} cards • 3 Bakugan • 6 Cores</p><small>Updated {deck.updatedAt}</small></div><div className="tile-actions"><button onClick={(e) => { e.stopPropagation(); openBuilder(deck); }}>EDIT</button><button onClick={(e) => { e.stopPropagation(); const copy = { ...deck, id: uid(), name: `${deck.name} Copy`, updatedAt: "Just now" }; setDecks((items) => [copy, ...items]); }}>DUPLICATE</button><button className="danger" onClick={(e) => { e.stopPropagation(); setDecks((items) => items.filter((d) => d.id !== deck.id)); }}>DELETE</button></div></article>; })}</section></>;
}

function DeckBuilder({ deck, setDeck, addCard, removeCard, save, back }: { deck: DeckRecord; setDeck: (d: DeckRecord) => void; addCard: (id: string) => void; removeCard: (id: string) => void; save: () => void; back: () => void }) {
  const [catalogTab, setCatalogTab] = useState<"cards" | "bakugan" | "cores">("cards");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [factionFilter, setFactionFilter] = useState("All");
  const [setFilter, setSetFilter] = useState("All");
  const [rarityFilter, setRarityFilter] = useState("All");
  const [costFilter, setCostFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"id" | "name" | "cost" | "rarity">("id");

  const format: DeckFormat = deck.format ?? "standard";
  const cardCopyLimit = format === "singleton" ? 1 : 3;
  const coreCopyLimit = format === "singleton" ? 1 : 6;
  const mainCards = CARDS.filter((card) => card.type !== "Character");
  const errors = deckErrors(deck);
  const legal = errors.length === 0;
  const selectedBakugan = deck.bakuganIds.map((id) => BAKUGAN.find((item) => item.id === id)).filter(Boolean) as typeof BAKUGAN;
  const selectedCores = deck.coreIds.map((id) => CORES.find((item) => item.id === id)).filter(Boolean) as typeof CORES;
  const cardCounts = mainCards.map((card) => ({ card, count: deck.cardIds.filter((id) => id === card.catalogId).length })).filter((item) => item.count > 0);
  const rarityOrder = ["Common", "Rare", "Super Rare", "Awesome Rare", "Bakugan Elite", "N/A"];
  const setName = (id: string) => id.startsWith("bb-") ? "Battle Brawlers" : "Other";
  const query = catalogQuery.trim().toLowerCase();
  const energyValues = [...new Set(mainCards.map((card) => String(card.cost)))].sort((a, b) => Number(a) - Number(b));

  const filteredCards = mainCards.filter((card) => {
    const matchesQuery = !query || `${card.displayName} ${card.effect}`.toLowerCase().includes(query);
    return matchesQuery
      && (typeFilter === "All" || card.type === typeFilter)
      && (factionFilter === "All" || card.factions.includes(factionFilter as never))
      && (setFilter === "All" || setName(card.catalogId) === setFilter)
      && (rarityFilter === "All" || card.rarity === rarityFilter)
      && (costFilter === "All" || String(card.cost) === costFilter);
  }).sort((a, b) => {
    if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
    if (sortBy === "cost") return (typeof a.cost === "number" ? a.cost : 99) - (typeof b.cost === "number" ? b.cost : 99) || a.number - b.number;
    if (sortBy === "rarity") return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity) || a.number - b.number;
    return a.number - b.number;
  });

  const filteredBakugan = BAKUGAN.filter((bakugan) => {
    const matchesQuery = !query || `${bakugan.name} ${bakugan.faction}`.toLowerCase().includes(query);
    return matchesQuery
      && (factionFilter === "All" || bakugan.faction === factionFilter)
      && (setFilter === "All" || setName(bakugan.id) === setFilter);
  }).sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")));

  const filteredCores = CORES.filter((core) => {
    const matchesQuery = !query || `${core.name} ${core.type}`.toLowerCase().includes(query);
    return matchesQuery && (typeFilter === "All" || core.type === typeFilter);
  }).sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : a.number - b.number);

  const requiredCoreTypes = selectedBakugan.flatMap((bakugan) => bakugan.character.coreTypes);
  const coreTypes = ["Fist", "Flaming Fist", "Shield", "Magic Shield", "Helix"];
  const cardTypeCounts = ["Action", "Flip", "Hero", "Evo"].map((type) => ({ type, count: deck.cardIds.filter((id) => CARDS.find((card) => card.catalogId === id)?.type === type).length }));
  const factionMismatchCount = deck.cardIds.filter((id) => {
    const card = CARDS.find((candidate) => candidate.catalogId === id);
    return !!card && !card.factions.some((faction) => deck.factions.includes(faction));
  }).length;
  const teamIssue = deck.bakuganIds.length !== 3 || new Set(deck.bakuganIds).size !== deck.bakuganIds.length;
  const coreTypeIssue = [...requiredCoreTypes].sort().join("|") !== selectedCores.map((core) => core.type).sort().join("|");
  const coreIssue = deck.coreIds.length !== 6 || coreTypeIssue || selectedCores.some((core) => deck.coreIds.filter((id) => id === core.id).length > coreCopyLimit);
  const deckIssue = deck.cardIds.length !== 40 || factionMismatchCount > 0 || cardCounts.some(({ count }) => count > cardCopyLimit);

  const updateTeam = (bakuganId: string) => {
    const active = deck.bakuganIds.includes(bakuganId);
    const next = active ? deck.bakuganIds.filter((id) => id !== bakuganId) : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, bakuganId] : deck.bakuganIds;
    setDeck({
      ...deck,
      bakuganIds: next,
      factions: [...new Set(next.map((id) => BAKUGAN.find((candidate) => candidate.id === id)?.faction).filter(Boolean))] as string[],
    });
  };
  const addCore = (coreId: string) => {
    const copies = deck.coreIds.filter((id) => id === coreId).length;
    if (deck.coreIds.length >= 6 || copies >= coreCopyLimit) return;
    setDeck({ ...deck, coreIds: [...deck.coreIds, coreId] });
  };
  const removeCore = (coreId: string) => {
    const next = [...deck.coreIds];
    const index = next.lastIndexOf(coreId);
    if (index >= 0) next.splice(index, 1);
    setDeck({ ...deck, coreIds: next });
  };
  const changeTab = (tab: "cards" | "bakugan" | "cores") => {
    setCatalogTab(tab);
    setTypeFilter("All");
    setFactionFilter("All");
    setSetFilter("All");
    setRarityFilter("All");
    setCostFilter("All");
    setSortBy("id");
  };

  return <section className="builder-page builder-v2">
    <header className="builder-header">
      <button onClick={back}>← DECK LIBRARY</button>
      <input value={deck.name} onChange={(event) => setDeck({ ...deck, name: event.target.value })} aria-label="Deck name" />
      <label className="builder-format"><span>FORMAT</span><select value={format} onChange={(event) => setDeck({ ...deck, format: event.target.value as DeckFormat })}><option value="standard">Standard</option><option value="singleton">Singleton</option></select></label>
      <Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL DECK" : `${errors.length} ISSUE${errors.length === 1 ? "" : "S"}`}</Badge>
      <span>Autosaved locally</span>
      <AppButton tone="red" onClick={save}>SAVE DECK</AppButton>
    </header>

    <div className="builder-layout builder-equal-columns">
      <aside className="catalog panel builder-catalog-column">
        <div className="catalog-title-row"><div><span className="eyebrow">COMPLETE CATALOGUE</span><h2>ADD GAME PIECES</h2></div><Badge>{catalogTab === "cards" ? filteredCards.length : catalogTab === "bakugan" ? filteredBakugan.length : filteredCores.length} SHOWN</Badge></div>
        <div className="catalog-tabs" role="tablist" aria-label="Game piece catalogue">
          <button className={catalogTab === "cards" ? "active" : ""} onClick={() => changeTab("cards")}>CARDS</button>
          <button className={catalogTab === "bakugan" ? "active" : ""} onClick={() => changeTab("bakugan")}>BAKUGAN</button>
          <button className={catalogTab === "cores" ? "active" : ""} onClick={() => changeTab("cores")}>CORES</button>
        </div>
        <label className="catalog-search"><span>SEARCH</span><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={catalogTab === "cards" ? "Name or effect…" : "Name…"} /></label>
        <div className="catalog-filters">
          {(catalogTab === "cards" || catalogTab === "cores") && <label><span>{catalogTab === "cards" ? "CARD TYPE" : "CORE TYPE"}</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option>{(catalogTab === "cards" ? ["Action", "Flip", "Hero", "Evo"] : coreTypes).map((type) => <option key={type}>{type}</option>)}</select></label>}
          {catalogTab !== "cores" && <label><span>FACTION</span><select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option>All</option>{["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label>}
          {catalogTab !== "cores" && <label><span>SET</span><select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}><option>All</option><option>Battle Brawlers</option></select></label>}
          {catalogTab === "cards" && <label><span>RARITY</span><select value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}><option>All</option>{rarityOrder.map((rarity) => <option key={rarity}>{rarity}</option>)}</select></label>}
          {catalogTab === "cards" && <label><span>ENERGY COST</span><select value={costFilter} onChange={(event) => setCostFilter(event.target.value)}><option>All</option>{energyValues.map((cost) => <option key={cost}>{cost}</option>)}</select></label>}
          <label><span>SORT BY</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="id">ID</option><option value="name">Name</option>{catalogTab === "cards" && <><option value="cost">Energy Cost</option><option value="rarity">Rarity</option></>}</select></label>
        </div>
        <div className={`catalog-results ${catalogTab}`}>
          {catalogTab === "cards" && filteredCards.map((card) => {
            const copies = deck.cardIds.filter((id) => id === card.catalogId).length;
            const atLimit = copies >= cardCopyLimit || deck.cardIds.length >= 40;
            return <article className="catalog-piece card-piece" key={card.id}>
              <img src={card.art} alt={card.displayName} />
              <div className="catalog-piece-copy"><strong>{card.displayName}</strong><span>{card.type} • {card.faction} • {card.cost} Energy</span><small>{card.rarity}</small></div>
              <div className="catalog-piece-actions"><b>{copies}/{cardCopyLimit}</b><button disabled={atLimit} onClick={() => addCard(card.catalogId)}>{atLimit ? "LIMIT" : "+ ADD"}</button></div>
            </article>;
          })}
          {catalogTab === "bakugan" && filteredBakugan.map((bakugan) => {
            const active = deck.bakuganIds.includes(bakugan.id);
            return <article className={`catalog-piece bakugan-piece ${active ? "selected" : ""} ${factionClass(bakugan.faction)}`} key={bakugan.id}>
              <img src={bakugan.art} alt={bakugan.name} />
              <div className="catalog-piece-copy"><strong>{bakugan.name}</strong><span>{bakugan.faction} • {bakugan.bPower}B • {bakugan.damage}D</span><small>{bakugan.character.coreTypes.join(" + ")}</small></div>
              <div className="catalog-piece-actions"><b>{active ? "1/1" : "0/1"}</b><button disabled={!active && deck.bakuganIds.length >= 3} onClick={() => updateTeam(bakugan.id)}>{active ? "REMOVE" : "+ ADD"}</button></div>
            </article>;
          })}
          {catalogTab === "cores" && filteredCores.map((core) => {
            const copies = deck.coreIds.filter((id) => id === core.id).length;
            const atLimit = copies >= coreCopyLimit || deck.coreIds.length >= 6;
            return <article className={`catalog-piece core-piece ${copies ? "selected" : ""}`} key={core.id}>
              <img src={core.art} alt={core.name} />
              <div className="catalog-piece-copy"><strong>{core.name}</strong><span>{core.type} • Core #{core.number}</span><small>{requiredCoreTypes.includes(core.type) ? "Required by selected Bakugan" : "Not currently required"}</small></div>
              <div className="catalog-piece-actions"><b>{copies}/{coreCopyLimit}</b><div><button disabled={!copies} onClick={() => removeCore(core.id)}>−</button><button disabled={atLimit} onClick={() => addCore(core.id)}>+</button></div></div>
            </article>;
          })}
          {((catalogTab === "cards" && !filteredCards.length) || (catalogTab === "bakugan" && !filteredBakugan.length) || (catalogTab === "cores" && !filteredCores.length)) && <div className="catalog-empty"><strong>NO RESULTS</strong><span>Adjust the search or filters.</span></div>}
        </div>
      </aside>

      <main className="deck-workspace builder-deck-column">
        <section className={`deck-validation-summary ${legal ? "legal" : "illegal"}`}>
          <div><span className="eyebrow">{format.toUpperCase()} FORMAT</span><h2>{legal ? "READY FOR BATTLE" : "DECK REQUIRES ATTENTION"}</h2><p>{format === "standard" ? "Up to three copies of each Main Deck card and six copies of a BakuCore." : "One copy of each Main Deck card, Character, and BakuCore."}</p></div>
          <Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL" : `${errors.length} OPEN`}</Badge>
          {!legal && <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        </section>

        <section className={`team-builder panel selected-section ${teamIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">BAKUGAN TEAM</span><h2>SELECTED BAKUGAN</h2></div><Badge tone={teamIssue ? "red" : "gold"}>{deck.bakuganIds.length} / 3</Badge></div>
          <div className="selected-bakugan-grid">{[0, 1, 2].map((index) => { const bakugan = selectedBakugan[index]; return bakugan ? <article className={factionClass(bakugan.faction)} key={bakugan.id}><img src={bakugan.art} alt={bakugan.name} /><div><strong>{bakugan.name}</strong><span>{bakugan.faction} • {bakugan.bPower}B • {bakugan.damage}D</span><small>{bakugan.character.coreTypes.join(" + ")}</small></div><button onClick={() => updateTeam(bakugan.id)}>REMOVE</button></article> : <div className="empty-selection-slot" key={index}><b>+</b><span>BAKUGAN SLOT {index + 1}</span></div>; })}</div>
        </section>

        <section className={`core-builder panel selected-section ${coreIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">HIDE MATRIX KIT</span><h2>SELECTED BAKUCORES</h2></div><Badge tone={coreIssue ? "red" : "gold"}>{deck.coreIds.length} / 6</Badge></div>
          <div className="core-requirement-strip"><span>ALLOWED CORE TYPES</span><div>{coreTypes.map((type) => { const required = requiredCoreTypes.filter((item) => item === type).length; const selected = selectedCores.filter((core) => core.type === type).length; return <i className={`${required ? "required" : "not-required"} ${selected === required ? "met" : "unmet"}`} key={type}>{type}<b>{selected}/{required}</b></i>; })}</div></div>
          <div className="selected-core-grid">{[0, 1, 2, 3, 4, 5].map((index) => { const core = selectedCores[index]; return core ? <article key={`${core.id}-${index}`}><img src={core.art} alt={core.name} /><strong>{core.name}</strong><span>{core.type}</span><button onClick={() => removeCore(core.id)}>REMOVE</button></article> : <div className="empty-selection-slot core-empty" key={index}><b>+</b><span>CORE SLOT {index + 1}</span></div>; })}</div>
        </section>

        <section className={`deck-list panel selected-section ${deckIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">MAIN DECK</span><h2>40-CARD LIST</h2></div><Badge tone={deckIssue ? "red" : "gold"}>{deck.cardIds.length} / 40</Badge></div>
          <div className="deck-type-summary">{cardTypeCounts.map(({ type, count }) => <div key={type}><span>{type}</span><strong>{count}</strong></div>)}<div className={factionMismatchCount ? "warning" : ""}><span>Faction issues</span><strong>{factionMismatchCount}</strong></div></div>
          <div className="selected-card-list">{cardCounts.length ? cardCounts.sort((a, b) => a.card.type.localeCompare(b.card.type) || a.card.displayName.localeCompare(b.card.displayName)).map(({ card, count }) => <article key={card.id}><img src={card.art} alt={card.displayName} /><div><strong>{card.displayName}</strong><span>{card.type} • {card.faction} • {card.cost} Energy • {card.rarity}</span><small>{card.effect}</small></div><div className="deck-quantity-controls"><button onClick={() => removeCard(card.catalogId)}>−</button><b>{count}</b><button disabled={count >= cardCopyLimit || deck.cardIds.length >= 40} onClick={() => addCard(card.catalogId)}>+</button></div></article>) : <div className="empty-deck-list"><strong>NO MAIN-DECK CARDS SELECTED</strong><span>Use the Cards tab in the catalogue to build the deck.</span></div>}</div>
        </section>
      </main>
    </div>
  </section>;
}

function Compendium({ query, setQuery, tab, setTab }: { query: string; setQuery: (q: string) => void; tab: "cards" | "rules" | "rulings"; setTab: (t: "cards" | "rules" | "rulings") => void }) {
  const cards = CARDS.filter((c) => `${c.name} ${c.effect} ${c.faction}`.toLowerCase().includes(query.toLowerCase()));
  const rules = RULE_ENTRIES.filter((r) => `${r.title} ${r.body}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHeader eyebrow="AUTHORITATIVE REFERENCE" title="CARD & RULES COMPENDIUM" copy="Inspect the playable card pool, digital adaptation rules, symbols, and administrator rulings." art="/assets/aquos.png" />
    <section className="compendium-toolbar"><label className="search-box large">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a card, keyword, symbol, or ruling…" /></label><div className="tabs"><button className={tab === "cards" ? "active" : ""} onClick={() => setTab("cards")}>CARDS</button><button className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>RULES & GLOSSARY</button><button className={tab === "rulings" ? "active" : ""} onClick={() => setTab("rulings")}>RULINGS</button></div></section>
    {tab === "cards" && <section className="compendium-cards">{cards.map((card) => <article className="reference-card" key={card.id}><img src={card.art} alt={card.name} /><div><Badge tone={factionClass(card.faction)}>{card.faction}</Badge><h2>{card.name}</h2><p>{card.effect}</p><div className="symbol-line"><Metric icon="/assets/symbols/energy.png" label="Cost" value={card.cost} /><Metric label="Type" value={card.type} /></div><button>OPEN OFFICIAL RULINGS →</button></div></article>)}</section>}
    {tab === "rules" && <section className="rule-grid">{rules.map((rule) => <article className="panel" key={rule.title}><Badge>{rule.category}</Badge><h2>{rule.title}</h2><p>{rule.body}</p><button>COPY RULE LINK</button></article>)}</section>}
    {tab === "rulings" && <section className="ruling-list"><article className="panel"><Badge tone="gold">PUBLISHED</Badge><h2>Second-Core adjacency weighting</h2><p>When Double Core succeeds, evaluate the Core behind the target first, then the Core in front, then either side. The chosen Core and all RNG rolls are published in the match log.</p><small>Effective: Original Battle Planet digital rules v1.0 • Administrator ruling</small></article><article className="panel unresolved"><Badge tone="red">NEEDS ADMIN RULING</Badge><h2>Submit an unanswered interaction</h2><p>Ambiguous interactions are not guessed by the client. Capture the card IDs, match event, and question for administrator review.</p><textarea placeholder="Describe the interaction and expected outcome…" /><AppButton tone="red">SUBMIT RULING REQUEST</AppButton></article></section>}
  </>;
}

function PlaySetup({ format, setFormat, mode, setMode, deck, decks, selectDeck, joinCode, setJoinCode, startSolo, createOnline, joinOnline, error }: { format: "bo1" | "bo3"; setFormat: (f: "bo1" | "bo3") => void; mode: "solo" | "online" | "join"; setMode: (m: "solo" | "online" | "join") => void; deck: DeckRecord; decks: DeckRecord[]; selectDeck: (id: string) => void; joinCode: string; setJoinCode: (v: string) => void; startSolo: () => void; createOnline: () => void; joinOnline: () => void; error: string }) {
  return <><PageHeader eyebrow="MATCH CONFIGURATION" title="CHOOSE THE BATTLE" copy="Lock a legal deck, match structure, and opponent path. Time limits adapt to decision complexity." art="/assets/pyrus.png" />
    <section className="setup-layout"><div className="panel setup-form"><div className="step-heading"><span>01</span><div><small>MATCH MODE</small><h2>WHO WILL YOU BRAWL?</h2></div></div><div className="choice-grid"><button className={mode === "solo" ? "active" : ""} onClick={() => setMode("solo")}><strong>TRAINING AI</strong><span>Immediate full match</span></button><button className={mode === "online" ? "active" : ""} onClick={() => setMode("online")}><strong>CREATE ONLINE ROOM</strong><span>Share a six-character code</span></button><button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}><strong>JOIN ROOM</strong><span>Enter an opponent code</span></button></div>
      <div className="step-heading"><span>02</span><div><small>MATCH STRUCTURE</small><h2>HOW MANY GAMES?</h2></div></div><div className="format-toggle"><button className={format === "bo1" ? "active" : ""} onClick={() => setFormat("bo1")}><b>BO1</b><strong>BEST OF ONE</strong><span>First game wins the match</span></button><button className={format === "bo3" ? "active" : ""} onClick={() => setFormat("bo3")}><b>BO3</b><strong>BEST OF THREE</strong><span>First to two game wins</span></button></div>
      <div className="step-heading"><span>03</span><div><small>LOCKED DECK</small><h2>SELECT YOUR ARSENAL</h2></div></div><select className="deck-select" value={deck.id} onChange={(e) => selectDeck(e.target.value)}>{decks.map((d) => <option value={d.id} key={d.id}>{d.name} — {deckIsLegal(d) ? "LEGAL" : "INVALID"}</option>)}</select>
      {mode === "join" && <label className="join-code">ROOM CODE<input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={6} placeholder="BP7K3M" /></label>}{error && <p className="error-message">{error}</p>}
      <AppButton tone="red" disabled={!deckIsLegal(deck) || (mode === "join" && joinCode.length < 5)} onClick={mode === "solo" ? startSolo : mode === "online" ? createOnline : joinOnline}>{mode === "solo" ? "START TRAINING MATCH" : mode === "online" ? "CREATE ONLINE ROOM" : "JOIN ONLINE ROOM"}</AppButton></div>
      <aside className="panel match-preview"><span className="eyebrow">MATCH PREVIEW</span><h2>{format === "bo1" ? "BEST OF ONE" : "BEST OF THREE"}</h2><div className="preview-deck"><img src={BAKUGAN.find((b) => b.id === deck.bakuganIds[0])?.art} alt="" /><strong>{deck.name}</strong><Badge tone={deckIsLegal(deck) ? "gold" : "red"}>{deckIsLegal(deck) ? "LEGAL" : "INVALID"}</Badge></div><ul><li>Original Battle Planet ruleset</li><li>Alternating twelve-Core placement</li><li>Secret targets and server RNG</li><li>Complexity-based priority timers</li><li>30-second reconnect grace</li><li>Random results visible in log</li></ul><p className="small-note">Deck revisions lock when both players ready. Online rooms poll an authoritative persistent match state.</p></aside></section></>;
}

function Lobby({ match, playerId, error, ready, leave }: { match: MatchState | null; playerId: string; error: string; ready: () => void; leave: () => void }) {
  if (!match) return <Empty title="NO ACTIVE ROOM" />;
  return <><PageHeader eyebrow="PRIVATE MATCH ROOM" title={`ROOM ${match.code}`} copy={`${match.format.toUpperCase()} • Original Battle Planet • Server-authoritative`} art="/assets/brawlers-group.png" actions={<AppButton tone="ghost" onClick={() => navigator.clipboard?.writeText(match.code)}>COPY ROOM CODE</AppButton>} />
    <section className="lobby-grid">{[0, 1].map((i) => { const p = match.players[i]; return <article className={`player-seat panel ${p?.ready ? "ready" : ""}`} key={i}>{p ? <><Badge tone={p.id === playerId ? "gold" : "blue"}>{p.id === playerId ? "YOU" : "OPPONENT"}</Badge><div className="seat-avatar">{p.name.slice(0, 2).toUpperCase()}</div><h2>{p.name}</h2><p>{p.bakugan.map((b) => b.name).join(" • ")}</p><div className="ready-status"><span className={p.ready ? "online" : "waiting"} />{p.ready ? "DECK LOCKED • READY" : "VALIDATING DECK…"}</div>{p.id === playerId && !p.ready && <AppButton tone="red" onClick={ready}>LOCK IN & READY</AppButton>}</> : <><div className="seat-avatar waiting">?</div><h2>WAITING FOR BRAWLER</h2><p>Share room code <strong>{match.code}</strong></p><div className="loading-bar" /></>}</article>; })}</section>
    <section className="lobby-rules panel"><div><span className="eyebrow">ROOM FORMAT</span><h2>{match.format === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</h2></div><div><span className="eyebrow">TIME PROFILE</span><h2>ADAPTIVE</h2><p>20–45 seconds by complexity</p></div><div><span className="eyebrow">RECONNECT</span><h2>00:30</h2><p>Then opponent wins</p></div><AppButton tone="ghost" onClick={leave}>LEAVE ROOM</AppButton></section>{error && <p className="error-message centered">{error}</p>}</>;
}


function ResultScreen({ match, playerId, history, nextGame, dashboard, openReplay }: { match: MatchState | null; playerId: string; history: ResultRecord[]; nextGame: () => void; dashboard: () => void; openReplay: () => void }) {
  if (!match) return <Empty title="NO RESULT" />; const won = match.winner === playerId; const needed = match.format === "bo3" ? 2 : 1; const complete = Math.max(...Object.values(match.series)) >= needed;
  return <section className={`result-page ${won ? "victory" : "defeat"}`}><img className="result-art" src="/assets/winner.png" alt="" /><div className="result-content"><Badge tone={won ? "gold" : "red"}>{complete ? "MATCH COMPLETE" : "SERIES INTERMISSION"}</Badge><h1>{won ? "VICTOR" : "DEFEAT"}</h1><p>{match.resultReason}</p><div className="series-score">{match.players.map((p) => <div key={p.id}><strong>{p.name}</strong><span>{match.series[p.id] ?? 0}</span></div>)}</div><div className="result-stats"><Metric label="Game" value={`${match.gameNumber}`} /><Metric label="Format" value={match.format.toUpperCase()} /><Metric label="Events" value={match.log.length} /><Metric label="Random results" value={match.log.filter((l) => l.kind === "random").length} /></div><div className="result-actions">{!complete && <AppButton tone="red" onClick={nextGame}>NEXT GAME • NEW MATRIX</AppButton>}<AppButton tone="gold" onClick={openReplay}>VIEW REPLAY</AppButton><AppButton tone="ghost" onClick={dashboard}>DASHBOARD</AppButton></div><small>Result stored in Match History • {history[0]?.at}</small></div></section>;
}

function HistoryScreen({ history, replay, setReplay, replayIndex, setReplayIndex }: { history: ResultRecord[]; replay: ResultRecord | null; setReplay: (r: ResultRecord | null) => void; replayIndex: number; setReplayIndex: (i: number) => void }) {
  return <><PageHeader eyebrow="MATCH ARCHIVE" title="HISTORY & REPLAY" copy="Inspect immutable results, deterministic event order, and published random outcomes." art="/assets/darkus.png" />
    {!replay ? <section className="history-layout"><div className="panel history-list"><div className="panel-heading"><div><span className="eyebrow">RECENT MATCHES</span><h2>{history.length} RECORDED</h2></div><select><option>All formats</option><option>Best of one</option><option>Best of three</option></select></div>{history.length ? history.map((item) => <button className="history-row" key={item.id} onClick={() => { setReplay(item); setReplayIndex(item.log.length - 1); }}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><strong>vs {item.opponent}</strong><span>{item.score}</span><span>{item.reason}</span><small>{item.at}</small><i>OPEN REPLAY →</i></button>) : <div className="empty-state"><strong>NO MATCHES YET</strong><p>Complete a training or online match to create a replay.</p></div>}</div><aside className="panel archive-stats"><h2>ARCHIVE SUMMARY</h2><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((h) => h.result === "Victor").length} /><Metric label="Replays" value={history.length} /></aside></section>
    : <section className="replay-page"><header><button onClick={() => setReplay(null)}>← HISTORY</button><div><span className="eyebrow">REPLAY {replay.id}</span><h2>{replay.result} vs {replay.opponent}</h2></div><AppButton tone="ghost" onClick={() => navigator.clipboard?.writeText(location.href)}>SHARE</AppButton></header><div className="replay-theatre"><div className="replay-event"><Badge tone={replay.log[replayIndex]?.kind === "random" ? "gold" : "blue"}>{replay.log[replayIndex]?.kind.toUpperCase()}</Badge><h2>{replay.log[replayIndex]?.message}</h2><small>{new Date(replay.log[replayIndex]?.at ?? 0).toLocaleTimeString()}</small></div><div className="replay-board"><img src="/assets/playmat.webp" alt="Battlefield reconstruction" /></div><aside>{replay.log.map((event, i) => <button className={i === replayIndex ? "active" : ""} key={event.id} onClick={() => setReplayIndex(i)}><span>{i + 1}</span>{event.message}</button>)}</aside></div><div className="replay-controls"><button onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}>◀ STEP</button><input type="range" min="0" max={Math.max(0, replay.log.length - 1)} value={replayIndex} onChange={(e) => setReplayIndex(Number(e.target.value))} /><button onClick={() => setReplayIndex(Math.min(replay.log.length - 1, replayIndex + 1))}>STEP ▶</button><Badge>{replayIndex + 1} / {replay.log.length}</Badge></div></section>}</>;
}

function ProfileScreen({ profile, setProfile, history, decks, authUser, saveProfile }: { profile: Profile; setProfile: React.Dispatch<React.SetStateAction<Profile>>; history: ResultRecord[]; decks: DeckRecord[]; authUser: AuthUser | null; saveProfile: () => void }) {
  return <><PageHeader eyebrow="BRAWLER IDENTITY" title={profile.name.toUpperCase()} copy="Manage the public information other Brawlers see in challenges, rooms, and shared records." art={`/assets/${profile.faction.toLowerCase() === "aurelus" ? "brawlers-group" : profile.faction.toLowerCase()}.png`} />
    <section className="profile-layout"><article className="panel profile-card"><div className={`large-avatar ${factionClass(profile.faction)}`}>{profile.name.slice(0, 2).toUpperCase()}</div><Badge tone={authUser ? "gold" : "blue"}>{authUser ? "CLOUD ACCOUNT" : "LOCAL PROFILE"}</Badge>{authUser && <small className="account-email">{authUser.email}</small>}<label>DISPLAY NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label><AppButton tone="red" onClick={saveProfile}>SAVE PROFILE</AppButton><small>{authUser ? "Profile changes sync to signed-in devices." : "Profile changes are retained in this browser."}</small></article><article className="panel profile-stats"><span className="eyebrow">BRAWLER RECORD</span><h2>ORIGINAL BATTLE PLANET</h2><div className="stat-grid"><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item) => item.result === "Victor").length} /><Metric label="Legal decks" value={decks.filter(deckIsLegal).length} /><Metric label="Public decks" value={decks.filter((deck) => deck.visibility === "Public").length} /></div><h3>PUBLIC DECKS</h3>{decks.filter((deck) => deck.visibility === "Public").map((deck) => <div className="public-deck" key={deck.id}><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span><Badge tone="gold">LEGAL</Badge></div>)}</article></section></>;
}

function SettingsScreen({ settings, setSettings, authUser, syncStatus, syncError, signOut, openAccount, syncNow, changePassword, deleteAccount }: { settings: AppSettings; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; authUser: AuthUser | null; syncStatus: SyncStatus; syncError: string; signOut: () => Promise<void>; openAccount: () => void; syncNow: () => void; changePassword: (currentPassword: string, newPassword: string) => Promise<void>; deleteAccount: (confirmation: string) => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accountError, setAccountError] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const clearLocalProfile = () => { if (window.confirm("Delete all Bakugan TCG Online data stored in this browser?")) { localStorage.clear(); window.location.reload(); } };
  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setAccountBusy(true);
    setAccountError("");
    try { await changePassword(currentPassword, newPassword); setCurrentPassword(""); setNewPassword(""); }
    catch (error) { setAccountError(error instanceof Error ? error.message : "Could not change password."); }
    finally { setAccountBusy(false); }
  };
  const removeAccount = async () => {
    setAccountBusy(true);
    setAccountError("");
    try { await deleteAccount(confirmation); }
    catch (error) { setAccountError(error instanceof Error ? error.message : "Could not delete account."); }
    finally { setAccountBusy(false); }
  };
  return <><PageHeader eyebrow="CLIENT PREFERENCES" title="SETTINGS" copy="Accessibility, audio, display, privacy, challenge, local storage, cloud sync, and account controls." art="/assets/haos.png" />
    <section className="settings-grid"><article className="panel"><h2>ACCESSIBILITY</h2><Toggle label="Reduced motion" copy="Replace camera moves and flashes with static emphasis." checked={settings.reducedMotion} onChange={(value) => setSettings({ ...settings, reducedMotion: value })} /><Toggle label="High contrast" copy="Increase panel, border, and focus contrast." checked={settings.highContrast} onChange={(value) => setSettings({ ...settings, highContrast: value })} /><label className="range-setting"><span>Card scale <b>{settings.cardScale}%</b></span><input type="range" min="80" max="140" value={settings.cardScale} onChange={(event) => setSettings({ ...settings, cardScale: Number(event.target.value) })} /></label></article><article className="panel"><h2>AUDIO & MATCH LOG</h2><Toggle label="Interface and match audio" copy="Phase calls, priority, and result cues." checked={settings.sound} onChange={(value) => setSettings({ ...settings, sound: value, soundEnabled: value })} /><label>DEFAULT LOG DETAIL<select value={settings.logDetail} onChange={(event) => setSettings({ ...settings, logDetail: event.target.value })}><option>All events</option><option>Gameplay only</option><option>Random results</option></select></label></article><article className="panel"><h2>PRIVACY & SOCIAL</h2><label>WHO CAN CHALLENGE YOU<select value={settings.challenges} onChange={(event) => setSettings({ ...settings, challenges: event.target.value })}><option>Everyone</option><option>Friends only</option><option>No one</option></select></label><Toggle label="Allow replay links" copy="Share privacy-safe completed match records." checked onChange={() => {}} /><button className="text-button">MANAGE BLOCKED BRAWLERS →</button></article>
      <article className="panel account-management"><div className="panel-heading"><div><span className="eyebrow">DATA & ACCOUNT</span><h2>{authUser ? "CLOUD SYNC" : "LOCAL STORAGE"}</h2></div><Badge tone={syncStatus === "synced" ? "gold" : syncStatus === "error" ? "red" : "blue"}>{syncStatus.toUpperCase()}</Badge></div>{authUser ? <><div className="account-summary"><strong>{authUser.email}</strong><span>Decks, drafts, history, settings, and resumable state sync automatically.</span></div>{syncError && syncStatus === "error" && <p className="error-message">{syncError}</p>}<div className="account-actions"><AppButton tone="blue" onClick={syncNow}>SYNC NOW</AppButton><AppButton tone="ghost" onClick={signOut}>SIGN OUT</AppButton></div><form className="password-form" onSubmit={submitPassword}><h3>CHANGE PASSWORD</h3><label>CURRENT PASSWORD<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><AppButton type="submit" tone="ghost" disabled={accountBusy}>UPDATE PASSWORD</AppButton></form><div className="delete-account"><h3>DELETE ACCOUNT</h3><p>This removes the cloud account and synced copy. The local browser copy remains until you delete it separately.</p><label>TYPE DELETE TO CONFIRM<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-text" disabled={accountBusy || confirmation.toUpperCase() !== "DELETE"} onClick={removeAccount}>DELETE CLOUD ACCOUNT</button></div></> : <><div className="storage-callout"><strong>SAVED ON THIS DEVICE</strong><span>Refreshes and browser restarts retain your decks, settings, drafts, match history, and active state.</span></div><AppButton tone="red" onClick={openAccount}>SIGN UP OR LOG IN TO SYNC</AppButton></>}{accountError && <p className="error-message" role="alert">{accountError}</p>}<hr /><button className="danger-text" onClick={clearLocalProfile}>DELETE LOCAL BROWSER DATA</button></article></section></>;
}

function Toggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><div><strong>{label}</strong><small>{copy}</small></div><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>; }
function Timer({ deadline }: { deadline: number }) { const [now, setNow] = useState(0); useEffect(() => { const tick = () => setNow(Date.now()); const start = window.setTimeout(tick, 0); const i = window.setInterval(tick, 1000); return () => { window.clearTimeout(start); window.clearInterval(i); }; }, []); const seconds = Math.max(0, Math.ceil((deadline - (now || deadline - 30_000)) / 1000)); return <div className={`timer ${seconds <= 10 ? "warning" : ""}`}><small>TIME REMAINING</small><strong>00:{String(seconds).padStart(2, "0")}</strong></div>; }
function BootScreen({ label }: { label: string }) { return <main className="boot-screen"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><span className="pulse" /><h1>{label}</h1><p>Restoring decks, settings, drafts, history, and active state…</p></main>; }
function Empty({ title }: { title: string }) { return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p></section>; }
