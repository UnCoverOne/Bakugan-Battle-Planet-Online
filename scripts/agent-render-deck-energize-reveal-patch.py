from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


Path("components/game-screen-v2/EnergyArrivalLayer.tsx").write_text('''"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { MatchState } from "../../lib/game";
import { energizeTransitions } from "./energizeAnimationState";

const ENERGIZE_ANIMATION_MS = 1120;
type ZoneOwner = "player" | "opponent";

function energyCardElement(zone: HTMLElement, cardId: string) {
  return [...zone.querySelectorAll<HTMLElement>("[data-card-id]")]
    .find((element) => element.dataset.cardId === cardId) ?? null;
}

export function EnergyArrivalLayer({
  match,
  playerId,
}: {
  match: MatchState | null;
  playerId?: string;
}) {
  const previousMatch = useRef<MatchState | null>(null);
  const activeElements = useRef<HTMLElement[]>([]);
  const clearTimer = useRef(0);

  const clearPresentation = () => {
    window.clearTimeout(clearTimer.current);
    clearTimer.current = 0;
    for (const element of activeElements.current) delete element.dataset.energizing;
    activeElements.current = [];
  };

  useEffect(() => clearPresentation, []);

  useLayoutEffect(() => {
    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!match || !previous || previous.id !== match.id) {
      clearPresentation();
      return;
    }

    const transitions = energizeTransitions(previous, match);
    if (!transitions.length) return;

    clearPresentation();
    const localPlayerId = playerId ?? match.players[0]?.id;
    const activated: HTMLElement[] = [];

    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const zone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-energy"]`);
      if (!zone) continue;
      zone.dataset.energizing = "true";
      activated.push(zone);
      for (const card of transition.cards) {
        const element = energyCardElement(zone, card.id);
        if (!element) continue;
        element.dataset.energizing = "true";
        activated.push(element);
      }
    }

    if (!activated.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    activeElements.current = activated;
    clearTimer.current = window.setTimeout(clearPresentation, ENERGIZE_ANIMATION_MS);
  }, [match?.id, match?.version, playerId]);

  return null;
}
''')

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    'import { useEffect, useRef, useState } from "react";',
    'import { useEffect, useLayoutEffect, useRef, useState } from "react";',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    'import { ResponsiveCardImage } from "./ResponsiveCardImage";\n',
    'import { ResponsiveCardImage } from "./ResponsiveCardImage";\nimport { energizeTransitions } from "./energizeAnimationState";\n',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    'const CARD_PREVIEW_CLEAR_EVENT = "bbp-card-preview-clear";\n',
    'const CARD_PREVIEW_CLEAR_EVENT = "bbp-card-preview-clear";\nconst DECK_ENERGIZE_REVEAL_MS = 5000;\n',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  canTap,
  revealFaces = false,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
}) {''',
    '''  canTap,
  revealFaces = false,
  revealedCardIds = [],
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
  revealedCardIds?: readonly string[];
}) {''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  const layout = heroCardLayout(energy.cards.length);
  const tappedIds = new Set(energy.tappedEnergyIds);
''',
    '''  const layout = heroCardLayout(energy.cards.length);
  const tappedIds = new Set(energy.tappedEnergyIds);
  const revealedIds = new Set(revealedCardIds);
''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''        const tapped = tappedIds.has(card.id);
        const actionable = owner === "player"''',
    '''        const tapped = tappedIds.has(card.id);
        const faceVisible = revealFaces || (owner === "player" && revealedIds.has(card.id));
        const actionable = owner === "player"''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '            data-face-visible={revealFaces ? "true" : "false"}',
    '            data-face-visible={faceVisible ? "true" : "false"}',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            <span className={styles.energyCardVisual} aria-hidden="true">
              <img
                className={styles.energyCardBack}
                src={CARD_BACK_ART}
                alt=""
                draggable={false}
              />
              <img
                className={styles.energyCardFace}
                src={card.art}
                alt=""
                draggable={false}
              />
            </span>''',
    '''            <img
              src={faceVisible ? card.art : CARD_BACK_ART}
              alt={faceVisible ? card.displayName || card.name : ""}
              aria-hidden={!faceVisible}
              data-hidden={faceVisible ? "false" : "true"}
              draggable={false}
            />''',
)

# EnergyZone prop threading.
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  canTap,
  revealFaces = false,
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
}) {
  return (
    <div''',
    '''  canTap,
  revealFaces = false,
  revealedCardIds = [],
}: {
  owner: ZoneOwner;
  energy: EnergyZoneView;
  pendingCardId?: string;
  onTap?: EnergyTapHandler;
  canTap?: (cardId: string) => boolean;
  revealFaces?: boolean;
  revealedCardIds?: readonly string[];
}) {
  return (
    <div''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''        canTap={canTap}
        revealFaces={revealFaces}
      />''',
    '''        canTap={canTap}
        revealFaces={revealFaces}
        revealedCardIds={revealedCardIds}
      />''',
)

