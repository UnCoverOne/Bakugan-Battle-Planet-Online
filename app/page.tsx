"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  createMatch, setReady, startNextSeriesGame, uid, type MatchState,
} from "../lib/game";
import { BAKUGAN, CARD_BY_ID, CARDS, CORES, RULE_ENTRIES, STARTER_DECKS, deckErrors, deckIsLegal, makePlayer, type CanonicalPlayerSelection, type DeckFormat, type DeckRecord } from "../lib/data";
import { mergeSnapshots, normalizeSnapshot, type AppRoute as Route, type AppSettings, type BrawlerProfile as Profile, type MatchResultRecord as ResultRecord, type UserSnapshot } from "../lib/persistence";
import { MATCH_UPDATE_EVENT, readMatchStore } from "../components/game-screen-v2/matchStore";
import {
  DECK_LIMIT,
  decodeDeckCode,
  deckTextList,
  encodeDeckCode,
  formatDeckTimestamp,
  uniqueDeckName,
} from "../lib/deck-transfer";
import { GLOSSARY_ENTRIES, PUBLISHED_RULINGS, REFERENCE_REVIEWED_AT, SYMBOL_ENTRIES } from "../lib/reference";

const GameplayRuntime = dynamic(
  () => import("../components/game-screen-v2/GameplayRuntime").then((module) => module.GameplayRuntime),
  { ssr: false },
);

type AuthUser = { id: string; email: string; displayName: string; faction: string; createdAt: number };
type SyncStatus = "checking" | "local" | "loading" | "saving" | "synced" | "offline" | "error";
type StorageHealth = { status: "checking" | "saved" | "error"; message: string; savedAt: number | null };

const STORAGE_STATUS_EVENT = "bbp-storage-status";
const ROUTE_PATHS: Record<Route, string> = {
  entry: "/",
  dashboard: "/dashboard",
  decks: "/decks",
  "deck-detail": "/decks",
  builder: "/builder",
  compendium: "/compendium",
  play: "/play",
  lobby: "/play/lobby",
  placement: "/play/match",
  match: "/play/match",
  result: "/play/result",
  history: "/history",
  profile: "/profile",
  settings: "/settings",
};
const ROUTE_TITLES: Record<Route, string> = {
  entry: "Bakugan Battle Planet Online",
  dashboard: "Dashboard | Bakugan Battle Planet Online",
  decks: "Deck Library | Bakugan Battle Planet Online",
  "deck-detail": "Deck Details | Bakugan Battle Planet Online",
  builder: "Deck Builder | Bakugan Battle Planet Online",
  compendium: "Card & Rules Compendium | Bakugan Battle Planet Online",
  play: "Play | Bakugan Battle Planet Online",
  lobby: "Match Lobby | Bakugan Battle Planet Online",
  placement: "Match | Bakugan Battle Planet Online",
  match: "Match | Bakugan Battle Planet Online",
  result: "Match Result | Bakugan Battle Planet Online",
  history: "History & Replay | Bakugan Battle Planet Online",
  profile: "Brawler Profile | Bakugan Battle Planet Online",
  settings: "Settings | Bakugan Battle Planet Online",
};

const NAV: { route: Route; label: string; key: string }[] = [
  { route: "dashboard", label: "Dashboard", key: "01" }, { route: "play", label: "Play", key: "02" },
  { route: "decks", label: "Decks", key: "03" }, { route: "compendium", label: "Compendium", key: "04" },
  { route: "history", label: "History", key: "05" }, { route: "profile", label: "Profile", key: "06" },
];

