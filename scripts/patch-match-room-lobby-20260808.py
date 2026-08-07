from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    if old not in source:
        raise SystemExit(f"Missing patch anchor: {label} ({path})")
    file.write_text(source.replace(old, new, 1))


def create_new(path: str, content: str) -> None:
    file = Path(path)
    if file.exists():
        raise SystemExit(f"Refusing to overwrite existing file: {path}")
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)


# Match setup should describe online actions as room entry, not match launch.
replace_once(
    "components/routes/PlayRoutes.tsx",
    '        description="Choose the battle, lock a complete legal loadout, then pass one final preflight."',
    '        description="Choose the battle, lock a complete legal loadout, then either start training or enter a private room."',
    "play setup hero copy",
)
replace_once(
    "components/routes/PlayRoutes.tsx",
    '  return "Resolve every preflight item before starting the match.";',
    '  return "Resolve every preflight item before starting training or entering the room.";',
    "ready step copy",
)
replace_once(
    "components/routes/PlayRoutes.tsx",
    '        {blockers.length > 0 && <div className={styles.blockerList} role="alert"><strong>Start Match is blocked:</strong><ul>{blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul></div>}',
    '        {blockers.length > 0 && <div className={styles.blockerList} role="alert"><strong>{setup.mode === "solo" ? "Start Match" : setup.mode === "online" ? "Create Room" : "Join Room"} is blocked:</strong><ul>{blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul></div>}',
    "mode-specific blocker label",
)
replace_once(
    "components/routes/PlayRoutes.tsx",
    '        <span>{blocked ? blockers[0].message : setup.step === "ready" ? "Ready to start the match." : `Continue to ${setup.step === "mode" ? "Loadout" : "Ready"}.`}</span>',
    '        <span>{blocked ? blockers[0].message : setup.step === "ready" ? setup.mode === "solo" ? "Ready to start the training match." : setup.mode === "online" ? "Ready to create the room." : "Ready to join the room." : `Continue to ${setup.step === "mode" ? "Loadout" : "Ready"}.`}</span>',
    "mode-specific ready status",
)
replace_once(
    "components/routes/PlayRoutes.tsx",
    '        ? <ActionButton disabled={blocked || setup.status === "launching"} onClick={onLaunch}>{setup.status === "launching" ? "STARTING…" : "START MATCH"}</ActionButton>',
    '''        ? <ActionButton disabled={blocked || setup.status === "launching"} onClick={onLaunch}>{setup.status === "launching"
          ? setup.mode === "solo" ? "STARTING…" : setup.mode === "online" ? "CREATING…" : "JOINING…"
          : setup.mode === "solo" ? "START MATCH" : setup.mode === "online" ? "CREATE ROOM" : "JOIN ROOM"}</ActionButton>''',
    "mode-specific final action",
)


# Keep online room readiness separate from the owner's explicit start action.
create_new(
    "lib/lobby.ts",
    '''import { cloneMatch, setReady, type MatchState } from "./game";

/** The player who created the room always occupies the first seat. */
export function roomOwnerId(state: MatchState) {
  return state.players[0]?.id ?? "";
}

/**
 * Online lobby SET_READY semantics:
 * - first press marks a player ready and always keeps the room in the lobby;
 * - after both players are ready, a second press from the room owner starts play.
 *
 * Local/training matches continue to use game.setReady directly and retain their
 * existing automatic start behaviour.
 */
export function setLobbyReadyOrStart(input: MatchState, playerId: string) {
  if (input.phase !== "lobby") throw new Error("Ready is not legal now.");
  const player = input.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Unknown player.");

  if (!player.ready) {
    const otherReady = input.players.find((candidate) => candidate.id !== playerId && candidate.ready);
    if (input.players.length === 2 && otherReady) {
      // game.setReady historically starts as soon as the second player readies.
      // Temporarily mask the other ready seat so we can reuse all validation,
      // logging, versioning, and deck checks without advancing the phase.
      const guarded = cloneMatch(input);
      const guardedOther = guarded.players.find((candidate) => candidate.id === otherReady.id);
      if (guardedOther) guardedOther.ready = false;
      const next = setReady(guarded, playerId);
      const restoredOther = next.players.find((candidate) => candidate.id === otherReady.id);
      if (restoredOther) restoredOther.ready = true;
      return next;
    }
    return setReady(input, playerId);
  }

  if (roomOwnerId(input) !== playerId) {
    throw new Error("Only the room owner can start the match.");
  }
  if (input.players.length !== 2) {
    throw new Error("Wait for another Brawler to join before starting the match.");
  }
  if (!input.players.every((candidate) => candidate.ready)) {
    throw new Error("Both players must be ready before the room owner can start the match.");
  }

  // Calling the established transition with two ready seats performs the
  // server-authoritative starting-player selection. Remove only the duplicate
  // ready log emitted by this deliberate second invocation.
  const next = setReady(input, playerId);
  const duplicateReadyLogIndex = input.log.length;
  if (next.log[duplicateReadyLogIndex]?.message === `${player.name} locked a legal deck.`) {
    next.log.splice(duplicateReadyLogIndex, 1);
  }
  return next;
}
''',
)
replace_once(
    "lib/engine/reducer.ts",
    '  setReady,\n',
    '',
    "remove direct setReady import",
)
replace_once(
    "lib/engine/reducer.ts",
    'import { addChatMessage } from "../chat";\n',
    'import { addChatMessage } from "../chat";\nimport { setLobbyReadyOrStart } from "../lobby";\n',
    "lobby transition import",
)
replace_once(
    "lib/engine/reducer.ts",
    '    case "SET_READY": return setReady(input, actorId);',
    '    case "SET_READY": return setLobbyReadyOrStart(input, actorId);',
    "online ready dispatch",
)


