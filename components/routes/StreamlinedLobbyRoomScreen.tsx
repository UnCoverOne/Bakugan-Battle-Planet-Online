"use client";

import { OriginalImage } from "@/components/media/OriginalImage";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { chatEntries, normalizeChatMessage } from "../../lib/chat";
import {
  CARD_BY_ID,
  deckLeadCard,
  makeCanonicalPlayer,
  validateDeck,
  type CanonicalPlayerSelection,
  type DeckRecord,
} from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
import type { GameCard, MatchState, PlayerState } from "../../lib/game";
import {
  lobbyConfig,
  playerLobbyDeckFormat,
  playerLobbyDeckName,
  requiredDeckFormat,
  tagLobbyPlayerDeck,
  type LobbyRulesFormat,
} from "../../lib/lobby-config";
import { lobbyCanStart, roomOwnerId } from "../../lib/lobby";
import { trainingBotLobbyCommands } from "../../lib/training-lobby";
import { dispatchLocalGameAction, dispatchLocalGameCommand } from "../../lib/engine/local-command-dispatcher";
import { eligibleRankedDecks, rankedSeries } from "../../lib/ranked-lobby";
import { useApp } from "../application/AppProvider";
import { Badge, factionClass } from "../application/ui";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { PlayerPreview } from "../profile/PlayerPreview";
import {
  matchCommandHeaders,
  primeMatchStore,
  publishMatch,
  readMatchStore,
  useMatchSelector,
  useMatchTransport,
} from "../game-screen-v2/matchStore";
import styles from "./StreamlinedLobbyRoomScreen.module.css";

type RoomCommand = "lobby-ready" | "start-match" | "lobby-settings" | "lobby-deck" | "ranked-ban" | "ranked-select" | "chat";
type BusyAction = "ready" | "start" | "settings" | "deck" | "ban" | "select" | "chat" | "";

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

function canonicalSelection(playerId: string, playerName: string, deck: DeckRecord, avatar = ""): CanonicalPlayerSelection {
  return {
    playerId,
    name: playerName,
    ...(avatar ? { cosmetics: { avatar } } : {}),
    deck: {
      id: deck.id,
      name: deck.name,
      bakuganIds: [...deck.bakuganIds],
      coreIds: [...deck.coreIds],
      cardIds: [...deck.cardIds],
      format: deck.format,
      factions: [...deck.factions],
      leadCardId: deck.leadCardId,
    },
  };
}

function deckPreviewCards(deck: DeckRecord) {
  const seen = new Set<string>();
  return [...deck.bakuganIds.map((id) => CARD_BY_ID.get(id)), deckLeadCard(deck)].filter((card): card is GameCard => {
    if (!card || seen.has(card.catalogId)) return false;
    seen.add(card.catalogId);
    return true;
  });
}

function deckTags(deck: DeckRecord) {
  const tags = [
    deckSetName(deck).toUpperCase(),
    deck.factions.join(" • "),
    ...(deck.tags ?? []),
  ]
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags
    .filter((tag, index) => tags.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index)
    .slice(0, 4);
}

function ChevronArrow() {
  return <svg className={styles.buttonArrow} viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8-8 8" /></svg>;
}