const factionClass = (name: string) => `faction-${name.toLowerCase()}`;
const randomCode = () => crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
const copyText = async (value: string) => {
  if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
  await navigator.clipboard.writeText(value);
};
const downloadTextFile = (filename: string, value: string, type = "text/plain") => {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
const routeFromPath = (pathname: string): Route => {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "entry";
  if (segments[0] === "dashboard") return "dashboard";
  if (segments[0] === "decks") return segments[2] === "share" ? "deck-detail" : segments[1] ? "builder" : "decks";
  if (segments[0] === "builder") return "builder";
  if (segments[0] === "compendium") return "compendium";
  if (segments[0] === "history") return "history";
  if (segments[0] === "profile") return "profile";
  if (segments[0] === "settings") return "settings";
  if (segments[0] === "play") return segments[1] === "lobby" ? "lobby" : segments[1] === "match" ? "match" : segments[1] === "result" ? "result" : "play";
  return "dashboard";
};

function dispatchStorageHealth(detail: StorageHealth) {
  window.dispatchEvent(new CustomEvent<StorageHealth>(STORAGE_STATUS_EVENT, { detail }));
}

function useStoredState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const skipInitialWrite = useRef(false);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        if (raw) setValue(JSON.parse(raw) as T);
      } catch (error) {
        skipInitialWrite.current = true;
        dispatchStorageHealth({
          status: "error",
          message: error instanceof SyntaxError
            ? "Saved browser data is corrupted. It has not been overwritten."
            : "Browser storage is unavailable. Changes may be lost when this tab closes.",
          savedAt: null,
        });
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    if (skipInitialWrite.current) {
      skipInitialWrite.current = false;
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      dispatchStorageHealth({ status: "saved", message: "Saved on this device.", savedAt: Date.now() });
    } catch (error) {
      const quota = error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
      dispatchStorageHealth({
        status: "error",
        message: quota
          ? "This device is out of browser-storage space. Your latest changes were not saved."
          : "This browser denied storage access. Your latest changes were not saved.",
        savedAt: null,
      });
    }
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

function RichEffect({ text }: { text: string }) {
  const tokenPattern = /(\[B\]|\[Damage Rating\]|\[Energy\]|\[DoubleStrike\]|\[Double Strike\]|\[FrostStrike\]|\[Frost Strike\]|\[ShadowStrike\]|\[Shadow Strike\]|\[Victor\])/g;
  return <>{text.split(tokenPattern).map((part, index) => {
    const normalized = part.replace("Double Strike", "DoubleStrike").replace("Frost Strike", "FrostStrike").replace("Shadow Strike", "ShadowStrike");
    const symbol = SYMBOL_ENTRIES.find((item) => item.token === normalized);
    return symbol ? <span className="inline-symbol" key={`${part}-${index}`} title={symbol.name}><img src={symbol.asset} alt={symbol.name} width="18" height="18" loading="lazy" decoding="async" /></span> : <span key={`${part}-${index}`}>{part}</span>;
  })}</>;
}

function ResponsiveCardArtwork({
  card,
  alt,
  width,
  height,
  sizes,
  priority = false,
}: {
  card: typeof CARDS[number];
  alt: string;
  width: number;
  height: number;
  sizes: string;
  priority?: boolean;
}) {
  const thumbnail = card.hasProvidedScan ? `/assets/cards/thumb/${card.number}.webp` : card.art;
  return (
    <img
      src={width <= 160 ? thumbnail : card.art}
      srcSet={card.hasProvidedScan ? `${thumbnail} 160w, ${card.art} 359w` : undefined}
      sizes={sizes}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

function CardArt({ card, small = false, onClick, selected = false }: { card: typeof CARDS[number]; small?: boolean; onClick?: () => void; selected?: boolean }) {
  return <button className={`card-art ${small ? "small" : ""} ${selected ? "selected" : ""}`} onClick={onClick} title={`${card.name}: ${card.effect}`}><img src={card.art} alt={card.name} /><span>{card.name}</span></button>;
}

function Shell({ route, setRoute, profile, authUser, syncStatus, storageHealth, children, match }: { route: Route; setRoute: (r: Route) => void; profile: Profile; authUser: AuthUser | null; syncStatus: SyncStatus; storageHealth: StorageHealth; children: React.ReactNode; match: MatchState | null }) {
  const immersiveMatch = route === "match";
  const mainRef = useRef<HTMLElement>(null);
  const [isOnline, setIsOnline] = useState(true);
  const localSavedTime = storageHealth.savedAt
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(storageHealth.savedAt)
    : "";
  const syncLabel = authUser
    ? (syncStatus === "saving" ? "Saving…" : syncStatus === "synced" ? "Cloud synced" : syncStatus === "offline" ? "Offline • queued" : syncStatus === "error" ? "Sync issue" : "Connecting…")
    : storageHealth.status === "error" ? "Not saved" : storageHealth.status === "saved" ? `Saved ${localSavedTime}` : "Checking storage…";
  const syncTone = authUser ? syncStatus : storageHealth.status === "error" ? "error" : storageHealth.status === "saved" ? "synced" : "checking";
  const contextualParent = route === "builder" || route === "deck-detail" ? { label: "Deck Library", route: "decks" as Route }
    : route === "settings" || route === "profile" ? { label: "Dashboard", route: "dashboard" as Route }
    : null;
  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (immersiveMatch) return;
    const frame = window.requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector<HTMLElement>("h1") ?? mainRef.current;
      target?.setAttribute("tabindex", "-1");
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [route, immersiveMatch]);
  return <div className={`app-shell ${immersiveMatch ? "immersive-match" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {!immersiveMatch && <header className="topbar">
      <button className="brand" onClick={() => setRoute("dashboard")} aria-label="Bakugan Battle Planet Online dashboard"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><span>TCG ONLINE</span></button>
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.route} className={route === item.route ? "active" : ""} aria-current={route === item.route ? "page" : undefined} onClick={() => setRoute(item.route)}><i>{item.key}</i>{item.label}</button>)}</nav>
      <div className="top-actions">
        {match && !["result"].includes(match.phase) && <button className="resume-chip" onClick={() => setRoute(match.phase === "lobby" ? "lobby" : "match")}><span className="pulse" /> Resume match</button>}
        <span className={`sync-chip ${syncTone}`} title={authUser ? `Signed in as ${authUser.email}` : storageHealth.message}><i>{authUser ? "☁" : "▣"}</i>{syncLabel}</span>
        <button className="profile-chip" onClick={() => setRoute("profile")}><span>{profile.name.slice(0, 2).toUpperCase()}</span><div>{profile.name}<small>{profile.faction} • {authUser ? "Account" : "Local"}</small></div></button>
        <button className="menu-button" onClick={() => setRoute("settings")} aria-label="Settings">⚙</button>
      </div>
    </header>}
    {!immersiveMatch && !isOnline && <div className="offline-banner" role="status">You are offline. Device-local changes will keep saving when storage is available; cloud sync is queued.</div>}
    {!immersiveMatch && storageHealth.status === "error" && <div className="storage-error-banner" role="alert">{storageHealth.message}</div>}
    {!immersiveMatch && contextualParent && <nav className="breadcrumbs" aria-label="Breadcrumb"><button onClick={() => setRoute(contextualParent.route)}>{contextualParent.label}</button><span aria-hidden="true">/</span><span aria-current="page">{ROUTE_TITLES[route].split(" | ")[0]}</span></nav>}
    <div className="route-announcer" aria-live="polite" aria-atomic="true">{ROUTE_TITLES[route].split(" | ")[0]}</div>
    <main id="main-content" className="main-stage" ref={mainRef}>{children}</main>
  </div>;
}

function PageHeader({ eyebrow, title, copy, art, actions }: { eyebrow: string; title: string; copy?: string; art?: string; actions?: React.ReactNode }) {
  return <section className="page-hero"><div className="page-hero-copy"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}<div className="hero-actions">{actions}</div></div>{art && <img className="page-hero-art" src={art} alt="" />}</section>;
}

export default function Home() {
  const defaultSettings: AppSettings = { reducedMotion: false, highContrast: false, sound: true, cardScale: 100, logDetail: "All events", challenges: "Everyone", replayLinks: true };
  const [route, setRouteState] = useState<Route>("entry");
  const [routeReady, setRouteReady] = useState(false);
  const [locationPath, setLocationPath] = useState("/");
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
  const [storageHealth, setStorageHealth] = useState<StorageHealth>({ status: "checking", message: "Checking whether this browser can save data…", savedAt: null });
  const [cloudRevision, setCloudRevision] = useState(0);
  const [cloudReady, setCloudReady] = useState(false);
  const snapshotRef = useRef<UserSnapshot | null>(null);
  const authBooted = useRef(false);
  const dirtyStarted = useRef(false);
  const applyingSnapshot = useRef(false);
  const cloudRevisionRef = useRef(0);
  const lastSyncedModifiedAt = useRef(-1);
  const setRoute = useCallback((next: Route) => {
    setRouteState(next);
    const path = ROUTE_PATHS[next];
    if (window.location.pathname !== path) window.history.pushState({ route: next }, "", path);
    setLocationPath(path);
  }, [setRouteState]);
  const navigatePath = useCallback((next: Route, path: string) => {
    setRouteState(next);
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({ route: next }, "", path);
    setLocationPath(new URL(path, window.location.href).pathname);
  }, [setRouteState]);

  const persistenceReady = [routeReady, profileReady, decksReady, historyReady, settingsReady, selectedDeckReady, builderReady, deckQueryReady, compendiumQueryReady, compendiumTabReady, formatReady, matchModeReady, joinCodeReady, matchReady, onlineReady, selectedCoreReady, logFilterReady, replayReady, replayIndexReady, playerIdReady, capabilityReady, modifiedReady].every(Boolean);

  useEffect(() => {
    const onStorageStatus = (event: Event) => setStorageHealth((event as CustomEvent<StorageHealth>).detail);
    window.addEventListener(STORAGE_STATUS_EVENT, onStorageStatus);
    return () => window.removeEventListener(STORAGE_STATUS_EVENT, onStorageStatus);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const path = window.location.pathname;
      const segments = path.split("/").filter(Boolean);
      setRouteState(routeFromPath(path));
      setLocationPath(path);
      if (segments[0] === "compendium") {
        setCompendiumTab(segments[1] === "rules" ? "rules" : segments[1] === "rulings" ? "rulings" : "cards");
      }
    };
    syncFromUrl();
    setRouteReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [setCompendiumTab]);

  useEffect(() => {
    const segments = locationPath.split("/").filter(Boolean);
    let title = ROUTE_TITLES[route];
    if (segments[0] === "compendium" && segments[1] === "cards" && segments[2]) {
      const card = CARDS.find((item) => item.slug === segments[2] || item.catalogId === segments[2]);
      if (card) title = `${card.displayName} | Bakugan Battle Planet Online`;
    } else if (segments[0] === "decks" && segments[1] && segments[1] !== "new") {
      const deck = decks.find((item) => item.id === decodeURIComponent(segments[1]));
      if (deck) title = `${deck.name} | Bakugan Battle Planet Online`;
    } else if (segments[0] === "history" && segments[1]) {
      const record = history.find((item) => item.id === decodeURIComponent(segments[1]));
      if (record) title = `${record.result} vs ${record.opponent} | Bakugan Battle Planet Online`;
    }
    document.title = title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = `Bakugan Battle Planet Online — ${title.split(" | ")[0]}.`;
  }, [decks, history, locationPath, route]);

  useEffect(() => {
    if (!decksReady) return;
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments[0] === "decks" && segments[1] && segments[1] !== "new") {
      const directDeck = decks.find((deck) => deck.id === decodeURIComponent(segments[1]));
      if (directDeck) {
        setBuilderDeck(directDeck);
        setSelectedDeckId(directDeck.id);
      }
    }
    if (segments[0] === "history" && segments[1]) {
      const directReplay = history.find((item) => item.id === decodeURIComponent(segments[1]));
      if (directReplay) {
        setReplay(directReplay);
        setReplayIndex(Math.max(0, directReplay.log.length - 1));
      }
    }
  }, [decksReady, historyReady]);

  // The setup/dashboard shell still owns non-game navigation while the typed
  // match store owns live gameplay. Keep the small shared boundary in sync in
  // both directions so entering a match cannot leave GameplayClient looking at
  // the previous `play` route (which renders only the empty gameplay host).
  useEffect(() => {
    const synchronizeFromMatchStore = () => {
      const stored = readMatchStore();
      setRouteState((current) => current === stored.route ? current : stored.route as Route);
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
    try {
      localStorage.setItem("bbp-route-v1", JSON.stringify(route));
    } catch {
      dispatchStorageHealth({
        status: "error",
        message: "Browser storage denied the latest navigation state. The URL remains safe to bookmark or share.",
        savedAt: null,
      });
    }
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
    decks,
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
    const urlRoute = routeFromPath(window.location.pathname);
    const restoredRoute = forceEntered && next.route === "entry" ? "dashboard" : next.route;
    setRoute(urlRoute === "entry" ? restoredRoute : urlRoute);
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

  const loadCloudData = async (user: AuthUser, strategy: "merge" | "local" | "cloud" = "merge") => {
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
      const merged = strategy === "cloud" ? remote : strategy === "local" ? local : mergeSnapshots(local, remote);
      const mergedForAccount: UserSnapshot = { ...merged, profile: { ...merged.profile, signedIn: true } };
      const changedByMerge = JSON.stringify({ ...mergedForAccount, updatedAt: 0 }) !== JSON.stringify({ ...remote, updatedAt: 0, profile: { ...remote.profile, signedIn: true } });
      restored = changedByMerge ? { ...mergedForAccount, updatedAt: Date.now() } : mergedForAccount;
      applyUserSnapshot(restored, true);
      lastSyncedModifiedAt.current = strategy === "cloud" || !changedByMerge ? restored.updatedAt : -1;
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

  const authenticate = async (action: "login" | "signup", payload: { email: string; password: string; displayName?: string; faction?: string; syncStrategy?: "merge" | "local" | "cloud" }) => {
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
      try { restored = await loadCloudData(data.user, action === "signup" ? "local" : payload.syncStrategy ?? "merge"); }
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
    setHistory((items) => [{ id: `${state.id}-${state.gameNumber}`, result: won ? "Victor" : "Defeat", opponent: state.players.find((p) => p.id !== playerId)?.name ?? "Opponent", score: Object.values(state.series).join("–"), reason: state.resultReason, at: new Date().toISOString(), startedAt: new Date(state.log[0]?.at ?? Date.now()).toISOString(), format: state.format, mode: online ? "online" : "training", schemaVersion: 1, log: state.log }, ...items]);
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
    const code = action === "create" ? undefined : explicitCode ?? match?.code;
    const response = await fetch("/api/game", { method: "POST", headers: { "content-type": "application/json", ...(matchCapability ? { "x-match-capability": matchCapability } : {}) }, body: JSON.stringify({ action, code, playerId, expectedVersion: match?.version, format, selection, payload }) });
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
  const createDraft = () => {
    if (decks.length >= DECK_LIMIT) {
      setToast(`Deck limit reached. Export or delete a deck before creating another (${DECK_LIMIT} maximum).`);
      setRoute("decks");
      return;
    }
    const draft: DeckRecord = {
      id: uid(),
      name: uniqueDeckName("Untitled Battle Deck", decks),
      factions: [...STARTER_DECKS[0].factions],
      bakuganIds: [...STARTER_DECKS[0].bakuganIds],
      coreIds: [...STARTER_DECKS[0].coreIds],
      cardIds: [],
      updatedAt: new Date().toISOString(),
      visibility: "Private",
      format: "standard",
      revision: 1,
    };
    setBuilderDeck(draft);
    navigatePath("builder", "/decks/new");
  };
  const openBuilderDeck = (deck: DeckRecord) => {
    setBuilderDeck({ ...deck });
    setSelectedDeckId(deck.id);
    navigatePath("builder", `/decks/${encodeURIComponent(deck.id)}`);
  };
  const openDeckDetail = (deck: DeckRecord) => {
    setSelectedDeckId(deck.id);
    navigatePath("deck-detail", `/decks/${encodeURIComponent(deck.id)}/share`);
  };
  const openReplayRecord = (item: ResultRecord) => {
    setReplay(item);
    setReplayIndex(Math.max(0, item.log.length - 1));
    navigatePath("history", `/history/${encodeURIComponent(item.id)}`);
  };
  const saveBuilder = () => {
    if (!builderDeck) return; const existing = decks.some((d) => d.id === builderDeck.id);
    if (!existing && decks.length >= DECK_LIMIT) {
      setToast(`Deck limit reached. Export or delete a deck before saving another (${DECK_LIMIT} maximum).`);
      return undefined;
    }
    const savedAt = new Date().toISOString();
    const savedDeck = { ...builderDeck, updatedAt: savedAt, revision: (builderDeck.revision ?? 0) + 1 };
    setDecks((items) => existing ? items.map((d) => d.id === builderDeck.id ? savedDeck : d) : [savedDeck, ...items]);
    setBuilderDeck(savedDeck);
    setSelectedDeckId(builderDeck.id); setToast(deckIsLegal(builderDeck) ? "Deck saved and validated." : "Draft saved with legality issues.");
    return savedDeck;
  };

  if (!persistenceReady) return <BootScreen label="RESTORING LOCAL BRAWLER DATA" />;
  if (route === "entry") return <Entry profile={profile} setProfile={setProfile} authChecking={authChecking} authBusy={authBusy} authError={authError} onGuest={() => { setAuthError(""); setProfile((current) => ({ ...current, signedIn: true })); setRoute("dashboard"); setSyncStatus("local"); }} onAuthenticate={authenticate} />;

  let content: React.ReactNode;
  if (route === "dashboard") content = <Dashboard profile={profile} decks={decks} history={history} match={match} setRoute={setRoute} selectDeck={setSelectedDeckId} createDraft={createDraft} openReplay={openReplayRecord} openLatestRuling={() => { setCompendiumTab("rulings"); navigatePath("compendium", "/compendium/rulings/second-core-adjacency-weighting"); }} />;
  else if (route === "decks") content = <DeckLibrary decks={decks} query={deckQuery} setQuery={setDeckQuery} selectedDeckId={selectedDeckId} selectDeck={setSelectedDeckId} setDecks={setDecks} openBuilder={openBuilderDeck} openDetail={openDeckDetail} createDraft={createDraft} notify={setToast} />;
  else if (route === "deck-detail") content = <DeckDetail deck={selectedDeck} author={profile.name} edit={() => openBuilderDeck(selectedDeck)} back={() => setRoute("decks")} clone={() => { if (decks.length >= DECK_LIMIT) return setToast("Deck limit reached. Delete or export a deck first."); const copy = { ...selectedDeck, id: uid(), name: uniqueDeckName(`${selectedDeck.name} Copy`, decks), visibility: "Private" as const, updatedAt: new Date().toISOString(), revision: 1 }; setDecks((items) => [copy, ...items]); openBuilderDeck(copy); }} notify={setToast} />;
  else if (route === "builder") content = <DeckBuilder deck={builderDeck ?? selectedDeck} setDeck={setBuilderDeck} addCard={addCard} removeCard={removeCard} save={saveBuilder} back={() => setRoute("decks")} storageHealth={storageHealth} notify={setToast} />;
  else if (route === "compendium") content = <Compendium query={compendiumQuery} setQuery={setCompendiumQuery} tab={compendiumTab} setTab={setCompendiumTab} authUser={authUser} notify={setToast} navigatePath={(path) => navigatePath("compendium", path)} />;
  else if (route === "play") content = <PlaySetup format={format} setFormat={setFormat} mode={matchMode} setMode={setMatchMode} deck={selectedDeck} decks={decks} selectDeck={setSelectedDeckId} joinCode={joinCode} setJoinCode={setJoinCode} startSolo={startSolo} createOnline={createOnline} joinOnline={joinOnline} error={matchError} />;
  else if (route === "lobby") content = <Lobby match={match} playerId={playerId} error={matchError} ready={() => command("ready", undefined, (s) => setReady(s, playerId))} leave={() => { setMatch(null); setOnline(false); setRoute("dashboard"); }} />;
  else if (route === "match" || route === "placement") content = <div className="gameplay-match-host" aria-label="Tabletop gameplay client" />;
  else if (route === "result") content = <ResultScreen match={match} playerId={playerId} history={history} nextGame={() => command("next-game", undefined, startNextSeriesGame)} dashboard={() => { setMatch(null); setOnline(false); setRoute("dashboard"); }} openReplay={() => { const item = history[0]; if (item) openReplayRecord(item); }} />;
  else if (route === "history") content = <HistoryScreen history={history} replay={replay} openReplay={openReplayRecord} closeReplay={() => { setReplay(null); setRoute("history"); }} replayIndex={replayIndex} setReplayIndex={setReplayIndex} setRoute={setRoute} />;
  else if (route === "profile") content = <ProfileScreen profile={profile} setProfile={setProfile} history={history} decks={decks} authUser={authUser} openDeck={openDeckDetail} saveProfile={() => saveAccountProfile().catch((error) => setToast(error instanceof Error ? error.message : "Could not save profile."))} />;
  else content = <SettingsScreen settings={settings} setSettings={setSettings} authUser={authUser} syncStatus={syncStatus} syncError={authError} storageHealth={storageHealth} signOut={signOutAccount} openAccount={() => { setAuthError(""); setRoute("entry"); }} syncNow={() => { setSyncStatus(authUser ? "loading" : "local"); setLocalModifiedAt(Date.now()); }} changePassword={changePassword} deleteAccount={deleteAccount} />;

  const needsGameplayRuntime = ["lobby", "placement", "match", "result"].includes(route);
  return (
    <>
      <Shell route={route} setRoute={setRoute} profile={profile} authUser={authUser} syncStatus={syncStatus} storageHealth={storageHealth} match={match}>
        {content}
        {toast && <div className="toast" role="status">{toast}</div>}
      </Shell>
      {needsGameplayRuntime && <GameplayRuntime />}
    </>
  );
}

function Entry({ profile, setProfile, authChecking, authBusy, authError, onGuest, onAuthenticate }: { profile: Profile; setProfile: React.Dispatch<React.SetStateAction<Profile>>; authChecking: boolean; authBusy: boolean; authError: string; onGuest: () => void; onAuthenticate: (action: "login" | "signup", payload: { email: string; password: string; displayName?: string; faction?: string; syncStrategy?: "merge" | "local" | "cloud" }) => Promise<void> }) {
  const [mode, setMode] = useState<"guest" | "login" | "signup">("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [syncStrategy, setSyncStrategy] = useState<"merge" | "local" | "cloud">("merge");
  const [showRecovery, setShowRecovery] = useState(false);
  const factions = ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"];
  const validateName = () => {
    const name = profile.name.trim().replace(/\s+/g, " ");
    if (!name) return "Brawler name cannot be blank or whitespace.";
    if (!/^[\p{L}\p{N} _'-]+$/u.test(name)) return "Use letters, numbers, spaces, apostrophes, underscores, or hyphens.";
    if (/^(admin|administrator|moderator|official|support)$/i.test(name)) return "That reserved Brawler name cannot be used.";
    return "";
  };
  const submitAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    if (mode === "guest") return;
    const nameError = mode === "signup" ? validateName() : "";
    if (nameError) { setFormError(nameError); return; }
    if (mode === "signup" && password !== confirmPassword) { setFormError("Passwords do not match."); return; }
    const normalizedName = profile.name.trim().replace(/\s+/g, " ");
    if (mode === "signup") setProfile((current) => ({ ...current, name: normalizedName }));
    await onAuthenticate(mode, { email, password, displayName: normalizedName, faction: profile.faction, syncStrategy });
  };
  return <main className="entry-page">
    <header className="public-header"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><nav><a href="#features">Features</a><a href="#rules">Rules</a><a href="#accessibility">Accessibility</a></nav><span>ORIGINAL 2019 RULESET</span></header>
    <section className="entry-hero"><div className="entry-art"><img src="/assets/brawlers.png" alt="The Awesome Brawlers and their Bakugan" /></div><div className="entry-copy"><Badge tone="red">PERSISTENT TCG ACCOUNT SYSTEM</Badge><h1>ANSWER THE CALL<br /><em>TO BRAWL.</em></h1><p>Continue locally on this device, or create an account to sync decks, settings, match history, drafts, and resumable state across devices.</p>
      <div className="auth-tabs" role="tablist" aria-label="Access options">
        {(["guest", "login", "signup"] as const).map((option) => <button key={option} role="tab" aria-selected={mode === option} aria-controls="access-panel" className={mode === option ? "active" : ""} onClick={() => { setMode(option); setFormError(""); }}>{option === "guest" ? "LOCAL PROFILE" : option === "login" ? "LOG IN" : "SIGN UP"}</button>)}
      </div>
      {mode === "guest" ? <form id="access-panel" role="tabpanel" className="signin-panel account-panel" onSubmit={(event) => { event.preventDefault(); const nameError = validateName(); if (nameError) { setFormError(nameError); return; } setProfile((current) => ({ ...current, name: current.name.trim().replace(/\s+/g, " ") })); onGuest(); }}>
        <div className="storage-callout"><strong>DEVICE-LOCAL MODE</strong><span>Your decks, settings, drafts, history, and active state remain in this browser after refreshes and restarts when browser storage is available.</span></div>
        <label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required aria-describedby="local-name-help" /></label>
        <small id="local-name-help">1–20 visible characters. Reserved staff names and blank-looking names are blocked.</small>
        <label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label>
        {formError && <p className="error-message" role="alert">{formError}</p>}
        <AppButton type="submit" tone="red">CONTINUE ON THIS DEVICE</AppButton><small>You can link this local profile to an account later without deleting the browser copy.</small>
      </form>
      : <form id="access-panel" role="tabpanel" className="signin-panel account-panel" onSubmit={submitAccount}>
        {mode === "signup" && <><label>BRAWLER NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} required /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{factions.map((faction) => <option key={faction}>{faction}</option>)}</select></label></>}
        <label>EMAIL ADDRESS<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby="password-requirements" /></label>
        <small id="password-requirements">Use 10–128 characters. A longer, unique passphrase is recommended.</small>
        {mode === "signup" && <label>CONFIRM PASSWORD<input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>}
        {mode === "login" && <fieldset className="merge-choice"><legend>AFTER LOGIN, USE WHICH DATA?</legend><label><input type="radio" name="sync-strategy" checked={syncStrategy === "merge"} onChange={() => setSyncStrategy("merge")} /><span><strong>Merge safely</strong>Keep both device and cloud decks; conflicts become private recovery copies.</span></label><label><input type="radio" name="sync-strategy" checked={syncStrategy === "local"} onChange={() => setSyncStrategy("local")} /><span><strong>Use this device</strong>Upload this device’s copy over the account snapshot.</span></label><label><input type="radio" name="sync-strategy" checked={syncStrategy === "cloud"} onChange={() => setSyncStrategy("cloud")} /><span><strong>Use cloud copy</strong>Replace the current device state with the account snapshot.</span></label></fieldset>}
        {(formError || authError) && <p className="error-message" role="alert">{formError || authError}</p>}
        <AppButton type="submit" tone="red" disabled={authBusy || authChecking}>{authChecking ? "CHECKING SESSION…" : authBusy ? "CONNECTING…" : mode === "login" ? "LOG IN & CONTINUE" : "CREATE ACCOUNT & SYNC"}</AppButton>
        {mode === "login" && <button className="text-button recovery-link" type="button" onClick={() => setShowRecovery((value) => !value)}>FORGOT PASSWORD?</button>}
        {showRecovery && <div className="storage-callout" role="status"><strong>ADMINISTRATOR-ASSISTED RECOVERY</strong><span>Automated recovery email is not configured for this prototype. Open a private account-recovery request with the project administrator; never include your password.</span><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online/issues/new" target="_blank" rel="noreferrer">OPEN SUPPORT REQUEST →</a></div>}
        <small>Passwords are hashed on the server and sessions use secure, HTTP-only cookies. Your selected data strategy is applied before the first sync.</small>
      </form>}
    </div></section>
    <section id="features" className="entry-features"><article><strong>01</strong><h2>PERSIST</h2><p>Return to the same page, draft, deck, or active match after restarting the browser.</p></article><article><strong>02</strong><h2>PLAY LOCAL</h2><p>Logged-out Brawlers retain their data using browser storage.</p></article><article><strong>03</strong><h2>SYNC</h2><p>Accounts carry decks, settings, records, and state between devices.</p></article></section>
    <section id="rules" className="public-info-section"><div><span className="eyebrow">OFFICIAL REFERENCE</span><h2>RULES & RULINGS</h2><p>The Compendium combines the supplied complete rulebook, advanced glossary, card catalogue, and published developer responses. Digital-adaptation rulings are labelled separately from official tabletop sources.</p><Link className="hex-button ghost" href="/compendium">OPEN COMPENDIUM</Link></div><ul><li>Stable links for cards, glossary entries, and rulings</li><li>Source, revision, and effective-date labels</li><li>Rendered game symbols instead of raw bracket tokens</li></ul></section>
    <section id="accessibility" className="public-info-section"><div><span className="eyebrow">ACCESSIBILITY</span><h2>PLAY WITH THE INTERFACE YOU NEED</h2><p>Keyboard focus, route announcements, reduced motion, high contrast, text scaling, labelled filters, and meaningful image descriptions are supported across non-game screens.</p><Link className="hex-button ghost" href="/settings">ACCESSIBILITY SETTINGS</Link></div><ul><li>Skip links and visible focus states</li><li>Reduced-motion and high-contrast preferences</li><li>Screen-reader friendly navigation and status announcements</li></ul></section>
    <footer className="public-footer"><span>Unofficial fan-made prototype. Bakugan and related marks belong to their respective owners.</span><Link href="/compendium">Rules</Link><Link href="/tools/card-editor">Card editor</Link><a href="#accessibility">Accessibility</a><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online" target="_blank" rel="noreferrer">Project repository</a></footer>
  </main>;
}

function Dashboard({ profile, decks, history, match, setRoute, selectDeck, createDraft, openReplay, openLatestRuling }: { profile: Profile; decks: DeckRecord[]; history: ResultRecord[]; match: MatchState | null; setRoute: (r: Route) => void; selectDeck: (id: string) => void; createDraft: () => void; openReplay: (item: ResultRecord) => void; openLatestRuling: () => void }) {
  const legal = decks.filter(deckIsLegal);
  return <><PageHeader eyebrow={`WELCOME BACK, ${profile.name.toUpperCase()}`} title="BRAWLER COMMAND" copy="Your next Brawl, legal decks, and recent results—one decision away." art="/assets/brawlers-group.png" actions={<><AppButton tone="red" onClick={() => setRoute("play")}>PLAY NOW</AppButton><AppButton tone="ghost" onClick={createDraft}>BUILD A DECK</AppButton></>} />
    {match && match.phase !== "result" && <section className="alert-strip"><div><span className="pulse" /><strong>ACTIVE MATCH</strong><p>{match.code} • {match.stepLabel}</p></div><AppButton onClick={() => setRoute(match.phase === "lobby" ? "lobby" : "match")}>RESUME</AppButton></section>}
    <section className="dashboard-grid"><article className="panel play-panel"><span className="panel-index">01</span><h2>READY TO BRAWL?</h2><p>{legal.length} legal decks available • BO1 and BO3 enabled</p><div className="team-silhouette">{BAKUGAN.slice(0, 3).map((b) => <img key={b.id} src={b.art} alt="" />)}</div><AppButton tone="red" onClick={() => setRoute("play")}>CHOOSE THE BATTLE</AppButton></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENT DECKS</span><h2>YOUR ARSENAL</h2></div><button onClick={() => setRoute("decks")}>VIEW ALL →</button></div><div className="mini-decks">{decks.slice(0, 3).map((deck) => <button key={deck.id} onClick={() => { selectDeck(deck.id); setRoute("builder"); }}><span className={factionClass(deck.factions[0])} /><strong>{deck.name}</strong><small>{deck.cardIds.length} cards • {deckIsLegal(deck) ? "LEGAL" : "ISSUES"}</small></button>)}</div></article>
      <article className="panel results-panel"><div className="panel-heading"><div><span className="eyebrow">MATCH ARCHIVE</span><h2>RECENT RESULTS</h2></div><button onClick={() => setRoute("history")}>OPEN HISTORY →</button></div>{history.length ? history.slice(0, 4).map((item) => <button className="result-row" key={item.id} onClick={() => openReplay(item)} aria-label={`Open replay: ${item.result} against ${item.opponent}`}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><span>vs {item.opponent}</span><strong>{item.score}</strong><small>{item.reason}</small></button>) : <div className="empty-state"><strong>NO MATCHES RECORDED</strong><p>Your completed Brawls and replays will appear here.</p><AppButton tone="ghost" onClick={() => setRoute("play")}>START A TRAINING MATCH</AppButton></div>}</article>
      <article className="panel ruling-panel"><span className="eyebrow">LATEST PLATFORM RULING</span><h2>ROLL CALCULATION IS PUBLIC</h2><p>Accuracy, Double Core, adjacency weighting, and four-Core rotation results are published in the match log after resolution.</p><button onClick={openLatestRuling}>OPEN RULING →</button></article></section></>;
}

function DeckLibrary({ decks, query, setQuery, selectedDeckId, selectDeck, setDecks, openBuilder, openDetail, createDraft, notify }: { decks: DeckRecord[]; query: string; setQuery: (q: string) => void; selectedDeckId: string; selectDeck: (id: string) => void; setDecks: React.Dispatch<React.SetStateAction<DeckRecord[]>>; openBuilder: (d: DeckRecord) => void; openDetail: (d: DeckRecord) => void; createDraft: () => void; notify: (message: string) => void }) {
  const [faction, setFaction] = useState("All");
  const [legality, setLegality] = useState("All");
  const [sort, setSort] = useState<"updated" | "name" | "favourite">("updated");
  const [importOpen, setImportOpen] = useState(false);
  const [importCode, setImportCode] = useState("");
  const [importError, setImportError] = useState("");
  const [deletedDeck, setDeletedDeck] = useState<{ deck: DeckRecord; index: number } | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => decks.filter((deck) => {
    const searchableCards = deck.cardIds.map((id) => CARD_BY_ID.get(id)).filter(Boolean).map((card) => `${card!.displayName} ${card!.effect}`).join(" ");
    const haystack = `${deck.name} ${deck.factions.join(" ")} ${deck.tags?.join(" ") ?? ""} ${deck.notes ?? ""} ${deck.format ?? "standard"} ${deck.visibility} ${searchableCards}`.toLocaleLowerCase();
    return (!normalizedQuery || haystack.includes(normalizedQuery))
      && (faction === "All" || deck.factions.includes(faction))
      && (legality === "All" || (legality === "Legal" ? deckIsLegal(deck) : !deckIsLegal(deck)));
  }).sort((left, right) => {
    if (sort === "name") return left.name.localeCompare(right.name);
    if (sort === "favourite") return Number(Boolean(right.favourite)) - Number(Boolean(left.favourite)) || left.name.localeCompare(right.name);
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }), [decks, normalizedQuery, faction, legality, sort]);
  const importDeck = () => {
    setImportError("");
    if (decks.length >= DECK_LIMIT) {
      setImportError(`Deck limit reached (${DECK_LIMIT}). Export or delete a deck first.`);
      return;
    }
    try {
      const imported = decodeDeckCode(importCode, uid);
      imported.name = uniqueDeckName(imported.name, decks);
      imported.visibility = "Private";
      setDecks((items) => [imported, ...items]);
      selectDeck(imported.id);
      setImportOpen(false);
      setImportCode("");
      notify(`Imported ${imported.name}. Imported decks start Private.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The deck code could not be imported.");
    }
  };
  const removeDeck = (deck: DeckRecord) => {
    const index = decks.findIndex((item) => item.id === deck.id);
    setDeletedDeck({ deck, index });
    setDecks((items) => items.filter((item) => item.id !== deck.id));
    notify(`${deck.name} deleted. Use Undo in the Deck Library to restore it.`);
  };
  const undoDelete = () => {
    if (!deletedDeck) return;
    setDecks((items) => {
      const next = [...items];
      next.splice(Math.min(deletedDeck.index, next.length), 0, deletedDeck.deck);
      return next;
    });
    setDeletedDeck(null);
    notify("Deck restored.");
  };
  const duplicateDeck = (deck: DeckRecord) => {
    if (decks.length >= DECK_LIMIT) {
      notify(`Deck limit reached (${DECK_LIMIT}). Export or delete a deck first.`);
      return;
    }
    const copy: DeckRecord = {
      ...deck,
      id: uid(),
      name: uniqueDeckName(`${deck.name} Copy`, decks),
      updatedAt: new Date().toISOString(),
      visibility: "Private",
      revision: 1,
      conflictOf: undefined,
    };
    setDecks((items) => [copy, ...items]);
    notify(`Created ${copy.name}.`);
  };
  return <><PageHeader eyebrow="DECK MANAGEMENT" title="DECK LIBRARY" copy="Organize, validate, duplicate, publish, import, and export your Battle Planet decks." art="/assets/pyrus.png" actions={<><AppButton tone="red" disabled={decks.length >= DECK_LIMIT} onClick={createDraft}>+ CREATE DECK</AppButton><AppButton tone="ghost" onClick={() => { setImportOpen(true); setImportError(""); }}>IMPORT CODE</AppButton></>} />
    {importOpen && <section className="panel import-panel" role="dialog" aria-modal="true" aria-labelledby="import-title"><div className="panel-heading"><div><span className="eyebrow">VERSIONED SHARE CODE</span><h2 id="import-title">IMPORT A DECK</h2></div><button onClick={() => setImportOpen(false)} aria-label="Close deck import">×</button></div><p>Paste a complete <strong>BBP1</strong> deck code. Catalogue IDs, team size, BakuCores, and all 40 cards are validated before anything is saved.</p><label>DECK CODE<textarea value={importCode} onChange={(event) => setImportCode(event.target.value)} placeholder="BBP1.eyJzY2hlbWEi…" autoFocus /></label>{importError && <p className="error-message" role="alert">{importError}</p>}<div className="hero-actions"><AppButton tone="red" disabled={!importCode.trim()} onClick={importDeck}>VALIDATE & IMPORT</AppButton><AppButton tone="ghost" onClick={() => setImportOpen(false)}>CANCEL</AppButton></div></section>}
    {deletedDeck && <div className="undo-banner" role="status"><span><strong>{deletedDeck.deck.name}</strong> was removed from this device.</span><button onClick={undoDelete}>UNDO DELETE</button><button onClick={() => setDeletedDeck(null)} aria-label="Dismiss undo">×</button></div>}
    <section className="toolbar deck-toolbar">
      <label className="search-box"><span className="sr-only">Search decks</span>⌕<input id="deck-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search names, factions, cards, tags, notes…" /></label>
      <Badge>{decks.length} / {DECK_LIMIT} DECKS</Badge>
      <label><span>Faction</span><select value={faction} onChange={(event) => setFaction(event.target.value)}><option value="All">All factions</option>{["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Legality</span><select value={legality} onChange={(event) => setLegality(event.target.value)}><option value="All">All legality</option><option>Legal</option><option>Issues</option></select></label>
      <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">Last updated</option><option value="name">Deck name</option><option value="favourite">Favourites first</option></select></label>
      <button onClick={() => downloadTextFile(`battle-planet-decks-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schema: 1, exportedAt: new Date().toISOString(), decks: decks.map(encodeDeckCode) }, null, 2), "application/json")}>EXPORT ALL</button>
    </section>
    <p className="active-deck-note" role="status">Active deck: <strong>{decks.find((deck) => deck.id === selectedDeckId)?.name ?? "None"}</strong>. Selecting a tile makes it the default deck on the Play screen.</p>
    <section className="deck-grid">{filtered.map((deck) => { const legal = deckIsLegal(deck); return <article key={deck.id} className={`deck-tile ${selectedDeckId === deck.id ? "selected" : ""}`}>
      <button className="deck-select-target" onClick={() => selectDeck(deck.id)} aria-pressed={selectedDeckId === deck.id} aria-label={`Use ${deck.name} as active deck`}>
        <div className={`deck-cover ${factionClass(deck.factions[0] ?? "Pyrus")}`}><img src={BAKUGAN.find((bakugan) => bakugan.id === deck.bakuganIds[0])?.art} alt="" loading="lazy" decoding="async" width="240" height="260" /><span>{deck.visibility}</span><strong>{deck.name}</strong>{selectedDeckId === deck.id && <b>ACTIVE DECK</b>}</div>
      </button>
      <div className="deck-meta"><div className="faction-list">{deck.factions.map((item) => <span key={item}><i className={factionClass(item)} aria-hidden="true" />{item}</span>)}</div><Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL" : `${deckErrors(deck).length} ISSUE${deckErrors(deck).length === 1 ? "" : "S"}`}</Badge>{deck.conflictOf && <Badge tone="red">CONFLICT COPY</Badge>}<p>{deck.cardIds.length} cards • {deck.bakuganIds.length} Bakugan • {deck.coreIds.length} Cores • {deck.format ?? "standard"}</p><small>Updated {formatDeckTimestamp(deck.updatedAt)}</small></div>
      <div className="tile-actions"><button onClick={() => setDecks((items) => items.map((item) => item.id === deck.id ? { ...item, favourite: !item.favourite, updatedAt: new Date().toISOString() } : item))} aria-label={`${deck.favourite ? "Remove" : "Add"} ${deck.name} ${deck.favourite ? "from" : "to"} favourites`}>{deck.favourite ? "★" : "☆"}</button><button onClick={() => openDetail(deck)}>DETAILS</button><button onClick={() => openBuilder(deck)}>EDIT</button><button onClick={() => setDecks((items) => items.map((item) => item.id === deck.id ? { ...item, visibility: item.visibility === "Public" ? "Private" : "Public", updatedAt: new Date().toISOString(), revision: (item.revision ?? 0) + 1 } : item))}>{deck.visibility === "Public" ? "MAKE PRIVATE" : "PUBLISH"}</button><button onClick={() => copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied.")).catch((error) => notify(error.message))}>COPY CODE</button><button onClick={() => duplicateDeck(deck)}>DUPLICATE</button><button className="danger" onClick={() => removeDeck(deck)}>DELETE</button></div>
    </article>; })}</section>
    {!filtered.length && <section className="empty-state panel"><strong>NO DECKS MATCH THESE FILTERS</strong><p>Reset the search, faction, legality, and sort controls, or create a new deck.</p><div className="hero-actions"><AppButton tone="ghost" onClick={() => { setQuery(""); setFaction("All"); setLegality("All"); setSort("updated"); }}>RESET FILTERS</AppButton><AppButton tone="red" disabled={decks.length >= DECK_LIMIT} onClick={createDraft}>CREATE DECK</AppButton></div></section>}
  </>;
}

function DeckDetail({ deck, author, edit, back, clone, notify }: { deck: DeckRecord; author: string; edit: () => void; back: () => void; clone: () => void; notify: (message: string) => void }) {
  const counts = new Map<string, number>();
  for (const id of deck.cardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const share = () => copyText(window.location.href).then(() => notify("Deck link copied.")).catch((error) => notify(error.message));
  return <><PageHeader eyebrow={`${deck.visibility.toUpperCase()} DECK • BY ${author.toUpperCase()}`} title={deck.name.toUpperCase()} copy={`${deck.format ?? "standard"} format • Updated ${formatDeckTimestamp(deck.updatedAt)}`} art={BAKUGAN.find((item) => item.id === deck.bakuganIds[0])?.art} actions={<><AppButton tone="red" onClick={edit}>EDIT DECK</AppButton><AppButton tone="ghost" onClick={clone}>COPY TO LIBRARY</AppButton></>} />
    <section className="deck-detail-layout"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">DECK IDENTITY</span><h2>TEAM & SHARE</h2></div><Badge tone={deckIsLegal(deck) ? "gold" : "red"}>{deckIsLegal(deck) ? "LEGAL" : "HAS ISSUES"}</Badge></div><p>Author: <strong>{author}</strong></p><p>Visibility: <strong>{deck.visibility}</strong></p><div className="hero-actions"><AppButton tone="blue" onClick={() => copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied.")).catch((error) => notify(error.message))}>COPY DECK CODE</AppButton><AppButton tone="ghost" onClick={share}>COPY DECK LINK</AppButton><AppButton tone="ghost" onClick={() => downloadTextFile(`${deck.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`, deckTextList(deck))}>DOWNLOAD TEXT</AppButton></div><button className="text-button" onClick={back}>← RETURN TO DECK LIBRARY</button></article>
      <article className="panel"><span className="eyebrow">BAKUGAN TEAM</span><h2>{deck.factions.join(" • ")}</h2><div className="detail-team">{deck.bakuganIds.map((id) => { const bakugan = BAKUGAN.find((item) => item.id === id); return bakugan && <div key={id}><img src={bakugan.art} alt={bakugan.name} loading="lazy" decoding="async" /><strong>{bakugan.name}</strong><span>{bakugan.bPower}B • {bakugan.damage} Damage</span></div>; })}</div></article>
      <article className="panel deck-detail-list"><span className="eyebrow">MAIN DECK</span><h2>{deck.cardIds.length} CARDS</h2>{[...counts.entries()].sort((left, right) => (CARD_BY_ID.get(left[0])?.displayName ?? "").localeCompare(CARD_BY_ID.get(right[0])?.displayName ?? "")).map(([id, count]) => { const card = CARD_BY_ID.get(id); return <div key={id}><strong>{count}× {card?.displayName ?? id}</strong><span>{card?.type} • {card?.faction} • {card?.cost} Energy</span></div>; })}</article>
    </section></>;
}

function DeckBuilder({ deck, setDeck, save, back, storageHealth, notify }: { deck: DeckRecord; setDeck: (d: DeckRecord) => void; addCard: (id: string) => void; removeCard: (id: string) => void; save: () => DeckRecord | undefined; back: () => void; storageHealth: StorageHealth; notify: (message: string) => void }) {
  const [catalogTab, setCatalogTab] = useState<"cards" | "bakugan" | "cores">("cards");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [factionFilter, setFactionFilter] = useState("All");
  const [setFilter, setSetFilter] = useState("All");
  const [rarityFilter, setRarityFilter] = useState("All");
  const [costFilter, setCostFilter] = useState("All");
  const [sortBy, setSortBy] = useState<"id" | "name" | "cost" | "rarity">("id");
  const [availabilityFilter, setAvailabilityFilter] = useState<"All" | "Usable" | "Selected" | "Missing">("All");
  const [catalogPage, setCatalogPage] = useState(1);
  const [selectedSort, setSelectedSort] = useState<"type" | "name" | "cost">("type");
  const [inspectedCard, setInspectedCard] = useState<typeof CARDS[number] | null>(null);
  const [mobilePane, setMobilePane] = useState<"catalogue" | "deck">("catalogue");
  const [undoStack, setUndoStack] = useState<DeckRecord[]>([]);
  const [redoStack, setRedoStack] = useState<DeckRecord[]>([]);
  const savedSnapshot = useRef(JSON.stringify(deck));
  const PAGE_SIZE = 36;
  const commit = (next: DeckRecord) => {
    if (JSON.stringify(next) === JSON.stringify(deck)) return;
    setUndoStack((items) => [...items.slice(-29), deck]);
    setRedoStack([]);
    setDeck(next);
  };
  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous) return;
    setRedoStack((items) => [...items, deck]);
    setUndoStack((items) => items.slice(0, -1));
    setDeck(previous);
  };
  const redo = () => {
    const next = redoStack.at(-1);
    if (!next) return;
    setUndoStack((items) => [...items, deck]);
    setRedoStack((items) => items.slice(0, -1));
    setDeck(next);
  };
  const dirty = JSON.stringify(deck) !== savedSnapshot.current;
  const saveExplicitly = () => {
    const saved = save();
    if (saved) savedSnapshot.current = JSON.stringify(saved);
  };
  const guardedBack = () => {
    if (dirty && !window.confirm("Leave this changed draft? The device autosave will be retained, but the library copy is unchanged until you choose Save Deck.")) return;
    back();
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    savedSnapshot.current = JSON.stringify(deck);
    setUndoStack([]);
    setRedoStack([]);
  }, [deck.id]);

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
    const copies = deck.cardIds.filter((id) => id === card.catalogId).length;
    const usable = card.factions.some((item) => deck.factions.includes(item));
    return matchesQuery
      && (typeFilter === "All" || card.type === typeFilter)
      && (factionFilter === "All" || card.factions.includes(factionFilter as never))
      && (setFilter === "All" || setName(card.catalogId) === setFilter)
      && (rarityFilter === "All" || card.rarity === rarityFilter)
      && (costFilter === "All" || String(card.cost) === costFilter)
      && (availabilityFilter === "All" || (availabilityFilter === "Usable" && usable) || (availabilityFilter === "Selected" && copies > 0) || (availabilityFilter === "Missing" && usable && copies === 0));
  }).sort((a, b) => {
    if (sortBy === "name") return a.displayName.localeCompare(b.displayName);
    if (sortBy === "cost") return (typeof a.cost === "number" ? a.cost : 99) - (typeof b.cost === "number" ? b.cost : 99) || a.number - b.number;
    if (sortBy === "rarity") return rarityOrder.indexOf(a.rarity) - rarityOrder.indexOf(b.rarity) || a.number - b.number;
    return a.number - b.number;
  });
  const visibleCards = filteredCards.slice((catalogPage - 1) * PAGE_SIZE, catalogPage * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  useEffect(() => { setCatalogPage(1); }, [catalogQuery, typeFilter, factionFilter, setFilter, rarityFilter, costFilter, availabilityFilter, sortBy, catalogTab]);

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
  const energyCurve = [...new Set(mainCards.map((card) => card.cost))].map((cost) => ({ cost, count: deck.cardIds.filter((id) => CARD_BY_ID.get(id)?.cost === cost).length })).filter((item) => item.count);
  const factionBreakdown = deck.factions.map((item) => ({ faction: item, count: deck.cardIds.filter((id) => CARD_BY_ID.get(id)?.factions.includes(item as never)).length }));
  const duplicateSummary = cardCounts.filter((item) => item.count > 1).length;
  const sortedCardCounts = [...cardCounts].sort((left, right) => {
    if (selectedSort === "name") return left.card.displayName.localeCompare(right.card.displayName);
    if (selectedSort === "cost") return Number(left.card.cost === "X" ? 99 : left.card.cost) - Number(right.card.cost === "X" ? 99 : right.card.cost) || left.card.displayName.localeCompare(right.card.displayName);
    return left.card.type.localeCompare(right.card.type) || left.card.displayName.localeCompare(right.card.displayName);
  });

  const updateTeam = (bakuganId: string) => {
    const active = deck.bakuganIds.includes(bakuganId);
    const next = active ? deck.bakuganIds.filter((id) => id !== bakuganId) : deck.bakuganIds.length < 3 ? [...deck.bakuganIds, bakuganId] : deck.bakuganIds;
    commit({
      ...deck,
      bakuganIds: next,
      factions: [...new Set(next.map((id) => BAKUGAN.find((candidate) => candidate.id === id)?.faction).filter(Boolean))] as string[],
    });
  };
  const addCore = (coreId: string) => {
    const copies = deck.coreIds.filter((id) => id === coreId).length;
    if (deck.coreIds.length >= 6 || copies >= coreCopyLimit) return;
    commit({ ...deck, coreIds: [...deck.coreIds, coreId] });
  };
  const removeCore = (coreId: string) => {
    const next = [...deck.coreIds];
    const index = next.lastIndexOf(coreId);
    if (index >= 0) next.splice(index, 1);
    commit({ ...deck, coreIds: next });
  };
  const adjustCard = (cardId: string, delta: 1 | -1) => {
    const next = [...deck.cardIds];
    if (delta === -1) {
      const index = next.lastIndexOf(cardId);
      if (index >= 0) next.splice(index, 1);
    } else {
      const copies = next.filter((id) => id === cardId).length;
      if (next.length >= 40 || copies >= cardCopyLimit) return;
      next.push(cardId);
    }
    commit({ ...deck, cardIds: next });
  };
  const changeTab = (tab: "cards" | "bakugan" | "cores") => {
    setCatalogTab(tab);
    setTypeFilter("All");
    setFactionFilter("All");
    setSetFilter("All");
    setRarityFilter("All");
    setCostFilter("All");
    setAvailabilityFilter("All");
    setSortBy("id");
  };
  const resetFilters = () => {
    setCatalogQuery("");
    setTypeFilter("All");
    setFactionFilter("All");
    setSetFilter("All");
    setRarityFilter("All");
    setCostFilter("All");
    setAvailabilityFilter("All");
    setSortBy("id");
  };
  const importIntoBuilder = () => {
    const code = window.prompt("Paste a BBP1 deck code. This replaces the current draft after validation.");
    if (!code) return;
    try {
      const imported = decodeDeckCode(code, () => deck.id);
      commit({ ...imported, id: deck.id, name: uniqueDeckName(imported.name, []) });
      notify("Deck code imported into the current draft.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The deck code could not be imported.");
    }
  };
  const exportImage = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    if (!context) return notify("Image export is unavailable in this browser.");
    context.fillStyle = "#031019";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#63dcff";
    context.font = "700 34px sans-serif";
    context.fillText("BAKUGAN BATTLE PLANET ONLINE", 70, 90);
    context.fillStyle = "#ffffff";
    context.font = "700 58px sans-serif";
    context.fillText(deck.name.slice(0, 32), 70, 170);
    context.fillStyle = "#a6c2cc";
    context.font = "28px sans-serif";
    context.fillText(`${(deck.format ?? "standard").toUpperCase()} • ${deck.visibility.toUpperCase()} • ${deck.factions.join(" / ")}`, 70, 220);
    context.font = "700 30px sans-serif";
    context.fillStyle = "#ffffff";
    context.fillText("BAKUGAN TEAM", 70, 300);
    context.font = "25px sans-serif";
    selectedBakugan.forEach((item, index) => context.fillText(`${index + 1}. ${item.name} — ${item.bPower}B / ${item.damage} Damage`, 80, 350 + index * 42));
    context.font = "700 30px sans-serif";
    context.fillText("MAIN DECK", 70, 510);
    context.font = "23px sans-serif";
    sortedCardCounts.slice(0, 28).forEach(({ card, count }, index) => context.fillText(`${count}× ${card.displayName}  •  ${card.type}  •  ${card.cost} Energy`, 80, 555 + index * 34));
    context.fillStyle = "#6f8b96";
    context.font = "21px sans-serif";
    context.fillText(`Exported ${new Date().toLocaleString()} • BBP1`, 70, 1540);
    canvas.toBlob((blob) => {
      if (!blob) return notify("Image export failed.");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${deck.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-decklist.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  return <section className="builder-page builder-v2">
    <header className="builder-header">
      <h1 className="sr-only" tabIndex={-1}>Deck Builder</h1>
      <button onClick={guardedBack}>← DECK LIBRARY</button>
      <input value={deck.name} onChange={(event) => commit({ ...deck, name: event.target.value })} aria-label="Deck name" />
      <label className="builder-format"><span>FORMAT</span><select value={format} onChange={(event) => commit({ ...deck, format: event.target.value as DeckFormat })}><option value="standard">Standard</option><option value="singleton">Singleton</option></select></label>
      <label className="builder-format"><span>VISIBILITY</span><select value={deck.visibility} onChange={(event) => commit({ ...deck, visibility: event.target.value as DeckRecord["visibility"] })}><option>Private</option><option>Public</option></select></label>
      <Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL DECK" : `${errors.length} ISSUE${errors.length === 1 ? "" : "S"}`}</Badge>
      <span className={storageHealth.status === "error" ? "save-failed" : ""}>{storageHealth.status === "error" ? "Draft not saved" : storageHealth.savedAt ? `Draft saved ${new Date(storageHealth.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Checking draft storage…"}</span>
      <span>{dirty ? "Library copy has unsaved changes" : `Library saved ${formatDeckTimestamp(deck.updatedAt)}`}</span>
      <button onClick={undo} disabled={!undoStack.length} aria-label="Undo deck change">↶ UNDO</button>
      <button onClick={redo} disabled={!redoStack.length} aria-label="Redo deck change">↷ REDO</button>
      <button onClick={importIntoBuilder}>IMPORT</button>
      <button onClick={() => copyText(encodeDeckCode(deck)).then(() => notify("Deck code copied.")).catch((error) => notify(error.message))}>COPY CODE</button>
      <button onClick={() => downloadTextFile(`${deck.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.txt`, deckTextList(deck))}>TEXT LIST</button>
      <button onClick={exportImage}>IMAGE LIST</button>
      <AppButton tone="red" onClick={saveExplicitly}>SAVE DECK</AppButton>
    </header>
    <div className="builder-mobile-switch" role="tablist" aria-label="Builder workspace"><button role="tab" aria-selected={mobilePane === "catalogue"} className={mobilePane === "catalogue" ? "active" : ""} onClick={() => setMobilePane("catalogue")}>CATALOGUE</button><button role="tab" aria-selected={mobilePane === "deck"} className={mobilePane === "deck" ? "active" : ""} onClick={() => setMobilePane("deck")}>CURRENT DECK ({deck.cardIds.length}/40)</button></div>

    <div className="builder-layout builder-equal-columns">
      <aside className={`catalog panel builder-catalog-column mobile-pane-${mobilePane}`}>
        <div className="catalog-title-row"><div><span className="eyebrow">COMPLETE CATALOGUE</span><h2>ADD GAME PIECES</h2></div><Badge>{catalogTab === "cards" ? filteredCards.length : catalogTab === "bakugan" ? filteredBakugan.length : filteredCores.length} SHOWN</Badge></div>
        <div className="catalog-tabs" role="tablist" aria-label="Game piece catalogue">
          <button role="tab" aria-selected={catalogTab === "cards"} aria-controls="catalogue-results" className={catalogTab === "cards" ? "active" : ""} onClick={() => changeTab("cards")}>CARDS</button>
          <button role="tab" aria-selected={catalogTab === "bakugan"} aria-controls="catalogue-results" className={catalogTab === "bakugan" ? "active" : ""} onClick={() => changeTab("bakugan")}>BAKUGAN</button>
          <button role="tab" aria-selected={catalogTab === "cores"} aria-controls="catalogue-results" className={catalogTab === "cores" ? "active" : ""} onClick={() => changeTab("cores")}>CORES</button>
        </div>
        <label className="catalog-search"><span>SEARCH</span><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder={catalogTab === "cards" ? "Name or effect…" : "Name…"} /></label>
        <div className="catalog-filters">
          {(catalogTab === "cards" || catalogTab === "cores") && <label><span>{catalogTab === "cards" ? "CARD TYPE" : "CORE TYPE"}</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option>{(catalogTab === "cards" ? ["Action", "Flip", "Hero", "Evo"] : coreTypes).map((type) => <option key={type}>{type}</option>)}</select></label>}
          {catalogTab !== "cores" && <label><span>FACTION</span><select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option>All</option>{["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label>}
          {catalogTab !== "cores" && <label><span>SET</span><select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}><option>All</option><option>Battle Brawlers</option></select></label>}
          {catalogTab === "cards" && <label><span>RARITY</span><select value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}><option>All</option>{rarityOrder.map((rarity) => <option key={rarity}>{rarity}</option>)}</select></label>}
          {catalogTab === "cards" && <label><span>ENERGY COST</span><select value={costFilter} onChange={(event) => setCostFilter(event.target.value)}><option>All</option>{energyValues.map((cost) => <option key={cost}>{cost}</option>)}</select></label>}
          {catalogTab === "cards" && <label><span>SHOW</span><select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value as typeof availabilityFilter)}><option>All</option><option>Usable</option><option>Selected</option><option>Missing</option></select></label>}
          <label><span>SORT BY</span><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="id">ID</option><option value="name">Name</option>{catalogTab === "cards" && <><option value="cost">Energy Cost</option><option value="rarity">Rarity</option></>}</select></label>
          <button className="reset-filters" onClick={resetFilters}>RESET FILTERS</button>
        </div>
        <div id="catalogue-results" role="tabpanel" className={`catalog-results ${catalogTab}`}>
          {catalogTab === "cards" && visibleCards.map((card) => {
            const copies = deck.cardIds.filter((id) => id === card.catalogId).length;
            const atLimit = copies >= cardCopyLimit || deck.cardIds.length >= 40;
            return <article className="catalog-piece card-piece" key={card.id}>
              <button className="catalog-art-button" onClick={() => setInspectedCard(card)} aria-label={`Inspect ${card.displayName}`}><ResponsiveCardArtwork card={card} alt="" width={92} height={129} sizes="92px" /></button>
              <div className="catalog-piece-copy"><strong>{card.displayName}</strong><span>{card.type} • {card.faction} • {card.cost} Energy</span><small>{card.rarity}</small></div>
              <div className="catalog-piece-actions"><b>{copies}/{cardCopyLimit}</b><button onClick={() => setInspectedCard(card)}>VIEW</button><button disabled={atLimit} onClick={() => adjustCard(card.catalogId, 1)}>{atLimit ? "LIMIT" : "+ ADD"}</button></div>
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
        {catalogTab === "cards" && filteredCards.length > PAGE_SIZE && <nav className="catalog-pagination" aria-label="Catalogue pages"><button disabled={catalogPage === 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}>← PREVIOUS</button><span>Page {catalogPage} of {pageCount} • {filteredCards.length} results</span><button disabled={catalogPage === pageCount} onClick={() => setCatalogPage((page) => Math.min(pageCount, page + 1))}>NEXT →</button></nav>}
      </aside>

      <div className={`deck-workspace builder-deck-column mobile-pane-${mobilePane}`}>
        <section className={`deck-validation-summary ${legal ? "legal" : "illegal"}`}>
          <div><span className="eyebrow">{format.toUpperCase()} FORMAT</span><h2>{legal ? "READY FOR BATTLE" : "DECK REQUIRES ATTENTION"}</h2><p>{format === "standard" ? "Up to three copies of each Main Deck card and six copies of a BakuCore." : "One copy of each Main Deck card, Character, and BakuCore."}</p></div>
          <Badge tone={legal ? "gold" : "red"}>{legal ? "LEGAL" : `${errors.length} OPEN`}</Badge>
          {!legal && <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
        </section>

        <section className={`team-builder panel selected-section ${teamIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">BAKUGAN TEAM</span><h2>SELECTED BAKUGAN</h2></div><div className="section-actions"><Badge tone={teamIssue ? "red" : "gold"}>{deck.bakuganIds.length} / 3</Badge><button disabled={!deck.bakuganIds.length} onClick={() => commit({ ...deck, bakuganIds: [], factions: [] })}>CLEAR TEAM</button></div></div>
          <div className="selected-bakugan-grid">{[0, 1, 2].map((index) => { const bakugan = selectedBakugan[index]; return bakugan ? <article className={factionClass(bakugan.faction)} key={bakugan.id}><img src={bakugan.art} alt={bakugan.name} /><div><strong>{bakugan.name}</strong><span>{bakugan.faction} • {bakugan.bPower}B • {bakugan.damage}D</span><small>{bakugan.character.coreTypes.join(" + ")}</small></div><button onClick={() => updateTeam(bakugan.id)}>REMOVE</button></article> : <div className="empty-selection-slot" key={index}><b>+</b><span>BAKUGAN SLOT {index + 1}</span></div>; })}</div>
        </section>

        <section className={`core-builder panel selected-section ${coreIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">HIDE MATRIX KIT</span><h2>SELECTED BAKUCORES</h2></div><div className="section-actions"><Badge tone={coreIssue ? "red" : "gold"}>{deck.coreIds.length} / 6</Badge><button disabled={!deck.coreIds.length} onClick={() => commit({ ...deck, coreIds: [] })}>CLEAR CORES</button></div></div>
          <div className="core-requirement-strip"><span>ALLOWED CORE TYPES</span><div>{coreTypes.map((type) => { const required = requiredCoreTypes.filter((item) => item === type).length; const selected = selectedCores.filter((core) => core.type === type).length; return <i className={`${required ? "required" : "not-required"} ${selected === required ? "met" : "unmet"}`} key={type}>{type}<b>{selected}/{required}</b></i>; })}</div></div>
          <div className="selected-core-grid">{[0, 1, 2, 3, 4, 5].map((index) => { const core = selectedCores[index]; return core ? <article key={`${core.id}-${index}`}><img src={core.art} alt={core.name} /><strong>{core.name}</strong><span>{core.type}</span><button onClick={() => removeCore(core.id)}>REMOVE</button></article> : <div className="empty-selection-slot core-empty" key={index}><b>+</b><span>CORE SLOT {index + 1}</span></div>; })}</div>
        </section>

        <section className="panel selected-section deck-analysis">
          <div className="panel-heading"><div><span className="eyebrow">DECK ANALYSIS</span><h2>CURVE & DISTRIBUTION</h2></div><Badge>{duplicateSummary} DUPLICATED TITLES</Badge></div>
          <div className="analysis-grid"><div><h3>ENERGY CURVE</h3>{energyCurve.map((item) => <span key={String(item.cost)}><b>{item.cost}</b><i style={{ "--analysis-width": `${Math.max(8, item.count / Math.max(1, ...energyCurve.map((entry) => entry.count)) * 100)}%` } as React.CSSProperties} /><strong>{item.count}</strong></span>)}</div><div><h3>CARD TYPES</h3>{cardTypeCounts.map((item) => <span key={item.type}><b>{item.type}</b><strong>{item.count}</strong></span>)}</div><div><h3>FACTIONS</h3>{factionBreakdown.map((item) => <span key={item.faction}><b>{item.faction}</b><strong>{item.count}</strong></span>)}</div></div>
        </section>

        <section className={`deck-list panel selected-section ${deckIssue ? "has-issues" : ""}`}>
          <div className="panel-heading"><div><span className="eyebrow">MAIN DECK</span><h2>40-CARD LIST</h2></div><div className="section-actions"><label>GROUP / SORT<select value={selectedSort} onChange={(event) => setSelectedSort(event.target.value as typeof selectedSort)}><option value="type">Card type</option><option value="name">Name</option><option value="cost">Energy cost</option></select></label><Badge tone={deckIssue ? "red" : "gold"}>{deck.cardIds.length} / 40</Badge><button disabled={!deck.cardIds.length} onClick={() => commit({ ...deck, cardIds: [] })}>CLEAR MAIN DECK</button></div></div>
          <div className="deck-type-summary">{cardTypeCounts.map(({ type, count }) => <div key={type}><span>{type}</span><strong>{count}</strong></div>)}<div className={factionMismatchCount ? "warning" : ""}><span>Faction issues</span><strong>{factionMismatchCount}</strong></div></div>
          <div className="selected-card-list">{sortedCardCounts.length ? sortedCardCounts.map(({ card, count }) => <article key={card.id}><button className="selected-card-inspect" onClick={() => setInspectedCard(card)} aria-label={`Inspect ${card.displayName}`}><ResponsiveCardArtwork card={card} alt="" width={50} height={70} sizes="50px" /></button><div><strong>{card.displayName}</strong><span>{card.type} • {card.faction} • {card.cost} Energy • {card.rarity}</span><small>{card.effect}</small></div><div className="deck-quantity-controls"><button onClick={() => adjustCard(card.catalogId, -1)}>−</button><b>{count}</b><button disabled={count >= cardCopyLimit || deck.cardIds.length >= 40} onClick={() => adjustCard(card.catalogId, 1)}>+</button></div></article>) : <div className="empty-deck-list"><strong>NO MAIN-DECK CARDS SELECTED</strong><span>Use the Cards tab in the catalogue to build the deck.</span></div>}</div>
        </section>
      </div>
    </div>
    {inspectedCard && <div className="card-inspector-backdrop" role="presentation" onMouseDown={() => setInspectedCard(null)}><section className="card-inspector" role="dialog" aria-modal="true" aria-labelledby="inspected-card-title" onMouseDown={(event) => event.stopPropagation()}><button className="inspector-close" onClick={() => setInspectedCard(null)} aria-label={`Close ${inspectedCard.displayName} details`}>×</button><ResponsiveCardArtwork card={inspectedCard} alt={inspectedCard.displayName} width={500} height={700} sizes="(max-width: 700px) 88vw, 500px" priority /><div><Badge tone={factionClass(inspectedCard.faction)}>{inspectedCard.faction}</Badge><h2 id="inspected-card-title">{inspectedCard.displayName}</h2><p>{inspectedCard.effect}</p><dl><div><dt>Catalogue ID</dt><dd>{inspectedCard.catalogId}</dd></div><div><dt>Collector number</dt><dd>{inspectedCard.number}/374</dd></div><div><dt>Type</dt><dd>{inspectedCard.type}</dd></div><div><dt>Rarity</dt><dd>{inspectedCard.rarity}</dd></div><div><dt>Energy</dt><dd>{inspectedCard.cost}</dd></div></dl><AppButton tone="red" disabled={deck.cardIds.filter((id) => id === inspectedCard.catalogId).length >= cardCopyLimit || deck.cardIds.length >= 40} onClick={() => adjustCard(inspectedCard.catalogId, 1)}>ADD TO DECK</AppButton></div></section></div>}
  </section>;
}

function Compendium({ query, setQuery, tab, setTab, authUser, notify, navigatePath }: { query: string; setQuery: (q: string) => void; tab: "cards" | "rules" | "rulings"; setTab: (t: "cards" | "rules" | "rulings") => void; authUser: AuthUser | null; notify: (message: string) => void; navigatePath: (path: string) => void }) {
  const [typeFilter, setTypeFilter] = useState("All");
  const [factionFilter, setFactionFilter] = useState("All");
  const [rarityFilter, setRarityFilter] = useState("All");
  const [costFilter, setCostFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [page, setPage] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  const [rulingCardId, setRulingCardId] = useState("");
  const [rulingQuestion, setRulingQuestion] = useState("");
  const [submissionState, setSubmissionState] = useState<"idle" | "submitting" | "sent">("idle");
  const [submissionError, setSubmissionError] = useState("");
  const PAGE_SIZE = 24;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const cards = useMemo(() => CARDS.filter((card) => {
    const searchable = `${card.displayName} ${card.effect} ${card.faction} ${card.type} ${card.rarity} ${card.catalogId} ${card.number} ${card.mechanics.join(" ")}`.toLocaleLowerCase();
    return (!normalizedQuery || searchable.includes(normalizedQuery))
      && (typeFilter === "All" || card.type === typeFilter)
      && (factionFilter === "All" || card.factions.includes(factionFilter as never))
      && (rarityFilter === "All" || card.rarity === rarityFilter)
      && (costFilter === "All" || String(card.cost) === costFilter)
      && (categoryFilter === "All" || (categoryFilter === "Character / game piece" ? card.type === "Character" : card.type !== "Character"));
  }), [normalizedQuery, typeFilter, factionFilter, rarityFilter, costFilter, categoryFilter]);
  const rules = useMemo(() => [
    ...RULE_ENTRIES.map((rule) => ({ ...rule, slug: rule.title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), source: "Digital adaptation reference", sourceSection: rule.category, reviewedAt: REFERENCE_REVIEWED_AT })),
    ...GLOSSARY_ENTRIES,
  ].filter((rule) => !normalizedQuery || `${rule.title} ${rule.body} ${rule.category}`.toLocaleLowerCase().includes(normalizedQuery)), [normalizedQuery]);
  const visibleCards = cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const pathSegments = typeof window === "undefined" ? [] : window.location.pathname.split("/").filter(Boolean);
  const detailSlug = pathSegments[0] === "compendium" && pathSegments[1] === "cards" ? decodeURIComponent(pathSegments[2] ?? "") : "";
  const selectedCard = detailSlug ? CARDS.find((card) => card.slug === detailSlug || card.catalogId === detailSlug) : null;
  const selectedIndex = selectedCard ? cards.findIndex((card) => card.catalogId === selectedCard.catalogId) : -1;
  useEffect(() => { setPage(1); }, [query, typeFilter, factionFilter, rarityFilter, costFilter, categoryFilter]);
  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    if (segments[1] === "rules") setTab("rules");
    if (segments[1] === "rulings") setTab("rulings");
    if (segments[1] === "cards") setTab("cards");
  }, [setTab]);
  const openCard = (card: typeof CARDS[number]) => {
    setZoomed(false);
    navigatePath(`/compendium/cards/${card.slug ?? card.catalogId}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const copyReferenceLink = async (path: string, label: string) => {
    try {
      await copyText(`${window.location.origin}${path}`);
      notify(`${label} link copied.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The link could not be copied.");
    }
  };
  const openRulings = (card: typeof CARDS[number]) => {
    setRulingCardId(card.catalogId);
    setTab("rulings");
    navigatePath(`/compendium/rulings?card=${encodeURIComponent(card.catalogId)}`);
  };
  const submitRuling = async () => {
    setSubmissionError("");
    if (!authUser) {
      setSubmissionError("Sign in before submitting a ruling request so administrators can reply and track its status.");
      return;
    }
    if (rulingQuestion.trim().length < 20) {
      setSubmissionError("Describe the interaction in at least 20 characters.");
      return;
    }
    setSubmissionState("submitting");
    try {
      const response = await fetch("/api/rulings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: rulingCardId || null, question: rulingQuestion.trim(), sourceUrl: window.location.href }),
      });
      const data = await response.json() as { id?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The ruling request could not be submitted.");
      setSubmissionState("sent");
      setRulingQuestion("");
      notify(`Ruling request ${data.id ?? ""} submitted for administrator review.`);
    } catch (error) {
      setSubmissionState("idle");
      setSubmissionError(error instanceof Error ? error.message : "The ruling request could not be submitted.");
    }
  };
  const resetCardFilters = () => {
    setQuery("");
    setTypeFilter("All");
    setFactionFilter("All");
    setRarityFilter("All");
    setCostFilter("All");
    setCategoryFilter("All");
  };

  return <>{!selectedCard && <><PageHeader eyebrow="AUTHORITATIVE REFERENCE" title="CARD & RULES COMPENDIUM" copy="Browse the supplied card workbook, advanced glossary, symbol reference, and published developer rulings with source and revision labels." art="/assets/aquos.png" />
    <section className="compendium-provenance panel"><div><span className="eyebrow">SOURCE STATUS</span><h2>REVIEWED {REFERENCE_REVIEWED_AT}</h2></div><p>Cards: <strong>Battle Planet Cards and Description.xlsx</strong> and provided scans. Rules: <strong>Official Complete Rulebook</strong> and <strong>Glossary.pdf</strong>. Published answers: <strong>Ruling Questions for Justin Gary and Gary Arant</strong>. Digital adaptations are labelled separately.</p><Badge tone="gold">REVISION 1</Badge></section>
    <section className="compendium-toolbar"><label className="search-box large"><span className="sr-only">Search the Compendium</span>⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a card, keyword, symbol, ID, or ruling…" /></label><div className="tabs" role="tablist" aria-label="Compendium sections"><button role="tab" aria-selected={tab === "cards"} aria-controls="compendium-panel" className={tab === "cards" ? "active" : ""} onClick={() => { setTab("cards"); navigatePath("/compendium"); }}>CARDS</button><button role="tab" aria-selected={tab === "rules"} aria-controls="compendium-panel" className={tab === "rules" ? "active" : ""} onClick={() => { setTab("rules"); navigatePath("/compendium/rules"); }}>RULES & GLOSSARY</button><button role="tab" aria-selected={tab === "rulings"} aria-controls="compendium-panel" className={tab === "rulings" ? "active" : ""} onClick={() => { setTab("rulings"); navigatePath("/compendium/rulings"); }}>RULINGS</button></div></section>
    </>}
    {tab === "cards" && !selectedCard && <div id="compendium-panel" role="tabpanel">
      <section className="compendium-filters panel"><label>TYPE<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option>All</option>{["Action", "Flip", "Hero", "Evo", "Character"].map((item) => <option key={item}>{item}</option>)}</select></label><label>FACTION<select value={factionFilter} onChange={(event) => setFactionFilter(event.target.value)}><option>All</option>{["Aquos", "Aurelus", "Darkus", "Haos", "Pyrus", "Ventus"].map((item) => <option key={item}>{item}</option>)}</select></label><label>SET<select><option>Battle Brawlers</option></select></label><label>RARITY<select value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}><option>All</option>{[...new Set(CARDS.map((card) => card.rarity))].sort().map((item) => <option key={item}>{item}</option>)}</select></label><label>COST<select value={costFilter} onChange={(event) => setCostFilter(event.target.value)}><option>All</option>{[...new Set(CARDS.map((card) => String(card.cost)))].sort((left, right) => Number(left) - Number(right)).map((item) => <option key={item}>{item}</option>)}</select></label><label>CATEGORY<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>All</option><option>Main Deck card</option><option>Character / game piece</option></select></label><button onClick={resetCardFilters}>RESET FILTERS</button><Badge>{cards.length} RESULTS</Badge></section>
      <section className="compendium-cards">{visibleCards.map((card) => <article className="reference-card" key={card.id}><button className="reference-art" onClick={() => openCard(card)} aria-label={`Open card details for ${card.displayName}`}><ResponsiveCardArtwork card={card} alt="" width={260} height={364} sizes="(max-width: 700px) 44vw, 260px" /></button><div><Badge tone={factionClass(card.faction)}>{card.faction}</Badge><h2>{card.displayName}</h2><p><RichEffect text={card.effect} /></p><div className="symbol-line"><Metric icon="/assets/symbols/energy.png" label="Cost" value={card.cost} /><Metric label="Type" value={card.type} /><Metric label="No." value={`${card.number}/374`} /></div><button onClick={() => openRulings(card)} aria-label={`Open official rulings for ${card.displayName}`}>OPEN OFFICIAL RULINGS →</button><button onClick={() => copyReferenceLink(`/compendium/cards/${card.slug ?? card.catalogId}`, card.displayName)} aria-label={`Copy card link for ${card.displayName}`}>COPY CARD LINK</button></div></article>)}</section>
      {cards.length > PAGE_SIZE && <nav className="catalog-pagination compendium-pagination" aria-label="Compendium card pages"><button disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>← PREVIOUS</button><span>Page {page} of {pageCount} • showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, cards.length)} of {cards.length}</span><button disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>NEXT →</button></nav>}
      {!cards.length && <section className="empty-state panel"><strong>NO CARDS MATCH</strong><p>Check spelling or reset the type, faction, set, rarity, cost, and category filters.</p><AppButton tone="ghost" onClick={resetCardFilters}>RESET CARD FILTERS</AppButton></section>}
    </div>}
    {tab === "cards" && selectedCard && <section id="compendium-panel" role="tabpanel" className="card-detail-page"><header className="card-detail-nav"><button onClick={() => navigatePath("/compendium")}>← CARD RESULTS</button><div><button disabled={selectedIndex <= 0} onClick={() => openCard(cards[selectedIndex - 1]!)}>← PREVIOUS</button><button disabled={selectedIndex < 0 || selectedIndex >= cards.length - 1} onClick={() => openCard(cards[selectedIndex + 1]!)}>NEXT →</button></div></header><div className="card-detail-layout"><button className={`card-detail-art ${zoomed ? "zoomed" : ""}`} onClick={() => setZoomed((value) => !value)} aria-label={`${zoomed ? "Reduce" : "Enlarge"} ${selectedCard.displayName} card image`}><ResponsiveCardArtwork card={selectedCard} alt={selectedCard.displayName} width={600} height={840} sizes="(max-width: 800px) 92vw, 600px" priority /></button><article className="panel"><Badge tone={factionClass(selectedCard.faction)}>{selectedCard.factions.join(" • ")}</Badge><h1>{selectedCard.displayName}</h1><p className="card-effect-large"><RichEffect text={selectedCard.effect} /></p><dl className="metadata-grid"><div><dt>Set</dt><dd>Battle Brawlers</dd></div><div><dt>Collector number</dt><dd>{selectedCard.number}/374</dd></div><div><dt>Catalogue ID</dt><dd>{selectedCard.catalogId}</dd></div><div><dt>Rarity</dt><dd>{selectedCard.rarity}</dd></div><div><dt>Type</dt><dd>{selectedCard.type}</dd></div><div><dt>Energy cost</dt><dd>{selectedCard.cost}</dd></div>{selectedCard.bPower != null && <div><dt>B-Power</dt><dd>{selectedCard.bPower}</dd></div>}{selectedCard.damage != null && <div><dt>Damage Rating</dt><dd>{selectedCard.damage}</dd></div>}{selectedCard.coreTypes.length > 0 && <div><dt>BakuCore indicators</dt><dd>{selectedCard.coreTypes.join(" + ")}</dd></div>}<div><dt>Source</dt><dd>{selectedCard.source ?? "Provided catalogue"}</dd></div></dl><div className="hero-actions"><AppButton tone="red" onClick={() => openRulings(selectedCard)}>OPEN OFFICIAL RULINGS</AppButton><AppButton tone="ghost" onClick={() => copyReferenceLink(`/compendium/cards/${selectedCard.slug ?? selectedCard.catalogId}`, selectedCard.displayName)}>COPY CARD LINK</AppButton></div></article></div></section>}
    {tab === "rules" && <div id="compendium-panel" role="tabpanel"><section className="symbol-reference panel"><div className="panel-heading"><div><span className="eyebrow">SYMBOL INDEX</span><h2>PRINTED ICONS</h2></div><Badge>{SYMBOL_ENTRIES.length} SYMBOLS</Badge></div><div>{SYMBOL_ENTRIES.map((symbol) => <article key={symbol.token}><img src={symbol.asset} alt="" width="44" height="44" loading="lazy" decoding="async" /><strong>{symbol.name}</strong><code>{symbol.token}</code><p>{symbol.description}</p></article>)}</div></section><section className="rule-grid">{rules.map((rule) => <article className="panel" id={`rule-${rule.slug}`} key={`${rule.source}-${rule.slug}`}><Badge>{rule.category}</Badge><h2>{rule.title}</h2><p>{rule.body}</p><small>{rule.source} • {rule.sourceSection} • Reviewed {rule.reviewedAt}</small><button onClick={() => copyReferenceLink(`/compendium/rules/${rule.slug}`, rule.title)} aria-label={`Copy rule link for ${rule.title}`}>COPY RULE LINK</button></article>)}</section>{!rules.length && <section className="empty-state panel"><strong>NO GLOSSARY ENTRIES MATCH</strong><p>Try a broader term or clear the search field.</p><AppButton tone="ghost" onClick={() => setQuery("")}>CLEAR SEARCH</AppButton></section>}</div>}
    {tab === "rulings" && <section id="compendium-panel" role="tabpanel" className="ruling-list">{PUBLISHED_RULINGS.filter((ruling) => !normalizedQuery || `${ruling.title} ${ruling.body} ${ruling.category}`.toLocaleLowerCase().includes(normalizedQuery)).map((ruling) => <article className="panel" id={`ruling-${ruling.slug}`} key={ruling.slug}><Badge tone="gold">PUBLISHED</Badge><h2>{ruling.title}</h2><p>{ruling.body}</p><small>Effective: original published developer response • {ruling.sourceSection} • Reviewed {ruling.reviewedAt}</small><button onClick={() => copyReferenceLink(`/compendium/rulings/${ruling.slug}`, ruling.title)} aria-label={`Copy ruling link for ${ruling.title}`}>COPY RULING LINK</button></article>)}<article className="panel unresolved"><Badge tone="red">ADMINISTRATOR REVIEW QUEUE</Badge><h2>Submit an unanswered interaction</h2><p>Requests are validated, tied to the signed-in sender, and stored as a pending administrator record. Do not include private information.</p><label>CARD (OPTIONAL)<select value={rulingCardId} onChange={(event) => setRulingCardId(event.target.value)}><option value="">General rules question</option>{CARDS.map((card) => <option value={card.catalogId} key={card.catalogId}>{card.displayName} ({card.catalogId})</option>)}</select></label><label>QUESTION<textarea value={rulingQuestion} onChange={(event) => setRulingQuestion(event.target.value)} placeholder="Describe the cards, current state, decision window, and expected outcome…" minLength={20} maxLength={2000} /></label>{submissionError && <p className="error-message" role="alert">{submissionError}</p>}{submissionState === "sent" && <p className="success-message" role="status">Request submitted and marked Pending.</p>}<AppButton tone="red" disabled={submissionState === "submitting" || rulingQuestion.trim().length < 20} onClick={submitRuling}>{submissionState === "submitting" ? "SUBMITTING…" : "SUBMIT RULING REQUEST"}</AppButton></article></section>}
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

function HistoryScreen({ history, replay, openReplay, closeReplay, replayIndex, setReplayIndex, setRoute }: { history: ResultRecord[]; replay: ResultRecord | null; openReplay: (record: ResultRecord) => void; closeReplay: () => void; replayIndex: number; setReplayIndex: (i: number) => void; setRoute: (route: Route) => void }) {
  const [formatFilter, setFormatFilter] = useState<"all" | "bo1" | "bo3">("all");
  const visibleHistory = history.filter((item) => formatFilter === "all" || item.format === formatFilter);
  return <><PageHeader eyebrow="MATCH ARCHIVE" title="HISTORY & REPLAY" copy="Inspect locally retained result records, event order, and published random outcomes." art="/assets/darkus.png" />
    {!replay ? <section className="history-layout"><div className="panel history-list"><div className="panel-heading"><div><span className="eyebrow">RECENT MATCHES</span><h2>{visibleHistory.length} RECORDED</h2></div><label><span className="sr-only">Filter history by format</span><select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value as typeof formatFilter)}><option value="all">All formats</option><option value="bo1">Best of one</option><option value="bo3">Best of three</option></select></label></div>{visibleHistory.length ? visibleHistory.map((item) => <button className="history-row" key={item.id} onClick={() => openReplay(item)}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><strong>vs {item.opponent}</strong><span>{item.score}</span><span>{item.reason}</span><small>{formatDeckTimestamp(item.at)} • {(item.format ?? "unknown").toUpperCase()} • {item.mode ?? "legacy"}</small><i>OPEN RECORD →</i></button>) : <div className="empty-state"><strong>{history.length ? "NO MATCHES IN THIS FORMAT" : "NO MATCHES YET"}</strong><p>{history.length ? "Choose another format or show all records." : "Complete a training or online match to create a record."}</p>{history.length ? <AppButton tone="ghost" onClick={() => setFormatFilter("all")}>SHOW ALL FORMATS</AppButton> : <AppButton tone="red" onClick={() => setRoute("play")}>START A TRAINING MATCH</AppButton>}</div>}</div><aside className="panel archive-stats"><h2>ARCHIVE SUMMARY</h2><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item) => item.result === "Victor").length} /><Metric label="Replays" value={history.length} /></aside></section>
    : <section className="replay-page"><header><button onClick={closeReplay}>← HISTORY</button><div><span className="eyebrow">RECORD {replay.id}</span><h2>{replay.result} vs {replay.opponent}</h2></div><AppButton tone="ghost" onClick={() => copyText(window.location.href)}>COPY RECORD LINK</AppButton></header><div className="replay-theatre"><div className="replay-event"><Badge tone={replay.log[replayIndex]?.kind === "random" ? "gold" : "blue"}>{replay.log[replayIndex]?.kind.toUpperCase()}</Badge><h2>{replay.log[replayIndex]?.message}</h2><small>{new Date(replay.log[replayIndex]?.at ?? 0).toLocaleTimeString()}</small></div><div className="replay-board"><img src="/assets/playmat.webp" alt="Static battlefield reference; this record replays the event log rather than reconstructing game state" loading="lazy" decoding="async" width="1200" height="720" /></div><aside aria-label="Replay events">{replay.log.map((event, index) => <button className={index === replayIndex ? "active" : ""} aria-current={index === replayIndex ? "step" : undefined} key={event.id} onClick={() => setReplayIndex(index)}><span>{index + 1}</span>{event.message}</button>)}</aside></div><div className="replay-controls"><button onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}>◀ STEP</button><input aria-label="Replay event" type="range" min="0" max={Math.max(0, replay.log.length - 1)} value={replayIndex} onChange={(event) => setReplayIndex(Number(event.target.value))} /><button onClick={() => setReplayIndex(Math.min(replay.log.length - 1, replayIndex + 1))}>STEP ▶</button><Badge>{replayIndex + 1} / {replay.log.length}</Badge></div></section>}</>;
}

function ProfileScreen({ profile, setProfile, history, decks, authUser, openDeck, saveProfile }: { profile: Profile; setProfile: React.Dispatch<React.SetStateAction<Profile>>; history: ResultRecord[]; decks: DeckRecord[]; authUser: AuthUser | null; openDeck: (deck: DeckRecord) => void; saveProfile: () => void }) {
  return <><PageHeader eyebrow="BRAWLER IDENTITY" title={profile.name.toUpperCase()} copy="Manage the public information other Brawlers see in challenges, rooms, and shared records." art={`/assets/${profile.faction.toLowerCase() === "aurelus" ? "brawlers-group" : profile.faction.toLowerCase()}.png`} />
    <section className="profile-layout"><article className="panel profile-card"><div className={`large-avatar ${factionClass(profile.faction)}`}>{profile.name.slice(0, 2).toUpperCase()}</div><Badge tone={authUser ? "gold" : "blue"}>{authUser ? "CLOUD ACCOUNT" : "LOCAL PROFILE"}</Badge>{authUser && <small className="account-email">{authUser.email}</small>}<label>DISPLAY NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label><AppButton tone="red" onClick={saveProfile}>SAVE PROFILE</AppButton><small>{authUser ? "Profile changes sync to signed-in devices." : "Profile changes are retained in this browser."}</small></article><article className="panel profile-stats"><span className="eyebrow">BRAWLER RECORD</span><h2>ORIGINAL BATTLE PLANET</h2><div className="stat-grid"><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item) => item.result === "Victor").length} /><Metric label="Legal decks" value={decks.filter(deckIsLegal).length} /><Metric label="Public decks" value={decks.filter((deck) => deck.visibility === "Public").length} /></div><h3>PUBLIC DECKS</h3>{decks.filter((deck) => deck.visibility === "Public").map((deck) => <button className="public-deck" key={deck.id} onClick={() => openDeck(deck)} aria-label={`Open public deck ${deck.name}`}><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span><Badge tone={deckIsLegal(deck) ? "gold" : "red"}>{deckIsLegal(deck) ? "LEGAL" : "ISSUES"}</Badge></button>)}</article></section></>;
}

