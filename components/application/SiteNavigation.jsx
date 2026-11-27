"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLobbyChat } from "./LobbyChatProvider";
import { useLobbySession } from "./LobbySessionProvider";
import { useAppFields } from "./AppProvider";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { LucideIcon } from "../design-system/LucideIcon";
import { ProfileMenu } from "./ProfileMenu";
import { useSettingsMenu } from "./SettingsMenuProvider";
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

function Destinations({ mobile, onNavigate }) {
  const pathname = usePathname();
  const active = navigationDestination(pathname);
  const session=useLobbySession();
  const chat=useLobbyChat();
  const inLobby=session.recovery.status==="member";
  return <nav className={mobile ? styles.mobileNav : styles.desktopNav} aria-label="Primary navigation">
    {PRIMARY_DESTINATIONS.map(({ href, label, icon }) =>
      <Link key={href} href={href==="/play"&&inLobby?"/play/lobby":href} className={styles.navLink} data-play={href==="/play"?"true":undefined} aria-label={href==="/play"&&inLobby&&chat.unread?`Return to lobby, ${chat.unread} unread messages`:undefined} aria-current={active === href ? "page" : undefined} onClick={onNavigate}>
        {mobile && <LucideIcon name={href==="/play"&&inLobby?"users":icon}/>}<span>{href==="/play"&&inLobby?"RETURN TO LOBBY":label}</span>{href==="/play"&&inLobby&&chat.unread>0&&<span className={styles.chatUnread} aria-hidden="true"/>}
      </Link>
    )}
  </nav>;
}

export function SiteNavigation({ onLogout }) {
  const { profile, authUser } = useAppFields(["profile", "authUser"]);
  const { open: socialOpen, setOpen: setSocialOpen } = useSocial();
  const [profileOpen, setProfileOpen] = useState(false);
  const { open: settingsOpen } = useSettingsMenu();
  const avatarRef = useRef(null);
  const pathname = usePathname();
  const avatarFaction = authUser && ["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].includes(profile?.faction)
    ? profile.faction
    : authUser ? "Pyrus" : "Guest";

  useEffect(() => { setProfileOpen(false); }, [pathname]);
  useEffect(() => { if (socialOpen || settingsOpen) setProfileOpen(false); }, [socialOpen, settingsOpen]);

  const closeProfile = useCallback(() => setProfileOpen(false), []);

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
          {authUser ? <ProfileAvatar profile={profile ?? { name: "Player", avatar: "" }} className={styles.avatar}/> : <LucideIcon name="user-round" size={23}/> }
        </button>
      </div>
    </header>
    <Destinations mobile onNavigate={closeMenus}/>
    <ProfileMenu open={profileOpen} onClose={closeProfile} triggerRef={avatarRef} onLogout={onLogout} />
  </>;
}