export function LobbyRoomScreen() {
  const router = useRouter();
  const {
    ready: appReady,
    match: appMatch,
    online: appOnline,
    playerId: appPlayerId,
    matchCapability: appMatchCapability,
    matchControllerId: appMatchControllerId,
    profile,
    settings,
    decks,
    setMatch,
    leaveMatch,
  } = useApp();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<BusyAction>("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!appReady || !appMatch) return;
    primeMatchStore({
      route: "lobby",
      match: appMatch,
      online: appOnline,
      playerId: appPlayerId,
      capability: appMatchCapability,
      controllerId: appMatchControllerId,
      settings,
    });
  }, [appMatch, appMatchCapability, appMatchControllerId, appOnline, appPlayerId, appReady, settings]);

  useMatchTransport();
  const room = useMatchSelector((state) => ({
    match: state.match,
    online: state.online,
    playerId: state.playerId,
    capability: state.capability,
  }));
  const match = room.match;
  const localPlayerId = room.playerId ?? "";
  const config = match ? lobbyConfig(match) : null;
  const ranked = match ? rankedSeries(match) : undefined;
  const myRanked = ranked?.players[localPlayerId];
  const opponentRanked = ranked ? Object.entries(ranked.players).find(([id]) => id !== localPlayerId)?.[1] : undefined;
  const messages = useMemo(() => chatEntries(match), [match]);
  const me = match?.players.find((player) => player.id === localPlayerId);
  const ownerId = match ? roomOwnerId(match) : "";
  const isOwner = Boolean(ownerId && ownerId === localPlayerId);
  const bothReady = Boolean(match && lobbyCanStart(match));
  const requiredFormat = config ? requiredDeckFormat(config.rulesFormat) : "standard";
  const playerDecks = decks as DeckRecord[];
  const compatibleDecks = playerDecks.filter((deck) => {
    const deckFormat = deck.format === "singleton" || deck.format === "competitive" ? deck.format : "standard";
    return deckFormat === requiredFormat && validateDeck(deck).isLegal;
  });
  const compatibleDeckIds = new Set(compatibleDecks.map((deck) => deck.id));
  const currentDeck = playerDecks.find((deck) => deckMatchesPlayer(deck, me)) ?? null;
  const currentDeckCards = currentDeck ? deckPreviewCards(currentDeck) : [];
  const currentDeckTags = currentDeck ? deckTags(currentDeck) : [];
  const myDeckFormatMatches = Boolean(me && playerLobbyDeckFormat(me) === requiredFormat);

  useEffect(() => {
    if (!match || match.phase === "lobby") return;
    if (rankedSeries(match)?.stage === "select") return;
    router.replace("/play/match");
  }, [match, match?.phase, router]);

  useEffect(() => {
    const element = chatScroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!deckPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDeckPickerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deckPickerOpen]);

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
          headers: matchCommandHeaders(current),
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
      let next = dispatchLocalGameAction(match, localPlayerId, "lobby-settings", { rulesFormat, meta: "battle-brawlers" });
      for (const command of trainingBotLobbyCommands(next)) {
        next = dispatchLocalGameCommand(next, "training-bot", command, localPlayerId);
      }
      publishLocal(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Lobby settings could not be changed.");
    } finally {
      setBusy("");
    }
  };

  const selectDeck = async (deckId: string) => {
    if (!match || !me) return;
    const deck = playerDecks.find((candidate) => candidate.id === deckId);
    if (!deck || !compatibleDeckIds.has(deck.id)) return;
    const playerAvatar = (me as PlayerState & { avatar?: string }).avatar ?? profile.avatar ?? "";
    const selection = canonicalSelection(localPlayerId, me.name, deck, playerAvatar);
    if (room.online) {
      const result = await sendRoomCommand("lobby-deck", undefined, "deck", selection);
      if (result) setDeckPickerOpen(false);
      return;
    }
    setBusy("deck");
    setError("");
    try {
      const replacement = tagLobbyPlayerDeck(makeCanonicalPlayer(selection), selection.deck);
      publishLocal(dispatchLocalGameAction(match, localPlayerId, "lobby-deck", { player: replacement }));
      setDeckPickerOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The deck could not be selected.");
    } finally {
      setBusy("");
    }
  };

  const banRankedDeck = async (deckId: string) => {
    await sendRoomCommand("ranked-ban", { deckId }, "ban");
  };

  const selectRankedRoundDeck = async (deckId: string) => {
    const next = await sendRoomCommand("ranked-select", { deckId }, "select");
    if (next && rankedSeries(next)?.stage === "playing") router.replace("/play/match");
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
      publishLocal(dispatchLocalGameAction(match, localPlayerId, "lobby-ready", { ready }));
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
      publishLocal(dispatchLocalGameAction(match, localPlayerId, "start-match"));
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
      publishLocal(dispatchLocalGameAction(match, localPlayerId, "chat", { message }));
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
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p>{config.mode.toUpperCase()} LOBBY</p>
          <h1>ROOM <strong>{match.code}</strong></h1>
          <div className={styles.heroMeta}>
            <span>{match.format === "bo3" ? "Best of Three" : "Best of One"}</span>
            <span>{formatLabel(config.rulesFormat)}</span>
            <span>Battle Brawlers</span>
          </div>
          <button className={styles.copyButton} type="button" onClick={() => void copyRoomCode()}>{copied ? "COPIED" : "COPY ROOM CODE"}</button>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <div className={styles.heroGrid} />
          <OriginalImage src="/assets/brawlers-group.png" alt="" />
        </div>
      </header>

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
                        disabled={!isOwner || busy === "settings" || rankedOnly || config.mode === "ranked"}
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
                const local = player?.id === localPlayerId;
                const playerIsOwner = index === 0;
                const deckName = player ? playerLobbyDeckName(player) : "";
                const storedAvatar = player ? (player as PlayerState & { avatar?: string }).avatar : "";
                return (
                  <article className={`${styles.seat} ${player?.ready ? styles.seatReady : ""}`} key={index}>
                    {player ? <>
                      <div className={styles.seatBadges}>
                        <Badge tone={local ? "gold" : "blue"}>{local ? "YOU" : player.id === "training-bot" ? "TRAINING AI" : "OPPONENT"}</Badge>
                        {playerIsOwner ? <Badge>LOBBY OWNER</Badge> : null}
                      </div>
                      <ProfileAvatar className={styles.avatar} profile={{ name: player.name, avatar: local ? profile.avatar : storedAvatar }} />
                      <h3>{ranked?.players[player.id]?.userId ? <PlayerPreview userId={ranked.players[player.id].userId} displayName={player.name} /> : player.name}</h3>
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

            {ranked ? <section className={styles.rankedPanel}>
              <header><div><span>RANKED SERIES · RULESET V{ranked.rulesetVersion}</span><h2>{ranked.stage === "ban" ? "Ban one opposing deck" : ranked.stage === "select" ? `Select your deck for game ${match.gameNumber + (match.phase === "result" ? 1 : 0)}` : ranked.stage === "ready" ? "Round decks locked" : ranked.stage === "complete" ? "Series complete" : "Three-deck Conquest"}</h2></div><Badge tone="gold">{ranked.stage.toUpperCase()}</Badge></header>
              {ranked.stage === "ban" && opponentRanked ? <>
                <p>Deck lists remain hidden. Your ban is revealed only after both Brawlers lock a choice.</p>
                <div className={styles.rankedDecks}>{opponentRanked.decks.map((deck) => <button type="button" key={deck.id} disabled={Boolean(myRanked?.bannedDeckId) || busy === "ban"} onClick={() => void banRankedDeck(deck.id)}>
                  <span className={styles.rankedCharacters}>{deckPreviewCards(deck).slice(0, 3).map((card) => <OriginalImage key={card.catalogId} src={cardArtSource(card, "thumbnail")} alt="" />)}</span>
                  <strong>{deck.name}</strong><small>{deck.factions.join(" • ")}</small>
                </button>)}</div>
                {myRanked?.bannedDeckId ? <p className={styles.rankedLocked}>BAN LOCKED · WAITING FOR OPPONENT</p> : null}
              </> : null}
              {ranked.stage === "select" ? <>
                <p>Choose simultaneously. A deck that has already won for you is no longer eligible; a losing deck may be selected again.</p>
                <div className={styles.rankedDecks}>{eligibleRankedDecks(match, localPlayerId).map((deck) => <button type="button" key={deck.id} disabled={Boolean(myRanked?.selectedDeckId) || busy === "select"} onClick={() => void selectRankedRoundDeck(deck.id)}>
                  <span className={styles.rankedCharacters}>{deckPreviewCards(deck).slice(0, 3).map((card) => <OriginalImage key={card.catalogId} src={cardArtSource(card, "thumbnail")} alt="" />)}</span>
                  <strong>{deck.name}</strong><small>{deck.factions.join(" • ")}</small>
                </button>)}</div>
                {myRanked?.selectedDeckId ? <p className={styles.rankedLocked}>DECK LOCKED · WAITING FOR OPPONENT</p> : null}
              </> : null}
              {ranked.stage === "ready" ? <p>Both round decks are locked. Complete the ready check, then the lobby owner starts game one.</p> : null}
            </section> : null}

            <section className={styles.loadoutPanel}>
              <div className={styles.loadoutHeading}>
                <div><span>YOUR DECK</span><h2>Battle loadout</h2></div>
                <button type="button" onClick={() => setDeckPickerOpen(true)} disabled={busy === "deck" || !me || Boolean(ranked)}>
                  <span>SELECT YOUR DECK</span><ChevronArrow />
                </button>
              </div>

              {currentDeck ? (
                <div className={styles.featuredDeckLayout}>
                  <div className={`${styles.featuredDeckStack} ${factionClass(currentDeck.factions[0] ?? "Pyrus")}`} aria-label={`Cards from ${currentDeck.name}`}>
                    {currentDeckCards.length ? currentDeckCards.map((card) => (
                      <div className={styles.featuredDeckCard} key={card.catalogId}>
                        <OriginalImage src={cardArtSource(card, "full")} alt={card.displayName} />
                      </div>
                    )) : <OriginalImage className={styles.featuredDeckPlaceholder} src="/assets/cards/card-missing.svg" alt="Deck artwork unavailable" />}
                  </div>
                  <div className={styles.featuredDeckCopy}>
                    <div className={styles.featuredDeckBadges}>
                      <Badge tone="gold">{deckSetName(currentDeck).toUpperCase()}</Badge>
                      <Badge>{currentDeck.factions.join(" • ")}</Badge>
                    </div>
                    <h3>{currentDeck.name}</h3>
                    {currentDeckTags.length ? <div className={styles.deckTags}>{currentDeckTags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                    <p>{formatLabel(config.rulesFormat)} requires a {requiredFormat === "singleton" ? "40-card Singleton" : requiredFormat === "competitive" ? "50-card Competitive" : "40-card Standard"} deck. Changing deck makes you unready.</p>
                  </div>
                </div>
              ) : (
                <div className={styles.noDeckPreview}>
                  <strong>SELECT A DECK</strong>
                  <p>Choose one of your decks for this lobby.</p>
                </div>
              )}

              {!myDeckFormatMatches ? <p className={styles.deckWarning}>Your current seat deck does not match this lobby format. Select a compatible deck before readying.</p> : null}
              {!compatibleDecks.length ? <Link className={styles.createDeckLink} href="/decks">CREATE A COMPATIBLE DECK</Link> : null}
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
                  disabled={!me || busy === "ready" || !myDeckFormatMatches || Boolean(ranked && ranked.stage !== "ready")}
                  onClick={() => void toggleReady()}
                >
                  {busy === "ready" ? "UPDATING…" : me?.ready ? "UNREADY" : "READY"}
                </button>
                {isOwner ? (
                  <button className={styles.startButton} type="button" disabled={!bothReady || busy === "start" || Boolean(ranked && ranked.stage !== "ready")} onClick={() => void startMatch()}>
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
              <article className={styles.message} data-local={message.playerId === localPlayerId ? "true" : "false"} key={message.id}>
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

      {deckPickerOpen ? (
        <div className={styles.deckPickerBackdrop} onMouseDown={() => setDeckPickerOpen(false)}>
          <section className={styles.deckPicker} role="dialog" aria-modal="true" aria-labelledby="deck-picker-heading" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span>YOUR DECKS</span><h2 id="deck-picker-heading">Select your deck</h2></div>
              <button type="button" aria-label="Close deck selection" onClick={() => setDeckPickerOpen(false)}>×</button>
            </header>
            <div className={styles.deckPickerGrid}>
              {playerDecks.map((deck) => {
                const lead = deckLeadCard(deck);
                const tags = deckTags(deck);
                const selectable = compatibleDeckIds.has(deck.id);
                const selectedDeck = currentDeck?.id === deck.id;
                return (
                  <button
                    type="button"
                    className={`${styles.deckChoice} ${selectedDeck ? styles.deckChoiceSelected : ""}`}
                    key={deck.id}
                    disabled={!selectable || busy === "deck"}
                    onClick={() => void selectDeck(deck.id)}
                    aria-label={`${selectable ? "Select" : "Unavailable"} ${deck.name}`}
                    title={selectable ? deck.name : `Requires a legal ${requiredFormat === "singleton" ? "Singleton" : requiredFormat === "competitive" ? "Competitive" : "Standard"} deck`}
                  >
                    <span className={styles.deckChoiceArt}>
                      <OriginalImage src={lead ? cardArtSource(lead, "full") : "/assets/cards/card-missing.svg"} alt={lead?.displayName ?? "Deck featured card unavailable"} />
                    </span>
                    <span className={styles.deckChoiceTags} aria-label={tags.length ? `Tags: ${tags.join(", ")}` : "No deck tags"}>
                      {tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </span>
                    <strong>{deck.name}</strong>
                    <span className={styles.deckChoiceDescription}>{deck.description?.trim() || "No description added."}</span>
                  </button>
                );
              })}
            </div>
            {!playerDecks.length ? <div className={styles.deckPickerEmpty}><strong>NO DECKS YET</strong><Link href="/decks">CREATE A DECK</Link></div> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