# PlayerZoneLayout prop threading.
replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  canTapEnergyCard,
  revealEnergyFaces = false,
  drawAvailable = false,''',
    '''  canTapEnergyCard,
  revealEnergyFaces = false,
  revealedEnergyCardIds = [],
  drawAvailable = false,''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  canTapEnergyCard?: (cardId: string) => boolean;
  revealEnergyFaces?: boolean;
  drawAvailable?: boolean;''',
    '''  canTapEnergyCard?: (cardId: string) => boolean;
  revealEnergyFaces?: boolean;
  revealedEnergyCardIds?: readonly string[];
  drawAvailable?: boolean;''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''          canTap={canTapEnergyCard}
          revealFaces={revealEnergyFaces}
        />''',
    '''          canTap={canTapEnergyCard}
          revealFaces={revealEnergyFaces}
          revealedCardIds={revealedEnergyCardIds}
        />''',
)

replace,
  revealedEnergyCardIds = [],
  drawAvailable = false,''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  canTapEnergyCard?: (cardId: string) => boolean;
  revealEnergyFaces?: boolean { hiddenCoreCells } = useBakuCorePresentation();''',
    '''  const [drawClock, setDrawClock] = useState(() => Date.now());
  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);
  const [revealedDeckEnergyCardIds, setRevealedDeckEnergyCardIds] = useState<string[]>([]);
  const deckEnergyRevealPreviousMatchvealEnergyFaces}
        />''',
    '''          canTap={canTapEnergyCard}
          revealFaces={revealEnergyFaces}
          revealedCardIds={revealedEnergyCardIds}
        />''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  const [drawClock, setDrawClock] = useState(() => Date.now());
  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);
  const { hiddenCoreCells } = useBakuCorePresentation();''',
    '''  const [drawClock, setDrawClock] = useState(() => Date.now());
  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);
  const [revealedDeckEnergyCardIds, setRevealedDeckEnergyCardIds] = useState<string[]>([]);
  const deckEnergyRevealPreviousMatch = useRef<MatchState | null>(null);
  const deckEnergyRevealTimers = useRef(new Map<string, number>());
  const { hiddenCoreCells } = useBakuCorePresentation();''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''  const resolvedCounts: GameScreenZoneCounts = match
    ? {''',
    '''  useLayoutEffect(() => {
    const previous = deckEnergyRevealPreviousMatch.current;
    deckEnergyRevealPreviousMatch.current = match ?? null;
    if (!match || !previous || previous.id !== match.id) {
      for (const timer of deckEnergyRevealTimers.current.values()) window.clearTimeout(timer);
      deckEnergyRevealTimers.current.clear();
      setRevealedDeckEnergyCardIds((current) => current.length ? [] : current);
      return;
    }

    const revealedIds = energizeTransitions(previous, match)
      .filter((transition) => transition.playerId === localPlayerId)
      .flatMap((transition) => transition.deckCards.map((card) => card.id));
    if (!revealedIds.length) return;

    setRevealedDeckEnergyCardIds((current) => [...new Set([...current, ...revealedIds])]);
    for (const cardId of revealedIds) {
      const previousTimer = deckEnergyRevealTimers.current.get(cardId);
      if (previousTimer) window.clearTimeout(previousTimer);
      const timer = window.setTimeout(() => {
        deckEnergyRevealTimers.current.delete(cardId);
        setRevealedDeckEnergyCardIds((current) => current.filter((id) => id !== cardId));
      }, DECK_ENERGIZE_REVEAL_MS);
      deckEnergyRevealTimers.current.set(cardId, timer);
    }
  }, [match?.id, match?.version, localPlayerId]);

  useEffect(() => () => {
    for (const timer of deckEnergyRevealTimers.current.values()) window.clearTimeout(timer);
    deckEnergyRevealTimers.current.clear();
  }, []);

  const resolvedCounts: GameScreenZoneCounts = match
    ? {''',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}
            drawAvailable={drawAvailable}''',
    '''            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}
            revealedEnergyCardIds={revealedDeckEnergyCardIds}
            drawAvailable={drawAvailable}''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''.energyCardVisual {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: block;
  pointer-events: none;
}

