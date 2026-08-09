"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { addChatMessage, chatEntries, normalizeChatMessage } from "../../lib/chat";
import { makeCanonicalPlayer, validateDeck, type CanonicalPlayerSelection, type DeckRecord } from "../../lib/data";
import type { MatchState, PlayerState } from "../../lib/game";
import {
  lobbyConfig,
  playerLobbyDeckFormat,
  playerLobbyDeckName,
  requiredDeckFormat,
  tagLobbyPlayerDeck,
  type LobbyRulesFormat,
} from "../../lib/lobby-config";
import {
  replaceLobbyDeck,
  roomOwnerId,
  setLobbyReady,
  startLobbyMatch,
  updateLobbySettings,
} from "../../lib/lobby";
import { syncTrainingBotForLobby } from "../../lib/training-lobby";
import { useApp } from "../application/AppProvider";
import { Badge, PageHeader } from "../application/ui";
import {
  primeMatchStore,
  publishMatch,
  readMatchStore,
  useMatchSelector,
  useMatchTransport,
} from "../game-screen-v2/matchStore";
import styles from "./StreamlinedLobbyRoomScreen.module.css";

type RoomCommand = "lobby-ready" | "start-match" | "lobby-settings" | "lobby-deck" | "chat";
type BusyAction = "ready" | "start" | "settings" | "deck" | "chat" | "";

