"use client";

import { useEffect } from "react";
import type { CSSProperties } from "react";
import type { GameCard, MatchState } from "../../lib/game";
import {
  EMPTY_GAME_SCREEN_ZONE_STATE,
  buildGameScreenZoneState,
  deckBackAssetCount,
  heroCardLayout,
  safeCardCount,
  type GameScreenOwnerState,
  type ZoneOwner,
} from "./gameScreenState";
import styles from "./GameScreen.module.css";

const GRID_WIDTH = 1800;
const GRID_HEIGHT = 1000;
const GRID_CENTER_X = GRID_WIDTH / 2;
const GRID_CENTER_Y = GRID_HEIGHT / 2;
const HEX_RADIUS = 52 * 0.8;
const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS;
const HEX_X_STEP = HEX_RADIUS * 1.5;
const COLUMN_RADIUS = Math.ceil(GRID_WIDTH / (HEX_X_STEP * 2)) + 2;
const ROW_RADIUS = Math.ceil(GRID_HEIGHT / (HEX_HEIGHT * 2)) + 3;
const CARD_BACK_ART = "/assets/card-back.png";

type CharacterCardSlot = 1 | 2 | 3;
type CardStackZoneKind = "discard-pile" | "deck";
type CardStackZoneDefinition = {
  kind: CardStackZoneKind;
  lines: readonly string[];
};
type OwnerZoneCounts = {
  hero: number;
  deck: number;
  discardPile: number;
};

export type GameScreenZoneCounts = Record<ZoneOwner, OwnerZoneCounts>;

const EMPTY_ZONE_COUNTS: GameScreenZoneCounts = {
  player: { hero: 0, deck: 0, discardPile: 0 },
  opponent: { hero: 0, deck: 0, discardPile: 0 },
};

const PLAYER_CHARACTER_CARD_SLOTS: readonly CharacterCardSlot[] = [1, 2, 3];
const OPPONENT_CHARACTER_CARD_SLOTS: readonly CharacterCardSlot[] = [3, 2, 1];

const PLAYER_CARD_STACK_ZONES: readonly CardStackZoneDefinition[] = [
  { kind: "discard-pile", lines: ["Discard", "Pile"] },
  { kind: "deck", lines: ["Deck"] },
];

// The opponent layout is a 180-degree spatial mirror of the local player's
// layout, so Deck appears on the viewer's left and Discard Pile on the right.
const OPPONENT_CARD_STACK_ZONES: readonly CardStackZoneDefinition[] = [
  { kind: "deck", lines: ["Deck"] },
  { kind: "discard-pile", lines: ["Discard", "Pile"] },
];

function hexPoints(cx: number, cy: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = index * Math.PI / 3;
    return `${cx + Math.cos(angle) * HEX_RADIUS},${cy + Math.sin(angle) * HEX_RADIUS}`;
  }).join(" ");
}

/**
 * Build the grid outwards from axial coordinate 0,0. This guarantees that a
 * complete hexagon is centred precisely on the middle of the 1800 x 1000
 * play-area coordinate system, which future Hide Matrix positions can share.
 */
const HEX_GRID = Array.from(
  { length: COLUMN_RADIUS * 2 + 1 },
  (_, columnIndex) => columnIndex - COLUMN_RADIUS,
).flatMap((q) => Array.from(
  { length: ROW_RADIUS * 2 + 1 },
  (_, rowIndex) => rowIndex - ROW_RADIUS,
).map((r) => {
  const cx = GRID_CENTER_X + q * HEX_X_STEP;
  const cy = GRID_CENTER_Y + (r + q / 2) * HEX_HEIGHT;
  return {
    key: `${q}:${r}`,
    cx,
    cy,
    points: hexPoints(cx, cy),
  };
})).filter((hex) => (
  hex.cx >= -HEX_RADIUS
  && hex.cx <= GRID_WIDTH + HEX_RADIUS
  && hex.cy >= -HEX_HEIGHT
  && hex.cy <= GRID_HEIGHT + HEX_HEIGHT
));

function ownerLabel(owner: ZoneOwner) {
  return owner === "player" ? "Your" : "Opponent";
}

function stackCount(counts: OwnerZoneCounts, kind: CardStackZoneKind) {
  return safeCardCount(kind === "deck" ? counts.deck : counts.discardPile);
}

