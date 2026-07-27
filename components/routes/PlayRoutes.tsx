"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { deckLeadCard } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
import { AppButton, Badge, Metric, PageHeader, deckLooksComplete } from "../application/ui";
import { ActionButton, CardGrid, Field, RouteHero, StatusChip, Surface } from "../design-system/primitives";
import styles from "./PlayRoutes.module.css";

export function PlayScreen() {
  const { format, setFormat, matchMode, setMatchMode, selectedDeck, decks, selectedDeckId, setSelectedDeckId, joinCode, setJoinCode, startSolo, createOnline, joinOnline, matchError } = useApp();
  const legalDecks = decks.filter(deckLooksComplete);
  const chosenLead = selectedDeck ? deckLeadCard(selectedDeck) : undefined;
  const begin = () => void (matchMode === "solo" ? startSolo() : matchMode === "online" ? createOnline() : joinOnline());
  return <div className={styles.route}>
    <RouteHero eyebrow="MATCH SETUP" title="Choose the battle" description="Select a mode, a legal deck, and the match structure." />
    <section className={`play-setup-v2 ${styles.setup}`}>
      <Surface className={`panel play-setup-main ${styles.main}`}>
        <section className="setup-section"><div className="section-number">1</div><div><h2>Match mode</h2><p>Choose how you want to enter the Brawl.</p></div></section>
        <div className="mode-card-grid">
          <button className={matchMode === "solo" ? "active" : ""} onClick={() => setMatchMode("solo")}><strong>Training</strong><span>Play a full match against the AI.</span></button>
          <button className={matchMode === "online" ? "active" : ""} onClick={() => setMatchMode("online")}><strong>Create room</strong><span>Start a private online room and share its code.</span></button>
          <button className={matchMode === "join" ? "active" : ""} onClick={() => setMatchMode("join")}><strong>Join room</strong><span>Enter a code from another Brawler.</span></button>
        </div>

        <section className="setup-section"><div className="section-number">2</div><div><h2>Select your deck</h2><p>Decks are represented by the Lead card selected in the Deck Builder.</p></div></section>
        {decks.length ? <CardGrid className={`play-deck-grid ${styles.deckGrid}`} minCardWidth="18rem">{decks.map((deck: any) => {
          const lead = deckLeadCard(deck);
          const legal = deckLooksComplete(deck);
          const active = (selectedDeckId || selectedDeck?.id) === deck.id;
          return <button key={deck.id} disabled={!legal} className={`${active ? "active" : ""} ${!legal ? "disabled" : ""}`} onClick={() => setSelectedDeckId(deck.id)}>
            <div className="play-deck-art">{lead ? <img src={cardArtSource(lead, "full")} loading="lazy" decoding="async" alt={`${lead.displayName}, lead card for ${deck.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="No Lead card selected"/>}</div>
            <div><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span><StatusChip tone="info">{deckSetName(deck).toUpperCase()}</StatusChip><StatusChip tone={legal ? "success" : "danger"}>{legal ? "LEGAL" : "DRAFT"}</StatusChip></div>
          </button>;
        })}</CardGrid> : <div className="storage-callout"><strong>NO DECKS AVAILABLE</strong><span>Create or restore a deck before starting a match.</span><Link href="/decks">OPEN MY DECKS →</Link></div>}

        <section className="setup-section"><div className="section-number">3</div><div><h2>Match format</h2><p>Choose the number of games in the match.</p></div></section>
        <div className="format-toggle modern"><button className={format === "bo1" ? "active" : ""} onClick={() => setFormat("bo1")}><b>BO1</b><strong>Best of one</strong><span>First game wins the match.</span></button><button className={format === "bo3" ? "active" : ""} onClick={() => setFormat("bo3")}><b>BO3</b><strong>Best of three</strong><span>First to two game wins.</span></button></div>
        {matchMode === "join" && <Field className={`join-code modern ${styles.roomCode}`} label="Room code"><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} placeholder="BP7K3M" /></Field>}
        {matchError && <p className="error-message" role="alert">{matchError}</p>}
      </Surface>
      <Surface as="aside" className={`panel play-confirmation ${styles.confirmation}`} elevation="overlay">
        <span className="eyebrow">READY CHECK</span>
        <div className="confirmation-lead">{chosenLead ? <img src={cardArtSource(chosenLead, "full")} decoding="async" alt=""/> : <img src="/assets/cards/card-missing.svg" alt=""/>}</div>
        <h2>{selectedDeck?.name ?? "Select a deck"}</h2>
        {selectedDeck && <StatusChip tone="info">{deckSetName(selectedDeck).toUpperCase()}</StatusChip>}
        <dl><div><dt>Mode</dt><dd>{matchMode === "solo" ? "Training" : matchMode === "online" ? "Create online room" : "Join online room"}</dd></div><div><dt>Format</dt><dd>{format === "bo1" ? "Best of one" : "Best of three"}</dd></div><div><dt>Legal decks</dt><dd>{legalDecks.length}</dd></div></dl>
        <details><summary>Match rules</summary><ul><li>Original Battle Planet ruleset</li><li>Alternating twelve-Core placement</li><li>Server-authoritative random outcomes</li><li>30-second reconnect grace online</li></ul></details>
        <ActionButton disabled={!selectedDeck || !deckLooksComplete(selectedDeck) || (matchMode === "join" && joinCode.length < 5)} onClick={begin}>{matchMode === "solo" ? "START TRAINING MATCH" : matchMode === "online" ? "CREATE ONLINE ROOM" : "JOIN ONLINE ROOM"}</ActionButton>
      </Surface>
    </section>
  </div>;
}

export function LobbyScreen() {
  const { match, playerId, matchError, readyMatch, leaveMatch } = useApp();
  if (!match) return <Empty title="NO ACTIVE ROOM" />;
  return <>
    <PageHeader eyebrow="PRIVATE MATCH ROOM" title={`ROOM ${match.code}`} copy={`${match.format.toUpperCase()} • Original Battle Planet • Server-authoritative`} art="/assets/brawlers-group.png" actions={<AppButton tone="ghost" onClick={() => navigator.clipboard?.writeText(match.code)}>COPY ROOM CODE</AppButton>} />
    <section className="lobby-grid">{[0, 1].map((index) => { const player = match.players[index]; return <article className={`player-seat panel ${player?.ready ? "ready" : ""}`} key={index}>{player ? <><Badge tone={player.id === playerId ? "gold" : "blue"}>{player.id === playerId ? "YOU" : "OPPONENT"}</Badge><div className="seat-avatar">{player.name.slice(0, 2).toUpperCase()}</div><h2>{player.name}</h2><p>{player.bakugan.map((bakugan: any) => bakugan.name).join(" • ")}</p><div className="ready-status"><span className={player.ready ? "online" : "waiting"} />{player.ready ? "DECK LOCKED • READY" : "VALIDATING DECK…"}</div>{player.id === playerId && !player.ready && <AppButton tone="red" onClick={() => void readyMatch()}>LOCK IN & READY</AppButton>}</> : <><div className="seat-avatar waiting">?</div><h2>WAITING FOR BRAWLER</h2><p>Share room code <strong>{match.code}</strong></p><div className="loading-bar" /></>}</article>; })}</section>
    <section className="lobby-rules panel"><div><span className="eyebrow">ROOM FORMAT</span><h2>{match.format === "bo3" ? "BEST OF THREE" : "BEST OF ONE"}</h2></div><div><span className="eyebrow">TIME PROFILE</span><h2>ADAPTIVE</h2><p>20–45 seconds by complexity</p></div><div><span className="eyebrow">RECONNECT</span><h2>00:30</h2><p>Then opponent wins</p></div><AppButton tone="ghost" onClick={leaveMatch}>LEAVE ROOM</AppButton></section>{matchError && <p className="error-message centered">{matchError}</p>}
  </>;
}

export function MatchHostScreen() {
  return <div className="gameplay-match-host" aria-label="Tabletop gameplay client" />;
}

export function ResultScreen() {
  const router = useRouter();
  const { match, playerId, history, nextSeriesGame, leaveMatch, replay, setReplay, setReplayIndex } = useApp();
  if (!match) return <Empty title="NO RESULT" />;
  const won = match.winner === playerId;
  const needed = match.format === "bo3" ? 2 : 1;
  const complete = Math.max(...Object.values(match.series).map(Number)) >= needed;
  const openReplay = () => {
    const item = replay ?? history.find((record: any) => record.id === `${match.id}-${match.gameNumber}`) ?? history[0];
    if (!item) return;
    setReplay(item);
    setReplayIndex(Math.max(0, item.log.length - 1));
    router.push(`/profile/records/${encodeURIComponent(item.id)}`);
  };
  return <section className={`result-page ${won ? "victory" : "defeat"}`}><img className="result-art" src="/assets/winner.png" alt="" /><div className="result-content"><Badge tone={won ? "gold" : "red"}>{complete ? "MATCH COMPLETE" : "SERIES INTERMISSION"}</Badge><h1>{won ? "VICTOR" : "DEFEAT"}</h1><p>{match.resultReason}</p><div className="series-score">{match.players.map((player: any) => <div key={player.id}><strong>{player.name}</strong><span>{match.series[player.id] ?? 0}</span></div>)}</div><div className="result-stats"><Metric label="Game" value={`${match.gameNumber}`} /><Metric label="Format" value={match.format.toUpperCase()} /><Metric label="Events" value={match.log.length} /><Metric label="Random results" value={match.log.filter((event: any) => event.kind === "random").length} /></div><div className="result-actions">{!complete && <AppButton tone="red" onClick={() => void nextSeriesGame()}>NEXT GAME • NEW MATRIX</AppButton>}<AppButton tone="gold" onClick={openReplay}>VIEW MATCH RECORD</AppButton><AppButton tone="ghost" onClick={leaveMatch}>DASHBOARD</AppButton></div><small>Result stored in Match Records • {history[0]?.at}</small></div></section>;
}

function Empty({ title }: { title: string }) {
  return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p><Link className="hex-button ghost" href="/dashboard">DASHBOARD</Link></section>;
}