# Dedicated live lobby: lightweight transport, ready check, owner start, and chat.
create_new(
    "components/routes/LobbyRoomScreen.tsx",
    '''"use client";

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
      settings,
    });
  }, [appMatch, appOnline, appPlayerId, appReady, settings]);

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
      ? isOwner ? "Ready to start" : "Waiting for owner"
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
''',
)

create_new(
    "components/routes/LobbyRoomScreen.module.css",
    '''.route {
  min-height: calc(100vh - 76px);
  padding-bottom: var(--space-8, 4rem);
}

.layout {
  width: min(calc(100% - (2 * var(--space-5, 1.5rem))), var(--content-wide, 88rem));
  margin: var(--space-6, 2rem) auto 0;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(19rem, .65fr);
  gap: var(--space-5, 1.5rem);
  align-items: start;
}

.roomPanel,
.chatPanel {
  border: 1px solid var(--border-subtle, rgba(255,255,255,.12));
  background: var(--surface-panel, #071820);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .24);
}

.roomPanel {
  padding: var(--space-6, 2rem);
}

.roomStatus,
.chatPanel > header,
.startPanel,
.roomFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4, 1rem);
}

.roomStatus {
  padding-bottom: var(--space-5, 1.5rem);
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,.12));
}

.roomStatus span,
.startPanel span,
.roomFooter span,
.chatPanel > header span {
  color: var(--brand-blue-bright, #59d9ff);
  font-family: var(--font-display, inherit);
  font-size: var(--type-meta, .72rem);
  font-style: italic;
  font-weight: 700;
  letter-spacing: var(--tracking-label, .12em);
  text-transform: uppercase;
}

.roomStatus h2,
.startPanel h2,
.chatPanel h2,
.seat h3,
.seat p,
.startPanel p,
.message p {
  margin: 0;
}

.roomStatus h2 {
  margin-top: .25rem;
  font-size: clamp(1.65rem, 3vw, 2.35rem);
  text-transform: uppercase;
}

.seats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4, 1rem);
  margin-top: var(--space-5, 1.5rem);
}

.seat {
  min-height: 20rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3, .8rem);
  padding: var(--space-5, 1.5rem);
  border: 1px solid var(--border-subtle, rgba(255,255,255,.12));
  background: rgba(2, 14, 20, .72);
  clip-path: polygon(1rem 0, 100% 0, 100% calc(100% - 1rem), calc(100% - 1rem) 100%, 0 100%, 0 1rem);
  text-align: center;
}

.seatReady {
  border-color: rgba(89, 217, 255, .62);
  box-shadow: inset 0 0 28px rgba(38, 172, 221, .09);
}

.seatBadges {
  min-height: 1.75rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: .45rem;
}

.avatar {
  width: 5.25rem;
  height: 5.25rem;
  display: grid;
  place-items: center;
  border: 1px solid rgba(89, 217, 255, .42);
  border-radius: 50%;
  background: rgba(7, 52, 68, .72);
  font-family: var(--font-display, inherit);
  font-size: 1.55rem;
  font-weight: 800;
}

.waitingAvatar {
  border-style: dashed;
  color: var(--text-secondary, #9bb0b8);
  background: transparent;
}

.seat h3 {
  font-size: 1.35rem;
  text-transform: uppercase;
}

.seat p {
  min-height: 2.5rem;
  color: var(--text-secondary, #9bb0b8);
  font-size: .88rem;
}

.readyState {
  display: flex;
  align-items: center;
  gap: .5rem;
  color: var(--text-secondary, #9bb0b8);
  font-size: .75rem;
  font-weight: 800;
  letter-spacing: .08em;
}

.readyState span {
  width: .55rem;
  height: .55rem;
  border-radius: 50%;
  background: #f2b94b;
  box-shadow: 0 0 10px rgba(242, 185, 75, .4);
}

.readyState[data-ready="true"] {
  color: #75e69a;
}

.readyState[data-ready="true"] span {
  background: #75e69a;
  box-shadow: 0 0 12px rgba(117, 230, 154, .52);
}

.readyButton,
.startButton,
.copyButton,
.chatForm button,
.roomFooter button {
  border: 1px solid rgba(89, 217, 255, .45);
  background: var(--brand-blue-deep, #07384a);
  color: var(--text-primary, #fff);
  font-family: var(--font-display, inherit);
  font-size: .78rem;
  font-style: italic;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
}

.readyButton,
.startButton {
  min-height: 2.8rem;
  padding: .75rem 1.25rem;
  clip-path: polygon(.55rem 0, 100% 0, calc(100% - .55rem) 100%, 0 100%);
}

.readyButton:disabled,
.startButton:disabled,
.chatForm button:disabled {
  opacity: .42;
  cursor: not-allowed;
}

.startPanel {
  margin-top: var(--space-5, 1.5rem);
  padding: var(--space-5, 1.5rem);
  border: 1px solid var(--border-subtle, rgba(255,255,255,.12));
  background: linear-gradient(110deg, rgba(7, 45, 59, .86), rgba(3, 21, 28, .7));
}

.startPanel > div {
  min-width: 0;
}

.startPanel h2 {
  margin-top: .3rem;
  font-size: 1.4rem;
  text-transform: uppercase;
}

.startPanel p {
  margin-top: .45rem;
  color: var(--text-secondary, #9bb0b8);
}

.startButton {
  flex: 0 0 auto;
  min-width: 10rem;
  border-color: rgba(255, 91, 96, .7);
  background: #8d1f29;
}

.roomFooter {
  margin-top: var(--space-5, 1.5rem);
  padding-top: var(--space-4, 1rem);
  border-top: 1px solid var(--border-subtle, rgba(255,255,255,.12));
}

.roomFooter > div {
  display: grid;
  gap: .2rem;
}

.roomFooter strong {
  font-size: .85rem;
}

.roomFooter button {
  margin-left: auto;
  padding: .65rem .9rem;
  background: transparent;
  border-color: var(--border-subtle, rgba(255,255,255,.18));
}

.copyButton {
  min-height: 2.65rem;
  padding: .65rem 1rem;
}

.chatPanel {
  min-height: 34rem;
  position: sticky;
  top: 96px;
  display: grid;
  grid-template-rows: auto minmax(17rem, 1fr) auto auto;
  overflow: hidden;
}

.chatPanel > header {
  padding: var(--space-4, 1rem);
  border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,.12));
}

.chatPanel h2 {
  margin-top: .2rem;
  font-size: 1.2rem;
}

.chatPanel > header small {
  color: var(--text-secondary, #9bb0b8);
  font-size: .65rem;
  letter-spacing: .08em;
}

.messages {
  min-height: 0;
  max-height: 29rem;
  overflow-y: auto;
  padding: var(--space-4, 1rem);
  display: flex;
  flex-direction: column;
  gap: .75rem;
}

.message {
  width: min(88%, 20rem);
  padding: .7rem .8rem;
  border: 1px solid var(--border-subtle, rgba(255,255,255,.1));
  background: rgba(255, 255, 255, .035);
}

.message[data-local="true"] {
  align-self: flex-end;
  border-color: rgba(89, 217, 255, .3);
  background: rgba(20, 94, 122, .2);
}

.message > div {
  display: flex;
  justify-content: space-between;
  gap: .75rem;
  margin-bottom: .35rem;
}

.message strong,
.message time {
  font-size: .68rem;
}

.message time {
  color: var(--text-secondary, #9bb0b8);
}

.message p {
  overflow-wrap: anywhere;
  font-size: .86rem;
  line-height: 1.4;
}

.noMessages {
  margin: auto;
  color: var(--text-secondary, #9bb0b8);
  text-align: center;
}

.chatForm {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: .5rem;
  padding: var(--space-4, 1rem);
  border-top: 1px solid var(--border-subtle, rgba(255,255,255,.12));
}

.chatForm input {
  min-width: 0;
  min-height: 2.7rem;
  padding: .65rem .75rem;
  border: 1px solid var(--border-subtle, rgba(255,255,255,.15));
  background: rgba(1, 11, 16, .8);
  color: var(--text-primary, #fff);
}

.chatForm button {
  min-width: 4.25rem;
  padding: .6rem .75rem;
}

.error {
  margin: 0;
  padding: 0 var(--space-4, 1rem) var(--space-4, 1rem);
  color: #ff8a8f;
  font-size: .78rem;
}

.waitingBar {
  width: min(100%, 12rem);
  height: 3px;
  overflow: hidden;
  background: rgba(255,255,255,.08);
}

.waitingBar::after {
  content: "";
  display: block;
  width: 42%;
  height: 100%;
  background: var(--brand-blue-bright, #59d9ff);
  animation: waiting 1.7s ease-in-out infinite;
}

.empty {
  width: min(calc(100% - 2rem), 42rem);
  margin: 12vh auto;
  padding: 3rem;
  border: 1px solid var(--border-subtle, rgba(255,255,255,.12));
  background: var(--surface-panel, #071820);
  text-align: center;
}

.empty strong {
  font-size: 1.5rem;
}

.empty p {
  color: var(--text-secondary, #9bb0b8);
}

.empty a {
  color: var(--brand-blue-bright, #59d9ff);
  font-weight: 800;
}

@keyframes waiting {
  0%, 100% { transform: translateX(-110%); }
  50% { transform: translateX(240%); }
}

@media (max-width: 900px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .chatPanel {
    position: static;
    min-height: 28rem;
  }
}

@media (max-width: 620px) {
  .layout {
    width: min(calc(100% - 1.25rem), var(--content-wide, 88rem));
    margin-top: 1rem;
  }

  .roomPanel {
    padding: 1rem;
  }

  .roomStatus,
  .startPanel,
  .roomFooter {
    align-items: stretch;
    flex-direction: column;
  }

  .seats {
    grid-template-columns: 1fr;
  }

  .seat {
    min-height: 16rem;
  }

  .startButton {
    width: 100%;
  }

  .roomFooter button {
    width: 100%;
    margin-left: 0;
  }
}
''',
)

