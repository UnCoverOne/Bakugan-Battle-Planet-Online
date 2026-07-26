"use client";

import Link from "next/link";
import { achievementsFor } from "../../lib/achievements";
import { PUBLIC_DECKS, deckLeadCard, type DeckRecord } from "../../lib/data";
import { cardArtSource } from "../../lib/content/card-art";
import { useApp } from "../application/AppProvider";
import { Badge, deckLooksComplete, factionClass } from "../application/ui";

function AchievementGlyph({ category, unlocked }: { category: string; unlocked: boolean }) {
  if (unlocked) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
  if (category === "Battle") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 6 6-2 2-6-6 2-2Zm14 0-6 6 2 2 6-6-2-2ZM8 15l-4 4m12-4 4 4"/></svg>;
  if (category === "Deck Building") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h11l2 3v13H6V4Zm-2 3h2v13H4V7Zm5 2h7m-7 4h7"/></svg>;
  if (category === "Online Play") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0m-7 3a3 3 0 0 1 4 0m-2 4h.01"/></svg>;
  if (category === "Compendium") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4V5Zm16 0h-4a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h4V5Z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.1 5.4 5.7.3-4.4 3.7 1.5 5.6-4.9-3-4.9 3 1.5-5.6-4.4-3.7 5.7-.3L12 3Z"/></svg>;
}

export function DashboardScreen() {
  const { profile, decks, history, match } = useApp();
  const achievements = achievementsFor(decks, history);
  const incompleteAchievements = achievements
    .filter((achievement) => !achievement.unlocked)
    .sort((left, right) => (right.current / right.target) - (left.current / left.target));
  const closestAchievements = [
    ...incompleteAchievements,
    ...achievements.filter((achievement) => achievement.unlocked).reverse(),
  ].slice(0, 3);
  const wins = history.filter((item: { result?: string }) => item.result === "Victor").length;
  const winRate = history.length ? Math.round((wins / history.length) * 100) : 0;
  const completeDecks = decks.filter(deckLooksComplete);
  const publicDecks = [
    ...decks.filter((deck: DeckRecord) => deck.visibility === "Public").map((deck: DeckRecord) => ({ ...deck, creator: profile.name, publishedAt: deck.publishedAt ?? deck.updatedAt })),
    ...PUBLIC_DECKS,
  ].sort((a, b) => Date.parse(b.publishedAt ?? b.updatedAt) - Date.parse(a.publishedAt ?? a.updatedAt));
  const featured = publicDecks[0];
  const featuredLead = featured ? deckLeadCard(featured) : undefined;
  const activeMatch = Boolean(match && match.phase !== "result");

  return <div className={`bakugan-home ${activeMatch ? "has-active-match" : ""}`}>
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

    {activeMatch && match && <section className="active-match-card">
      <div><span className="pulse"/><span className="eyebrow">ACTIVE MATCH</span><h2>{match.code ? `Room ${match.code}` : "Battle in progress"}</h2><p>{match.stepLabel ?? "Return to your current Brawl."}</p></div>
      <Link className="hex-button blue" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}>RESUME MATCH</Link>
    </section>}

    <section className="home-feature-grid">
      <article className="panel home-achievement-summary">
        <div className="panel-heading"><h2>Closest achievements</h2><Link href="/profile/achievements">VIEW ALL →</Link></div>
        <div className="home-achievement-list">
          {closestAchievements.map((achievement) => <div className={`home-achievement-row ${achievement.unlocked ? "complete" : ""}`} key={achievement.id}>
            <span className="home-achievement-icon"><AchievementGlyph category={achievement.category} unlocked={achievement.unlocked}/></span>
            <div className="home-achievement-copy">
              <div><strong>{achievement.name}</strong><small>{achievement.unlocked ? "Complete" : `${achievement.current} / ${achievement.target}`}</small></div>
              <p>{achievement.description}</p>
              <progress aria-label={`${achievement.name}: ${achievement.current} of ${achievement.target}`} max={achievement.target} value={achievement.current}/>
            </div>
          </div>)}
        </div>
      </article>

      <article className="panel home-featured-deck">
        <div className="panel-heading"><h2>Featured public deck</h2><Link href="/decks/public">BROWSE ALL →</Link></div>
        {featured ? <div className="home-featured-deck-layout">
          <div className={`home-featured-deck-art ${factionClass(featured.factions[0] ?? "Pyrus")}`}>
            {featuredLead ? <img src={cardArtSource(featuredLead, "full")} alt={`${featuredLead.displayName}, lead card for ${featured.name}`}/> : <img src="/assets/cards/card-missing.svg" alt="Lead card artwork unavailable"/>}
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
