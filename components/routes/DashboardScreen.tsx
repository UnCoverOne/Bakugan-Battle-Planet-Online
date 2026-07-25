"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, PageHeader, deckLooksComplete } from "../application/ui";

export function DashboardScreen() {
  const router = useRouter();
  const { profile, decks, history, match, setSelectedDeckId, setReplay, setReplayIndex } = useApp();
  const legal = decks.filter(deckLooksComplete);
  const openReplay = (id: string) => {
    const record = history.find((item: { id: string }) => item.id === id);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
    router.push(`/history/${encodeURIComponent(record.id)}`);
  };
  return <>
    <PageHeader eyebrow={`WELCOME BACK, ${profile.name.toUpperCase()}`} title="BRAWLER COMMAND" copy="Your next Brawl, complete decks, and recent results—one decision away." art="/assets/brawlers-group.png" actions={<><Link className="hex-button red" href="/play">PLAY NOW</Link><Link className="hex-button ghost" href="/builder/new">BUILD A DECK</Link></>} />
    {match && match.phase !== "result" && <section className="alert-strip"><div><span className="pulse" /><strong>ACTIVE MATCH</strong><p>{match.code} • {match.stepLabel}</p></div><Link className="hex-button blue" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}>RESUME</Link></section>}
    <section className="dashboard-grid">
      <article className="panel play-panel"><span className="panel-index">01</span><h2>READY TO BRAWL?</h2><p>{legal.length} complete decks available • BO1 and BO3 enabled</p><div className="team-silhouette"><img src="/assets/pyrus.png" alt="" /><img src="/assets/aquos.png" alt="" /><img src="/assets/darkus.png" alt="" /></div><Link className="hex-button red" href="/play">CHOOSE THE BATTLE</Link></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">RECENT DECKS</span><h2>YOUR ARSENAL</h2></div><Link href="/decks">VIEW ALL →</Link></div><div className="mini-decks">{decks.slice(0, 3).map((deck: any) => <button key={deck.id} onClick={() => { setSelectedDeckId(deck.id); router.push(`/builder/${encodeURIComponent(deck.id)}`); }}><span className={`faction-${(deck.factions[0] ?? "Pyrus").toLowerCase()}`} /><strong>{deck.name}</strong><small>{deck.cardIds.length} cards • {deckLooksComplete(deck) ? "COMPLETE" : "DRAFT"}</small></button>)}</div>{!decks.length && <div className="empty-state"><strong>NO DECKS YET</strong><p>Open the Deck Library to restore starter decks, or create a fresh draft.</p><AppButton tone="ghost" onClick={() => router.push("/builder/new")}>CREATE A DECK</AppButton></div>}</article>
      <article className="panel results-panel"><div className="panel-heading"><div><span className="eyebrow">MATCH ARCHIVE</span><h2>RECENT RESULTS</h2></div><Link href="/history">OPEN HISTORY →</Link></div>{history.length ? history.slice(0, 4).map((item: any) => <button className="result-row" key={item.id} onClick={() => openReplay(item.id)} aria-label={`Open replay: ${item.result} against ${item.opponent}`}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><span>vs {item.opponent}</span><strong>{item.score}</strong><small>{item.reason}</small></button>) : <div className="empty-state"><strong>NO MATCHES RECORDED</strong><p>Your completed Brawls and replays will appear here.</p><Link className="hex-button ghost" href="/play">START A TRAINING MATCH</Link></div>}</article>
      <article className="panel ruling-panel"><span className="eyebrow">LATEST PLATFORM RULING</span><h2>ROLL CALCULATION IS PUBLIC</h2><p>Accuracy, Double Core, adjacency weighting, and four-Core rotation results are published in the match log after resolution.</p><Link href="/compendium/rulings/second-core-adjacency-weighting">OPEN RULING →</Link></article>
    </section>
  </>;
}
