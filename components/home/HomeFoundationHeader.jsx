"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SocialMenuButton } from "../social/SocialProvider";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/decks", label: "Decks" },
  { href: "/compendium", label: "Compendium" },
  { href: "/leaderboard", label: "Leaderboard" },
];

/**
 * First-pass navigation structure. It intentionally uses no images, icon
 * packages, animated effects or chosen visual theme.
 */
export function HomeFoundationHeader({
  authUser,
  profile,
  decksHref,
  requestAccountAccess,
  onFeedback,
  onLogout,
  activeSession,
  remoteSession,
  remoteSessionPresentation,
  resumeCurrentMatch,
  resumingCurrentMatch,
  resumeAccountMatch,
  resumingMatchCode,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  useEffect(() => {
    if (!mobileOpen && !accountOpen) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        setAccountOpen(false);
      }
    };
    const onPointerDown = (event) => {
      if (accountOpen && !accountRef.current?.contains(event.target)) {
        setAccountOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [mobileOpen, accountOpen]);

  const navLinks = (closeMenu) => LINKS.map(({ href, label }) => (
    <Link
      key={href}
      href={href === "/decks" ? decksHref : href}
      aria-current={href === "/" ? "page" : undefined}
      onClick={closeMenu}
    >
      {label}
    </Link>
  ));

  return (
    <header className="bbp-foundation-header">
      <div className="bbp-foundation-header-inner">
        <Link className="bbp-foundation-brand" href="/" aria-label="Bakugan Battle Planet Online home">
          Bakugan Battle Planet Online
        </Link>

        <nav className="bbp-foundation-desktop-nav" aria-label="Primary navigation">
          {navLinks(undefined)}
        </nav>

        <div className="bbp-foundation-header-actions">
          {activeSession && (
            <button type="button" className="bbp-foundation-resume"
              disabled={resumingCurrentMatch}
              onClick={() => void resumeCurrentMatch()}>
              {resumingCurrentMatch ? "Resuming…" : activeSession.navLabel}
            </button>
          )}
          {remoteSession && remoteSessionPresentation && (
            <button type="button" className="bbp-foundation-resume"
              disabled={resumingMatchCode === remoteSession.code}
              onClick={() => void resumeAccountMatch(remoteSession)}>
              {resumingMatchCode === remoteSession.code ? "Resuming…" : remoteSessionPresentation.navLabel}
            </button>
          )}
          <div className="bbp-foundation-social"><SocialMenuButton /></div>
          <div className="bbp-foundation-account-wrap" ref={accountRef}>
            <button type="button" className="bbp-foundation-account-button"
              aria-expanded={accountOpen}
              aria-controls="bbp-foundation-account-panel"
              aria-label="Account options"
              onClick={() => { setAccountOpen((open) => !open); setMobileOpen(false); }}>
              {authUser ? (profile?.name || "Account") : "Account"}
            </button>
            {accountOpen && (
              <div className="bbp-foundation-account-panel" id="bbp-foundation-account-panel">
                <nav aria-label="Account navigation">
                  <Link href="/profile" onClick={() => setAccountOpen(false)}>Profile</Link>
                  <Link href="/profile/achievements" onClick={() => setAccountOpen(false)}>Achievements</Link>
                  <Link href="/collection" onClick={() => setAccountOpen(false)}>Collection</Link>
                  <Link href="/settings" onClick={() => setAccountOpen(false)}>Settings</Link>
                  {authUser?.roles?.includes("administrator") && (
                    <Link href="/admin" onClick={() => setAccountOpen(false)}>Administrator</Link>
                  )}
                </nav>
                <button type="button" onClick={() => { setAccountOpen(false); onFeedback(); }}>Feedback &amp; reports</button>
                {authUser ? (
                  <button type="button" onClick={() => { setAccountOpen(false); void onLogout(); }}>Log out</button>
                ) : (
                  <div className="bbp-foundation-auth-actions">
                    <button type="button" onClick={() => { setAccountOpen(false); requestAccountAccess("login"); }}>Log in</button>
                    <button type="button" onClick={() => { setAccountOpen(false); requestAccountAccess("signup"); }}>Register</button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button type="button" className="bbp-foundation-menu-button"
            aria-expanded={mobileOpen}
            aria-controls="bbp-foundation-mobile-nav"
            onClick={() => { setMobileOpen((open) => !open); setAccountOpen(false); }}>
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {mobileOpen && (
        <nav id="bbp-foundation-mobile-nav" className="bbp-foundation-mobile-nav" aria-label="Mobile navigation">
          {navLinks(() => setMobileOpen(false))}
        </nav>
      )}
    </header>
  );
}