replace_once(
    "app/(workspace)/play/lobby/page.tsx",
    'import { MatchRuntime } from "../../../../components/routes/MatchRuntime";\nimport { LobbyScreen } from "../../../../components/routes/PlayRoutes";\n\nexport const metadata: Metadata = { title: "Match Lobby" };\nexport default function LobbyPage() { return <><LobbyScreen /><MatchRuntime /></>; }',
    'import { LobbyRoomScreen } from "../../../../components/routes/LobbyRoomScreen";\n\nexport const metadata: Metadata = { title: "Match Lobby" };\nexport default function LobbyPage() { return <LobbyRoomScreen />; }',
    "dedicated lobby page",
)


# Engine regression: two ready players remain in lobby until the owner starts.
path = Path("tests/engine-architecture.test.ts")
source = path.read_text()
old = '''  const readyTwo = envelope(firstAfterOne, {
    commandId: "ready-player-two",
    actorId: "p2",
    command: { type: "SET_READY" },
    randomSeed: "starting-player-seed",
    issuedAt: 1_800_000_001_000,
  });
  const first = reduceMatch(firstAfterOne, readyTwo);
  const second = reduceMatch(secondAfterOne, readyTwo);

  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  assert.equal(first.state.phase, "startingPlayer");
  assert.equal(first.state[ENGINE_METADATA_KEY]?.phase.area, "setup");
'''
new = '''  const readyTwo = envelope(firstAfterOne, {
    commandId: "ready-player-two",
    actorId: "p2",
    command: { type: "SET_READY" },
    randomSeed: "ready-two",
    issuedAt: 1_800_000_001_000,
  });
  const firstBothReady = reduceMatch(firstAfterOne, readyTwo);
  const secondBothReady = reduceMatch(secondAfterOne, readyTwo);

  assert.deepEqual(firstBothReady.state, secondBothReady.state);
  assert.deepEqual(firstBothReady.events, secondBothReady.events);
  assert.equal(firstBothReady.state.phase, "lobby");
  assert.equal(firstBothReady.state.players.every((candidate) => candidate.ready), true);
  assert.equal(firstBothReady.state[ENGINE_METADATA_KEY]?.phase.area, "lobby");

  const start = envelope(firstBothReady.state, {
    commandId: "owner-start-match",
    actorId: "p1",
    command: { type: "SET_READY" },
    randomSeed: "starting-player-seed",
    issuedAt: 1_800_000_002_000,
  });
  const first = reduceMatch(firstBothReady.state, start);
  const second = reduceMatch(secondBothReady.state, start);

  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  assert.equal(first.state.phase, "startingPlayer");
  assert.equal(first.state[ENGINE_METADATA_KEY]?.phase.area, "setup");
'''
if old not in source:
    raise SystemExit("Missing patch anchor: deterministic ready test")
