"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
const NAV = [
    { href: "/dashboard", label: "Dashboard", key: "01" },
    { href: "/play", label: "Play", key: "02" },
    { href: "/decks", label: "Decks", key: "03" },
    { href: "/compendium", label: "Compendium", key: "04" },
    { href: "/history", label: "History", key: "05" },
    { href: "/profile", label: "Profile", key: "06" },
];
const TITLES = {
    dashboard: "Dashboard",
    play: "Play",
    decks: "Deck Library",
    builder: "Deck Builder",
    compendium: "Card & Rules Compendium",
    history: "History & Replay",
    profile: "Brawler Profile",
    settings: "Settings",
};
export function AppShell({ children }) {
    const pathname = usePathname();
    const { ready, route, profile, authUser, syncStatus, storageHealth, match, toast } = useApp();
    const immersiveMatch = pathname === "/play/match";
    const publicEntry = pathname === "/";
    const mainRef = useRef(null);
    const [isOnline, setIsOnline] = useState(true);
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
        if (immersiveMatch || publicEntry || !ready)
            return;
        const frame = window.requestAnimationFrame(() => {
            const target = mainRef.current?.querySelector("h1") ?? mainRef.current;
            target?.setAttribute("tabindex", "-1");
            target?.focus();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [immersiveMatch, pathname, publicEntry, ready]);
    if (!ready)
        return <BootScreen />;
    if (publicEntry)
        return <>{children}</>;
    const savedTime = storageHealth.savedAt
        ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(storageHealth.savedAt)
        : "";
    const syncLabel = authUser
        ? syncStatus === "saving" ? "Saving…" : syncStatus === "synced" ? "Cloud synced" : syncStatus === "offline" ? "Offline • queued" : syncStatus === "error" ? "Sync issue" : "Connecting…"
        : storageHealth.status === "error" ? "Not saved" : storageHealth.status === "saved" ? `Saved ${savedTime}` : "Checking storage…";
    const syncTone = authUser ? syncStatus : storageHealth.status === "error" ? "error" : storageHealth.status === "saved" ? "synced" : "checking";
    const title = TITLES[pathname.split("/").filter(Boolean)[0] ?? "dashboard"] ?? TITLES[route] ?? "Bakugan Battle Planet Online";
    return <div className={`app-shell ${immersiveMatch ? "immersive-match" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {!immersiveMatch && <header className="topbar">
      <Link className="brand" href="/dashboard" aria-label="Bakugan Battle Planet Online dashboard"><img src="/assets/logo.png" alt="Bakugan Battle Planet"/><span>TCG ONLINE</span></Link>
      <nav aria-label="Primary navigation">{NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return <Link key={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} href={item.href}><i>{item.key}</i>{item.label}</Link>;
            })}</nav>
      <div className="top-actions">
        {match && match.phase !== "result" && <Link className="resume-chip" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}><span className="pulse"/> Resume match</Link>}
        <span className={`sync-chip ${syncTone}`} title={authUser ? `Signed in as ${authUser.email}` : storageHealth.message}><i>{authUser ? "☁" : "▣"}</i>{syncLabel}</span>
        <Link className="profile-chip" href="/profile"><span>{profile.name.slice(0, 2).toUpperCase()}</span><div>{profile.name}<small>{profile.faction} • {authUser ? "Account" : "Local"}</small></div></Link>
        <Link className="menu-button" href="/settings" aria-label="Settings">⚙</Link>
      </div>
    </header>}
    {!immersiveMatch && !isOnline && <div className="offline-banner" role="status">You are offline. Device-local changes will keep saving when storage is available; cloud sync is queued.</div>}
    {!immersiveMatch && storageHealth.status === "error" && <div className="storage-error-banner" role="alert">{storageHealth.message}</div>}
    <div className="route-announcer" aria-live="polite" aria-atomic="true">{title}</div>
    <main id="main-content" className="main-stage" ref={mainRef}>{children}</main>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
function BootScreen() {
    return <main className="boot-screen"><img src="/assets/logo.png" alt="Bakugan Battle Planet"/><span className="pulse"/><h1>RESTORING LOCAL BRAWLER DATA</h1><p>Restoring decks, settings, drafts, history, and active state…</p></main>;
}
