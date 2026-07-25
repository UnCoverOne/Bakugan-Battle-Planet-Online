"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, Metric, PageHeader, deckLooksComplete } from "../application/ui";

export function PlayScreen() {
  const { format, setFormat, matchMode, setMatchMode, selectedDeck, decks, selectedDeckId, setSelectedDeckId, joinCode, setJoinCode, startSolo, createOnline, joinOnline, matchError } = useApp();
  return <>
    <PageHeader eyebrow="MATCH CONFIGURATION" title="CHOOSE THE BATTLE" copy="Lock a deck, match structure, and opponent path. Card definitions stay out of this route and load only when a match actually starts." art="/assets/pyrus.png" />
    <section className="setup-layout"><div className="panel setup-form"><div className="step-heading"><span>01</span><div><small>MATCH MODE</small><h2>WHO WILL YOU BRAWL?</h2></div></div><div className="choice-grid"><button className={matchMode === "solo" ? "active" : ""} onClick={() => setMatchMode("solo")}><strong>TRAINING AI</strong><span>Immediate full match</span></button><button className={matchMode === "online" ? "active" : ""} onClick={() => setMatchMode("online")}><strong>CREATE ONLINE ROOM</strong><span>Share a six-character code</span></button><button className={matchMode === "join" ? "active" : ""} onClick={() => setMatchMode("join")}><strong>JOIN ROOM</strong><span>Enter an opponent code</span></button></div>
      <div className="step-heading"><span>02</span><div><small>MATCH STRUCTURE</small><h2>HOW MANY GAMES?</h2></div></div><div className="format-toggle"><button className={format === "bo1" ? "active" : ""} onClick={() => setFormat("bo1")}><b>BO1</b><strong>BEST OF ONE</strong><span>First game wins the match</span></button><button className={format === "bo3" ? "active" : ""} onClick={() => setFormat("bo3")}><b>BO3</b><strong>BEST OF THREE</strong><span>First to two game wins</span></button></div>
      <div className="step-heading"><span>03</span><div><small>LOCKED DECK</small><h2>SELECT YOUR ARSENAL</h2></div></div>{decks.length ? <select className="deck-select" value={selectedDeckId || selectedDeck?.id} onChange={(event) => setSelectedDeckId(event.target.value)}>{decks.map((deck: any) => <option value={deck.id} key={deck.id}>{deck.name} — {deckLooksComplete(deck) ? "COMPLETE" : "DRAFT"}</option>)}</select> : <div className="storage-callout"><strong>NO DECKS AVAILABLE</strong><span>Open the Deck Library to restore starter decks or create a draft.</span><Link href="/decks">OPEN DECK LIBRARY →</Link></div>}
      {matchMode === "join" && <label className="join-code">ROOM CODE<input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={6} placeholder="BP7K3M" /></label>}{matchError && <p className="error-message" role="alert">{matchError}</p>}
      <AppButton tone="red" disabled={!selectedDeck || !deckLooksComplete(selectedDeck) || (matchMode === "join" && joinCode.length < 5)} onClick={() => void (matchMode === "solo" ? startSolo() : matchMode === "online" ? createOnline() : joinOnline())}>{matchMode === "solo" ? "START TRAINING MATCH" : matchMode === "online" ? "CREATE ONLINE ROOM" : "JOIN ONLINE ROOM"}</AppButton></div>
      <aside className="panel match-preview"><span className="eyebrow">MATCH PREVIEW</span><h2>{format === "bo1" ? "BEST OF ONE" : "BEST OF THREE"}</h2><div className="preview-deck"><img src="/assets/brawlers-group.png" alt="" /><strong>{selectedDeck?.name ?? "No deck selected"}</strong><Badge tone={deckLooksComplete(selectedDeck) ? "gold" : "red"}>{deckLooksComplete(selectedDeck) ? "COMPLETE" : "DRAFT"}</Badge></div><ul><li>Original Battle Planet ruleset</li><li>Alternating twelve-Core placement</li><li>Secret targets and server RNG</li><li>Complexity-based priority timers</li><li>30-second reconnect grace</li><li>Gameplay bundle loads on match entry</li></ul></aside></section>
  </>;
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
    router.push(`/history/${encodeURIComponent(item.id)}`);
  };
  return <section className={`result-page ${won ? "victory" : "defeat"}`}><img className="result-art" src="/assets/winner.png" alt="" /><div className="result-content"><Badge tone={won ? "gold" : "red"}>{complete ? "MATCH COMPLETE" : "SERIES INTERMISSION"}</Badge><h1>{won ? "VICTOR" : "DEFEAT"}</h1><p>{match.resultReason}</p><div className="series-score">{match.players.map((player: any) => <div key={player.id}><strong>{player.name}</strong><span>{match.series[player.id] ?? 0}</span></div>)}</div><div className="result-stats"><Metric label="Game" value={`${match.gameNumber}`} /><Metric label="Format" value={match.format.toUpperCase()} /><Metric label="Events" value={match.log.length} /><Metric label="Random results" value={match.log.filter((event: any) => event.kind === "random").length} /></div><div className="result-actions">{!complete && <AppButton tone="red" onClick={() => void nextSeriesGame()}>NEXT GAME • NEW MATRIX</AppButton>}<AppButton tone="gold" onClick={openReplay}>VIEW REPLAY</AppButton><AppButton tone="ghost" onClick={leaveMatch}>DASHBOARD</AppButton></div><small>Result stored in Match History • {history[0]?.at}</small></div></section>;
}

function Empty({ title }: { title: string }) {
  return <section className="empty-page"><img src="/assets/logo.png" alt="" /><h1>{title}</h1><p>Return to the dashboard and start a new match.</p><Link className="hex-button ghost" href="/dashboard">DASHBOARD</Link></section>;
}