path.write_text(source.replace(old, new, 1))


# Match setup regression now locks mode-specific actions rather than one universal Start Match label.
path = Path("tests/play-setup.test.ts")
source = path.read_text()
source = source.replace(
    'test("room, connection, and authentication failures all produce explicit Start Match blockers", () => {',
    'test("room, connection, and authentication failures all produce explicit launch blockers", () => {',
    1,
)
source = source.replace(
    'test("the Play route renders the complete loadout, visible blockers, and one definitive Start Match action", async () => {',
    'test("the Play route distinguishes starting training from creating or joining a room", async () => {',
    1,
)
source = source.replace('    "Start Match is blocked:",\n', '    "Create Room",\n    "Join Room",\n', 1)
source = source.replace(
    '  assert.equal((route.match(/START MATCH/g) ?? []).length, 1);',
    '  assert.match(route, /setup\.mode === "solo" \? "START MATCH" : setup\.mode === "online" \? "CREATE ROOM" : "JOIN ROOM"/);\n  assert.match(route, /setup\.mode === "solo" \? "Start Match" : setup\.mode === "online" \? "Create Room" : "Join Room"/);',
    1,
)
path.write_text(source)


create_new(
    "tests/lobby-flow.test.ts",
    '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch } from "../lib/game";
import { roomOwnerId, setLobbyReadyOrStart } from "../lib/lobby";

test("online room readiness never starts automatically and only the owner can start", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  const guest = makePlayer("guest", "Guest", STARTER_DECKS[1]);
  let match = createMatch("ROOM01", "bo1", [owner, guest]);

  assert.equal(roomOwnerId(match), "owner");
  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "lobby");
  assert.equal(match.players.find((player) => player.id === "owner")?.ready, true);

  match = setLobbyReadyOrStart(match, "guest");
  assert.equal(match.phase, "lobby");
  assert.equal(match.players.every((player) => player.ready), true);
  assert.throws(
    () => setLobbyReadyOrStart(match, "guest"),
    /Only the room owner can start the match/,
  );

  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "startingPlayer");
  assert.equal(match.log.filter((entry) => entry.message === "Owner locked a legal deck.").length, 1);
});