function roomTime(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatLabel(format: LobbyRulesFormat) {
  if (format === "singleton") return "Singleton";
  if (format === "competitive") return "Competitive";
  return "Standard";
}

function sameSet(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function deckMatchesPlayer(deck: DeckRecord, player: PlayerState | undefined) {
  if (!player) return false;
  const bakuganIds = player.bakugan.map((bakugan) => bakugan.character.catalogId);
  const coreIds = player.cores.map((core) => core.catalogId ?? core.id);
  const cardIds = [...player.deckCards, ...player.hand].map((card) => card.catalogId);
  return sameSet(deck.bakuganIds, bakuganIds)
    && sameSet(deck.coreIds, coreIds)
    && sameSet(deck.cardIds, cardIds);
}

function canonicalSelection(playerId: string, playerName: string, deck: DeckRecord): CanonicalPlayerSelection {
  return {
    playerId,
    name: playerName,
    deck: {
      name: deck.name,
      bakuganIds: [...deck.bakuganIds],
      coreIds: [...deck.coreIds],
      cardIds: [...deck.cardIds],
      format: deck.format,
    },
  };
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
    decks,
    setMatch,
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
  const config = match ? lobbyConfig(match) : null;
  const messages = useMemo(() => chatEntries(match), [match]);
  const me = match?.players.find((player) => player.id === room.playerId);
  const ownerId = match ? roomOwnerId(match) : "";
  const owner = match?.players.find((player) => player.id === ownerId);
  const isOwner = Boolean(ownerId && ownerId === room.playerId);
  const bothReady = Boolean(match && match.players.length === 2 && match.players.every((player) => player.ready));
  const requiredFormat = config ? requiredDeckFormat(config.rulesFormat) : "standard";
  const compatibleDecks = useMemo(
    () => (decks as DeckRecord[]).filter((deck) => {
      const deckFormat = deck.format === "singleton" ? "singleton" : "standard";
      return deckFormat === requiredFormat && validateDeck(deck).isLegal;
    }),
    [decks, requiredFormat],
  );
  const currentDeck = useMemo(
    () => compatibleDecks.find((deck) => deckMatchesPlayer(deck, me)) ?? null,
    [compatibleDecks, me],
  );
  const myDeckFormatMatches = Boolean(me && playerLobbyDeckFormat(me) === requiredFormat);

  useEffect(() => {
    if (!match || match.phase === "lobby") return;
    router.replace("/play/match");
  }, [match, match?.phase, router]);

  useEffect(() => {
    const element = chatScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  const publishLocal = (next: MatchState) => {
    setMatch(next);
    publishMatch(next);
    return next;
  };

  const sendRoomCommand = async (
    action: RoomCommand,
    payload: Record<string, unknown> | undefined,
    label: BusyAction,
    selection?: CanonicalPlayerSelection,
  ) => {
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
            selection,
          }),
        });
        const data = await response.json().catch(() => ({})) as { state?: MatchState; error?: string };
        if (data.state) {
          publishMatch(data.state);
          setMatch(data.state);
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

  const changeFormat = async (rulesFormat: LobbyRulesFormat) => {
    if (!match || !config || !isOwner || rulesFormat === config.rulesFormat) return;
    if (rulesFormat === "competitive" && config.mode !== "ranked") return;
    if (room.online) {
      await sendRoomCommand("lobby-settings", { rulesFormat, meta: "battle-brawlers" }, "settings");
      return;
    }
    setBusy("settings");
    setError("");
    try {
      let next = updateLobbySettings(match, room.playerId, rulesFormat, "battle-brawlers");
      next = syncTrainingBotForLobby(next);
      publishLocal(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lobby settings could not be changed.");
    } finally {
      setBusy("");
    }
  };

  const selectDeck = async (deckId: string) => {
    if (!match || !me) return;
    const deck = compatibleDecks.find((candidate) => candidate.id === deckId);
    if (!deck) return;
    const selection = canonicalSelection(room.playerId, me.name, deck);
    if (room.online) {
      await sendRoomCommand("lobby-deck", undefined, "deck", selection);
      return;
    }
    setBusy("deck");
    setError("");
    try {
      const replacement = tagLobbyPlayerDeck(makeCanonicalPlayer(selection), selection.deck);
      publishLocal(replaceLobbyDeck(match, room.playerId, replacement));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deck could not be selected.");
    } finally {
      setBusy("");
    }
  };

  const toggleReady = async () => {
    if (!match || !me) return;
    const ready = !me.ready;
    if (room.online) {
      await sendRoomCommand("lobby-ready", { ready }, "ready");
      return;
    }
    setBusy("ready");
    setError("");
    try {
      publishLocal(setLobbyReady(match, room.playerId, ready));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ready state could not be changed.");
    } finally {
      setBusy("");
    }
  };

  const startMatch = async () => {
    if (!match) return;
    if (room.online) {
      await sendRoomCommand("start-match", undefined, "start");
      return;
    }
    setBusy("start");
    setError("");
    try {
      publishLocal(startLobbyMatch(match, room.playerId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The match could not be started.");
    } finally {
      setBusy("");
    }
  };

  const sendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!match) return;
    const message = normalizeChatMessage(draft);
    if (!message) return;
    if (room.online) {
      const result = await sendRoomCommand("chat", { message }, "chat");
      if (result) setDraft("");
      return;
    }
    setBusy("chat");
    setError("");
    try {
      publishLocal(addChatMessage(match, room.playerId, message));
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The message could not be sent.");
    } finally {
      setBusy("");
    }
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
    return <section className={styles.empty} role="status"><strong>OPENING LOBBY…</strong><p>Restoring your match lobby.</p></section>;
  }
  if (!match || !config) {
    return <section className={styles.empty}><strong>NO ACTIVE LOBBY</strong><p>Create or join a lobby from Match Creation.</p><Link href="/play">RETURN TO MATCH CREATION</Link></section>;
  }

  const roomState = match.players.length < 2
    ? "Waiting for opponent"
    : bothReady
      ? isOwner ? "Ready to start" : "Waiting for lobby owner"
      : "Ready check";

  return (
    <div className={styles.route}>
      <PageHeader
        eyebrow={`${config.mode.toUpperCase()} LOBBY`}
        title={`ROOM ${match.code}`}
        copy={`${match.format === "bo3" ? "Best of Three" : "Best of One"} • ${formatLabel(config.rulesFormat)} • Battle Brawlers`}
        art="/assets/brawlers-group.png"
        actions={<button className={styles.copyButton} type="button" onClick={() => void copyRoomCode()}>{copied ? "COPIED" : "COPY ROOM CODE"}</button>}
      />

      <main className={styles.layout}>
        <section className={styles.mainColumn}>
          <section className={styles.configPanel}>
            <header>
              <div><span>LOBBY SETTINGS</span><h2>{isOwner ? "Configure the match" : "Owner-selected rules"}</h2></div>
              <Badge tone={room.online ? "blue" : "gold"}>{room.online ? "ONLINE" : "TRAINING"}</Badge>
            </header>
            <div className={styles.configGrid}>
              <div>
                <span>FORMAT</span>
                <div className={styles.formatButtons}>
                  {(["standard", "singleton", "competitive"] as LobbyRulesFormat[]).map((candidate) => {
                    const rankedOnly = candidate === "competitive" && config.mode !== "ranked";
                    return (
                      <button
                        type="button"
                        key={candidate}
                        className={config.rulesFormat === candidate ? styles.selected : ""}
                        aria-pressed={config.rulesFormat === candidate}
                        disabled={!isOwner || busy === "settings" || rankedOnly}
                        onClick={() => void changeFormat(candidate)}
                      >
                        <strong>{formatLabel(candidate)}</strong>
                        <small>{candidate === "competitive" ? "Ranked only" : candidate === "singleton" ? "One copy per card/Core" : "Standard deck construction"}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className={styles.metaField}>
                <span>META</span>
                <select value="battle-brawlers" disabled={!isOwner || busy === "settings"} onChange={() => undefined}>
                  <option value="battle-brawlers">Battle Brawlers</option>
                </select>
                <small>Currently the only available meta.</small>
              </label>
            </div>
          </section>

          <section className={styles.roomPanel}>
            <header className={styles.roomStatus}>
              <div><span>ROOM STATUS</span><h2>{roomState}</h2></div>
              <Badge tone={room.online ? "blue" : "gold"}>{room.online ? "CONNECTED" : "LOCAL"}</Badge>
            </header>

            <div className={styles.seats}>
              {[0, 1].map((index) => {
                const player = match.players[index];
                const local = player?.id === room.playerId;
                const playerIsOwner = index === 0;
                const deckName = player ? playerLobbyDeckName(player) : "";
                return (
                  <article className={`${styles.seat} ${player?.ready ? styles.seatReady : ""}`} key={index}>
                    {player ? <>
                      <div className={styles.seatBadges}>
                        <Badge tone={local ? "gold" : "blue"}>{local ? "YOU" : player.id === "training-bot" ? "TRAINING AI" : "OPPONENT"}</Badge>
                        {playerIsOwner ? <Badge>LOBBY OWNER</Badge> : null}
                      </div>
                      <div className={styles.avatar}>{player.name.slice(0, 2).toUpperCase()}</div>
                      <h3>{player.name}</h3>
                      <p>{deckName || player.bakugan.map((bakugan) => bakugan.name).join(" • ")}</p>
                      <div className={styles.readyState} data-ready={player.ready ? "true" : "false"}>
                        <span aria-hidden="true" />{player.ready ? "READY" : "NOT READY"}
                      </div>
                    </> : <>
                      <div className={`${styles.avatar} ${styles.waitingAvatar}`}>?</div>
                      <h3>WAITING FOR BRAWLER</h3>
                      <p>Share room code <strong>{match.code}</strong> with your opponent.</p>
                    </>}
                  </article>
                );
              })}
            </div>

            <section className={styles.loadoutPanel}>
              <div>
                <span>YOUR DECK</span>
                <h2>Select your deck</h2>
                <p>{formatLabel(config.rulesFormat)} requires a {requiredFormat === "singleton" ? "Singleton" : "Standard"} deck. Changing deck makes you unready.</p>
              </div>
              {compatibleDecks.length ? (
                <select
                  value={currentDeck?.id ?? ""}
                  disabled={busy === "deck" || me?.ready}
                  onChange={(event) => void selectDeck(event.target.value)}
                  aria-label="Select lobby deck"
                >
                  <option value="" disabled>{currentDeck ? currentDeck.name : "Choose a deck"}</option>
                  {compatibleDecks.map((deck) => <option value={deck.id} key={deck.id}>{deck.name}</option>)}
                </select>
              ) : <Link href="/decks">CREATE A COMPATIBLE DECK</Link>}
              {!myDeckFormatMatches ? <p className={styles.deckWarning}>Your current seat deck does not match this lobby format. Select a compatible deck before readying.</p> : null}
            </section>

            <section className={styles.startPanel} aria-live="polite">
              <div>
                <span>READY CHECK</span>
                <h2>{bothReady ? isOwner ? "Both players are ready" : "Ready — waiting for lobby owner" : "Both players must be ready"}</h2>
                <p>Ready status never starts the game automatically. The lobby owner starts once both seats are ready.</p>
              </div>
              <div className={styles.startActions}>
                <button
                  className={styles.readyButton}
                  type="button"
                  disabled={!me || busy === "ready" || !myDeckFormatMatches || (room.online && !room.online)}
                  onClick={() => void toggleReady()}
                >
                  {busy === "ready" ? "UPDATING…" : me?.ready ? "UNREADY" : "READY"}
                </button>
                {isOwner ? (
                  <button className={styles.startButton} type="button" disabled={!bothReady || busy === "start"} onClick={() => void startMatch()}>
                    {busy === "start" ? "STARTING…" : "START GAME"}
                  </button>
                ) : null}
              </div>
            </section>

            <footer className={styles.roomFooter}>
              <div><span>MODE</span><strong>{config.mode.toUpperCase()}</strong></div>
              <div><span>STRUCTURE</span><strong>{match.format === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</strong></div>
              <div><span>FORMAT</span><strong>{formatLabel(config.rulesFormat).toUpperCase()}</strong></div>
              <div><span>META</span><strong>BATTLE BRAWLERS</strong></div>
              <button type="button" onClick={leaveMatch}>LEAVE LOBBY</button>
            </footer>
          </section>
        </section>

        <aside className={styles.chatPanel} aria-label="Lobby chat">
          <header><div><span>PLAYER COMMS</span><h2>LOBBY CHAT</h2></div><small>{messages.length} MESSAGE{messages.length === 1 ? "" : "S"}</small></header>
          <div className={styles.messages} ref={chatScroll} aria-live="polite">
            {messages.length ? messages.map((message) => (
              <article className={styles.message} data-local={message.playerId === room.playerId ? "true" : "false"} key={message.id}>
                <div><strong>{message.author}</strong><time dateTime={new Date(message.at).toISOString()}>{roomTime(message.at)}</time></div>
                <p>{message.message}</p>
              </article>
            )) : <p className={styles.noMessages}>No messages yet. Say hello while you prepare.</p>}
          </div>
          <form className={styles.chatForm} onSubmit={(event) => void sendChat(event)}>
            <input
              type="text"
              value={draft}
              maxLength={240}
              autoComplete="off"
              aria-label="Lobby chat message"
              placeholder="Message your opponent…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" disabled={busy === "chat" || !normalizeChatMessage(draft)}>{busy === "chat" ? "…" : "SEND"}</button>
          </form>
          {config.mode === "training" ? <p className={styles.trainingNote}>Training AI does not reply to chat.</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </aside>
      </main>
    </div>
  );
}
