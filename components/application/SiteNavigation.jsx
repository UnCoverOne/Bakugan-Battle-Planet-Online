"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppFields } from "./AppProvider";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { SocialMenuButton, useSocial } from "../social/SocialProvider";
import styles from "./SiteNavigation.module.css";

export const PRIMARY_DESTINATIONS = [
  { href: "/", label: "HOME", icon: "layout-dashboard" },
  { href: "/play", label: "PLAY", icon: "play" },
  { href: "/decks", label: "DECKS", icon: "layers" },
  { href: "/compendium", label: "COMPENDIUM", icon: "library-big" },
];

export function navigationDestination(path) {
  if (path === "/") return "/";
  if (path.startsWith("/play/") || path === "/play") return "/play";
  if (path.startsWith("/builder/") || path === "/builder" || path.startsWith("/decks/") || path === "/decks") return "/decks";
  if (path.startsWith("/compendium/") || path === "/compendium") return "/compendium";
  return null;
}

function NavIcon({ name }) {
  // Lucide outline icon geometry. Only the four mobile destinations are included.
  const paths = {
    "layout-dashboard": <>
      <rect width="7" height="9" x="3" y="3" rx="1" />
      <rect width="7" height="5" x="14" y="3" rx="1" />
      <rect width="7" height="9" x="14" y="12" rx="1" />
      <rect width="7" height="5" x="3" y="16" rx="1" />
    </>,
    play: <polygon points="6 3 20 12 6 21 6 3" />,
    layers: <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </>,
    "library-big": <>
      <rect width="8" height="18" x="3" y="3" rx="1" />
      <path d="M7 3v18" />
      <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z" />
    </>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
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
  const avatarFaction = authUser && ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].includes(profile?.faction)
    ? profile.faction
    : "Pyrus";

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
        <img src="/assets/logo.png" alt="" width="58" height="58" className={styles.brandImage} />
      </Link>
      <Destinations onNavigate={closeMenus} />
      <div className={styles.actions}>
        <div className={styles.socialButtonWrap} onClick={() => setProfileOpen(false)}><SocialMenuButton /></div>
        <button ref={avatarRef} type="button" className={styles.avatarButton} data-faction={avatarFaction} aria-label="Open profile menu" aria-expanded={profileOpen} aria-haspopup="dialog" aria-controls="site-profile-menu"
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
