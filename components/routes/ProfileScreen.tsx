"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { deckLeadCard, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, Metric, copyText, deckLooksComplete, factionClass, formatTimestamp } from "../application/ui";

export function ProfileScreen({ segments = [] }: { segments?: string[] }) {
  const router = useRouter();
  const { profile, setProfile, history, decks, authUser, saveAccountProfile, notify, replay, setReplay, replayIndex, setReplayIndex } = useApp();
  const section = segments[0] === "achievements" ? "achievements" : segments[0] === "records" ? "records" : "overview";
  const recordId = section === "records" ? decodeURIComponent(segments[1] ?? "") : "";
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(profile.name);
  const [draftFaction, setDraftFaction] = useState(profile.faction);
  const [achievementFilter, setAchievementFilter] = useState("All");
  const [recordFilter, setRecordFilter] = useState("all");
  const achievements = achievementsFor(decks, history);
  const wins = history.filter((item: any) => item.result === "Victor").length;
  const publicDecks = decks.filter((deck: DeckRecord) => deck.visibility === "Public");

  useEffect(() => {
    if (!recordId) return;
    const record = history.find((item: any) => item.id === recordId);
    if (!record) return;
    setReplay(record);
    setReplayIndex(Math.max(0, record.log.length - 1));
  }, [history, recordId, setReplay, setReplayIndex]);

  const activeRecord = recordId ? history.find((item: any) => item.id === recordId) ?? replay : null;
  const saveProfile = async () => {
    setProfile({ ...profile, name: draftName.trim() || profile.name, faction: draftFaction });
    try { await saveAccountProfile(); } catch (error) { notify(error instanceof Error ? error.message : "Could not save profile."); }
    setEditing(false);
  };

  return <>
    <section className="profile-banner"><div className={`profile-banner-avatar ${factionClass(profile.faction)}`}>{profile.name.slice(0, 2).toUpperCase()}</div><div><span className="eyebrow">BRAWLER PROFILE</span><h1>{profile.name}</h1><p>{profile.faction} Brawler · {authUser ? "Cloud account" : "Local profile"}</p></div>{section === "overview" && <AppButton tone="ghost" onClick={() => { setDraftName(profile.name); setDraftFaction(profile.faction); setEditing(true); }}>EDIT PROFILE</AppButton>}</section>
    <nav className="profile-tabs" aria-label="Profile sections"><Link className={section === "overview" ? "active" : ""} href="/profile">Overview</Link><Link className={section === "achievements" ? "active" : ""} href="/profile/achievements">Achievements</Link><Link className={section === "records" ? "active" : ""} href="/profile/records">Match Records</Link></nav>

    {section === "overview" && <section className="profile-overview-grid"><article className="panel profile-summary"><div className="panel-heading"><div><span className="eyebrow">PLAYER SUMMARY</span><h2>Battle Planet record</h2></div><Badge tone={authUser ? "gold" : "blue"}>{authUser ? "CLOUD" : "LOCAL"}</Badge></div><div className="profile-metric-grid"><Metric label="Games played" value={history.length}/><Metric label="Games won" value={wins}/><Metric label="Win rate" value={`${history.length ? Math.round((wins / history.length) * 100) : 0}%`}/><Metric label="Achievements" value={achievements.filter((achievement) => achievement.unlocked).length}/></div><div className="profile-quick-links"><Link href="/profile/achievements">View achievements →</Link><Link href="/profile/records">Open match records →</Link></div></article><article className="panel profile-public-decks"><div className="panel-heading"><div><span className="eyebrow">PUBLIC DECKS</span><h2>{publicDecks.length} published</h2></div><Link href="/decks/public">BROWSE LIBRARY →</Link></div>{publicDecks.length ? publicDecks.map((deck) => { const lead = deckLeadCard(deck); return <Link className="profile-deck-row" key={deck.id} href={`/decks/${encodeURIComponent(deck.id)}`}>{lead ? <img src={cardArtSource(lead, "thumbnail")} alt=""/> : <img src="/assets/cards/card-missing.svg" alt=""/>}<div><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span></div><Badge tone={deckLooksComplete(deck) ? "gold" : "red"}>{deckLooksComplete(deck) ? "LEGAL" : "DRAFT"}</Badge></Link>; }) : <div className="empty-state"><strong>NO PUBLIC DECKS</strong><p>Set a deck’s visibility to Public in the Deck Builder to publish it.</p><Link className="hex-button ghost" href="/decks">OPEN MY DECKS</Link></div>}</article></section>}

    {section === "achievements" && <AchievementsPanel achievements={achievements} filter={achievementFilter} setFilter={setAchievementFilter}/>}
    {section === "records" && <RecordsPanel history={history} activeRecord={activeRecord} replayIndex={replayIndex} setReplayIndex={setReplayIndex} filter={recordFilter} setFilter={setRecordFilter} router={router}/>}

    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}><section className="profile-edit-modal panel" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title"><h2 id="edit-profile-title">Edit profile</h2><label>Display name<input value={draftName} maxLength={20} onChange={(event) => setDraftName(event.target.value)}/></label><label>Preferred faction<select value={draftFaction} onChange={(event) => setDraftFaction(event.target.value)}>{["Pyrus","Aquos","Darkus","Haos","Ventus","Aurelus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label><div className="hero-actions"><AppButton tone="red" onClick={() => void saveProfile()}>SAVE PROFILE</AppButton><AppButton tone="ghost" onClick={() => setEditing(false)}>CANCEL</AppButton></div></section></div>}
  </>;
}

