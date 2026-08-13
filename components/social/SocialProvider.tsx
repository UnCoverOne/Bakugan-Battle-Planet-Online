"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LobbyInviteSummary, SocialAccountSummary, SocialSnapshot } from "../../lib/social";
import { socialTitleLabel } from "../../lib/social";
import { readJsonResponse } from "../../lib/json-response";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useApp } from "../application/AppProvider";
import styles from "./SocialProvider.module.css";

const EMPTY_SNAPSHOT: SocialSnapshot = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  onlineBrawlers: [],
  invitations: [],
  activeLobby: null,
  unreadCount: 0,
};

type SocialContextValue = {
  snapshot: SocialSnapshot;
  open: boolean;
  setOpen(open: boolean): void;
  loading: boolean;
  refresh(): Promise<void>;
  perform(action: string, account?: SocialAccountSummary, inviteId?: string): Promise<void>;
};

const SocialContext = createContext<SocialContextValue | null>(null);

export function useSocial() {
  const value = useContext(SocialContext);
  if (!value) throw new Error("useSocial must be used inside SocialProvider.");
  return value;
}

export function SocialProvider({ children }: { children: ReactNode }) {
  const {
    authUser,
    notify,
    requestAccountAccess,
    setFormat,
    setJoinCode,
    setMatchMode,
  } = useApp();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SocialSnapshot>(EMPTY_SNAPSHOT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const openRef = useRef(false);

  useEffect(() => { openRef.current = open; }, [open]);

  const refresh = useCallback(async () => {
    if (!authUser) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    const current = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetch("/api/social?action=snapshot", { cache: "no-store" });
      const result = await readJsonResponse(response, "Social data returned an invalid response.") as { snapshot?: SocialSnapshot; error?: string };
      if (!response.ok || !result.snapshot) throw new Error(result.error ?? "Social data is unavailable.");
      if (current === requestId.current) setSnapshot(result.snapshot);
    } catch (error) {
      if (current === requestId.current && openRef.current) notify(error instanceof Error ? error.message : "Social data is unavailable.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [authUser, notify]);

  useEffect(() => {
    if (!authUser) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), open ? 20_000 : 60_000);
    return () => window.clearInterval(interval);
  }, [authUser, open, refresh]);

  useEffect(() => {
    if (!authUser) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let disposed = false;
    const connect = () => {
      if (disposed || !navigator.onLine) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/social/socket`, "bbp-social-v1");
      socket.addEventListener("open", () => { attempts = 0; });
      socket.addEventListener("message", (event) => {
        let message: { type?: string } = {};
        try { message = JSON.parse(String(event.data)) as { type?: string }; } catch { return; }
        if (message.type === "lobby.invited") notify("New lobby invitation received.");
        if (message.type !== "pong") void refresh();
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5));
        attempts += 1;
        retry = window.setTimeout(connect, delay);
      });
    };
    const reconnect = () => {
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      connect();
    };
    connect();
    window.addEventListener("online", reconnect);
    return () => {
      disposed = true;
      if (retry) window.clearTimeout(retry);
      window.removeEventListener("online", reconnect);
      socket?.close(1000, "Page closed");
    };
  }, [authUser, notify, refresh]);

  const perform = useCallback(async (action: string, account?: SocialAccountSummary, inviteId?: string) => {
    if (!authUser) {
      setOpen(false);
      requestAccountAccess("login");
      return;
    }
    const body: Record<string, unknown> = { action };
    if (account) body.targetId = account.userId;
    if (action === "invite") body.lobbyCode = snapshot.activeLobby?.code;
    if (inviteId) body.inviteId = inviteId;
    const response = await fetch("/api/social", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await readJsonResponse(response, "Social action returned an invalid response.") as {
      error?: string;
      lobby?: { code: string; format: "bo1" | "bo3" };
    };
    if (!response.ok) throw new Error(result.error ?? "Social action failed.");
    if (action === "accept-invite" && result.lobby) {
      setMatchMode("join");
      setJoinCode(result.lobby.code);
      setFormat(result.lobby.format);
      setOpen(false);
      router.push("/play");
      notify(`Lobby ${result.lobby.code} is ready. Choose a deck to join.`);
      return;
    }
    const success: Record<string, string> = {
      "request-friend": "Friend request sent.",
      "accept-friend": "Friend added.",
      "decline-friend": "Friend request declined.",
      "cancel-friend": "Friend request cancelled.",
      "remove-friend": "Friend removed.",
      invite: "Lobby invitation sent.",
      "decline-invite": "Lobby invitation declined.",
    };
    if (success[action]) notify(success[action]);
    await refresh();
  }, [authUser, notify, refresh, requestAccountAccess, router, setFormat, setJoinCode, setMatchMode, snapshot.activeLobby?.code]);

  const value = useMemo(() => ({ snapshot, open, setOpen, loading, refresh, perform }), [snapshot, open, loading, refresh, perform]);
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function SocialMenuButton() {
  const { snapshot, open, setOpen } = useSocial();
  return (
    <button
      ref={socialButtonRef}
      className={`${styles.socialButton} ${open ? styles.active : ""}`}
      type="button"
      aria-label={`Open social menu${snapshot.unreadCount ? `, ${snapshot.unreadCount} new` : ""}`}
      aria-haspopup="dialog"
      aria-controls="social-drawer"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.25 11.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm7.5-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM2.75 20c.3-4.2 2.14-6.3 5.5-6.3s5.2 2.1 5.5 6.3m.1-7.5c.55-.2 1.18-.3 1.9-.3 3.05 0 4.72 1.93 5 5.8" /></svg>
      {snapshot.unreadCount > 0 && <span className={styles.badge}>{Math.min(snapshot.unreadCount, 9)}{snapshot.unreadCount > 9 ? "+" : ""}</span>}
    </button>
  );
}

const socialButtonRef = { current: null as HTMLButtonElement | null };

export function SocialDrawer() {
  const { authUser, notify, requestAccountAccess } = useApp();
  const { snapshot, open, setOpen, loading, perform } = useSocial();
  const drawerRef = useRef<HTMLElement | null>(null);
  const [selected, setSelected] = useState<SocialAccountSummary | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setMenuFor(null);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => drawerRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      socialButtonRef.current?.focus();
    };
  }, [open, setOpen]);

  const run = async (action: string, account?: SocialAccountSummary, inviteId?: string) => {
    const key = `${action}:${account?.userId ?? inviteId ?? "invite"}`;
    setBusy(key);
    try {
      await perform(action, account, inviteId);
      setMenuFor(null);
      setSelected(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Social action failed.";
      notify(message);
    } finally {
      setBusy("");
    }
  };

  if (!open) return null;
  return (
    <div className={styles.layer}>
      <button className={styles.backdrop} type="button" aria-label="Close social menu" onClick={() => setOpen(false)} />
      <aside id="social-drawer" ref={drawerRef} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="social-title" tabIndex={-1}>
        <header className={styles.header}>
          <div><span>COMM-LINK</span><h2 id="social-title">SOCIAL</h2></div>
          <button className={styles.close} type="button" aria-label="Close social menu" onClick={() => setOpen(false)}>×</button>
        </header>
        {!authUser ? (
          <div className={styles.signIn}>
            <span className={styles.signInIcon}>◎</span>
            <h3>CONNECT WITH BRAWLERS</h3>
            <p>Log in to see friends, find online Brawlers, and send lobby invitations.</p>
            <button type="button" onClick={() => { setOpen(false); requestAccountAccess("login"); }}>LOG IN</button>
            <button className={styles.secondary} type="button" onClick={() => { setOpen(false); requestAccountAccess("signup"); }}>REGISTER</button>
          </div>
        ) : (
          <div className={styles.scrollArea} aria-busy={loading}>
            {snapshot.invitations.length > 0 && (
              <section className={styles.invites} aria-labelledby="social-invites-title">
                <div className={styles.sectionHeading}><h3 id="social-invites-title">LOBBY INVITES</h3><span>{snapshot.invitations.length}</span></div>
                {snapshot.invitations.map((invite) => <InviteCard key={invite.id} invite={invite} busy={busy} onAction={run} />)}
              </section>
            )}
            <section aria-labelledby="social-friends-title">
              <div className={styles.sectionHeading}>
                <h3 id="social-friends-title">FRIENDS</h3>
                <span>{snapshot.friends.length}</span>
              </div>
              {snapshot.incomingRequests.map((account) => (
                <SocialRow key={`incoming-${account.userId}`} account={account} label="Wants to be friends" menuFor={menuFor} busy={busy} inviteEnabled={Boolean(snapshot.activeLobby)} onMenu={setMenuFor} onSelect={setSelected} onAction={run} />
              ))}
              {snapshot.outgoingRequests.map((account) => (
                <SocialRow key={`outgoing-${account.userId}`} account={account} label="Request sent" menuFor={menuFor} busy={busy} inviteEnabled={Boolean(snapshot.activeLobby)} onMenu={setMenuFor} onSelect={setSelected} onAction={run} />
              ))}
              {snapshot.friends.map((account) => (
                <SocialRow key={account.userId} account={account} menuFor={menuFor} busy={busy} inviteEnabled={Boolean(snapshot.activeLobby)} onMenu={setMenuFor} onSelect={setSelected} onAction={run} />
              ))}
              {!snapshot.friends.length && !snapshot.incomingRequests.length && !snapshot.outgoingRequests.length && (
                <EmptyState text="No friends yet. Add an online Brawler to build your squad." />
              )}
            </section>
            <section aria-labelledby="social-online-title">
              <div className={styles.sectionHeading}>
                <h3 id="social-online-title">ONLINE BRAWLERS</h3>
                <span>{snapshot.onlineBrawlers.length}</span>
              </div>
              {snapshot.onlineBrawlers.map((account) => (
                <SocialRow key={account.userId} account={account} menuFor={menuFor} busy={busy} inviteEnabled={Boolean(snapshot.activeLobby)} onMenu={setMenuFor} onSelect={setSelected} onAction={run} />
              ))}
              {!snapshot.onlineBrawlers.length && <EmptyState text={loading ? "Scanning for Brawlers…" : "No other Brawlers are online right now."} />}
            </section>
          </div>
        )}
        {selected && <SocialAccountPreview account={selected} onClose={() => setSelected(null)} />}
      </aside>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className={styles.empty}>{text}</p>;
}

function InviteCard({ invite, busy, onAction }: { invite: LobbyInviteSummary; busy: string; onAction(action: string, account?: SocialAccountSummary, inviteId?: string): void }) {
  return (
    <article className={styles.inviteCard}>
      <ProfileAvatar profile={{ name: invite.inviter.displayName, avatar: invite.inviter.avatar }} className={styles.avatar} />
      <div><strong>{invite.inviter.displayName}</strong><span>Lobby {invite.lobbyCode} · {invite.format.toUpperCase()}</span></div>
      <div className={styles.inviteActions}>
        <button disabled={Boolean(busy)} type="button" onClick={() => onAction("accept-invite", undefined, invite.id)}>ACCEPT</button>
        <button disabled={Boolean(busy)} type="button" onClick={() => onAction("decline-invite", undefined, invite.id)}>DECLINE</button>
      </div>
    </article>
  );
}

type SocialRowProps = {
  account: SocialAccountSummary;
  label?: string;
  menuFor: string | null;
  busy: string;
  inviteEnabled: boolean;
  onMenu(value: string | null): void;
  onSelect(account: SocialAccountSummary): void;
  onAction(action: string, account?: SocialAccountSummary): void;
};

function SocialRow({ account, label, menuFor, busy, inviteEnabled, onMenu, onSelect, onAction }: SocialRowProps) {
  const menuOpen = menuFor === account.userId;
  return (
    <article className={styles.row}>
      <button className={styles.rowBody} type="button" onClick={() => onSelect(account)}>
        <span className={styles.avatarWrap}>
          <ProfileAvatar profile={{ name: account.displayName, avatar: account.avatar }} className={styles.avatar} />
          <i className={account.online ? styles.online : styles.offline} aria-label={account.online ? "Online" : "Offline"} />
        </span>
        <span className={styles.identity}><strong>{account.displayName}</strong><small>{label ?? (account.online ? `${account.faction} · Online` : `${account.faction} · Offline`)}</small></span>
      </button>
      <button className={styles.more} type="button" aria-label={`Options for ${account.displayName}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => onMenu(menuOpen ? null : account.userId)}>•••</button>
      {menuOpen && (
        <ActionMenu account={account} busy={busy} inviteEnabled={inviteEnabled} onAction={onAction} />
      )}
    </article>
  );
}

function ActionMenu({ account, busy, inviteEnabled, onAction }: { account: SocialAccountSummary; busy: string; inviteEnabled: boolean; onAction(action: string, account?: SocialAccountSummary): void }) {
  const disabled = Boolean(busy);
  return (
    <div className={styles.actionMenu} role="menu">
      {account.relationship === "none" && <button role="menuitem" disabled={disabled} type="button" onClick={() => onAction("request-friend", account)}>ADD FRIEND</button>}
      {account.relationship === "incoming" && <>
        <button role="menuitem" disabled={disabled} type="button" onClick={() => onAction("accept-friend", account)}>ACCEPT FRIEND</button>
        <button role="menuitem" disabled={disabled} type="button" onClick={() => onAction("decline-friend", account)}>DECLINE REQUEST</button>
      </>}
      {account.relationship === "outgoing" && <button role="menuitem" disabled={disabled} type="button" onClick={() => onAction("cancel-friend", account)}>CANCEL REQUEST</button>}
      {account.relationship === "friend" && <button role="menuitem" disabled={disabled} type="button" onClick={() => onAction("remove-friend", account)}>REMOVE FRIEND</button>}
      <button role="menuitem" disabled={disabled || !inviteEnabled} title={inviteEnabled ? "Invite to your lobby" : "Create a lobby with an open slot to invite this Brawler."} type="button" onClick={() => onAction("invite", account)}>INVITE TO LOBBY</button>
    </div>
  );
}

export function SocialAccountPreview({ account, onClose }: { account: SocialAccountSummary; onClose(): void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return (
    <div className={styles.previewLayer} role="presentation" onPointerDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <article className={styles.preview} role="dialog" aria-modal="true" aria-label={`${account.displayName} profile preview`}>
        <button autoFocus className={styles.previewClose} type="button" aria-label="Close profile preview" onClick={onClose}>×</button>
        <div className={styles.previewIdentity}>
          <ProfileAvatar profile={{ name: account.displayName, avatar: account.avatar }} className={styles.previewAvatar} />
          <div><small>{account.faction} BRAWLER</small><h3>{account.displayName}</h3><span>{socialTitleLabel(account.titleId)}</span></div>
        </div>
        <div className={styles.rankBar}><strong>{account.rank}</strong><b>{account.bp} BP</b></div>
        <div className={styles.previewStats}><span><b>{account.wins}</b>WINS</span><span><b>{account.losses}</b>LOSSES</span><span><b>{account.winRate}%</b>WIN RATE</span></div>
        <Link href={`/brawlers/${encodeURIComponent(account.userId)}`} onClick={onClose}>VIEW PROFILE</Link>
      </article>
    </div>
  );
}

export function SocialAccountActions({ account, compact = false }: { account: SocialAccountSummary; compact?: boolean }) {
  const { snapshot, perform } = useSocial();
  const { notify } = useApp();
  const currentAccount = [
    ...snapshot.friends,
    ...snapshot.incomingRequests,
    ...snapshot.outgoingRequests,
    ...snapshot.onlineBrawlers,
  ].find((candidate) => candidate.userId === account.userId) ?? account;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const root = useRef<HTMLSpanElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !popover.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const run = async (action: string, target?: SocialAccountSummary) => {
    setBusy(action);
    try {
      await perform(action, target);
      setOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Social action failed.");
    } finally {
      setBusy("");
    }
  };
  return (
    <span className={`${styles.inlineActions} ${compact ? styles.compact : ""}`} ref={root}>
      <button ref={trigger} type="button" aria-label={`Social options for ${currentAccount.displayName}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>•••<span className={styles.actionLabel}>SOCIAL</span></button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popover}
          className={styles.resultActionPopover}
          style={{
            top: Math.min((trigger.current?.getBoundingClientRect().bottom ?? 0) + 5, window.innerHeight - 210),
            right: Math.max(8, window.innerWidth - (trigger.current?.getBoundingClientRect().right ?? window.innerWidth)),
          }}
        >
          <ActionMenu account={currentAccount} busy={busy} inviteEnabled={Boolean(snapshot.activeLobby)} onAction={run} />
        </div>,
        document.body,
      )}
    </span>
  );
}