.energyCardVisual img {
  position: absolute;
  inset: 0;
  display: block;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  object-fit: contain;
  object-position: center;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.48);
  pointer-events: none;
  user-select: none;
  transition: opacity 150ms ease;
}

.energyCardBack {
  opacity: 1;
}

.energyCardFace {
  opacity: 0;
}

.energyCard[data-face-visible="true"] .energyCardBack,
.energyCard[data-deck-reveal="true"] .energyCardBack {
  opacity: 0;
}

.energyCard[data-face-visible="true"] .energyCardFace,
.energyCard[data-deck-reveal="true"] .energyCardFace {
  opacity: 1;
}
''',
    '''.energyCard img {
  display: block;
  width: 100%;
  height: 100%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  object-fit: contain;
  object-position: center;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.48);
  pointer-events: none;
  user-select: none;
}
''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '.energyCard[data-energizing="true"] .energyCardVisual {\n',
    '.energyCard[data-energizing="true"] img {\n',
)
replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''  .energyCard[data-energizing="true"] .energyCardVisual,
  .energyCardVisual img,
''',
    '''  .energyCard[data-energizing="true"] img,
''',
)

replace_once(
    "tests/presentation-stability.test.ts",
    '''test("top-deck Energize cards reveal only to their owner for five seconds", () => {
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  const layer = read("components/game-screen-v2/EnergyArrivalLayer.tsx");
  const css = read("components/game-screen-v2/GameScreen.module.css");
  assert.match(screen, /energyCardBack/);
  assert.match(screen, /energyCardFace/);
  assert.match(screen, /data-face-visible/);
  assert.match(layer, /DECK_ENERGIZE_REVEAL_MS = 5000/);
  assert.match(layer, /transition\\.playerId === localPlayerId/);
  assert.match(layer, /element\\.dataset\\.deckReveal = "true"/);
  assert.match(layer, /delete element\\.dataset\\.deckReveal/);
  assert.match(css, /data-deck-reveal="true"/);
});''',
    '''test("top-deck Energize cards reveal only to their owner for five seconds", () => {
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  assert.match(screen, /DECK_ENERGIZE_REVEAL_MS = 5000/);
  assert.match(screen, /transition\\.playerId === localPlayerId/);
  assert.match(screen, /revealedDeckEnergyCardIds/);
  assert.match(screen, /src=\\{faceVisible \\? card\\.art : CARD_BACK_ART\\}/);
  assert.match(screen, /owner === "player" && revealedIds\\.has\\(card\\.id\\)/);
  assert.doesNotMatch(screen, /energyCardFace/);
});''',
)