test("the owner cannot start before the second ready player exists", () => {
  const owner = makePlayer("owner", "Owner", STARTER_DECKS[0]);
  let match = createMatch("ROOM02", "bo1", [owner]);
  match = setLobbyReadyOrStart(match, "owner");
  assert.equal(match.phase, "lobby");
  assert.throws(
    () => setLobbyReadyOrStart(match, "owner"),
    /Wait for another Brawler to join/,
  );
});

test("the lobby route has live room transport, chat, ready state, and owner-only start UI", async () => {
  const [room, page] = await Promise.all([
    readFile(new URL("../components/routes/LobbyRoomScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(workspace)/play/lobby/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const contract of [
    "useMatchTransport",
    "chatEntries",
    "LOCK IN & READY",
    "ROOM OWNER",
    "Both players must be ready",
    "Waiting for room owner",
    "START MATCH",
    "Ready status does not start the match automatically",
  ]) assert.match(room, new RegExp(contract.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")));
  assert.match(room, /\{isOwner \? \(/);
  assert.match(room, /match\.phase !== "lobby"/);
  assert.match(page, /LobbyRoomScreen/);
  assert.doesNotMatch(page, /MatchRuntime|LobbyScreen/);
});
''',
)


# Include the focused room test in the standard and engine suites.
path = Path("package.json")
source = path.read_text()
source = source.replace(
    'tests/play-setup.test.ts tests/compendium-experience.test.ts',
    'tests/play-setup.test.ts tests/lobby-flow.test.ts tests/compendium-experience.test.ts',
    1,
)
source = source.replace(
    'tests/manual-tie-break.test.ts tests/deck-inspection.test.ts tests/magnus-ultimate-rival.test.ts tests/reported-gameplay-regressions-2026-08.test.ts',
    'tests/manual-tie-break.test.ts tests/deck-inspection.test.ts tests/magnus-ultimate-rival.test.ts tests/lobby-flow.test.ts tests/reported-gameplay-regressions-2026-08.test.ts',
    1,
)
path.write_text(source)