function ZoneLabel({ lines }: { lines: readonly string[] }) {
  return <>{lines.map((line) => <span className={styles.zoneLabel} key={line}>{line}</span>)}</>;
}

function CharacterCardZone({
  owner,
  slot,
  card,
}: {
  owner: ZoneOwner;
  slot: CharacterCardSlot;
  card?: GameCard;
}) {
  const label = card
    ? `${ownerLabel(owner)} Character Card ${slot}: ${card.displayName || card.name}`
    : `${ownerLabel(owner)} Character Card ${slot} zone`;

  return (
    <li
      className={styles.characterCardZone}
      data-zone-kind="character-card"
      data-zone-owner={owner}
      data-zone-id={`${owner}-character-card-${slot}`}
      data-slot={slot}
      data-card-id={card?.id}
      aria-label={label}
    >
      {card ? (
        <img
          className={styles.characterCardImage}
          src={card.art}
          alt={card.displayName || card.name}
          draggable={false}
        />
      ) : <ZoneLabel lines={["Character", `Card ${slot}`]} />}
    </li>
  );
}

function DeckStack({ count, owner }: { count: number; owner: ZoneOwner }) {
  const visualCount = deckBackAssetCount(count);
  if (visualCount === 0) return null;

  return (
    <div className={styles.deckBackStack} aria-hidden="true">
      {Array.from({ length: visualCount }, (_, index) => {
        const centredIndex = index - (visualCount - 1) / 2;
        const style = {
          "--deck-x": `${centredIndex * 1.8}px`,
          "--deck-y": `${centredIndex * -1.25}px`,
          "--deck-order": index,
        } as CSSProperties;
        return (
          <img
            className={styles.deckBackCard}
            src={CARD_BACK_ART}
            alt=""
            draggable={false}
            data-zone-owner={owner}
            style={style}
            key={`${owner}-deck-back-${index}`}
          />
        );
      })}
    </div>
  );
}

function DiscardCard({ card }: { card: GameCard | null }) {
  if (!card) return null;
  return (
    <img
      className={styles.discardCardImage}
      src={card.art}
      alt={card.displayName || card.name}
      draggable={false}
    />
  );
}

function CardStackZone({
  owner,
  kind,
  lines,
  count,
  latestDiscard,
}: {
  owner: ZoneOwner;
  kind: CardStackZoneKind;
  lines: readonly string[];
  count: number;
  latestDiscard: GameCard | null;
}) {
  const label = lines.join(" ");
  const cardCount = safeCardCount(count);
  const hasVisual = kind === "deck" ? cardCount > 0 : Boolean(latestDiscard);

  return (
    <li
      className={styles.cardStackZone}
      data-zone-kind={kind}
      data-zone-owner={owner}
      data-zone-id={`${owner}-${kind}`}
      data-card-count={cardCount}
      data-top-card-id={kind === "discard-pile" ? latestDiscard?.id : undefined}
      aria-label={`${ownerLabel(owner)} ${label} zone, ${cardCount} cards`}
    >
      {!hasVisual && <ZoneLabel lines={lines} />}
      {kind === "deck"
        ? <DeckStack count={cardCount} owner={owner} />
        : <DiscardCard card={latestDiscard} />}
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </li>
  );
}

function HeroStack({ cards }: { cards: readonly GameCard[] }) {
  if (!cards.length) return null;
  const layout = heroCardLayout(cards.length);

  return (
    <div className={styles.heroCardStack}>
      {cards.map((card, index) => {
        const left = layout.startPercent + index * layout.stepPercent;
        const style = { "--hero-left": `${left}%`, "--hero-order": index } as CSSProperties;
        return (
          <img
            className={styles.heroCardImage}
            src={card.art}
            alt={card.displayName || card.name}
            draggable={false}
            style={style}
            key={card.id}
          />
        );
      })}
    </div>
  );
}

function HeroZone({ owner, cards, count }: { owner: ZoneOwner; cards: readonly GameCard[]; count: number }) {
  const cardCount = safeCardCount(count);
  return (
    <div
      className={styles.heroZone}
      data-zone-kind="hero"
      data-zone-owner={owner}
      data-zone-id={`${owner}-hero`}
      data-card-count={cardCount}
      aria-label={`${ownerLabel(owner)} Hero zone, ${cardCount} cards`}
    >
      {!cards.length && <ZoneLabel lines={["Hero", "Zone"]} />}
      <HeroStack cards={cards} />
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </div>
  );
}

