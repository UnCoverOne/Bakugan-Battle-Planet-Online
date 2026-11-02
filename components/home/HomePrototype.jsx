"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SocialMenuButton } from "../social/SocialProvider";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/play", label: "Play" },
  { href: "/decks", label: "Decks" },
  { href: "/compendium", label: "Compendium" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function HomePrototypeHeader({
  authUser,
  requestAccountAccess,
  activeSession,
  remoteSession,
  remoteSessionPresentation,
  resumingCurrentMatch,
  resumeCurrentMatch,
  resumingMatchCode,
  resumeAccountMatch,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <header className="home-rebuild-header">
      <div className="home-rebuild-header-inner">
        <Link className="home-rebuild-brand" href="/" aria-label="Bakugan Battle Planet Online home">
          <span className="home-rebuild-brand-mark" aria-hidden="true">B</span>
          <span className="home-rebuild-brand-copy">
            <strong>BAKUGAN</strong>
            <small>BATTLE PLANET ONLINE</small>
          </span>
        </Link>

        <nav className="home-rebuild-desktop-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={href === "/" ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="home-rebuild-actions">
          {activeSession && (
            <button
              type="button"
              className="home-rebuild-resume"
              disabled={resumingCurrentMatch}
              onClick={() => void resumeCurrentMatch()}
            >
              {resumingCurrentMatch ? "Checking…" : "Resume match"}
            </button>
          )}
          {!activeSession && remoteSession && remoteSessionPresentation && (
            <button
              type="button"
              className="home-rebuild-resume"
              disabled={resumingMatchCode === remoteSession.code}
              onClick={() => void resumeAccountMatch(remoteSession)}
            >
              {resumingMatchCode === remoteSession.code ? "Resuming…" : "Resume match"}
            </button>
          )}
          <div className="home-rebuild-social"><SocialMenuButton /></div>
          {authUser ? (
            <Link className="home-rebuild-account" href="/profile">My profile</Link>
          ) : (
            <>
              <button className="home-rebuild-login" type="button" onClick={() => requestAccountAccess("login")}>Log in</button>
              <button className="home-rebuild-account" type="button" onClick={() => requestAccountAccess("signup")}>Join</button>
            </>
          )}
          <button
            className="home-rebuild-menu-toggle"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="home-rebuild-mobile-menu"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav id="home-rebuild-mobile-menu" className="home-rebuild-mobile-nav" aria-label="Mobile navigation">
          {NAV_ITEMS.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={href === "/" ? "page" : undefined} onClick={() => setMenuOpen(false)}>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function HomePrototype() {
  return (
    <div className="home-rebuild-page">
      <section className="home-rebuild-canvas" aria-labelledby="home-rebuild-title">
        <div className="home-rebuild-placeholder">
          <span className="home-rebuild-kicker">HOMEPAGE REBUILD / STAGE 01</span>
          <h1 id="home-rebuild-title">A blank canvas.</h1>
          <p>The previous homepage has been set aside on this branch. We will build the new experience here, one section at a time.</p>
          <div className="home-rebuild-divider" aria-hidden="true" />
          <span className="home-rebuild-footnote">Navigation is live. Your game, decks and account systems remain connected.</span>
        </div>
      </section>
    </div>
  );
}