function SettingsScreen({ settings, setSettings, authUser, syncStatus, syncError, storageHealth, signOut, openAccount, syncNow, changePassword, deleteAccount }: { settings: AppSettings; setSettings: React.Dispatch<React.SetStateAction<AppSettings>>; authUser: AuthUser | null; syncStatus: SyncStatus; syncError: string; storageHealth: StorageHealth; signOut: () => Promise<void>; openAccount: () => void; syncNow: () => void; changePassword: (currentPassword: string, newPassword: string) => Promise<void>; deleteAccount: (confirmation: string) => Promise<void> }) {
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
    <section className="settings-grid"><article className="panel"><h2>ACCESSIBILITY</h2><Toggle label="Reduced motion" copy="Replace camera moves and flashes with static emphasis." checked={settings.reducedMotion} onChange={(value) => setSettings({ ...settings, reducedMotion: value })} /><Toggle label="High contrast" copy="Increase panel, border, and focus contrast." checked={settings.highContrast} onChange={(value) => setSettings({ ...settings, highContrast: value })} /><label className="range-setting"><span>Card scale <b>{settings.cardScale}%</b></span><input type="range" min="80" max="140" value={settings.cardScale} onChange={(event) => setSettings({ ...settings, cardScale: Number(event.target.value) })} /></label></article><article className="panel"><h2>AUDIO & MATCH LOG</h2><Toggle label="Interface and match audio" copy="Phase calls, priority, and result cues." checked={settings.sound} onChange={(value) => setSettings({ ...settings, sound: value, soundEnabled: value })} /><label>DEFAULT LOG DETAIL<select value={settings.logDetail} onChange={(event) => setSettings({ ...settings, logDetail: event.target.value })}><option>All events</option><option>Gameplay only</option><option>Random results</option></select></label></article><article className="panel"><h2>PRIVACY</h2><Toggle label="Allow replay links" copy="Enable copyable links to locally retained completed match records." checked={settings.replayLinks ?? true} onChange={(value) => setSettings({ ...settings, replayLinks: value })} /><p className="small-note">Friend challenges and block management are not advertised until the supporting social service exists.</p></article>
      <article className="panel account-management"><div className="panel-heading"><div><span className="eyebrow">DATA & ACCOUNT</span><h2>{authUser ? "CLOUD SYNC" : "LOCAL STORAGE"}</h2></div><Badge tone={syncStatus === "synced" || storageHealth.status === "saved" ? "gold" : syncStatus === "error" || storageHealth.status === "error" ? "red" : "blue"}>{authUser ? syncStatus.toUpperCase() : storageHealth.status.toUpperCase()}</Badge></div>{authUser ? <><div className="account-summary"><strong>{authUser.email}</strong><span>Decks, drafts, history, settings, and resumable state sync automatically.</span></div>{syncError && syncStatus === "error" && <p className="error-message">{syncError}</p>}<div className="account-actions"><AppButton tone="blue" onClick={syncNow}>SYNC NOW</AppButton><AppButton tone="ghost" onClick={signOut}>SIGN OUT</AppButton></div><form className="password-form" onSubmit={submitPassword}><h3>CHANGE PASSWORD</h3><label>CURRENT PASSWORD<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><label>NEW PASSWORD<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required aria-describedby="new-password-help" /></label><small id="new-password-help">Use 10–128 characters and avoid reusing a password from another service.</small><AppButton type="submit" tone="ghost" disabled={accountBusy}>UPDATE PASSWORD</AppButton></form><div className="delete-account"><h3>DELETE ACCOUNT</h3><p>This removes the cloud account and synced copy. The local browser copy remains until you delete it separately.</p><label>TYPE DELETE TO CONFIRM<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label><button className="danger-text" disabled={accountBusy || confirmation.toUpperCase() !== "DELETE"} onClick={removeAccount}>DELETE CLOUD ACCOUNT</button></div></> : <><div className={`storage-callout ${storageHealth.status === "error" ? "storage-failed" : ""}`}><strong>{storageHealth.status === "error" ? "LATEST CHANGES NOT SAVED" : "SAVED ON THIS DEVICE"}</strong><span>{storageHealth.message}{storageHealth.savedAt ? ` Last successful save: ${new Date(storageHealth.savedAt).toLocaleString()}.` : ""}</span></div><AppButton tone="red" onClick={openAccount}>SIGN UP OR LOG IN TO SYNC</AppButton></>}{accountError && <p className="error-message" role="alert">{accountError}</p>}<hr /><button className="danger-text" onClick={clearLocalProfile}>DELETE LOCAL BROWSER DATA</button></article></section></>;
}

function Toggle({ label, copy, checked, onChange }: { label: string; copy: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="toggle-row"><div><strong>{label}</strong><small>{copy}</small></div><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span /></label>; }
function Timer({ deadline }: { deadline: number }) { const [now, setNow] = useState(0); useEffect(() => { const tick = () => setNow(Date.now()); const start = window.setTimeout(tick, 0); const i = window.setInterval(tick, 1000); return () => { window.clearTimeout(start); window.clearInterval(i); }; }, []); const seconds = Math.max(0, Math.ceil((deadline - (now || deadline - 30_000)) / 1000)); return <div className={`timer ${seconds <= 10 ? "warning" : ""}`}><small>TIME REMAINING</small><strong>00:{String(seconds).padStart(2, "0")}</strong></div>; }
function BootScreen({ label }: { label: string }) { return <main className="boot-screen"><img src="/assets/logo.png" alt="Bakugan Battle Planet" /><span className="pulse" /><h1>{label}</h1><p>Restoring decks, settings, drafts, history, and active state…</p></main>; }
function Empty({ title }: { title: string }) { return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p></section>; }
