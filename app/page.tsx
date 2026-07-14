"use client";

import { useEffect, useRef, useState } from "react";
import {
  HEX_CELLS, cardChoiceSpec, concedeMatch, createMatch, discardToHandLimit, energizeCard,
  legalPlacementCells, passPriority, placeCore, playCard, resolveDamage, selectBakugan,
  setReady, startNextSeriesGame, targetCore, totalDamage, totalPower, uid,
  type CardChoices, type CoreType, type GameCard, type MatchState,
} from "../lib/game";
import { BAKUGAN, CARDS, CORES, RULE_ENTRIES, STARTER_DECKS, deckErrors, deckIsLegal, makePlayer, type DeckFormat, type DeckRecord } from "../lib/data";
import { mergeSnapshots, normalizeSnapshot, type AppRoute as Route, type AppSettings, type BrawlerProfile as Profile, type MatchResultRecord as ResultRecord, type UserSnapshot } from "../lib/persistence";

type AuthUser = { id: string; email: string; displayName: string; faction: string; createdAt: number };
type SyncStatus = "checking" | "local" | "loading" | "saving" | "synced" | "offline" | "error";

const NAV: { route: Route; label: string; key: string }[] = [
  { route: "dashboard", label: "Dashboard", key: "01" }, { route: "play", label: "Play", key: "02" },
  { route: "decks", label: "Decks", key: "03" }, { route: "compendium", label: "Compendium", key: "04" },
  { route: "history", label: "History", key: "05" }, { route: "profile", label: "Profile", key: "06" },
];

