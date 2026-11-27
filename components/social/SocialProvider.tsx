"use client";

import { usePathname, useRouter } from "next/navigation";
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
import { useLobbySession } from "../application/LobbySessionProvider";
import type { SocialAccountSummary, SocialSnapshot } from "../../lib/social";
import { readJsonResponse } from "../../lib/json-response";
import { useAppFields } from "../application/AppProvider";
import { EMPTY_INBOX, type MessageInbox } from "../../lib/social-messages";
import { messageRequest } from "./message-client";
export { SocialMenuButton, SocialDrawer, SocialAccountActions } from "./SocialMenu";

const EMPTY_SNAPSHOT: SocialSnapshot = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
  onlineBrawlers: [],
  offlineBrawlers: [],
  invitations: [],
  activeLobby: null,
  unreadCount: 0,
};

export type SocialTab = "Brawlers" | "Messages" | "Requests";
type SocialContextValue = {
  inbox: MessageInbox;
  inboxRevision: number;
  messageError: string;
  socialError: string;
  tab: SocialTab;
  setTab(tab: SocialTab): void;
  peer: SocialAccountSummary | null;
  setPeer(peer: SocialAccountSummary | null): void;
  openConversation(peer: SocialAccountSummary): void;
  refreshInbox(): Promise<void>;
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
  } = useAppFields(["authUser", "notify", "requestAccountAccess"]);
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<SocialSnapshot>(EMPTY_SNAPSHOT);
  const lobbySession=useLobbySession();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inbox,setInbox]=useState<MessageInbox>(EMPTY_INBOX);
  const [inboxRevision,setInboxRevision]=useState(0);
  const [messageError,setMessageError]=useState("");
  const [socialError,setSocialError]=useState("");
  const [tab,setTab]=useState<SocialTab>("Brawlers");
  const [peer,setPeer]=useState<SocialAccountSummary|null>(null);
  const pathname=usePathname();
  useEffect(()=>{setOpen(false);},[pathname]);
  const inboxGeneration=useRef(0);
  const inboxPending=useRef<Promise<void>|null>(null);
  const inboxQueued=useRef(false);
  const snapshotRef=useRef(snapshot);
  snapshotRef.current=snapshot;
  const refreshInbox=useCallback(()=>{
    if(!authUser){setInbox(EMPTY_INBOX);return Promise.resolve();}
    if(inboxPending.current){inboxQueued.current=true;return inboxPending.current;}
    const generation=++inboxGeneration.current;
    const run=async()=>{
      do {
        inboxQueued.current=false;
        try {
          const result=await messageRequest<{inbox:MessageInbox}>();
          if(generation===inboxGeneration.current){setInbox(result.inbox);setInboxRevision(n=>n+1);setMessageError("");}
        } catch(error) {
          if(generation===inboxGeneration.current)setMessageError(error instanceof Error?error.message:"Messages unavailable.");
        }
      } while(generation===inboxGeneration.current&&inboxQueued.current);
    };
    const pending=run().finally(()=>{if(inboxPending.current===pending)inboxPending.current=null;});
    inboxPending.current=pending;
    return pending;
  },[authUser]);
  useEffect(()=>()=>{inboxGeneration.current++;inboxPending.current=null;inboxQueued.current=false;},[]);
  const requestId = useRef(0);
  const refreshing = useRef(false);
  const refreshQueued = useRef(false);
  const refreshLatest = useRef<() => Promise<void>>(async () => {});


  const refresh = useCallback(async () => {
    if (!authUser) {
      setSnapshot(EMPTY_SNAPSHOT);
      return;
    }
    if (refreshing.current) { refreshQueued.current = true; return; }
    refreshing.current = true;
    const current = ++requestId.current;
    setLoading(true);
    try {
      const response = await fetch("/api/social?action=snapshot", { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const result = await readJsonResponse(response, "Social data returned an invalid response.") as { snapshot?: SocialSnapshot; error?: string };
      if (!response.ok || !result.snapshot) throw new Error(result.error ?? "Social data is unavailable.");
      if (current === requestId.current) { setSnapshot(result.snapshot); setSocialError(""); }
    } catch (error) {
      if (current === requestId.current) setSocialError(error instanceof Error ? error.message : "Social data is unavailable.");
    } finally {
      if (current === requestId.current) setLoading(false);
      refreshing.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        void refreshLatest.current();
      }
    }
  }, [authUser]);
  useEffect(() => {
    refreshLatest.current = refresh;
    requestId.current += 1;
    if (!authUser) setSnapshot(EMPTY_SNAPSHOT);
  }, [authUser, refresh]);

  useEffect(() => {
    if (!authUser) return;
    void refresh(); void refreshInbox();
    const refreshVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) { void refresh(); void refreshInbox(); }
    };
    const interval = window.setInterval(refreshVisible, open ? 20_000 : 60_000);
    document.addEventListener("visibilitychange", refreshVisible);
    window.addEventListener("online",refreshVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refreshVisible); window.removeEventListener("online",refreshVisible); };
  }, [authUser, open, refresh, refreshInbox]);

  useEffect(() => {
    if (!authUser) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let attempts = 0;
    let disposed = false;
    const connect = () => {
      if (disposed || !navigator.onLine || socket?.readyState===WebSocket.OPEN || socket?.readyState===WebSocket.CONNECTING) return;
      if(retry){window.clearTimeout(retry);retry=undefined;}
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/social/socket`, "bbp-social-v1");
      socket.addEventListener("open", () => { attempts = 0; });
      socket.addEventListener("message", (event) => {
        let message: { type?: string; actorId?: string } = {};
        try { message = JSON.parse(String(event.data)) as { type?: string; actorId?: string }; } catch { return; }
        if (message.type === "lobby.invited") notify("New lobby invitation received.");
        if (message.type === "message.changed") {
          void refreshInbox();
          const current=snapshotRef.current;
          if(message.actorId&&message.actorId!==authUser.id&&![...current.friends,...current.onlineBrawlers,...current.offlineBrawlers].some(account=>account.userId===message.actorId)) void refresh();
        } else if (message.type !== "pong") {
          void refresh();
          if(message.type==="presence.snapshot")void refreshInbox();
        }
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
  }, [authUser, notify, refresh, refreshInbox]);

  // Lobby membership and eligibility change independently of the Social menu.
  const recovery=lobbySession.recovery;
  const lobbyKey=recovery.status==="member"
    ? [recovery.lobby.id,recovery.lobby.mode,recovery.lobby.currentSeriesId,recovery.lobby.members.length,recovery.lobby.configuration.format,recovery.lobby.configuration.structure].join(":")
    : recovery.status;
  useEffect(()=>{if(authUser)void refresh();},[authUser,lobbyKey,refresh]);

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
      signal: AbortSignal.timeout(12_000),
    });
    const result = await readJsonResponse(response, "Social action returned an invalid response.") as {
      error?: string;
      lobby?: { code: string; format: "bo1" | "bo3"; joined?: boolean };
    };
    if (!response.ok) { void refresh(); throw new Error(result.error ?? "Social action failed."); }
    if (action === "accept-invite" && result.lobby) {
      setOpen(false);
      await lobbySession.refresh();
      router.push("/play/lobby");
      notify("Lobby invitation accepted.");
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
  }, [authUser, notify, refresh, requestAccountAccess, router, snapshot.activeLobby?.code, lobbySession]);

  const openConversation=useCallback((account:SocialAccountSummary)=>{setPeer(account);setTab("Messages");setOpen(true);},[]);
  const value = useMemo(() => ({ snapshot, inbox, inboxRevision, messageError, socialError, tab, setTab, peer, setPeer, openConversation, refreshInbox, open, setOpen, loading, refresh, perform }), [snapshot, inbox, inboxRevision, messageError, socialError, tab, peer, openConversation, refreshInbox, open, loading, refresh, perform]);
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

