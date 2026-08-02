"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { accountStatMatches } from "../../lib/match-statistics";
import { deriveSyncIndicator } from "../../lib/client-status";
import { PROFILE_TITLES } from "../../lib/profile-customization";
import { VERSION_MISMATCH_EVENT } from "../AssetFreshness";
import { SystemState, VersionMismatchScreen } from "./SystemState";
import {
  AccountAccessModal,
  GuestAccountPrompt,
} from "./AccountAccessModal";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useApp } from "./AppProvider";

const NAV = [
  { href: "/", label: "Home", icon: "⌂" },
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
  admin: "Administrator",
};

const FACTION_ICONS = {
  Aquos: "/assets/symbols/factions/aquos.png",
  Aurelus: "/assets/symbols/factions/aurelus.png",
  Darkus: "/assets/symbols/factions/darkus.png",
  Haos: "/assets/symbols/factions/haos.png",
  Pyrus: "/assets/symbols/factions/pyrus.png",
  Ventus: "/assets/symbols/factions/ventus.png",
};

function MenuIcon({ name }) {
  const paths = {
    user: <><circle cx="12" cy="8" r="3.25" /><path d="M5.5 20c.55-4.05 2.72-6.08 6.5-6.08S17.95 15.95 18.5 20" /></>,
    trophy: <><path d="M8 4h8v4.25c0 3-1.5 5.25-4 5.25s-4-2.25-4-5.25V4Z" /><path d="M8 6H4.75v1.25c0 2.3 1.15 3.45 3.45 3.45M16 6h3.25v1.25c0 2.3-1.15 3.45-3.45 3.45M12 13.5V17m-4 3h8m-6-3h4" /></>,
    sparkle: <><path d="m12 2 1.45 4.05L17.5 7.5l-4.05 1.45L12 13l-1.45-4.05L6.5 7.5l4.05-1.45L12 2Z" /><path d="m18.5 13 .82 2.18L21.5 16l-2.18.82L18.5 19l-.82-2.18L15.5 16l2.18-.82L18.5 13ZM5 13l.65 1.85 1.85.65-1.85.65L5 18l-.65-1.85-1.85-.65 1.85-.65L5 13Z" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.5-1H2.5V10h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.56 4.2l.06.06A1.7 1.7 0 0 0 8.5 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.9 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1 .99Z" /></>,
    shield: <path d="M12 2.75 19 5.5v5.25c0 4.3-2.33 7.8-7 10.5-4.67-2.7-7-6.2-7-10.5V5.5l7-2.75Z" />,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9" /></>,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}


function SyncGlyph({ cloud }) {
  return cloud ? (
    <svg className="sync-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.3 18.25h9.05a4.15 4.15 0 0 0 .55-8.26A5.6 5.6 0 0 0 6.24 8.7a4.78 4.78 0 0 0 1.06 9.55Z" />
    </svg>
  ) : (
    <svg className="sync-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 7h8M8 10h8M9 17h6" />
    </svg>
  );
}

export function AppShell({ children }) {
  const pathname = usePathname();
  const {
    ready,
    route,
    profile,
    decks,
    history,
    authUser,
    authChecking,
    accountDataReady,
    authError,
    retryCloudLoad,
    syncStatus,
    storageHealth,
    match,
    toast,
    accountPrompt,
    dismissAccountPrompt,
    accountAccessMode,
    requestAccountAccess,
    closeAccountAccess,
    signOutAccount,
  } = useApp();
  const immersiveMatch = pathname === "/play/match";
  const homeRoute = pathname === "/" || pathname.startsWith("/dashboard");
  const secondaryRoute = !immersiveMatch && !homeRoute;
  const mainRef = useRef(null);
  const menuRef = useRef(null);
  const [isOnline, setIsOnline] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [versionMismatch, setVersionMismatch] = useState(false);

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
    const showMismatch = () => setVersionMismatch(true);
    window.addEventListener(VERSION_MISMATCH_EVENT, showMismatch);
    return () =>
      window.removeEventListener(VERSION_MISMATCH_EVENT, showMismatch);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const close = (event) => {
      if (
        event.key === "Escape" ||
        (event.type === "pointerdown" &&
          !menuRef.current?.contains(event.target))
      )
        setProfileOpen(false);
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
    if (immersiveMatch || !ready) return;
    const frame = window.requestAnimationFrame(() => {
      const target = mainRef.current?.querySelector("h1") ?? mainRef.current;
      target?.setAttribute("tabindex", "-1");
      target?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [immersiveMatch, pathname, ready]);

  const requestLogout = async () => {
    if (await signOutAccount()) return;
    if (
      window.confirm(
        "Cloud save could not finish. Log out anyway and keep the unsynced account recovery copy in this browser?",
      )
    ) {
      await signOutAccount({ retainUnsynced: true });
    }
  };

  if (!ready || authChecking) return <BootScreen />;
  if (authUser && !accountDataReady) {
    return (
      <AccountDataScreen
        error={authError}
        onRetry={() => void retryCloudLoad()}
        onLogout={() => void requestLogout()}
      />
    );
  }
  const achievements = achievementsFor(decks, history);
  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked,
  ).length;
  const wins = accountStatMatches(history).filter(
    (record) => record.result === "Victor",
  ).length;
  const selectedProfileTitle =
    PROFILE_TITLES.find((item) => item.id === profile.titleId) ??
    PROFILE_TITLES[0];
  const syncIndicator = deriveSyncIndicator({
    authenticated: Boolean(authUser),
    syncStatus,
    storageStatus: storageHealth.status,
    storageMessage: storageHealth.message,
  });
  const title =
    TITLES[pathname.split("/").filter(Boolean)[0] ?? "dashboard"] ??
    TITLES[route] ??
    "Bakugan Battle Planet Online";
  const profileActive =
    pathname.startsWith("/profile") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/admin");

  return (
    <div
      className={`app-shell ${immersiveMatch ? "immersive-match" : ""} ${secondaryRoute ? "secondary-route" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {!immersiveMatch && (
        <header className="topbar overhaul-topbar">
          <Link
            className="brand"
            href="/"
            aria-label="Bakugan Battle Planet Online home"
          >
            <img src="/assets/logo.png" alt="Bakugan Battle Planet" />
            <span>TCG ONLINE</span>
          </Link>
          <nav aria-label="Primary navigation">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? homeRoute
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                  href={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="top-actions">
            {match && match.phase !== "result" && (
              <Link
                className="resume-chip"
                href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}
              >
                <span className="pulse" /> Resume match
              </Link>
            )}
            <Link
              href="/profile"
              className={`sync-dot ${syncIndicator.tone}`}
              title={syncIndicator.title}
              aria-label={syncIndicator.title}
            >
              <SyncGlyph cloud={Boolean(authUser)} />
            </Link>
            <div className="profile-menu-wrap" ref={menuRef}>
              <button
                className={`profile-avatar-button ${profileActive ? "active" : ""}`}
                type="button"
                aria-label="Open profile menu"
                aria-haspopup="menu"
                aria-controls="profile-menu"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <ProfileAvatar
                  profile={profile}
                  className="profile-avatar-control"
                />
                <span className="sr-only">Open profile menu</span>
              </button>
              {profileOpen && (
                <div
                  id="profile-menu"
                  className="profile-popover"
                  role="menu"
                >
                  <div className="profile-popover-heading">
                    <ProfileAvatar
                      profile={profile}
                      className={`profile-popover-avatar faction-${profile.faction.toLowerCase()}`}
                    />
                    <div className="profile-popover-identity">
                      <strong>{profile.name}</strong>
                      <div className="profile-popover-title">
                        <img src={FACTION_ICONS[profile.faction]} alt="" />
                        <span>{selectedProfileTitle.label}</span>
                      </div>
                    </div>
                  </div>
                  <div className="profile-popover-stats">
                    <div>
                      <div className="profile-popover-stat-value"><MenuIcon name="trophy" /><strong>{unlocked}</strong></div>
                      <span>Achievements</span>
                    </div>
                    <div>
                      <div className="profile-popover-stat-value"><MenuIcon name="sparkle" /><strong>{wins}</strong></div>
                      <span>Games won</span>
                    </div>
                  </div>
                  <nav aria-label="Profile menu">
                    <Link className="profile-popover-row" role="menuitem" href="/profile">
                      <span className="profile-popover-row-icon"><MenuIcon name="user" /></span>
                      <span className="profile-popover-row-label">View Profile</span>
                      <span className="profile-popover-chevron"><MenuIcon name="chevron" /></span>
                    </Link>
                    <Link className="profile-popover-row" role="menuitem" href="/profile/achievements">
                      <span className="profile-popover-row-icon"><MenuIcon name="trophy" /></span>
                      <span className="profile-popover-row-label">Achievements</span>
                      <span className="profile-popover-chevron"><MenuIcon name="chevron" /></span>
                    </Link>
                    <Link className="profile-popover-row" role="menuitem" href="/settings">
                      <span className="profile-popover-row-icon"><MenuIcon name="settings" /></span>
                      <span className="profile-popover-row-label">Settings</span>
                      <span className="profile-popover-chevron"><MenuIcon name="chevron" /></span>
                    </Link>
                    {authUser?.roles?.includes("administrator") && (
                      <Link className="profile-popover-row" role="menuitem" href="/admin">
                        <span className="profile-popover-row-icon"><MenuIcon name="shield" /></span>
                        <span className="profile-popover-row-label">Administrator</span>
                        <span className="profile-popover-chevron"><MenuIcon name="chevron" /></span>
                      </Link>
                    )}
                  </nav>
                  {authUser ? (
                    <button className="profile-popover-logout" role="menuitem" type="button" onClick={() => void requestLogout()}>
                      <span className="profile-popover-row-icon"><MenuIcon name="logout" /></span>
                      <span>Log out</span>
                    </button>
                  ) : (
                    <div className="profile-popover-auth">
                      <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); requestAccountAccess("login"); }}>Log in</button>
                      <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); requestAccountAccess("signup"); }}>Register</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
      )}
      {!immersiveMatch && !isOnline && (
        <div className="offline-banner" role="status">
          <strong>Offline.</strong>{" "}
          {authUser
            ? "The loaded account session remains available; cloud writes will retry when the connection returns."
            : "Device-local features remain available; cloud services and public updates are unavailable."}
        </div>
      )}
      {!immersiveMatch && !authUser && storageHealth.status === "error" && (
        <div className="storage-error-banner" role="alert">
          {storageHealth.message}
        </div>
      )}
      <div className="route-announcer" aria-live="polite" aria-atomic="true">
        {title}
      </div>
      <main id="main-content" className="main-stage" ref={mainRef}>
        {children}
      </main>
      {!immersiveMatch && (
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? homeRoute
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
              >
                <i>{item.icon}</i>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
      {accountPrompt && !authUser && (
        <GuestAccountPrompt
          reason={accountPrompt}
          onLogin={() => {
            dismissAccountPrompt();
            requestAccountAccess("login");
          }}
          onRegister={() => {
            dismissAccountPrompt();
            requestAccountAccess("signup");
          }}
          onDismiss={dismissAccountPrompt}
        />
      )}
      {accountAccessMode && !authUser && (
        <AccountAccessModal
          key={accountAccessMode}
          mode={accountAccessMode}
          onClose={closeAccountAccess}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {versionMismatch && (
        <VersionMismatchScreen onRefresh={() => window.location.reload()} />
      )}
    </div>
  );
}

function AccountDataScreen({ error, onRetry, onLogout }) {
  return (
    <main className="boot-screen">
      <SystemState
        tone={error ? "error" : "loading"}
        eyebrow="Account data"
        title={error ? "Cloud data could not be loaded" : "Loading account data"}
        message={
          error ||
          "Your local guest data is isolated while the signed-in account snapshot loads."
        }
        actions={
          error ? (
            <>
              <button type="button" onClick={onRetry}>Try again</button>
              <button type="button" onClick={onLogout}>Log out</button>
            </>
          ) : undefined
        }
      />
    </main>
  );
}

function BootScreen() {
  return (
    <main className="boot-screen">
      <img src="/assets/logo.png" alt="Bakugan Battle Planet" />
      <span className="pulse" />
      <h1>LOADING BRAWLER DATA</h1>
      <p>Checking the session before selecting local or account storage…</p>
    </main>
  );
}
