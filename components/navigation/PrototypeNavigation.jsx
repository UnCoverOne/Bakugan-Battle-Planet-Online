"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSocial } from "../social/SocialProvider";

// The only four primary destinations. Both rails use this same definition.
export const PRIMARY_DESTINATIONS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/play", label: "Play", icon: "play" },
  { href: "/decks", label: "Decks", icon: "decks" },
  { href: "/compendium", label: "Compendium", icon: "compendium" },
];

function NavIcon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v11H3z" /><path d="M9 21v-8h6v8" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    decks: <><rect x="3" y="6" width="13" height="16" rx="1" /><path d="M7 6V3h14v16h-5" /></>,
    compendium: <><path d="M12 5c-2.6-1.5-5.7-1.7-9-1v15c3.3-.7 6.4-.5 9 1 2.6-1.5 5.7-1.7 9-1V4c-3.3-.7-6.4-.5-9 1Z" /><path d="M12 5v15" /></>,
    social: <><circle cx="9" cy="8" r="3" /><path d="M2 21v-2c0-3 2.7-5 7-5s7 2 7 5v2M16 5c2 0 3 1.4 3 3s-1 3-3 3M18 14c3 .6 4 2.4 4 5v2" /></>,
    profile: <><circle cx="12" cy="8" r="3.5" /><path d="M4 21c.2-4.7 2.9-7 8-7s7.8 2.3 8 7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[name]}
  </svg>;
}

const profileLinks = [
  { href: "/profile", label: "Profile" },
  { href: "/profile/achievements", label: "Achievements" },
  { href: "/collection", label: "Collection" },
  { href: "/settings", label: "Settings" },
];

export function PrototypeNavigation({
  authUser,
  decksHref,
  requestAccountAccess,
  onLogout,
  onFeedback,
  busy = false,
}) {
  const pathname = usePathname();
  const { open: socialOpen, setOpen: setSocialOpen, snapshot } = useSocial();
  const [profileOpen, setProfileOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const profileButton = useRef(null);
  const profilePanel = useRef(null);
  const profileWrap = useRef(null);
  const previousPath = useRef(pathname);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      setProfileOpen(false);
      setSocialOpen(false);
      previousPath.current = pathname;
    }
  }, [pathname, setSocialOpen]);

  useEffect(() => {
    if (socialOpen) setProfileOpen(false);
  }, [socialOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const previousOverflow = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      profilePanel.current?.querySelector("button, a")?.focus();
    });
    const onPointerDown = (event) => {
      if (!narrow && !profileWrap.current?.contains(event.target)) setProfileOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setProfileOpen(false);
        return;
      }
      if (event.key !== "Tab" || !narrow || !profilePanel.current) return;
      const items = [...profilePanel.current.querySelectorAll("a[href], button:not([disabled])")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      profileButton.current?.focus();
    };
  }, [profileOpen, narrow]);

  const current = (href) =>
    href === "/" ? pathname === "/" || pathname.startsWith("/dashboard")
      : href === "/decks"
        ? pathname === "/decks" || pathname.startsWith("/decks/") || pathname.startsWith("/builder/")
        : pathname === href || pathname.startsWith(href + "/");

  const railItem = ({ href, label, icon }, isBottom) => (
    <Link
      key={href}
      prefetch={false}
      href={href === "/decks" ? decksHref : href}
      aria-current={current(href) ? "page" : undefined}
      className={isBottom ? "prototype-bottom-link" : "prototype-top-link"}
    >
      {isBottom && <NavIcon name={icon} />}
      <span>{label}</span>
    </Link>
  );

  const closeProfile = () => setProfileOpen(false);

  return (
    <>
      <header className="prototype-topbar">
        <nav className="prototype-top-links" aria-label="Primary navigation">
          {PRIMARY_DESTINATIONS.map((item) => railItem(item, false))}
        </nav>
        <div className="prototype-top-actions" ref={profileWrap}>
          <button type="button" className="prototype-icon-button"
            aria-label={snapshot.unreadCount ? `Open social menu, ${snapshot.unreadCount} unread` : "Open social menu"}
            aria-haspopup="dialog" aria-controls="social-drawer"
            aria-expanded={socialOpen} disabled={busy}
            onClick={() => { closeProfile(); setSocialOpen(!socialOpen); }}>
            <NavIcon name="social" />
          </button>
          <button type="button" ref={profileButton} className="prototype-icon-button"
            aria-label="Open profile menu" aria-haspopup="dialog"
            aria-controls="prototype-profile-panel" aria-expanded={profileOpen} disabled={busy}
            onClick={() => { setSocialOpen(false); setProfileOpen((open) => !open); }}>
            <NavIcon name="profile" />
          </button>
          {profileOpen && (
            <section id="prototype-profile-panel" ref={profilePanel}
              className="prototype-profile-panel"
              role="dialog" aria-modal={narrow ? "true" : undefined}
              aria-labelledby="prototype-profile-title" tabIndex={-1}>
              <div className="prototype-profile-heading">
                <h2 id="prototype-profile-title">Profile</h2>
                <button type="button" onClick={closeProfile} aria-label="Close profile menu">
                  Close
                </button>
              </div>
              <nav aria-label="Profile and account">
                {profileLinks.map(({ href, label }) => (
                  <Link prefetch={false} href={href} key={href} onClick={closeProfile}>{label}</Link>
                ))}
                {authUser?.roles?.includes("administrator") && (
                  <Link prefetch={false} href="/admin" onClick={closeProfile}>Administrator</Link>
                )}
              </nav>
              <button type="button" onClick={() => { closeProfile(); onFeedback(); }}>
                Feedback &amp; reports
              </button>
              {authUser ? (
                <button type="button" onClick={() => { closeProfile(); void onLogout(); }}>
                  Log out
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => { closeProfile(); requestAccountAccess("login"); }}>Log in</button>
                  <button type="button" onClick={() => { closeProfile(); requestAccountAccess("signup"); }}>Register</button>
                </>
              )}
            </section>
          )}
        </div>
      </header>
      <nav className="prototype-bottom-rail" aria-label="Mobile primary navigation" hidden={socialOpen || (profileOpen && narrow)}>
        {PRIMARY_DESTINATIONS.map((item) => railItem(item, true))}
      </nav>
    </>
  );
}
