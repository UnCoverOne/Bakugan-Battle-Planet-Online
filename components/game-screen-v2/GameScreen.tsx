"use client";

import { useEffect } from "react";
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

type ZoneOwner = "player" | "opponent";
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

function safeCount(value: number) {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function stackCount(counts: OwnerZoneCounts, kind: CardStackZoneKind) {
  return safeCount(kind === "deck" ? counts.deck : counts.discardPile);
}

/**
 * A stable presentation slot for one Bakugan Character card. Ownership and
 * unique zone identifiers let the future adapter place each player's cards in
 * the correct mirrored area without coupling this scaffold to MatchState yet.
 */
function CharacterCardZone({ owner, slot }: { owner: ZoneOwner; slot: CharacterCardSlot }) {
  return (
    <li
      className={styles.characterCardZone}
      data-zone-kind="character-card"
      data-zone-owner={owner}
      data-zone-id={`${owner}-character-card-${slot}`}
      data-slot={slot}
      aria-label={`${ownerLabel(owner)} Character Card ${slot} zone`}
    >
      <span>Character</span>
      <span>Card {slot}</span>
    </li>
  );
}

/**
 * Stable presentation slots for each player's deck and discard pile. These are
 * layout-only targets until the new screen is connected to live match data.
 */
function CardStackZone({
  owner,
  kind,
  lines,
  count,
}: {
  owner: ZoneOwner;
  kind: CardStackZoneKind;
  lines: readonly string[];
  count: number;
}) {
  const label = lines.join(" ");
  const cardCount = safeCount(count);
  return (
    <li
      className={styles.cardStackZone}
      data-zone-kind={kind}
      data-zone-owner={owner}
      data-zone-id={`${owner}-${kind}`}
      data-card-count={cardCount}
      aria-label={`${ownerLabel(owner)} ${label} zone, ${cardCount} cards`}
    >
      {lines.map((line) => <span key={line}>{line}</span>)}
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </li>
  );
}

/**
 * A wide persistent-card area aligned to the combined width of the associated
 * deck and discard zones.
 */
function HeroZone({ owner, count }: { owner: ZoneOwner; count: number }) {
  const cardCount = safeCount(count);
  return (
    <div
      className={styles.heroZone}
      data-zone-kind="hero"
      data-zone-owner={owner}
      data-zone-id={`${owner}-hero`}
      data-card-count={cardCount}
      aria-label={`${ownerLabel(owner)} Hero zone, ${cardCount} cards`}
    >
      <span>Hero</span>
      <span>Zone</span>
      <strong className={styles.zoneCount} aria-hidden="true">{cardCount}</strong>
    </div>
  );
}

function PlayerZoneLayout({ owner, counts }: { owner: ZoneOwner; counts: OwnerZoneCounts }) {
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
            <CharacterCardZone key={`${owner}-${slot}`} owner={owner} slot={slot} />
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
        <HeroZone owner={owner} count={counts.hero} />
        <ol className={styles.cardStackZones}>
          {cardStackZones.map((zone) => (
            <CardStackZone
              key={`${owner}-${zone.kind}`}
              owner={owner}
              {...zone}
              count={stackCount(counts, zone.kind)}
            />
          ))}
        </ol>
      </section>
    </>
  );
}

/**
 * Standalone replacement game-screen scaffold.
 *
 * The play area is presentation-only for now, keeping the new screen isolated
 * from the existing match state and game engine while the layout is developed.
 */
export function GameScreen({
  onExit,
  zoneCounts = EMPTY_ZONE_COUNTS,
}: {
  onExit?: () => void;
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

        <PlayerZoneLayout owner="opponent" counts={zoneCounts.opponent} />
        <PlayerZoneLayout owner="player" counts={zoneCounts.player} />
      </div>
    </div>
  );
}
