"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { deriveSyncIndicator } from "../../lib/client-status";
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

  if (!ready || authChecking) return <BootScreen />;
  if (authUser && !accountDataReady) {
    return (
      <AccountDataScreen
        error={authError}
        onRetry={() => void retryCloudLoad()}
        onLogout={() => void signOutAccount()}
      />
    );
  }
  const achievements = achievementsFor(decks, history);
  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked,
  ).length;
  const wins = history.filter((record) => record.result === "Victor").length;
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
              href={syncStatus === "conflict" ? "/settings" : "/profile"}
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
                    <div>
                      <strong>{profile.name}</strong>
                      <small>{authUser ? `${profile.faction} Brawler` : "Guest · saved on this device"}</small>
                    </div>
                  </div>
                  <div className="profile-popover-stats">
                    <div>
                      <strong>{unlocked}</strong>
                      <span>Achievements</span>
                    </div>
                    <div>
                      <strong>{wins}</strong>
                      <span>Games won</span>
                    </div>
                  </div>
                  <nav aria-label="Profile menu">
                    <Link role="menuitem" href="/profile">
                      {authUser ? "View Profile" : "View local profile"}
                    </Link>
                    {authUser && (
                      <Link role="menuitem" href="/profile/achievements">
                        Achievements
                      </Link>
                    )}
                    <Link role="menuitem" href="/settings">
                      Settings
                    </Link>
                    {authUser?.roles?.includes("administrator") && (
                      <Link role="menuitem" href="/admin">
                        Administrator
                      </Link>
                    )}
                    {authUser ? (
                      <button
                        role="menuitem"
                        type="button"
                        onClick={() => void signOutAccount()}
                      >
                        Log Out
                      </button>
                    ) : (
                      <>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setProfileOpen(false);
                            requestAccountAccess("login");
                          }}
                        >
                          Log In
                        </button>
                        <button
                          role="menuitem"
                          type="button"
                          onClick={() => {
                            setProfileOpen(false);
                            requestAccountAccess("signup");
                          }}
                        >
                          Register
                        </button>
                      </>
                    )}
                  </nav>
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
      {!immersiveMatch && syncStatus === "conflict" && (
        <Link className="storage-error-banner" href="/settings" role="alert">
          Cloud sync paused. Compare the pending and cloud account revisions in
          Settings before choosing a version.
        </Link>
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
