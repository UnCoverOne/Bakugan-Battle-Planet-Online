"use client";

import { useRouter } from "next/navigation";
import { useApp } from "../application/AppProvider";
import { AppButton, Badge, Metric, PageHeader, deckLooksComplete, factionClass } from "../application/ui";

export function ProfileScreen() {
  const router = useRouter();
  const { profile, setProfile, history, decks, authUser, saveAccountProfile, notify } = useApp();
  return <>
    <PageHeader eyebrow="BRAWLER IDENTITY" title={profile.name.toUpperCase()} copy="Manage the public information other Brawlers see in challenges, rooms, and shared records." art={`/assets/${profile.faction.toLowerCase() === "aurelus" ? "brawlers-group" : profile.faction.toLowerCase()}.png`} />
    <section className="profile-layout"><article className="panel profile-card"><div className={`large-avatar ${factionClass(profile.faction)}`}>{profile.name.slice(0, 2).toUpperCase()}</div><Badge tone={authUser ? "gold" : "blue"}>{authUser ? "CLOUD ACCOUNT" : "LOCAL PROFILE"}</Badge>{authUser && <small className="account-email">{authUser.email}</small>}<label>DISPLAY NAME<input value={profile.name} maxLength={20} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label><label>PREFERRED FACTION<select value={profile.faction} onChange={(event) => setProfile({ ...profile, faction: event.target.value })}>{["Pyrus", "Aquos", "Darkus", "Haos", "Ventus", "Aurelus"].map((faction) => <option key={faction}>{faction}</option>)}</select></label><AppButton tone="red" onClick={() => void saveAccountProfile().catch((error: Error) => notify(error.message || "Could not save profile."))}>SAVE PROFILE</AppButton><small>{authUser ? "Profile changes sync to signed-in devices." : "Profile changes are retained in this browser."}</small></article><article className="panel profile-stats"><span className="eyebrow">BRAWLER RECORD</span><h2>ORIGINAL BATTLE PLANET</h2><div className="stat-grid"><Metric label="Matches" value={history.length} /><Metric label="Victories" value={history.filter((item: any) => item.result === "Victor").length} /><Metric label="Complete decks" value={decks.filter(deckLooksComplete).length} /><Metric label="Public decks" value={decks.filter((deck: any) => deck.visibility === "Public").length} /></div><h3>PUBLIC DECKS</h3>{decks.filter((deck: any) => deck.visibility === "Public").map((deck: any) => <button className="public-deck" key={deck.id} onClick={() => router.push(`/decks/${encodeURIComponent(deck.id)}`)} aria-label={`Open public deck ${deck.name}`}><strong>{deck.name}</strong><span>{deck.factions.join(" • ")}</span><Badge tone={deckLooksComplete(deck) ? "gold" : "red"}>{deckLooksComplete(deck) ? "COMPLETE" : "DRAFT"}</Badge></button>)}</article></section>
  </>;
}
