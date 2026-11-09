"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppFields } from "./AppProvider";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { SocialMenuButton, useSocial } from "../social/SocialProvider";
import styles from "./SiteNavigation.module.css";

export const PRIMARY_DESTINATIONS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/play", label: "Play", icon: "play" },
  { href: "/decks", label: "Decks", icon: "decks" },
  { href: "/compendium", label: "Compendium", icon: "compendium" },
];

export function navigationDestination(path) {
  if (path === "/") return "/";
  if (path.startsWith("/play/") || path === "/play") return "/play";
  if (path.startsWith("/builder/") || path === "/builder" || path.startsWith("/decks/") || path === "/decks") return "/decks";
  if (path.startsWith("/compendium/") || path === "/compendium") return "/compendium";
  return null;
}

function NavIcon({ name }) {
  const paths = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></>,
    play: <><path d="m4 20 16-16M4 4l16 16"/><path d="m3 3 4 1-3 4M21 3l-4 1 3 4M3 21l4-1-3-4M21 21l-4-1 3-4"/></>,
    decks: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></>,
    compendium: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zM12 6v14"/></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Destinations({ mobile, onNavigate }) {
  const pathname = usePathname();
  const active = navigationDestination(pathname);
  return <nav className={mobile ? styles.mobileNav : styles.desktopNav} aria-label="Primary navigation">
    {PRIMARY_DESTINATIONS.map(({ href, label, icon }) =>
      <Link key={href} href={href} className={styles.navLink} aria-current={active === href ? "page" : undefined} onClick={onNavigate}>
        {mobile && <NavIcon name={icon}/>}<span>{label}</span>
      </Link>
    )}
  </nav>;
}

export function SiteNavigation({ onLogout }) {
  const { profile, authUser, requestAccountAccess } = useAppFields(["profile", "authUser", "requestAccountAccess"]);
  const { open: socialOpen, setOpen: setSocialOpen } = useSocial();
  const [profileOpen, setProfileOpen] = useState(false);
  const avatarRef = useRef(null);
  const menuRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => { setProfileOpen(false); }, [pathname]);
  useEffect(() => { if (socialOpen) setProfileOpen(false); }, [socialOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const previous = document.body.style.overflow;
    // Only lock scrolling for full-screen dialogs; desktop popover does not require it.
    const query = window.matchMedia("(max-width: 850px)");
    if (query.matches) document.body.style.overflow = "hidden";
    menuRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); setProfileOpen(false); }
      if (event.key !== "Tab" || !menuRef.current) return;
      const items = [...menuRef.current.querySelectorAll('a[href],button:not([disabled])')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onPointer = (event) => {
      if (query.matches || menuRef.current?.contains(event.target) || avatarRef.current?.contains(event.target)) return;
      setProfileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      avatarRef.current?.focus();
    };
  }, [profileOpen]);

  const closeMenus = () => { setProfileOpen(false); setSocialOpen(false); };
  return <>
    <header className={styles.topRail}>
      <Link href="/" className={styles.brand} onClick={closeMenus} aria-label="Bakugan Online home">
        <img src="/assets/logo.png" alt="" width="32" height="32" className={styles.brandImage} />
        <span>Bakugan Online</span>
      </Link>
      <Destinations onNavigate={closeMenus} />
      <div className={styles.actions}>
        <div className={styles.socialButtonWrap} onClick={() => setProfileOpen(false)}><SocialMenuButton /></div>
        <button ref={avatarRef} type="button" className={styles.avatarButton} aria-label="Open profile menu" aria-expanded={profileOpen} aria-haspopup="dialog" aria-controls="site-profile-menu"
          onClick={() => { setSocialOpen(false); setProfileOpen(value => !value); }}>
          <ProfileAvatar profile={profile ?? { name: "Guest", avatar: "" }} className={styles.avatar}/>
        </button>
      </div>
    </header>
    <Destinations mobile onNavigate={closeMenus}/>
    {profileOpen && <div className={styles.profileLayer}>
      <button type="button" className={styles.profileBackdrop} aria-label="Close profile menu" onClick={() => setProfileOpen(false)}/>
      <section ref={menuRef} id="site-profile-menu" role="dialog" aria-modal="true" aria-labelledby="site-profile-title" tabIndex={-1} className={styles.profileMenu}>
        <div className={styles.profileHeading}>
          <div className={styles.profileIdentity}>
            <ProfileAvatar profile={profile ?? { name: "Guest", avatar: "" }} className={styles.menuAvatar}/>
            <div><strong id="site-profile-title">{authUser ? (profile?.name || "Player") : "Guest"}</strong><small>{authUser ? "Player account" : "Not signed in"}</small></div>
          </div>
          <button type="button" className={styles.closeButton} aria-label="Close profile menu" onClick={() => setProfileOpen(false)}>×</button>
        </div>
        <div className={styles.profileLinks}>
          {authUser ? <>
            <Link href="/profile" onClick={closeMenus}>Profile</Link>
            <Link href="/profile/records" onClick={closeMenus}>Match history</Link>
            <Link href="/settings" onClick={closeMenus}>Settings</Link>
            <button type="button" onClick={() => { closeMenus(); void onLogout(); }}>Sign out</button>
          </> : <>
            <button type="button" onClick={() => { closeMenus(); requestAccountAccess("login"); }}>Log in</button>
            <button type="button" onClick={() => { closeMenus(); requestAccountAccess("signup"); }}>Register</button>
          </>}
        </div>
      </section>
    </div>}
  </>;
}
