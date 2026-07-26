"use client";

import Link from "next/link";
import { achievementsFor } from "../../lib/achievements";
import { PUBLIC_DECKS, deckLeadCard, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { useApp } from "../application/AppProvider";
import { Badge, deckLooksComplete, factionClass } from "../application/ui";

export function DashboardScreen() {
  const { profile, decks, history, match } = useApp();
  const achievements = achievementsFor(decks, history);
  const unlocked = achievements.filter((achievement) => achievement.unlocked);
  const nextAchievements = achievements
    .filter((achievement) => !achievement.unlocked)
    .sort((left, right) => (right.current / right.target) - (left.current / left.target))
    .slice(0, 3);
  const wins = history.filter((item: { result?: string }) => item.result === "Victor").length;
  const winRate = history.length ? Math.round((wins / history.length) * 100) : 0;
  const completeDecks = decks.filter(deckLooksComplete);
  const publicDecks = [
    ...decks.filter((deck: DeckRecord) => deck.visibility === "Public").map((deck: DeckRecord) => ({ ...deck, creator: profile.name, publishedAt: deck.publishedAt ?? deck.updatedAt })),
    ...PUBLIC_DECKS,
  ].sort((a, b) => Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt));
  const featured = publicDecks[0];
  const featuredLead = featured ? deckLeadCard(featured) : undefined;

  return <div className="bakugan-home">
    <section className="bakugan-home-hero">
      <div className="bakugan-home-hero-copy">
        <p className="home-kicker">Welcome back, {profile.name}</p>
        <h1><span>Brawler</span><strong>Command</strong></h1>
        <p>Build your arsenal, prepare your Bakugan team, and choose your next Battle Planet Brawl.</p>
        <div className="hero-actions"><Link className="hex-button red" href="/play">PLAY</Link><Link className="hex-button ghost" href="/decks">DECKS</Link></div>
      </div>
      <div className="bakugan-home-hero-art">
        <div className="bakugan-home-energy" aria-hidden="true"/>
        <img src="/assets/brawlers-group.png" alt="Bakugan Brawlers ready for battle"/>
      </div>
    </section>

    {match && match.phase !== "result" && <section className="active-match-card">
      <div><span className="pulse"/><span className="eyebrow">ACTIVE MATCH</span><h2>{match.code ? `Room ${match.code}` : "Battle in progress"}</h2><p>{match.stepLabel ?? "Return to your current Brawl."}</p></div>
      <Link className="hex-button blue" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}>RESUME MATCH</Link>
    </section>}

    <section className="home-feature-grid">
      <article className="panel home-achievement-summary">
        <div className="panel-heading"><div><span className="eyebrow">ACHIEVEMENTS</span><h2>Closest milestones</h2></div><Link href="/profile/achievements">VIEW ALL →</Link></div>
        <div className="home-achievement-total"><strong>{unlocked.length}</strong><span>of {achievements.length} unlocked</span></div>
        <div className="home-achievement-list">
          {nextAchievements.length ? nextAchievements.map((achievement) => <div className="home-achievement-row" key={achievement.id}>
            <div><strong>{achievement.name}</strong><small>{achievement.current} / {achievement.target}</small></div>
            <progress aria-label={`${achievement.name}: ${achievement.current} of ${achievement.target}`} max={achievement.target} value={achievement.current}/>
          </div>) : <div className="home-achievement-complete"><strong>Every current achievement is unlocked.</strong><p>Your Battle Planet record is complete for this achievement set.</p></div>}
        </div>
      </article>

      <article className="panel home-featured-deck">
        <div className="panel-heading"><div><span className="eyebrow">NEWEST PUBLIC DECK</span><h2>Community spotlight</h2></div><Link href="/decks/public">BROWSE ALL →</Link></div>
        {featured ? <div className="home-featured-deck-layout">
          <div className={`home-featured-deck-art ${factionClass(featured.factions[0] ?? "Pyrus")}`}>
            {featuredLead ? <img src={cardArtSource(featuredLead, "thumbnail")} alt={`${featuredLead.displayName}, lead card for ${featured.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="Lead card artwork unavailable"/>}
          </div>
          <div className="home-featured-deck-copy">
            <div className="home-featured-deck-badges"><Badge tone="gold">{deckLooksComplete(featured) ? "LEGAL" : "DRAFT"}</Badge><Badge>{featured.factions.join(" • ")}</Badge></div>
            <h3>{featured.name}</h3>
            <p className="home-featured-deck-creator">by {featured.creator ?? "Community Brawler"}</p>
            <p className="home-featured-deck-description">{featured.description ?? "A public Battle Planet deck ready to explore and copy."}</p>
            <Link className="hex-button ghost" href={`/decks/public/${encodeURIComponent(featured.id)}`}>VIEW DECK</Link>
          </div>
        </div> : <div className="empty-state"><strong>NO PUBLIC DECKS YET</strong><p>Publish a deck from My Decks to feature it here.</p></div>}
      </article>
    </section>

    <section className="panel home-profile-strip">
      <Link className="home-profile-identity" href="/profile">
        <span className={`home-profile-avatar ${factionClass(profile.faction)}`}>{profile.name.slice(0, 2).toUpperCase()}</span>
        <span><strong>{profile.name}</strong><small>{profile.faction} Brawler</small></span>
      </Link>
      <div className="home-profile-stat"><strong>{history.length}</strong><span>Games played</span></div>
      <div className="home-profile-stat"><strong>{wins}</strong><span>Games won</span></div>
      <div className="home-profile-stat"><strong>{winRate}%</strong><span>Win rate</span></div>
      <div className="home-profile-stat"><strong>{completeDecks.length}</strong><span>Complete decks</span></div>
    </section>
  </div>;
}
