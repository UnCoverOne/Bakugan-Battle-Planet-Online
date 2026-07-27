"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { achievementsFor } from "../../lib/achievements";
import { CARD_BY_ID, PUBLIC_DECKS, deckLeadCard, type DeckRecord } from "../../lib/data";
import { deckSetName } from "../../lib/deck-set";
import { cardArtSource } from "../../lib/content/card-art";
import type { GameCard } from "../../lib/game";
import { useApp } from "../application/AppProvider";
import { Badge, deckLooksComplete, factionClass } from "../application/ui";

const HERO_PARTS = Array.from(
  { length: 6 },
  (_, index) => `/assets/home/hero-pyrus-960/part-${String(index + 1).padStart(2, "0")}.txt`,
);

const DISPLAY_FONT_PARTS = Array.from(
  { length: 4 },
  (_, index) => `/assets/home/rbno31-bold-italic/part-${String(index + 1).padStart(2, "0")}.txt`,
);

let highResolutionHeroPromise: Promise<string> | undefined;
let displayFontPromise: Promise<void> | undefined;

function loadTextParts(paths: string[], label: string) {
  return Promise.all(
    paths.map(async (path) => {
      const response = await fetch(path, { cache: "force-cache" });
      if (!response.ok) throw new Error(`Unable to load ${label} segment: ${path}`);
      return (await response.text()).trim();
    }),
  );
}