const factionClass = (name: string) => `faction-${name.toLowerCase()}`;
const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const CORE_BACK_ART: Record<CoreType, string> = {
  Fist: "/assets/core-backs/fist.png",
  "Flaming Fist": "/assets/core-backs/flaming-fist.png",
  Shield: "/assets/core-backs/shield.png",
  "Magic Shield": "/assets/core-backs/magic-shield.png",
  Helix: "/assets/core-backs/helix.png",
};

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
        {match && !["result"].includes(match.phase) && <button className="resume-chip" onClick={() => setRoute(match.phase === "placement" ? "placement" : match.phase === "lobby" ? "lobby" : "match")}><span className="pulse" /> Resume match</button>}
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

  const persistenceReady = [routeReady, profileReady, decksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, selectedCoreReady, logFilterReady, replayReady, replayIndexReady, playerIdReady, modifiedReady].every(Boolean);

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
    const destination: Route = match.phase === "lobby" ? "lobby" : match.phase === "placement" ? "placement" : match.phase === "result" ? "result" : "match";
    if (route === destination || !["lobby", "placement", "match", "result"].includes(route)) return;
    const id = window.setTimeout(() => setRoute(destination), 0);
    return () => window.clearTimeout(id);
  }, [match?.phase, match?.version, route]);

  const api = async (action: string, payload?: Record<string, unknown>, explicitCode?: string, playerOverride?: ReturnType<typeof makePlayer>) => {
    setMatchError("");
    const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, code: explicitCode ?? match?.code, playerId, expectedVersion: match?.version, format, player: playerOverride, payload }) });
    const data = await response.json() as { state?: MatchState; error?: string };
    if (!response.ok) { if (data.state) setMatch(data.state); throw new Error(data.error ?? "Match request failed."); }
    if (data.state) setMatch(data.state); return data.state!;
  };

  useEffect(() => {
    if (!online || !match?.code) return;
    const id = setInterval(() => api("get").catch((e) => setMatchError(e.message)), 1600);
    return () => clearInterval(id);
  }, [online, match?.code, match?.version]);

  const settleAI = (state: MatchState) => {
    const bot = state.players.find((p) => p.id !== playerId); if (!bot) return state;
    let next = state;
    try {
      if (next.phase === "placement" && next.priority === bot.id) {
        const core = bot.cores.find((c) => !next.placements.some((p) => p.playerId === bot.id && p.core.id === c.id))!;
        const legal = legalPlacementCells(next);
        const compactCell = legal.map((id) => HEX_CELLS.find((cell) => cell.id === id)!)
          .sort((a, b) => (Math.abs(a.q) + Math.abs(a.r) + Math.abs(a.q + a.r)) - (Math.abs(b.q) + Math.abs(b.r) + Math.abs(b.q + b.r)))[0];
        next = placeCore(next, bot.id, core.id, compactCell.id);
      } else if (next.phase === "energize" && !bot.energizedThisTurn) {
        next = energizeCard(next, bot.id, bot.hand[0]?.id);
      } else if (next.phase === "selection" && !next.selected[bot.id]) {
        const closed = bot.bakugan.filter((bakugan) => !bakugan.open); next = selectBakugan(next, bot.id, (closed[0] ?? bot.bakugan[0]).id);
      } else if (next.phase === "target" && !next.targets[bot.id]) {
        const choices = next.placements.filter((placement) => !placement.attachedTo).map((p) => p.cell); next = targetCore(next, bot.id, choices[(next.gameNumber + next.version) % choices.length]);
      } else if (["preRoll", "power", "victor", "postDamage", "endPlay"].includes(next.phase) && next.priority === bot.id) {
        const playable = next.phase === "power" ? bot.hand.find((card) => card.type === "Action" && typeof card.cost === "number" && card.cost <= bot.energy && cardChoiceSpec(next, bot.id, card).length === 0) : undefined;
        if (playable && next.passes.length === 0 && Math.random() > .55) next = playCard(next, bot.id, playable.id); else next = passPriority(next, bot.id);
      } else if (next.phase === "damage" && next.pendingLoser === bot.id) {
        const flip = next.revealedFlip; const cost = typeof flip?.cost === "number" ? flip.cost : 0; next = resolveDamage(next, bot.id, flip && cost <= bot.energy ? flip.id : undefined);
      } else if (next.phase === "handLimit" && next.priority === bot.id) {
        next = discardToHandLimit(next, bot.id, bot.hand.slice(0, Math.max(0, bot.hand.length - 7)).map((card) => card.id));
      }
    } catch {}
    return next;
  };

  useEffect(() => {
    if (!match || online || match.phase === "result") return;
    const bot = match.players.find((p) => p.id !== playerId); if (!bot) return;
    const shouldAct = (match.phase === "placement" && match.priority === bot.id) || (match.phase === "energize" && !bot.energizedThisTurn) || (match.phase === "selection" && !match.selected[bot.id]) || (match.phase === "target" && !match.targets[bot.id]) || (["preRoll", "power", "victor", "postDamage", "endPlay"].includes(match.phase) && match.priority === bot.id) || (match.phase === "damage" && match.pendingLoser === bot.id && !!match.revealedFlip) || (match.phase === "handLimit" && match.priority === bot.id);
    if (!shouldAct) return;
    const id = setTimeout(() => setMatch((current) => current ? settleAI(current) : current), 650);
    return () => clearTimeout(id);
  }, [match?.version, online]);

  const localAction = (fn: (state: MatchState) => MatchState) => {
    if (!match) return; try { const next = fn(match); setMatch(next); setMatchError(""); } catch (e) { setMatchError(e instanceof Error ? e.message : "Illegal action."); }
  };

  const command = (action: string, payload?: Record<string, unknown>, localFn?: (state: MatchState) => MatchState) => {
    if (online) api(action, payload).catch((e) => setMatchError(e.message)); else if (localFn) localAction(localFn);
  };

  const startSolo = () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    const botDeck = STARTER_DECKS[1]; const state = createMatch(randomCode(), format, [makePlayer(playerId, profile.name, selectedDeck), makePlayer("training-bot", "Mira Nova • Training AI", botDeck)]);
    const ready = setReady(setReady(state, playerId), "training-bot"); setOnline(false); setMatch(ready); setRoute("placement");
  };

  const createOnline = async () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    const code = randomCode();
    try { const state = await api("create", undefined, code, makePlayer(playerId, profile.name, selectedDeck)); setOnline(true); setMatch(state); setRoute("lobby"); }
    catch (e) { setMatchError(e instanceof Error ? e.message : "Could not create room."); }
  };

  const joinOnline = async () => {
    if (!selectedDeck || !deckIsLegal(selectedDeck)) return setToast("Select a legal deck first.");
    try { const state = await api("join", undefined, joinCode.toUpperCase(), makePlayer(playerId, profile.name, selectedDeck)); setOnline(true); setMatch(state); setRoute("lobby"); }
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
  else if (route === "placement") content = <PlacementScreen match={match} playerId={playerId} faction={profile.faction} selectedCore={selectedCore} setSelectedCore={setSelectedCore} error={matchError} place={(coreId, cell) => command("place", { coreId, cell }, (s) => placeCore(s, playerId, coreId, cell))} undo={() => command("undo")} />;
  else if (route === "match") content = <FullMatchScreen match={match} playerId={playerId} faction={profile.faction} error={matchError} logFilter={logFilter} setLogFilter={setLogFilter} command={command} />;
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
    {match && match.phase !== "result" && <section className="alert-strip"><div><span className="pulse" /><strong>ACTIVE MATCH</strong><p>{match.code} • {match.stepLabel}</p></div><AppButton onClick={() => setRoute(match.phase === "placement" ? "placement" : match.phase === "lobby" ? "lobby" : "match")}>RESUME</AppButton></section>}
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

function PlacementScreen({ match, playerId, faction, selectedCore, setSelectedCore, error, place, undo }: { match: MatchState | null; playerId: string; faction: string; selectedCore: string; setSelectedCore: (id: string) => void; error: string; place: (core: string, cell: string) => void; undo: () => void }) {
  if (!match) return <Empty title="NO ACTIVE MATCH" />; const player = match.players.find((p) => p.id === playerId); const legal = legalPlacementCells(match); const mine = match.priority === playerId;
  return <section className="placement-page tabletop-placement" data-faction={faction.toLowerCase()}><header className="game-status"><div><Badge tone="gold">GAME {match.gameNumber}</Badge><strong>{match.format.toUpperCase()} • {Object.values(match.series).join("–")}</strong></div><div><span className="eyebrow">{match.stepLabel}</span><h1>{mine ? "PLACE A BAKUCORE" : "OPPONENT PLACING"}</h1></div><Timer deadline={match.deadline} /><button onClick={undo}>↶ UNDO REQUEST</button></header>
    <div className="placement-layout"><aside className="panel core-tray"><span className="eyebrow">YOUR UNUSED CORES</span><h2>SELECT ONE</h2>{player?.cores.map((core) => { const used = match.placements.some((p) => p.playerId === playerId && p.core.id === core.id); return <button disabled={used || !mine} className={selectedCore === core.id ? "selected" : ""} key={core.id} onClick={() => setSelectedCore(core.id)}><img src={core.art} alt={core.name} /><span>{core.name}</span>{used && <Badge>PLACED</Badge>}</button>; })}<p className="small-note">First Core is centre-only. Later Cores must touch the existing matrix.</p></aside>
      <main className="matrix-panel"><div className="matrix-heading"><div><span className="eyebrow">HIDE MATRIX</span><h2>{match.placements.length} / 12 CORES PLACED</h2></div><div className="orientation">↑ ROLL DIRECTION / FRONT</div></div><div className="hex-matrix">{HEX_CELLS.map((cell) => { const placed = match.placements.find((p) => p.cell === cell.id); const canPlace = mine && !!selectedCore && legal.includes(cell.id); return <button key={cell.id} className={`matrix-cell ${placed ? "occupied" : ""} ${canPlace ? "legal" : ""}`} style={{ "--q": cell.q, "--r": cell.r } as React.CSSProperties} disabled={!canPlace} onClick={() => { place(selectedCore, cell.id); setSelectedCore(""); }}>{placed ? <><span className="placement-core-back" aria-label={`Face-down ${placed.core.type} BakuCore`}><img src={CORE_BACK_ART[placed.core.type]} alt="" /></span><b>{placed.order}</b></> : <i>{canPlace ? "+" : ""}</i>}</button>; })}</div><div className="matrix-legend"><span><i className="you" /> Your Core</span><span><i className="them" /> Opponent Core</span><span><i className="legal" /> Legal placement</span></div></main>
      <aside className="panel placement-log"><span className="eyebrow">PLACEMENT ORDER</span><h2>EVENTS</h2>{match.log.filter((l) => l.kind === "game").slice(-8).reverse().map((l) => <p key={l.id}><time>{new Date(l.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>{l.message}</p>)}</aside></div>{error && <p className="error-message game-error">{error}</p>}</section>;
}

function LegacyMatchScreen({ match, playerId, error, logFilter, setLogFilter, command }: { match: MatchState | null; playerId: string; error: string; logFilter: string; setLogFilter: (v: string) => void; command: (action: string, payload?: Record<string, unknown>, localFn?: (s: MatchState) => MatchState) => void }) {
  if (!match) return <Empty title="NO ACTIVE MATCH" />; const me = match.players.find((p) => p.id === playerId)!; const foe = match.players.find((p) => p.id !== playerId)!; const myTurn = match.priority === playerId; const myRoll = match.rolls[playerId]; const foeRoll = match.rolls[foe.id]; const filteredLog = match.log.filter((l) => logFilter === "all" || l.kind === logFilter);
  return <section className="match-page"><header className="game-status compact"><div><Badge tone="red">LIVE</Badge><strong>{match.code} • GAME {match.gameNumber}</strong></div><div><span className="eyebrow">{match.stepLabel}</span><h1>{match.phase === "selection" ? "SELECT A CLOSED BAKUGAN" : match.phase === "target" ? "CHOOSE A SECRET TARGET" : match.phase === "power" ? `${myTurn ? "YOUR" : "OPPONENT"} PRIORITY` : match.phase === "damage" ? "DAMAGE & FLIP WINDOW" : "END PLAY"}</h1></div><Timer deadline={match.deadline} /><div className="connection"><span className={foe.connected ? "online" : "offline"} />{foe.connected ? "CONNECTED" : "RECONNECT 00:30"}</div></header>
    <div className="battle-layout"><aside className="battle-rail left"><PlayerRail player={foe} match={match} playerId={playerId} opponent /></aside>
      <main className="battlefield"><div className="battlefield-bg" /><div className="opponent-bakugan">{match.selected[foe.id] && <img src={foe.bakugan.find((b) => b.id === match.selected[foe.id])?.art} alt="" />}</div><div className="battle-core-field">{match.placements.map((p) => <button key={p.cell} className={`${match.phase === "target" ? "targetable" : ""} ${match.targets[playerId] === p.cell ? "targeted" : ""}`} onClick={() => match.phase === "target" && command("target", { cell: p.cell }, (s) => targetCore(s, playerId, p.cell))}><img src={p.core.art} alt={p.core.name} /><span>{p.cell}</span></button>)}</div><div className="player-bakugan">{match.selected[playerId] && <img src={me.bakugan.find((b) => b.id === match.selected[playerId])?.art} alt="" />}</div>
        {(myRoll || foeRoll) && <div className="roll-banner">{[foeRoll, myRoll].map((roll) => roll && <div key={roll.playerId}><strong>{roll.playerId === playerId ? "YOU" : foe.name}</strong><span>{roll.result.replaceAll("-", " ")}</span><small>Accuracy {roll.accuracyRoll} • Double {roll.doubleRoll}</small></div>)}</div>}</main>
      <aside className="battle-rail right"><section className="decision-panel"><span className="eyebrow">LEGAL ACTIONS</span><h2>{match.stepLabel}</h2>{match.phase === "selection" && <div className="bakugan-choice">{me.bakugan.map((b) => <button key={b.id} onClick={() => command("select", { bakuganId: b.id }, (s) => selectBakugan(s, playerId, b.id))}><img src={b.art} alt="" /><strong>{b.name}</strong><span>{b.bPower}B / {b.damage}D</span><small>ACC {b.rollAccuracy}% • DOUBLE {b.doubleCoreChance}%</small></button>)}</div>}
        {match.phase === "target" && <p>Select a highlighted Core in the centre field. Your target remains secret until both players lock.</p>}
        {match.phase === "power" && <><div className="power-score"><div><small>YOUR TOTAL</small><strong>{totalPower(match, playerId)}</strong></div><span>VS</span><div><small>OPPONENT</small><strong>{totalPower(match, foe.id)}</strong></div></div><div className="hand-actions">{me.hand.filter((c) => c.type !== "Flip").map((card) => <button key={card.id} disabled={!myTurn || (typeof card.cost === "number" && card.cost > me.energy)} onClick={() => command("play", { cardId: card.id }, (s) => playCard(s, playerId, card.id))}><img src={card.art} alt="" /><span>{card.name}</span><small>{card.cost} Energy • {card.effect}</small></button>)}</div><AppButton tone="red" disabled={!myTurn} onClick={() => command("pass", undefined, (s) => passPriority(s, playerId))}>PASS PRIORITY</AppButton><AppButton tone="ghost" disabled={!myTurn} onClick={() => command("undo")}>↶ REQUEST UNDO</AppButton></>}
        {match.phase === "damage" && match.pendingLoser === playerId && <><div className="damage-callout"><strong>{match.pendingDamage}</strong><span>INCOMING DAMAGE</span></div><div className="hand-actions">{me.hand.filter((c) => c.type === "Flip").map((card) => <button key={card.id} disabled={typeof card.cost === "number" && card.cost > me.energy} onClick={() => command("damage", { cardId: card.id }, (s) => resolveDamage(s, playerId, card.id))}><img src={card.art} alt="" /><span>FLIP • {card.name}</span><small>{card.effect}</small></button>)}</div><AppButton tone="red" onClick={() => command("damage", {}, (s) => resolveDamage(s, playerId))}>TAKE DAMAGE</AppButton></>}
        {match.phase === "damage" && match.pendingLoser !== playerId && <p>Opponent is resolving the Flip window.</p>}
        {match.phase === "endPlay" && <><p>The final priority window is open before Energy charges and turn modifiers reset.</p><AppButton tone="red" disabled={!myTurn} onClick={() => command("pass", undefined, (s) => passPriority(s, playerId))}>PASS PRIORITY</AppButton></>}
        {error && <p className="error-message">{error}</p>}</section>
        <section className="match-log"><div className="log-head"><span>MATCH LOG</span><select value={logFilter} onChange={(e) => setLogFilter(e.target.value)}><option value="all">All events</option><option value="game">Gameplay</option><option value="random">Random results</option><option value="connection">Connection</option></select></div>{filteredLog.slice(-12).reverse().map((item) => <p className={item.kind} key={item.id}><time>{new Date(item.at).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</time>{item.message}</p>)}</section></aside></div>
    <footer className="match-hand"><div><span className="eyebrow">YOUR HAND</span><strong>{me.hand.length} CARDS</strong></div>{me.hand.map((card) => <img key={card.id} src={card.art} alt={card.name} title={`${card.name}: ${card.effect}`} />)}<div className="energy-pool"><img src="/assets/symbols/energy.png" alt="Energy" /><strong>{me.energy}/{me.maxEnergy}</strong><span>ENERGY</span></div></footer></section>;
}

function useBattleViewport() {
  const [viewport, setViewport] = useState({ scale: 1, width: 1680, height: 900 });
  useEffect(() => {
    const update = () => {
      const visualViewport = window.visualViewport;
      const width = Math.max(1, visualViewport?.width ?? window.innerWidth);
      const height = Math.max(1, visualViewport?.height ?? window.innerHeight);
      // The match screen is a dense, fixed-composition tabletop. Scale it from
      // both axes so short laptop windows and browser zoom never crop the hand,
      // player zones, or action rail. The virtual canvas grows by the inverse
      // amount, so the scaled result still fills the complete viewport.
      const scale = Math.max(0.5, Math.min(1, width / 1180, height / 900));
      setViewport({
        scale,
        width: Math.ceil(width / scale),
        height: Math.ceil(height / scale),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return viewport;
}

function FullMatchScreen({ match, playerId, faction, error, logFilter, setLogFilter, command }: { match: MatchState | null; playerId: string; faction: string; error: string; logFilter: string; setLogFilter: (v: string) => void; command: (action: string, payload?: Record<string, unknown>, localFn?: (s: MatchState) => MatchState) => void }) {
  const battleViewport = useBattleViewport();
  const [pendingCardId, setPendingCardId] = useState("");
  const [choices, setChoices] = useState<CardChoices>({});
  const [limitCards, setLimitCards] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(true);
  const [showRollNotice, setShowRollNotice] = useState(false);
  const [focusedCardId, setFocusedCardId] = useState("");
  const [focusedBakuganId, setFocusedBakuganId] = useState("");
  const rollSignature = match ? Object.values(match.rolls).map((roll) => `${roll.playerId}:${roll.result}:${roll.accuracyRoll}:${roll.doubleRoll}`).join("|") : "";
  useEffect(() => {
    if (!rollSignature) return;
    const reveal = window.setTimeout(() => setShowRollNotice(true), 0);
    const hide = window.setTimeout(() => setShowRollNotice(false), 4200);
    return () => { window.clearTimeout(reveal); window.clearTimeout(hide); };
  }, [rollSignature]);
  useEffect(() => {
    const reset = window.setTimeout(() => { setPendingCardId(""); setChoices({}); setLimitCards([]); }, 0);
    return () => window.clearTimeout(reset);
  }, [match?.phase, match?.version]);
  if (!match) return <Empty title="NO ACTIVE MATCH" />;
  const me = match.players.find((player) => player.id === playerId)!; const foe = match.players.find((player) => player.id !== playerId)!;
  const myTurn = match.priority === playerId; const myRoll = match.rolls[playerId]; const foeRoll = match.rolls[foe.id];
  const pending = me.hand.find((card) => card.id === pendingCardId); const specs = pending ? cardChoiceSpec(match, playerId, pending) : [];
  const focusedCard = me.hand.find((card) => card.id === (pendingCardId || focusedCardId));
  const focusedBakugan = [...me.bakugan, ...foe.bakugan].find((bakugan) => bakugan.id === focusedBakuganId);
  const filteredLog = match.log.filter((item) => item.kind !== "random" && (logFilter === "all" || item.kind === logFilter));
  const priorityWindow = ["preRoll", "power", "victor", "postDamage", "endPlay"].includes(match.phase);
  const phaseTitle: Record<string, string> = {
    energize: "CHOOSE A CARD TO ENERGIZE", selection: "SELECT A CLOSED BAKUGAN", preRoll: "PRE-ROLL PRIORITY",
    target: "CHOOSE A SECRET TARGET", power: "POWER STEP", victor: "VICTOR STEP", damage: "DAMAGE & FLIP WINDOW",
    postDamage: "POST-DAMAGE PRIORITY", endPlay: "END PHASE PLAY STEP", handLimit: "DISCARD TO SEVEN",
  };
  const phaseSteps = [
    { label: "START", phases: ["energize"] },
    { label: "ROLL", phases: ["selection", "preRoll", "target"] },
    { label: "BRAWL", phases: ["power", "victor", "damage", "postDamage", "retract"] },
    { label: "END", phases: ["endPlay", "handLimit"] },
  ];
  const brawlSteps = [
    { label: "POWER", phases: ["power"] },
    { label: "VICTOR", phases: ["victor"] },
    { label: "DAMAGE", phases: ["damage", "postDamage"] },
    { label: "RETRACT", phases: ["retract"] },
  ];
  const toggleChoice = (key: "discardCardIds" | "handCardIds", id: string) => setChoices((current) => {
    const list = current[key] ?? []; return { ...current, [key]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] };
  });
  const playPending = () => {
    if (!pending) return; const payload = { cardId: pending.id, choices };
    command("play", payload, (state) => playCard(state, playerId, pending.id, choices)); setPendingCardId(""); setChoices({});
  };
  const affordability = (card: GameCard) => card.cost === "X" || card.cost <= me.energy;
  const myBakugan = me.bakugan.find((bakugan) => bakugan.id === match.selected[playerId]);
  const foeBakugan = foe.bakugan.find((bakugan) => bakugan.id === match.selected[foe.id]);
  const heldCoresFor = (bakuganId: string) => match.placements.filter((placement) => placement.attachedTo === bakuganId);
  const myLatestDiscard = me.discard.at(-1);
  const foeLatestDiscard = foe.discard.at(-1);
  const myFaction = me.bakugan[0]?.faction ?? faction;
  const foeFaction = foe.bakugan[0]?.faction ?? "Pyrus";
  const roundTarget = match.format === "bo3" ? 2 : 1;
  const myScore = match.series[me.id] ?? 0;
  const foeScore = match.series[foe.id] ?? 0;
  const myPower = totalPower(match, playerId);
  const foePower = totalPower(match, foe.id);
  const powerLeader = myPower === foePower ? "TIED" : myPower > foePower ? "YOU LEAD" : `${foe.name.toUpperCase()} LEADS`;
  const majorPhase = phaseSteps.find((step) => step.phases.includes(match.phase))?.label ?? "MATCH";
  const rollLabel = (result: string) => ({ miss: "MISSED THE FIELD", "open-no-core": "OPENED WITHOUT A CORE", "target-core": "HIT THE TARGET CORE", "adjacent-core": "OPENED ON AN ADJACENT CORE", "double-core": "CAPTURED TWO CORES" }[result] ?? result.replaceAll("-", " "));
  const handLimitCount = Math.max(0, me.hand.length - 7);
  const canChooseHand = (card: GameCard) => (match.phase === "energize" && !me.energizedThisTurn)
    || (match.phase === "handLimit" && myTurn)
    || (priorityWindow && myTurn && !["Flip", "Character"].includes(card.type) && affordability(card));
  const chooseHandCard = (card: GameCard) => {
    if (match.phase === "energize" && !me.energizedThisTurn) {
      command("energize", { cardId: card.id }, (state) => energizeCard(state, playerId, card.id)); return;
    }
    if (match.phase === "handLimit" && myTurn) {
      setLimitCards((current) => current.includes(card.id) ? current.filter((id) => id !== card.id) : current.length < handLimitCount ? [...current, card.id] : current); return;
    }
    if (priorityWindow && myTurn && !["Flip", "Character"].includes(card.type) && affordability(card)) {
      setPendingCardId((current) => current === card.id ? "" : card.id); setChoices({ xValue: card.cost === "X" ? Math.min(1, me.energy) : undefined });
    }
  };
  const activeInstruction = match.phase === "energize" ? (me.energizedThisTurn ? `Waiting for ${foe.name}` : "Choose a card in your hand to charge as Energy")
    : match.phase === "selection" ? "Choose one of your closed Bakugan below"
    : match.phase === "target" ? "Choose a highlighted BakuCore on the playmat"
    : match.phase === "handLimit" ? (myTurn ? `Choose ${handLimitCount} card${handLimitCount === 1 ? "" : "s"} from your hand` : `Waiting for ${foe.name}`)
    : priorityWindow ? (myTurn ? "Play a card from your hand or pass priority" : `Priority: ${foe.name}`)
    : match.phase === "damage" ? `${match.pendingDamage} damage remaining` : match.stepLabel;
  return <section className="table-match battle-ui-v7" data-faction={faction.toLowerCase()}>
    <div className="battle-scale-stage" style={{
      "--battle-scale": battleViewport.scale,
      width: `${battleViewport.width}px`,
      height: `${battleViewport.height}px`,
    } as React.CSSProperties}>
    <header className="table-phasebar battle-topbar">
      <section className="phase-command">
        <span className="phase-kicker">{majorPhase} PHASE • {match.stepLabel}</span>
        <h1>{phaseTitle[match.phase] ?? match.stepLabel}</h1>
        <nav className="major-phase-track" aria-label="Major phase progress">{phaseSteps.map((step) => <i className={step.phases.includes(match.phase) ? "active" : ""} aria-current={step.phases.includes(match.phase) ? "step" : undefined} key={step.label}>{step.label}</i>)}</nav>
        <nav className={`brawl-step-track ${majorPhase === "BRAWL" ? "visible" : ""}`} aria-label="Brawl step progress">{brawlSteps.map((step) => <i className={step.phases.includes(match.phase) ? "active" : ""} key={step.label}>{step.label}</i>)}</nav>
      </section>
      <section className="battle-utilities"><div className="turn-badge"><small>TURN</small><strong>{match.turn}</strong></div><Timer deadline={match.deadline} /><button className="concede-button" onClick={() => command("concede", {}, (state) => concedeMatch(state, playerId))}>CONCEDE</button></section>
    </header>

    <main className="tabletop battle-layout">
      <aside className="battle-left-column">
        <section className="rail-card top-player-card opponent-profile" aria-label="Opponent status">
          <div className="identity-portrait"><img src={foeBakugan?.art ?? foe.bakugan[0]?.art} alt="" /><img className="identity-faction" src={`/assets/${foeFaction.toLowerCase()}.png`} alt={`${foeFaction} faction`} /></div>
          <div className="identity-copy"><small>OPPONENT • {foe.connected ? "CONNECTED" : "RECONNECTING"}</small><strong>{foe.name}</strong><span>{foeFaction} Brawler</span></div>
          <div className="round-score"><span>ROUNDS WON</span><strong>{foeScore}/{roundTarget}</strong></div>
        </section>
        <section className={`rail-card table-log ${logOpen ? "open" : "closed"}`}>
          <button className="table-panel-title" onClick={() => setLogOpen((open) => !open)}>EVENT LOG <span>{logOpen ? "−" : "+"}</span></button>
          {logOpen && <><select value={logFilter} onChange={(event) => setLogFilter(event.target.value)}><option value="all">Player events</option><option value="game">Gameplay</option><option value="system">System</option><option value="connection">Connection</option></select><div>{filteredLog.slice(-9).reverse().map((item) => <p className={item.kind} key={item.id}><time>{new Date(item.at).toLocaleTimeString([], { minute:"2-digit", second:"2-digit" })}</time>{item.message}</p>)}</div></>}
        </section>
        <section className="table-actions floating-action-window" aria-label="Available actions">
          <span className="floating-action-title">ACTIONS</span><small className="floating-action-copy">{activeInstruction}</small>
          {match.phase === "energize" && !me.energizedThisTurn && <AppButton tone="ghost" onClick={() => command("energize", {}, (state) => energizeCard(state, playerId))}>SKIP ENERGIZE</AppButton>}
          {priorityWindow && <><AppButton tone="gold" disabled={!pending || !myTurn} onClick={playPending}>{pending ? `PLAY ${pending.name}` : "SELECT A CARD"}</AppButton><AppButton tone="blue" disabled={!myTurn || !!pending} onClick={() => command("pass", {}, (state) => passPriority(state, playerId))}>{match.batch.length ? "PASS • RESOLVE TOP" : "PASS • LET OPPONENT RESPOND"}</AppButton><button className="undo-table" disabled={!myTurn || !!pending} onClick={() => command("undo")}>↶ UNDO LAST ACTION</button></>}
          {match.phase === "handLimit" && myTurn && <AppButton tone="red" disabled={limitCards.length !== handLimitCount} onClick={() => command("hand-limit", { cardIds: limitCards }, (state) => discardToHandLimit(state, playerId, limitCards))}>DISCARD {limitCards.length}/{handLimitCount}</AppButton>}
        </section>
        <section className="rail-card local-profile" aria-label="Your match identity">
          <div className="local-portrait"><img src={myBakugan?.art ?? me.bakugan[0]?.art} alt="" /><img src={`/assets/${myFaction.toLowerCase()}.png`} alt={`${myFaction} faction`} /></div>
          <div><small>YOU • {myFaction.toUpperCase()}</small><strong>{me.name}</strong><span>{myTurn ? "PRIORITY" : "WAITING"}</span></div>
          <div className="round-score"><span>ROUNDS WON</span><strong>{myScore}/{roundTarget}</strong></div>
        </section>
      </aside>

      <section className="battle-board-column" aria-label="Battlefield">
        <div className="playmat-surface">
          <div className="official-playmat" aria-hidden="true" />
          <section className="opponent-table-row mirrored-table-row" aria-label="Opponent play area">
            <section className="opponent-roster physical-character-row" aria-label="Opponent Bakugan">{foe.bakugan.map((bakugan) => <article tabIndex={0} className={`${match.selected[foe.id] === bakugan.id ? "active" : ""} ${bakugan.open ? "open" : "closed"}`} key={bakugan.id} aria-label={`${bakugan.name}, ${match.selected[foe.id] === bakugan.id ? "selected" : bakugan.open ? "open" : "closed"}`} onMouseEnter={() => setFocusedBakuganId(bakugan.id)} onMouseLeave={() => setFocusedBakuganId("")} onFocus={() => setFocusedBakuganId(bakugan.id)} onBlur={() => setFocusedBakuganId("")}><div className="held-core-fan">{heldCoresFor(bakugan.id).map((placement, index) => <img src={placement.core.art} alt={placement.core.name} style={{ "--core-i": index } as React.CSSProperties} key={placement.cell} />)}</div><img className="physical-character-card" src={bakugan.art} alt={bakugan.name} /></article>)}</section>
            <article className="opponent-hand-shelf"><label>HAND • {foe.hand.length}</label><div className="opponent-hand" aria-label={`${foe.hand.length} hidden cards`}>{foe.hand.slice(0, 8).map((card, index) => <i className="mini-card-back" style={{ "--i": index } as React.CSSProperties} key={`${card.id}-${index}`} />)}</div></article>
            <section className="opponent-zone-shelf physical-zone-shelf" aria-label="Opponent physical card zones">
              <article className="physical-zone hero-physical-zone"><label>HERO ZONE</label><div className={`physical-stack face-up-stack ${foe.heroes.length ? "has-card" : "empty"}`}>{foe.heroes.at(-1) ? <img src={foe.heroes.at(-1)!.art} alt={foe.heroes.at(-1)!.name} /> : <span>EMPTY</span>}<b>{foe.heroes.length}</b></div></article>
              <div className="lower-zone-row">
                <article className="physical-zone discard-physical-zone"><label>DISCARD</label><div className={`physical-stack face-up-stack ${foeLatestDiscard ? "has-card" : "empty"}`}>{foeLatestDiscard ? <img src={foeLatestDiscard.art} alt={foeLatestDiscard.name} /> : <span>EMPTY</span>}<b>{foe.discard.length}</b></div></article>
                <article className="physical-zone deck-physical-zone"><label>DECK</label><div className="physical-stack card-back"><b>{foe.deck}</b></div></article>
              </div>
              <div className="opponent-energy-counter"><span>ENERGY</span><strong>{foe.energy}/{foe.maxEnergy}</strong></div>
            </section>
          </section>

          <section className="hex-arena" aria-label="BakuCore Field">
            <div className="arena-lattice" aria-hidden="true">{HEX_CELLS.map((cell) => <i className="field-hex" key={cell.id} style={{ "--q": cell.q, "--r": cell.r } as React.CSSProperties} />)}</div>
            <div className="battle-core-field axial">{match.placements.filter((placement) => !placement.attachedTo).map((placement) => { const cell = HEX_CELLS.find((candidate) => candidate.id === placement.cell)!; const targetable = match.phase === "target"; return <button key={placement.cell} title={`Face-down ${placement.core.type} BakuCore`} aria-label={`Face-down ${placement.core.type} BakuCore`} className={`${targetable ? "targetable" : ""} ${match.targets[playerId] === placement.cell ? "targeted" : ""} face-down`} style={{ "--q": cell.q, "--r": cell.r } as React.CSSProperties} disabled={!targetable} onClick={() => command("target", { cell: placement.cell }, (state) => targetCore(state, playerId, placement.cell))}><span className="core-back"><img src={CORE_BACK_ART[placement.core.type]} alt="" /></span></button>; })}</div>
          </section>

          {showRollNotice && (myRoll || foeRoll) && <div className="table-roll-results">{[myRoll, foeRoll].map((roll) => roll && <div key={roll.playerId}><strong>{roll.playerId === playerId ? "YOU" : foe.name}</strong><span>{rollLabel(roll.result)}</span><small>{roll.cores.length ? `${roll.cores.length} BakuCore${roll.cores.length === 1 ? "" : "s"} captured` : "No BakuCore captured"}</small></div>)}</div>}

          <section className="player-roster physical-character-row" aria-label="Your Bakugan">{me.bakugan.map((bakugan) => <button key={bakugan.id} className={`${match.selected[playerId] === bakugan.id ? "active" : ""} ${bakugan.open ? "open" : "closed"}`} disabled={match.phase !== "selection" || bakugan.open || !!match.selected[playerId]} onClick={() => command("select", { bakuganId: bakugan.id }, (state) => selectBakugan(state, playerId, bakugan.id))} onMouseEnter={() => setFocusedBakuganId(bakugan.id)} onMouseLeave={() => setFocusedBakuganId("")} onFocus={() => setFocusedBakuganId(bakugan.id)} onBlur={() => setFocusedBakuganId("")} aria-label={`${bakugan.name}, ${match.selected[playerId] === bakugan.id ? "selected" : bakugan.open ? "open" : "closed"}`}><div className="held-core-fan">{heldCoresFor(bakugan.id).map((placement, index) => <img src={placement.core.art} alt={placement.core.name} style={{ "--core-i": index } as React.CSSProperties} key={placement.cell} />)}</div><img className="physical-character-card" src={bakugan.art} alt={bakugan.name} /></button>)}</section>

          <section className="player-zone-shelf physical-zone-shelf" aria-label="Your physical card zones">
            <article className="physical-zone hero-physical-zone"><label>HERO ZONE</label><div className={`physical-stack face-up-stack ${me.heroes.length ? "has-card" : "empty"}`}>{me.heroes.at(-1) ? <img src={me.heroes.at(-1)!.art} alt={me.heroes.at(-1)!.name} /> : <span>EMPTY</span>}<b>{me.heroes.length}</b></div></article>
            <div className="lower-zone-row">
              <article className="physical-zone discard-physical-zone"><label>DISCARD</label><div className={`physical-stack face-up-stack ${myLatestDiscard ? "has-card" : "empty"}`}>{myLatestDiscard ? <img src={myLatestDiscard.art} alt={myLatestDiscard.name} /> : <span>EMPTY</span>}<b>{me.discard.length}</b></div></article>
              <article className="physical-zone deck-physical-zone"><label>DECK</label><div className="physical-stack card-back"><b>{me.deck}</b></div></article>
            </div>
          </section>

          <section className="floating-counters" aria-label="Your hand and energy counts">
            <article><span>HAND</span><strong>{me.hand.length}</strong></article>
            <article className="energy-counter"><span>ENERGY</span><strong>{me.energy}/{me.maxEnergy}</strong></article>
          </section>
          {focusedBakugan ? <aside className="hand-inspector character-card-inspector table-card-inspector visible" aria-live="polite"><div><Badge tone="gold">CHARACTER</Badge><small>{focusedBakugan.faction}</small></div><strong>{focusedBakugan.name}</strong><p className="character-stats"><b>{focusedBakugan.bPower}B</b><b>{focusedBakugan.damage} DAMAGE</b></p><p>{focusedBakugan.character.effect || "No printed effect."}</p></aside> : focusedCard ? <aside className="hand-inspector character-card-inspector table-card-inspector visible" aria-live="polite"><div><Badge tone={affordability(focusedCard) ? "gold" : "red"}>{focusedCard.cost} ENERGY</Badge><small>{focusedCard.type}</small></div><strong>{focusedCard.name}</strong><p>{focusedCard.effect || "No printed effect."}</p></aside> : null}
        </div>
        <section className={`table-context ${myTurn ? "is-yours" : "is-waiting"}`} aria-live="polite"><span className="eyebrow">{myTurn ? "YOUR ACTION" : "OPPONENT ACTION"}</span><strong>{activeInstruction}</strong>{error && <small className="error-message">{error}</small>}</section>
      </section>

      <aside className="battle-right-column">
        <section className="rail-card combat-preview"><header><span className="table-panel-title">COMBAT PREVIEW</span><strong className={`leader-call ${myPower === foePower ? "tie" : myPower > foePower ? "winning" : "losing"}`}>{powerLeader}</strong></header><div className="combatants"><article>{myBakugan ? <img src={myBakugan.art} alt={myBakugan.name} /> : <i>?</i>}<strong>{myBakugan?.name ?? "Your Bakugan"}</strong><b>{myPower}<small>B</small></b><span className="stat-breakdown">BASE {myBakugan?.bPower ?? 0} • MOD {myBakugan ? `${myPower - myBakugan.bPower >= 0 ? "+" : ""}${myPower - myBakugan.bPower}` : "0"}</span><mark><img src="/assets/symbols/damage.png" alt="" />{totalDamage(match, playerId)} DAMAGE</mark></article><em>VS</em><article>{foeBakugan ? <img src={foeBakugan.art} alt={foeBakugan.name} /> : <i>?</i>}<strong>{foeBakugan?.name ?? "Opponent"}</strong><b>{foePower}<small>B</small></b><span className="stat-breakdown">BASE {foeBakugan?.bPower ?? 0} • MOD {foeBakugan ? `${foePower - foeBakugan.bPower >= 0 ? "+" : ""}${foePower - foeBakugan.bPower}` : "0"}</span><mark><img src="/assets/symbols/damage.png" alt="" />{totalDamage(match, foe.id)} DAMAGE</mark></article></div></section>

        <section className="rail-card batch-panel"><header><span>BATCH</span><b>{match.batch.length}</b></header>{match.batch.length ? <div>{[...match.batch].reverse().map((item, index) => <article key={item.id}><span>{index + 1}</span><img src={item.card.art} alt={item.card.name} /><div><strong>{item.card.name}</strong><small>{index === 0 ? "RESOLVES NEXT" : "WAITING"}</small></div></article>)}</div> : <p>No cards or abilities are waiting to resolve.</p>}</section>

      </aside>
    </main>

    <footer className="hand-dock">
      <div className="hand-fan">{me.hand.map((card, index) => { const available = canChooseHand(card); const fanOffset = index - (me.hand.length - 1) / 2; return <button key={card.id} className={`${pendingCardId === card.id || limitCards.includes(card.id) ? "selected" : ""} ${available ? "available" : "unavailable"}`} style={{ "--fan-angle": `${fanOffset * 3.4}deg`, "--fan-lift": `${Math.abs(fanOffset) * 5}px`, "--fan-shift": `${fanOffset * 3}px` } as React.CSSProperties} aria-disabled={!available} onMouseEnter={() => setFocusedCardId(card.id)} onMouseLeave={() => setFocusedCardId("")} onFocus={() => setFocusedCardId(card.id)} onBlur={() => setFocusedCardId("")} onClick={() => chooseHandCard(card)} title={`${card.name} • ${card.cost} Energy • ${card.effect}`}><img src={card.art} alt={card.name} />{pendingCardId === card.id && <span className="hand-card-state">SELECTED</span>}</button>; })}</div>
    </footer>

    {pending && specs.length > 0 && <div className="table-modal-backdrop"><section className="table-choice-modal"><header><img src={pending.art} alt={pending.name} /><div><Badge>{pending.type}</Badge><h2>{pending.name}</h2><p>{pending.effect || "No printed effect"}</p></div></header><ChoiceEditor state={match} playerId={playerId} card={pending} specs={specs} choices={choices} setChoices={setChoices} toggleChoice={toggleChoice} /><div className="cast-actions"><AppButton tone="red" onClick={playPending}>ADD TO BATCH</AppButton><AppButton tone="ghost" onClick={() => { setPendingCardId(""); setChoices({}); }}>CANCEL</AppButton></div></section></div>}
    {match.phase === "damage" && match.pendingLoser === playerId && match.revealedFlip && <div className="table-modal-backdrop"><section className="table-choice-modal flip-choice"><header><img src={match.revealedFlip.art} alt={match.revealedFlip.name} /><div><Badge tone="gold">REVEALED FLIP</Badge><h2>{match.revealedFlip.name}</h2><p>{match.revealedFlip.effect}</p><strong>{match.pendingDamage} DAMAGE REMAINING</strong></div></header><div className="cast-actions"><AppButton tone="red" disabled={typeof match.revealedFlip.cost === "number" && match.revealedFlip.cost + (match.frostStrike[match.damageOrigin] ?? 0) > me.energy} onClick={() => command("damage", { cardId: match.revealedFlip!.id }, (state) => resolveDamage(state, playerId, match.revealedFlip!.id))}>PLAY FLIP</AppButton><AppButton tone="ghost" onClick={() => command("damage", {}, (state) => resolveDamage(state, playerId))}>DECLINE • CONTINUE DAMAGE</AppButton></div></section></div>}
    </div>
  </section>;
}

function ChoiceEditor({ state, playerId, card, specs, choices, setChoices, toggleChoice }: { state: MatchState; playerId: string; card: GameCard; specs: string[]; choices: CardChoices; setChoices: React.Dispatch<React.SetStateAction<CardChoices>>; toggleChoice: (key: "discardCardIds" | "handCardIds", id: string) => void }) {
  const me = state.players.find((player) => player.id === playerId)!; const foe = state.players.find((player) => player.id !== playerId)!;
  const allBakugan = state.players.flatMap((player) => player.bakugan); const ownCards = me.hand.filter((candidate) => candidate.id !== card.id);
  return <div className="choice-editor">{specs.includes("targetBakugan") && <fieldset><legend>TARGET BAKUGAN</legend>{allBakugan.filter((bakugan) => card.type !== "Evo" || (bakugan.id.startsWith("bb-") && bakugan.name === card.evolvesFrom)).map((bakugan) => <button className={choices.targetBakuganId === bakugan.id ? "selected" : ""} key={bakugan.id} onClick={() => setChoices((current) => ({ ...current, targetBakuganId: bakugan.id }))}>{bakugan.name}<small>{bakugan.faction} • {bakugan.open ? "Open" : "Closed"}</small></button>)}</fieldset>}
    {specs.includes("targetPlayer") && <fieldset><legend>TARGET PLAYER</legend>{state.players.map((player) => <button className={choices.targetPlayerId === player.id ? "selected" : ""} key={player.id} onClick={() => setChoices((current) => ({ ...current, targetPlayerId: player.id }))}>{player.name}</button>)}</fieldset>}
    {specs.includes("targetHero") && <fieldset><legend>TARGET HERO</legend>{foe.heroes.map((hero) => <button className={choices.targetHeroId === hero.id ? "selected" : ""} key={hero.id} onClick={() => setChoices((current) => ({ ...current, targetHeroId: hero.id }))}>{hero.name}</button>)}</fieldset>}
    {specs.includes("targetEvo") && <fieldset><legend>TARGET EVO</legend>{foe.bakugan.flatMap((bakugan) => bakugan.evoStack).map((evo) => <button className={choices.targetEvoId === evo.id ? "selected" : ""} key={evo.id} onClick={() => setChoices((current) => ({ ...current, targetEvoId: evo.id }))}>{evo.name}</button>)}</fieldset>}
    {specs.includes("targetEnergy") && <fieldset><legend>TARGET ENERGY</legend>{foe.energyZone.map((energy, index) => <button className={choices.targetEnergyId === energy.id ? "selected" : ""} key={energy.id} onClick={() => setChoices((current) => ({ ...current, targetEnergyId: energy.id }))}>Energy #{index + 1}</button>)}</fieldset>}
    {specs.includes("core") && <fieldset><legend>SELECT BAKUCORE</legend>{state.placements.map((placement) => <button className={choices.coreCell === placement.cell ? "selected" : ""} key={placement.cell} onClick={() => setChoices((current) => ({ ...current, coreCell: placement.cell }))}>{placement.order} • {placement.core.type}{placement.attachedTo ? " • attached" : ""}</button>)}</fieldset>}
    {specs.includes("discard") && <fieldset><legend>SACRIFICE / DISCARD</legend>{ownCards.map((candidate) => <button className={choices.discardCardIds?.includes(candidate.id) ? "selected" : ""} key={candidate.id} onClick={() => toggleChoice("discardCardIds", candidate.id)}>{candidate.name}</button>)}</fieldset>}
    {specs.includes("multiHand") && <fieldset><legend>SELECT CARDS FROM HAND</legend>{ownCards.map((candidate) => <button className={choices.handCardIds?.includes(candidate.id) ? "selected" : ""} key={candidate.id} onClick={() => toggleChoice("handCardIds", candidate.id)}>{candidate.name}</button>)}</fieldset>}
    {specs.includes("xValue") && <label className="x-choice">X ENERGY: <strong>{choices.xValue ?? 0}</strong><input type="range" min="0" max={me.energy} value={choices.xValue ?? 0} onChange={(event) => setChoices((current) => ({ ...current, xValue:Number(event.target.value) }))} /></label>}
    {specs.includes("mode") && <fieldset><legend>CHOOSE EFFECT</legend><button className={choices.mode === "power" ? "selected" : ""} onClick={() => setChoices((current) => ({ ...current, mode:"power" }))}>B-POWER</button><button className={choices.mode === "damage" ? "selected" : ""} onClick={() => setChoices((current) => ({ ...current, mode:"damage" }))}>DAMAGE</button></fieldset>}</div>;
}

function PlayerRail({ player, match, opponent }: { player: MatchState["players"][number]; match: MatchState; playerId: string; opponent?: boolean }) {
  return <><section className="player-identity"><span className={`avatar ${opponent ? "opponent" : ""}`}>{player.name.slice(0, 2).toUpperCase()}</span><div><strong>{player.name}</strong><small>{opponent ? "OPPONENT" : "YOU"}</small></div></section><div className="rail-metrics"><Metric label="Deck" value={player.deck} /><Metric label="Hand" value={opponent ? "••••" : player.hand.length} /><Metric icon="/assets/symbols/energy.png" label="Energy" value={`${player.energy}/${player.maxEnergy}`} /></div><div className="character-stack">{player.bakugan.map((b) => <article key={b.id} className={match.selected[player.id] === b.id ? "selected" : ""}><img src={b.art} alt="" /><div><strong>{b.name}</strong><span>{b.bPower}B / {b.damage}D</span></div></article>)}</div><div className="series-pips">{Array.from({ length: match.format === "bo3" ? 2 : 1 }, (_, i) => <i className={i < (match.series[player.id] ?? 0) ? "won" : ""} key={i} />)}</div></>;
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
    <section className="settings-grid"><article className="panel"><h2>ACCESSIBILITY</h2><Toggle label="Reduced motion" copy="Replace camera moves and flashes with static emphasis." checked={settings.reducedMotion} onChange={(value) => setSettings({ ...settings, reducedMotion: value })} /><Toggle label="High contrast" copy="Increase panel, border, and focus contrast." checked={settings.highContrast} onChange={(value) => setSettings({ ...settings, highContrast: value })} /><label className="range-setting"><span>Card scale <b>{settings.cardScale}%</b></span><input type="range" min="80" max="140" value={settings.cardScale} onChange={(event) => setSettings({ ...settings, cardScale: Number(event.target.value) })} /></label></article><article className="panel"><h2>AUDIO & MATCH LOG</h2><Toggle label="Interface and match audio" copy="Phase calls, priority, and result cues." checked={settings.sound} onChange={(value) => setSettings({ ...settings, sound: value })} /><label>DEFAULT LOG DETAIL<select value={settings.logDetail} onChange={(event) => setSettings({ ...settings, logDetail: event.target.value })}><option>All events</option><option>Gameplay only</option><option>Random results</option></select></label></article><article className="panel"><h2>PRIVACY & SOCIAL</h2><label>WHO CAN CHALLENGE YOU<select value={settings.challenges} onChange={(event) => setSettings({ ...settings, challenges: event.target.value })}><option>Everyone</option><option>Friends only</option><option>No one</option></select></label><Toggle label="Allow replay links" copy="Share privacy-safe completed match records." checked onChange={() => {}} /><button className="text-button">MANAGE BLOCKED BRAWLERS →</button></article>
      <article className="panel account-management"><div className="panel-heading"><div><span className="eyebrow">DATA & ACCOUNT</span><h2>{authUser ? "CLOUD SYNC" : "LOCAL STORAGE"}</h2></div><Badge tone={syncStatus === "synced" ? "gold" : syncStatus === "error" ? "red" : "blue"}>{syncStatus.toUpperCase()}</Badge></div>{authUser ? <><div className="account-summary"><strong>{authUser.email}</strong><span>Decks, drafts, history, settings, and resumable state sync automatically.</span></div>{syncError && syncStatus === "error" && <p className="error-message">{syncError}</p>}<div className="account-actions"><AppButton tone="blue" onClick={syncNow}>SYNC NOW</AppButton><AppButton tone="ghost" onClick={signOut}>SIGN OUT</AppButton></div><form className="password-form" onSubmit={submitPassword}><h3>CHANGE PASSWORD</h3><label>CURRENT PASSWORD<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><AppButton type="submit" tone="ghost" disabled={accountBusy}>UPDATE PASSWORD</AppButton></form><div className="delete-account"><h3>DELETE ACCOUNT</h3><p>This removes the cloud account and synced copy. The local browser copy remains until you delete it separately.</p><label>TYPE DELETE TO CONFIRM<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-text" disabled={accountBusy || confirmation.toUpperCase() !== "DELETE"} onClick={removeAccount}>DELETE CLOUD ACCOUNT</button></div></> : <><div className="storage-callout"><strong>SAVED ON THIS DEVICE</strong><span>Refreshes and browser restarts retain your decks, settings, drafts, match history, and active state.</span></div><AppButton tone="red" onClick={openAccount}>SIGN UP OR LOG IN TO SYNC</AppButton></>}{accountError && <p className="error-message" role="alert">{accountError}</p>}<hr /><button className="danger-text" onClick={clearLocalProfile}>DELETE LOCAL BROWSER DATA</button></article></section></>;
}

function Toggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><div><strong>{label}</strong><small>{copy}</small></div><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>; }
function Timer({ deadline }: { deadline: number }) { const [now, setNow] = useState(0); useEffect(() => { const tick = () => setNow(Date.now()); const start = window.setTimeout(tick, 0); const i = window.setInterval(tick, 1000); return () => { window.clearTimeout(start); window.clearInterval(i); }; }, []); const seconds = Math.max(0, Math.ceil((deadline - (now || deadline - 30_000)) / 1000)); return <div className={`timer ${seconds <= 10 ? "warning" : ""}`}><small>TIME REMAINING</small><strong>00:{String(seconds).padStart(2, "0")}</strong></div>; }
function BootScreen({ label }: { label: string }) { return <main className="boot-screen"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><span className="pulse" /><h1>{label}</h1><p>Restoring decks, settings, drafts, history, and active state…</p></main>; }
function Empty({ title }: { title: string }) { return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p></section>; }