function AchievementsPanel({ achievements, filter, setFilter }: { achievements: ReturnType<typeof achievementsFor>; filter: string; setFilter: (value: string) => void }) {
  const visible = achievements.filter((achievement) => filter === "All" || (filter === "Unlocked" ? achievement.unlocked : filter === "In progress" ? !achievement.unlocked && achievement.current > 0 : !achievement.unlocked && achievement.current === 0));
  return <section className="profile-section"><header className="section-toolbar"><div><span className="eyebrow">PROGRESSION</span><h2>Achievements</h2></div><label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All</option><option>Unlocked</option><option>In progress</option><option>Locked</option></select></label></header><div className="achievement-grid">{visible.map((achievement) => <article className={`panel achievement-card ${achievement.unlocked ? "unlocked" : ""}`} key={achievement.id}><div className="achievement-icon">{achievement.unlocked ? "✓" : "◇"}</div><Badge tone={achievement.unlocked ? "gold" : "blue"}>{achievement.category}</Badge><h3>{achievement.name}</h3><p>{achievement.description}</p><progress max={achievement.target} value={achievement.current}/><small>{achievement.unlocked ? "Unlocked" : `${achievement.current} / ${achievement.target}`}</small></article>)}</div></section>;
}

function RecordsPanel({ history, activeRecord, replayIndex, setReplayIndex, filter, setFilter, router }: any) {
  if (activeRecord) return <section className="record-detail-page"><header><button onClick={() => router.push("/profile/records")}>← MATCH RECORDS</button><div><span className="eyebrow">RECORD {activeRecord.id}</span><h2>{activeRecord.result} vs {activeRecord.opponent}</h2><p>{formatTimestamp(activeRecord.at)} · {(activeRecord.format ?? "unknown").toUpperCase()} · {activeRecord.mode ?? "legacy"}</p></div><AppButton tone="ghost" onClick={() => void copyText(window.location.href)}>COPY LINK</AppButton></header><div className="record-detail-layout"><aside className="panel record-event-list" aria-label="Match events">{activeRecord.log.map((event: any, index: number) => <button className={index === replayIndex ? "active" : ""} key={event.id} onClick={() => setReplayIndex(index)}><span>{index + 1}</span><div><strong>{event.kind}</strong><p>{event.message}</p></div></button>)}</aside><article className="panel record-event-focus"><Badge tone={activeRecord.log[replayIndex]?.kind === "random" ? "gold" : "blue"}>{activeRecord.log[replayIndex]?.kind?.toUpperCase()}</Badge><h2>{activeRecord.log[replayIndex]?.message}</h2><p>{new Date(activeRecord.log[replayIndex]?.at ?? 0).toLocaleTimeString()}</p><div className="record-controls"><button onClick={() => setReplayIndex(Math.max(0, replayIndex - 1))}>← Previous</button><span>{replayIndex + 1} / {activeRecord.log.length}</span><button onClick={() => setReplayIndex(Math.min(activeRecord.log.length - 1, replayIndex + 1))}>Next →</button></div></article><aside className="panel record-metadata"><h2>Match details</h2><dl><div><dt>Result</dt><dd>{activeRecord.result}</dd></div><div><dt>Score</dt><dd>{activeRecord.score}</dd></div><div><dt>Reason</dt><dd>{activeRecord.reason}</dd></div><div><dt>Events</dt><dd>{activeRecord.log.length}</dd></div></dl></aside></div></section>;
  const visible = history.filter((item: any) => filter === "all" || item.result.toLowerCase() === filter || item.mode === filter || item.format === filter);
  const wins = history.filter((item: any) => item.result === "Victor").length;
  return <section className="profile-section"><div className="record-summary"><Metric label="Matches" value={history.length}/><Metric label="Wins" value={wins}/><Metric label="Losses" value={Math.max(0, history.length - wins)}/><Metric label="Win rate" value={`${history.length ? Math.round((wins / history.length) * 100) : 0}%`}/></div><header className="section-toolbar"><div><span className="eyebrow">MATCH ARCHIVE</span><h2>Match Records</h2></div><label>Filter<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All records</option><option value="victor">Victories</option><option value="defeat">Defeats</option><option value="training">Training</option><option value="online">Online</option><option value="bo1">Best of one</option><option value="bo3">Best of three</option></select></label></header><div className="panel record-table"><div className="record-table-head"><span>Result</span><span>Opponent</span><span>Score</span><span>Mode</span><span>Date</span><span></span></div>{visible.length ? visible.map((item: any) => <button className="record-table-row" key={item.id} onClick={() => router.push(`/profile/records/${encodeURIComponent(item.id)}`)}><Badge tone={item.result === "Victor" ? "gold" : "red"}>{item.result}</Badge><strong>{item.opponent}</strong><span>{item.score}</span><span>{item.mode ?? "legacy"}</span><small>{formatTimestamp(item.at)}</small><i>OPEN →</i></button>) : <div className="empty-state"><strong>NO MATCH RECORDS</strong><p>Complete a training or online match to create a record.</p><Link className="hex-button red" href="/play">PLAY A MATCH</Link></div>}</div></section>;
}