function PlayerZoneLayout({
  owner,
  counts,
  state,
}: {
  owner: ZoneOwner;
  counts: OwnerZoneCounts;
  state: GameScreenOwnerState;
}) {
  const isOpponent = owner === "opponent";
  const characterSlots = isOpponent
    ? OPPONENT_CHARACTER_CARD_SLOTS
    : PLAYER_CHARACTER_CARD_SLOTS;
  const cardStackZones = isOpponent
    ? OPPONENT_CARD_STACK_ZONES
    : PLAYER_CARD_STACK_ZONES;

  return (
    <>
      <section
        className={`${styles.characterCardArea} ${
          isOpponent ? styles.opponentCharacterCardArea : styles.playerCharacterCardArea
        }`}
        data-zone-owner={owner}
        data-zone-group="character-cards"
        aria-label={`${ownerLabel(owner)} Bakugan Character card area`}
      >
        <ol className={styles.characterCardZones}>
          {characterSlots.map((slot) => (
            <CharacterCardZone
              key={`${owner}-${slot}`}
              owner={owner}
              slot={slot}
              card={state.characterCards[slot - 1]}
            />
          ))}
        </ol>
      </section>

      <section
        className={`${styles.cardStackArea} ${
          isOpponent ? styles.opponentCardStackArea : styles.playerCardStackArea
        }`}
        data-zone-owner={owner}
        data-zone-group="play-area-cards"
        aria-label={`${ownerLabel(owner)} Hero, deck, and discard pile area`}
      >
        <HeroZone owner={owner} cards={state.heroCards} count={counts.hero} />
        <ol className={styles.cardStackZones}>
          {cardStackZones.map((zone) => (
            <CardStackZone
              key={`${owner}-${zone.kind}`}
              owner={owner}
              {...zone}
              count={stackCount(counts, zone.kind)}
              latestDiscard={state.latestDiscard}
            />
          ))}
        </ol>
      </section>
    </>
  );
}

export function GameScreen({
  onExit,
  match,
  playerId,
  zoneCounts = EMPTY_ZONE_COUNTS,
}: {
  onExit?: () => void;
  match?: MatchState | null;
  playerId?: string;
  zoneCounts?: GameScreenZoneCounts;
}) {
  useEffect(() => {
    if (!onExit) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onExit();
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [onExit]);

  const zoneState = match
    ? buildGameScreenZoneState(match, playerId)
    : EMPTY_GAME_SCREEN_ZONE_STATE;
  const resolvedCounts: GameScreenZoneCounts = match
    ? {
      player: {
        hero: zoneState.player.heroCards.length,
        deck: zoneState.player.deckCount,
        discardPile: zoneState.player.discardCount,
      },
      opponent: {
        hero: zoneState.opponent.heroCards.length,
        deck: zoneState.opponent.deckCount,
        discardPile: zoneState.opponent.discardCount,
      },
    }
    : zoneCounts;

  return (
    <div className={styles.screen}>
      <div className={styles.playArea} aria-label="Experimental game play area">
        <svg
          className={styles.hexGrid}
          viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="game-screen-hex-fade" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="white" stopOpacity="0.9" />
              <stop offset="38%" stopColor="white" stopOpacity="0.72" />
              <stop offset="59%" stopColor="white" stopOpacity="0.3" />
              <stop offset="80%" stopColor="black" stopOpacity="0" />
            </radialGradient>
            <mask id="game-screen-hex-mask">
              <rect width={GRID_WIDTH} height={GRID_HEIGHT} fill="url(#game-screen-hex-fade)" />
            </mask>
          </defs>
          <g mask="url(#game-screen-hex-mask)">
            {HEX_GRID.map((hex) => <polygon key={hex.key} points={hex.points} />)}
          </g>
        </svg>

        <PlayerZoneLayout owner="opponent" counts={resolvedCounts.opponent} state={zoneState.opponent} />
        <PlayerZoneLayout owner="player" counts={resolvedCounts.player} state={zoneState.player} />
      </div>
    </div>
  );
}
