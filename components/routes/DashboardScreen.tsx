"use client";

import Link from "next/link";
import { achievementsFor } from "../../lib/achievements";
import { PUBLIC_DECKS, deckLeadCard, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { useApp } from "../application/AppProvider";
import { Badge, Metric, PageHeader, deckLooksComplete, factionClass } from "../application/ui";

export function DashboardScreen() {
  const { profile, decks, history, match } = useApp();
  const achievements = achievementsFor(decks, history);
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const nextAchievements = achievements.filter((achievement) => !achievement.unlocked).slice(0, 2);
  const wins = history.filter((item: { result?: string }) => item.result === "Victor").length;
  const winRate = history.length ? Math.round((wins / history.length) * 100) : 0;
  const completeDecks = decks.filter(deckLooksComplete);
  const publicDecks = [
    ...decks.filter((deck: DeckRecord) => deck.visibility === "Public").map((deck: DeckRecord) => ({ ...deck, creator: profile.name, publishedAt: deck.publishedAt ?? deck.updatedAt })),
    ...PUBLIC_DECKS,
  ].sort((a, b) => Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt));
  const featured = publicDecks[0];
  const featuredLead = featured ? deckLeadCard(featured) : undefined;

  return <>
    <PageHeader
      eyebrow={`WELCOME BACK, ${profile.name.toUpperCase()}`}
      title="BRAWLER COMMAND"
      copy="Build your arsenal, track your progress, and enter the next Bakugan Brawl."
      art="/assets/brawlers-group.png"
      actions={<><Link className="hex-button red" href="/play">PLAY</Link><Link className="hex-button ghost" href="/decks">DECKS</Link></>}
    />
    {match && match.phase !== "result" && <section className="active-match-card">
      <div><span className="pulse"/><span className="eyebrow">ACTIVE MATCH</span><h2>{match.code ? `Room ${match.code}` : "Battle in progress"}</h2><p>{match.stepLabel ?? "Return to your current Brawl."}</p></div>
      <Link className="hex-button blue" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}>RESUME MATCH</Link>
    </section>}

    <section className="home-engagement-grid">
      <article className="panel achievement-preview">
        <div className="panel-heading"><div><span className="eyebrow">ACHIEVEMENTS</span><h2>{unlocked.length} UNLOCKED</h2></div><Link href="/profile/achievements">VIEW ALL →</Link></div>
        <div className="achievement-progress-ring" aria-label={`${unlocked.length} of ${achievements.length} achievements unlocked`}><strong>{unlocked.length}</strong><span>of {achievements.length}</span></div>
        <div className="achievement-preview-list">
          {nextAchievements.length ? nextAchievements.map((achievement) => <div key={achievement.id}><span>{achievement.name}</span><progress max={achievement.target} value={achievement.current}/><small>{achievement.current} / {achievement.target}</small></div>) : <p>Every current achievement is unlocked.</p>}
        </div>
      </article>

      <article className="panel home-stats">
        <div className="panel-heading"><div><span className="eyebrow">BRAWLER STATS</span><h2>YOUR RECORD</h2></div><Link href="/profile">VIEW PROFILE →</Link></div>
        <div className="home-stat-grid">
          <Metric label="Games played" value={history.length}/>
          <Metric label="Games won" value={wins}/>
          <Metric label="Win rate" value={`${winRate}%`}/>
          <Metric label="Complete decks" value={completeDecks.length}/>
        </div>
        <p className="home-stat-note">{completeDecks[0] ? `${completeDecks[0].name} is ready for your next match.` : "Complete a deck to unlock the full Play setup."}</p>
      </article>

      <article className="panel newest-public-deck">
        <div className="panel-heading"><div><span className="eyebrow">NEWEST PUBLIC DECK</span><h2>COMMUNITY SPOTLIGHT</h2></div><Link href="/decks/public">BROWSE PUBLIC DECKS →</Link></div>
        {featured ? <div className="featured-public-deck">
          <div className={`featured-public-art ${factionClass(featured.factions[0] ?? "Pyrus")}`}>
            {featuredLead && <img src={cardArtSource(featuredLead, "thumbnail")} alt={`${featuredLead.displayName}, lead card for ${featured.name}`}/>}
          </div>
          <div><div className="hero-actions"><Badge tone="gold">{deckLooksComplete(featured) ? "LEGAL" : "DRAFT"}</Badge><Badge>{featured.factions.join(" • ")}</Badge></div><h3>{featured.name}</h3><p>by {featured.creator ?? "Community Brawler"}</p><p>{featured.description ?? "A public Battle Planet deck ready to explore and copy."}</p><Link className="hex-button ghost" href={`/decks/public/${encodeURIComponent(featured.id)}`}>VIEW DECK</Link></div>
        </div> : <div className="empty-state"><strong>NO PUBLIC DECKS YET</strong><p>Publish a deck from My Decks to feature it here.</p></div>}
      </article>
    </section>
  </>;
}