function loadHighResolutionHero() {
  highResolutionHeroPromise ??= loadTextParts(HERO_PARTS, "Home hero")
    .then((parts) => `data:image/avif;base64,${parts.join("")}`);

  return highResolutionHeroPromise;
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function loadDisplayFont() {
  if (typeof window === "undefined" || typeof FontFace === "undefined") {
    return Promise.resolve();
  }

  displayFontPromise ??= loadTextParts(DISPLAY_FONT_PARTS, "RBNo3.1 Bold Italic font")
    .then((parts) => new FontFace(
      "RBNo31Display",
      decodeBase64(parts.join("")),
      { style: "italic", weight: "700" },
    ).load())
    .then((font) => {
      document.fonts.add(font);
    })
    .catch((error) => {
      displayFontPromise = undefined;
      throw error;
    });

  return displayFontPromise;
}

function useHomeDisplayFont() {
  useEffect(() => {
    void loadDisplayFont().catch(() => undefined);
  }, []);
}

function useHighResolutionHero() {
  const [source, setSource] = useState("/assets/home/hero-pyrus.svg");

  useEffect(() => {
    let active = true;
    loadHighResolutionHero()
      .then((heroSource) => {
        if (active) setSource(heroSource);
      })
      .catch(() => {
        if (active) setSource("/assets/home/hero-pyrus.svg");
      });

    return () => {
      active = false;
    };
  }, []);

  return source;
}

function AchievementGlyph({ category, unlocked }: { category: string; unlocked: boolean }) {
  if (unlocked) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>;
  if (category === "Battle") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 6 6-2 2-6-6 2-2Zm14 0-6 6 2 2 6-6-2-2ZM8 15l-4 4m12-4 4 4"/></svg>;
  if (category === "Deck Building") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h11l2 3v13H6V4Zm-2 3h2v13H4V7Zm5 2h7m-7 4h7"/></svg>;
  if (category === "Online Play") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9a11 11 0 0 1 16 0M7 12a7 7 0 0 1 10 0m-7 3a3 3 0 0 1 4 0m-2 4h.01"/></svg>;
  if (category === "Compendium") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6a3 3 0 0 1 3 3v11a3 3 0 0 0-3-3H4V5Zm16 0h-4a3 3 0 0 0-3 3v11a3 3 0 0 1 3-3h4V5Z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.1 5.4 5.7.3-4.4 3.7 1.5 5.6-4.9-3-4.9 3 1.5-5.6-4.4-3.7 5.7-.3L12 3Z"/></svg>;
}

function ChevronArrow() {
  return <svg className="button-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8-8 8"/></svg>;
}

function HeroSpeedLines() {
  return <div className="bakugan-home-speed-lines" aria-hidden="true">
    <span/><span/><span/><span/><span/><span/><span/>
  </div>;
}

export function DashboardScreen() {
  const { profile, decks, history, match } = useApp();
  useHomeDisplayFont();
  const heroSource = useHighResolutionHero();
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
  const previewSeen = new Set<string>();
  const featuredPreviewCards: GameCard[] = featured
    ? [...featured.bakuganIds.map((id) => CARD_BY_ID.get(id)), featuredLead].filter((card): card is GameCard => {
      if (!card || previewSeen.has(card.catalogId)) return false;
      previewSeen.add(card.catalogId);
      return true;
    })
    : [];
  const activeMatch = Boolean(match && match.phase !== "result");

  return <div className={`bakugan-home ${activeMatch ? "has-active-match" : ""}`}>
    <section className="bakugan-home-hero">
      <div className="bakugan-home-hero-copy">
        <p className="home-kicker">Welcome back, {profile.name}</p>
        <h1><span>Battle</span><strong>Planet</strong></h1>
        <p>Build your arsenal, prepare your Bakugan team, and choose your next Battle Planet Brawl.</p>
        <div className="hero-actions">
          <span className="play-button-glow"><Link className="hex-button red" href="/play"><span>PLAY</span><ChevronArrow/></Link></span>
          <Link className="hex-button ghost" href="/decks"><span>DECKS</span><ChevronArrow/></Link>
        </div>
      </div>
      <div className="bakugan-home-hero-art">
        <HeroSpeedLines/>
        <div className="bakugan-home-energy" aria-hidden="true"/>
        <img src={heroSource} width="960" height="920" decoding="async" alt="Pyrus Bakugan charging into battle"/>
      </div>
    </section>

    {activeMatch && match && <section className="active-match-card">
      <div><span className="pulse"/><span className="eyebrow">ACTIVE MATCH</span><h2>{match.code ? `Room ${match.code}` : "Battle in progress"}</h2><p>{match.stepLabel ?? "Return to your current Brawl."}</p></div>
      <Link className="hex-button blue" href={match.phase === "lobby" ? "/play/lobby" : "/play/match"}><span>RESUME MATCH</span><ChevronArrow/></Link>
    </section>}

    <section className="home-feature-grid">
      <article className="panel home-achievement-summary">
        <div className="panel-heading"><h2>Achievement progress</h2><Link href="/profile/achievements">VIEW ALL →</Link></div>
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
        <div className="panel-heading"><h2>Featured deck</h2><Link href="/decks/public">BROWSE ALL →</Link></div>
        {featured ? <div className="home-featured-deck-layout">
          <div className={`home-featured-deck-stack ${factionClass(featured.factions[0] ?? "Pyrus")}`} aria-label={`Featured cards from ${featured.name}`}>
            {featuredPreviewCards.length ? featuredPreviewCards.map((card) => <div className="home-featured-deck-card" key={card.catalogId}>
              <img src={cardArtSource(card, "full")} alt={card.displayName}/>
            </div>) : <img className="home-featured-deck-placeholder" src="/assets/cards/card-missing.svg" alt="Featured deck artwork unavailable"/>}
          </div>
          <div className="home-featured-deck-copy">
            <div className="home-featured-deck-badges"><Badge tone="gold">{deckSetName(featured).toUpperCase()}</Badge><Badge>{featured.factions.join(" • ")}</Badge></div>
            <h3>{featured.name}</h3>
            <p className="home-featured-deck-creator">by {featured.creator ?? "Community Brawler"}</p>
            <p className="home-featured-deck-description">{featured.description ?? "A public Battle Planet deck ready to explore and copy."}</p>
            <Link className="hex-button ghost" href={`/decks/public/${encodeURIComponent(featured.id)}`}><span>VIEW DECK</span><ChevronArrow/></Link>
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
