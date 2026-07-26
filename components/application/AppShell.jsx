"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { useApp } from "./AppProvider";

const NAV = [
  { href: "/dashboard", label: "Home", icon: "⌂" },
  { href: "/play", label: "Play", icon: "▶" },
  { href: "/decks", label: "Decks", icon: "▤" },
  { href: "/compendium", label: "Compendium", icon: "◇" },
];
const TITLES = {
  dashboard: "Home",
  play: "Play",
  decks: "Decks",
  builder: "Deck Builder",
  compendium: "Compendium",
  history: "Match Records",
  profile: "Profile",
  settings: "Settings",
};

export function AppShell({ children }) {
  const pathname = usePathname();
  const { ready, route, profile, decks, history, authUser, syncStatus, storageHealth, match, toast, signOutAccount } = useApp();
  const immersiveMatch = pathname === "/play/match";
  const publicEntry = pathname === "/";
  const mainRef = useRef(null);
  const menuRef = useRef(null);
  const [isOnline, setIsOnline] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);

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
    if (!profileOpen) return;
    const close = (event) => {
      if (event.key === "Escape" || (event.type === "pointerdown" && !menuRef.current?.contains(event.target))) setProfileOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [profileOpen]);

  useEffect(() => {
    setProfileOpen(false);
    if (immersiveMatch || publicEntry || !ready) return;
    const frame = window.requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector("h1") ?? mainRef.current;
      target?.setAttribute("tabindex", "-1");
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [immersiveMatch, pathname, publicEntry, ready]);

  if (!ready) return <BootScreen />;
  if (publicEntry) return <>{children}</>;

  const achievements = achievementsFor(decks, history);
  const unlocked = achievements.filter((achievement) => achievement.unlocked).length;
  const wins = history.filter((record) => record.result === "Victor").length;
  const syncTone = authUser ? syncStatus : storageHealth.status === "error" ? "error" : storageHealth.status === "saved" ? "synced" : "checking";
  const syncTitle = authUser
    ? syncStatus === "saving" ? "Saving to cloud" : syncStatus === "synced" ? "Cloud synced" : syncStatus === "offline" ? "Offline; sync queued" : syncStatus === "error" ? "Cloud sync issue" : "Connecting to cloud"
    : storageHealth.message;
  const title = TITLES[pathname.split("/").filter(Boolean)[0] ?? "dashboard"] ?? TITLES[route] ?? "Bakugan Battle Planet Online";
  const profileActive = pathname.startsWith("/profile") || pathname.startsWith("/settings") || pathname.startsWith("/history");

  return <div className={`app-shell ${immersiveMatch ? "immersive-match" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {!immersiveMatch && <header className="topbar overhaul-topbar">
      <Link className="brand" href="/dashboard" aria-label="Bakugan Battle Planet Online home"><img src="/assets/logo.png" alt="Bakugan Battle Planet"/><span>TCG ONLINE</span></Link>
      <nav aria-label="Primary navigation">{NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} href={item.href}>{item.label}</Link>;
      })}</nav>
      <div className="top-actions">
        {match && match.phase !== "result" && <Link className="resume-chip" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}><span className="pulse"/> Resume match</Link>}
        <span className={`sync-dot ${syncTone}`} title={syncTitle} aria-label={syncTitle}>{authUser ? "☁" : "▣"}</span>
        <div className="profile-menu-wrap" ref={menuRef}>
          <button className={`profile-avatar-button ${profileActive ? "active" : ""}`} type="button" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}>
            <span>{profile.name.slice(0, 2).toUpperCase()}</span><span className="sr-only">Open profile menu</span>
          </button>
          {profileOpen && <div className="profile-popover" role="menu">
            <div className="profile-popover-heading"><span className={`profile-popover-avatar faction-${profile.faction.toLowerCase()}`}>{profile.name.slice(0, 2).toUpperCase()}</span><div><strong>{profile.name}</strong><small>{profile.faction} Brawler</small></div></div>
            <div className="profile-popover-stats"><div><strong>{unlocked}</strong><span>Achievements</span></div><div><strong>{wins}</strong><span>Games won</span></div></div>
            <nav aria-label="Profile menu">
              <Link role="menuitem" href="/profile">View Profile</Link>
              <Link role="menuitem" href="/profile/achievements">Achievements</Link>
              <Link role="menuitem" href="/settings">Settings</Link>
              <button role="menuitem" type="button" onClick={() => void signOutAccount()}>Log Out</button>
            </nav>
          </div>}
        </div>
      </div>
    </header>}
    {!immersiveMatch && !isOnline && <div className="offline-banner" role="status">You are offline. Device-local changes will keep saving; cloud sync is queued.</div>}
    {!immersiveMatch && storageHealth.status === "error" && <div className="storage-error-banner" role="alert">{storageHealth.message}</div>}
    <div className="route-announcer" aria-live="polite" aria-atomic="true">{title}</div>
    <main id="main-content" className="main-stage" ref={mainRef}>{children}</main>
    {!immersiveMatch && <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={active ? "active" : ""}><i>{item.icon}</i><span>{item.label}</span></Link>;
      })}
      <Link href="/profile" aria-current={profileActive ? "page" : undefined} className={profileActive ? "active" : ""}><i className="mobile-avatar">{profile.name.slice(0, 2).toUpperCase()}</i><span>Profile</span></Link>
    </nav>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function BootScreen() {
  return <main className="boot-screen"><img src="/assets/logo.png" alt="Bakugan Battle Planet"/><span className="pulse"/><h1>RESTORING LOCAL BRAWLER DATA</h1><p>Restoring decks, settings, drafts, history, and active state…</p></main>;
}
