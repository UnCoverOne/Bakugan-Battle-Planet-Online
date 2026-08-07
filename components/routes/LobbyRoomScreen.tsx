"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { chatEntries, normalizeChatMessage } from "../../lib/chat";
import type { MatchState } from "../../lib/game";
import { useApp } from "../application/AppProvider";
import { Badge, PageHeader } from "../application/ui";
import {
  primeMatchStore,
  publishMatch,
  readMatchStore,
  useMatchSelector,
  useMatchTransport,
} from "../game-screen-v2/matchStore";
import styles from "./LobbyRoomScreen.module.css";

type RoomCommand = "ready" | "chat";
type BusyAction = "ready" | "start" | "chat" | "";

function roomTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function LobbyRoomScreen() {
  const router = useRouter();
  const {
    ready: appReady,
    match: appMatch,
    online: appOnline,
    playerId: appPlayerId,
    matchCapability: appMatchCapability,
    settings,
    leaveMatch,
  } = useApp();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<BusyAction>("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!appReady || !appMatch) return;
    primeMatchStore({
      route: "lobby",
      match: appMatch,
      online: appOnline,
      playerId: appPlayerId,
      capability: appMatchCapability,
      settings,
    });
  }, [appMatch, appMatchCapability, appOnline, appPlayerId, appReady, settings]);

  useMatchTransport();
  const room = useMatchSelector((state) => ({
    match: state.match,
    online: state.online,
    playerId: state.playerId,
    capability: state.capability,
  }));
  const match = room.match;
  const messages = useMemo(() => chatEntries(match), [match]);
  const me = match?.players.find((player) => player.id === room.playerId);
  const owner = match?.players[0];
  const isOwner = Boolean(owner && owner.id === room.playerId);
  const bothReady = Boolean(match && match.players.length === 2 && match.players.every((player) => player.ready));

  useEffect(() => {
    if (!match || match.phase === "lobby") return;
    router.replace("/play/match");
  }, [match, match?.phase, router]);

  useEffect(() => {
    const element = chatScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const sendRoomCommand = async (action: RoomCommand, payload: Record<string, unknown> | undefined, label: BusyAction) => {
    if (busy) return null;
    setBusy(label);
    setError("");
    try {
      let current = readMatchStore();
      let expectedState = current.match;
      if (!expectedState || !current.playerId) throw new Error("The room is no longer available.");
      if (!current.online) throw new Error("Reconnect before changing the room state.");

      for (let attempt = 0; attempt < 2; attempt += 1) {
        current = readMatchStore();
        const response = await fetch("/api/game", {
          method: "POST",
          cache: "no-store",
          headers: {
            "content-type": "application/json",
            ...(current.capability ? { "x-match-capability": current.capability } : {}),
          },
          body: JSON.stringify({
            action,
            code: expectedState.code,
            playerId: current.playerId,
            expectedVersion: expectedState.version,
            payload,
          }),
        });
        const data = await response.json().catch(() => ({})) as { state?: MatchState; error?: string };
        if (data.state) {
          publishMatch(data.state);
          expectedState = data.state;
        }
        if (response.ok) return data.state ?? expectedState;
        if (response.status !== 409 || !data.state || attempt === 1) {
          throw new Error(data.error ?? "The room action could not be completed.");
        }
      }
      return null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The room action could not be completed.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const readyUp = () => void sendRoomCommand("ready", undefined, "ready");
  const startMatch = () => void sendRoomCommand("ready", undefined, "start");
  const sendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = normalizeChatMessage(draft);
    if (!message) return;
    const result = await sendRoomCommand("chat", { message }, "chat");
    if (result) setDraft("");
  };
  const copyRoomCode = async () => {
    if (!match) return;
    try {
      await navigator.clipboard?.writeText(match.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setError("The room code could not be copied. Select it manually instead.");
    }
  };

  if (!appReady) {
    return <section className={styles.empty} role="status"><strong>OPENING ROOM…</strong><p>Restoring your private match room.</p></section>;
  }
  if (!match) {
    return <section className={styles.empty}><strong>NO ACTIVE ROOM</strong><p>Create or join a room from Match Setup.</p><Link href="/play">RETURN TO MATCH SETUP</Link></section>;
  }

  const roomState = match.players.length < 2
    ? "Waiting for opponent"
    : bothReady
      ? isOwner ? "Ready to start" : "Waiting for room owner"
      : "Ready check";

  return (
    <div className={styles.route}>
      <PageHeader
        eyebrow="PRIVATE MATCH ROOM"
        title={`ROOM ${match.code}`}
        copy={`${match.format.toUpperCase()} • Original Battle Planet • Match begins only when both players are ready and the room owner starts it.`}
        art="/assets/brawlers-group.png"
        actions={<button className={styles.copyButton} type="button" onClick={() => void copyRoomCode()}>{copied ? "COPIED" : "COPY ROOM CODE"}</button>}
      />

      <main className={styles.layout}>
        <section className={styles.roomPanel}>
          <header className={styles.roomStatus}>
            <div><span>ROOM STATUS</span><h2>{roomState}</h2></div>
            <Badge tone={room.online ? "blue" : "red"}>{room.online ? "CONNECTED" : "OFFLINE"}</Badge>
          </header>

          <div className={styles.seats}>
            {[0, 1].map((index) => {
              const player = match.players[index];
              const local = player?.id === room.playerId;
              const playerIsOwner = index === 0;
              return (
                <article className={`${styles.seat} ${player?.ready ? styles.seatReady : ""}`} key={index}>
                  {player ? <>
                    <div className={styles.seatBadges}>
                      <Badge tone={local ? "gold" : "blue"}>{local ? "YOU" : "OPPONENT"}</Badge>
                      {playerIsOwner ? <Badge>ROOM OWNER</Badge> : null}
                    </div>
                    <div className={styles.avatar}>{player.name.slice(0, 2).toUpperCase()}</div>
                    <h3>{player.name}</h3>
                    <p>{player.bakugan.map((bakugan) => bakugan.name).join(" • ")}</p>
                    <div className={styles.readyState} data-ready={player.ready ? "true" : "false"}>
                      <span aria-hidden="true" />{player.ready ? "READY" : "IN ROOM • NOT READY"}
                    </div>
                    {local && !player.ready ? (
                      <button className={styles.readyButton} type="button" disabled={busy === "ready" || !room.online} onClick={readyUp}>
                        {busy === "ready" ? "LOCKING IN…" : "LOCK IN & READY"}
                      </button>
                    ) : null}
                  </> : <>
                    <div className={`${styles.avatar} ${styles.waitingAvatar}`}>?</div>
                    <h3>WAITING FOR BRAWLER</h3>
                    <p>Share room code <strong>{match.code}</strong> with your opponent.</p>
                    <div className={styles.waitingBar} aria-hidden="true" />
                  </>}
                </article>
              );
            })}
          </div>

          <section className={styles.startPanel} aria-live="polite">
            <div>
              <span>{isOwner ? "OWNER CONTROL" : "ROOM CONTROL"}</span>
              <h2>{!bothReady ? "Both players must be ready" : isOwner ? "Both players are ready" : "Ready — waiting for room owner"}</h2>
              <p>{match.players.length < 2
                ? "The match stays in this room until another Brawler joins and both seats are ready."
                : !bothReady
                  ? "Ready status does not start the match automatically."
                  : isOwner
                    ? "You are the room owner. Start the match when both players are prepared."
                    : `${owner?.name ?? "The room owner"} can now start the match.`}</p>
            </div>
            {isOwner ? (
              <button className={styles.startButton} type="button" disabled={!bothReady || busy === "start" || !room.online} onClick={startMatch}>
                {busy === "start" ? "STARTING…" : "START MATCH"}
              </button>
            ) : null}
          </section>

          <footer className={styles.roomFooter}>
            <div><span>FORMAT</span><strong>{match.format === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</strong></div>
            <div><span>RECONNECT</span><strong>00:30</strong></div>
            <button type="button" onClick={leaveMatch}>LEAVE ROOM</button>
          </footer>
        </section>

        <aside className={styles.chatPanel} aria-label="Room chat">
          <header><div><span>PLAYER COMMS</span><h2>ROOM CHAT</h2></div><small>{messages.length} MESSAGE{messages.length === 1 ? "" : "S"}</small></header>
          <div className={styles.messages} ref={chatScroll} aria-live="polite">
            {messages.length ? messages.map((message) => (
              <article className={styles.message} data-local={message.playerId === room.playerId ? "true" : "false"} key={message.id}>
                <div><strong>{message.author}</strong><time dateTime={new Date(message.at).toISOString()}>{roomTime(message.at)}</time></div>
                <p>{message.message}</p>
              </article>
            )) : <p className={styles.noMessages}>No messages yet. Say hello while you wait.</p>}
          </div>
          <form className={styles.chatForm} onSubmit={(event) => void sendChat(event)}>
            <input
              type="text"
              value={draft}
              maxLength={240}
              autoComplete="off"
              aria-label="Room chat message"
              placeholder="Message your opponent…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={busy === "chat" || !normalizeChatMessage(draft) || !room.online}>{busy === "chat" ? "…" : "SEND"}</button>
          </form>
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </aside>
      </main>
    </div>
  );
}
