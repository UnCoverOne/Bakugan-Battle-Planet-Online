from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected one match in {path}, found {text.count(old)}")
    file.write_text(text.replace(old, new, 1))


Path("components/game-screen-v2/energizeAnimationState.ts").write_text('''import type { GameCard, MatchState } from "../../lib/game";

export type EnergizeTransition = {
  playerId: string;
  cards: readonly GameCard[];
  deckCards: readonly GameCard[];
};

/** Detect cards that newly entered a player's Energy Zone between authoritative states. */
export function energizeTransitions(
  previous: MatchState | null | undefined,
  current: MatchState | null | undefined,
): readonly EnergizeTransition[] {
  if (!previous || !current || previous.id !== current.id) return [];

  return current.players.flatMap((player) => {
    const before = previous.players.find((candidate) => candidate.id === player.id);
    if (!before) return [];
    const previousEnergyIds = new Set(before.energyZone.map((card) => card.id));
    const cards = player.energyZone.filter((card) => !previousEnergyIds.has(card.id));
    if (!cards.length) return [];

    // A card visible in the previous authoritative deck and newly present in
    // Energy made a direct deck-to-Energy transition. Hidden opponent deck
    // contents naturally produce no reveal candidates for the local client.
    const previousDeckIds = new Set(before.deckCards.map((card) => card.id));
    const deckCards = cards.filter((card) => previousDeckIds.has(card.id));
    return [{ playerId: player.id, cards, deckCards }];
  });
}
''')

Path("components/game-screen-v2/EnergyArrivalLayer.tsx").write_text('''"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { MatchState } from "../../lib/game";
import { energizeTransitions } from "./energizeAnimationState";

const ENERGIZE_ANIMATION_MS = 1120;
const DECK_ENERGIZE_REVEAL_MS = 5000;
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
  const activeAnimationElements = useRef<HTMLElement[]>([]);
  const animationTimer = useRef(0);
  const revealedElements = useRef(new Set<HTMLElement>());
  const revealTimers = useRef(new Map<HTMLElement, number>());

  const clearAnimationPresentation = () => {
    window.clearTimeout(animationTimer.current);
    animationTimer.current = 0;
    for (const element of activeAnimationElements.current) delete element.dataset.energizing;
    activeAnimationElements.current = [];
  };

  const clearDeckReveals = () => {
    for (const timer of revealTimers.current.values()) window.clearTimeout(timer);
    revealTimers.current.clear();
    for (const element of revealedElements.current) delete element.dataset.deckReveal;
    revealedElements.current.clear();
  };

  const revealDeckEnergizedCard = (element: HTMLElement) => {
    const previousTimer = revealTimers.current.get(element);
    if (previousTimer) window.clearTimeout(previousTimer);
    element.dataset.deckReveal = "true";
    revealedElements.current.add(element);
    const timer = window.setTimeout(() => {
      delete element.dataset.deckReveal;
      revealedElements.current.delete(element);
      revealTimers.current.delete(element);
    }, DECK_ENERGIZE_REVEAL_MS);
    revealTimers.current.set(element, timer);
  };

  useEffect(() => () => {
    clearAnimationPresentation();
    clearDeckReveals();
  }, []);

  useLayoutEffect(() => {
    const previous = previousMatch.current;
    previousMatch.current = match;
    if (!match || !previous || previous.id !== match.id) {
      clearAnimationPresentation();
      clearDeckReveals();
      return;
    }

    const transitions = energizeTransitions(previous, match);
    if (!transitions.length) return;

    clearAnimationPresentation();
    const localPlayerId = playerId ?? match.players[0]?.id;
    const activated: HTMLElement[] = [];

    for (const transition of transitions) {
      const owner: ZoneOwner = transition.playerId === localPlayerId ? "player" : "opponent";
      const zone = document.querySelector<HTMLElement>(`[data-zone-id="${owner}-energy"]`);
      if (!zone) continue;
      zone.dataset.energizing = "true";
      activated.push(zone);
      const deckCardIds = transition.playerId === localPlayerId
        ? new Set(transition.deckCards.map((card) => card.id))
        : new Set<string>();
      for (const card of transition.cards) {
        const element = energyCardElement(zone, card.id);
        if (!element) continue;
        element.dataset.energizing = "true";
        activated.push(element);
        if (deckCardIds.has(card.id)) revealDeckEnergizedCard(element);
      }
    }

    if (!activated.length) return;
    window.dispatchEvent(new Event("bbp-card-preview-clear"));
    activeAnimationElements.current = activated;
    animationTimer.current = window.setTimeout(
      clearAnimationPresentation,
      ENERGIZE_ANIMATION_MS,
    );
  }, [match?.id, match?.version, playerId]);

  return null;
}
''')

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            <img
              src={revealFaces ? card.art : CARD_BACK_ART}
              alt={revealFaces ? card.displayName || card.name : ""}
              aria-hidden={!revealFaces}
              data-hidden={revealFaces ? "false" : "true"}
              draggable={false}
            />''',
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
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '''            data-tapped={tapped ? "true" : "false"}
            aria-pressed={tapped}''',
    '''            data-tapped={tapped ? "true" : "false"}
            data-face-visible={revealFaces ? "true" : "false"}
            aria-pressed={tapped}''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
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
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''.energyCard[data-energizing="true"] img {
  animation: energy-card-materialize 760ms cubic-bezier(0.16, 0.82, 0.2, 1) 250ms both;
}
''',
    '''.energyCard[data-energizing="true"] .energyCardVisual {
  animation: energy-card-materialize 760ms cubic-bezier(0.16, 0.82, 0.2, 1) 250ms both;
}
''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''  .energyCard[data-energizing="true"] img,
''',
    '''  .energyCard[data-energizing="true"] .energyCardVisual,
  .energyCardVisual img,
''',
)

with Path("tests/game-screen-state.test.ts").open("a") as file:
    file.write('''

test("deck-to-Energy transitions identify cards eligible for a five-second owner reveal", () => {
  const player = makePlayer("deck-energy-player", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("deck-energy-opponent", "Magnus", STARTER_DECKS[1]);
  const before = createMatch("DECKENERGYFX", "bo1", [player, opponent]);
  const after = structuredClone(before);
  const energized = after.players[0].deckCards.shift();
  assert.ok(energized);
  after.players[0].deck = after.players[0].deckCards.length;
  after.players[0].energyZone.push(energized);
  after.players[0].maxEnergy = after.players[0].energyZone.length;
  after.version += 1;

  const transitions = energizeTransitions(before, after);
  assert.equal(transitions.length, 1);
  assert.deepEqual(transitions[0].deckCards.map((card) => card.id), [energized.id]);

  const fromHand = structuredClone(before);
  const handCard = fromHand.players[0].hand.shift();
  assert.ok(handCard);
  fromHand.players[0].energyZone.push(handCard);
  fromHand.players[0].maxEnergy = fromHand.players[0].energyZone.length;
  fromHand.version += 1;
  assert.deepEqual(energizeTransitions(before, fromHand)[0].deckCards, []);
});
''')

with Path("tests/presentation-stability.test.ts").open("a") as file:
    file.write('''

test("top-deck Energize cards reveal only to their owner for five seconds", () => {
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  const layer = read("components/game-screen-v2/EnergyArrivalLayer.tsx");
  const css = read("components/game-screen-v2/GameScreen.module.css");
  assert.match(screen, /energyCardBack/);
  assert.match(screen, /energyCardFace/);
  assert.match(screen, /data-face-visible/);
  assert.match(layer, /DECK_ENERGIZE_REVEAL_MS = 5000/);
  assert.match(layer, /transition\.playerId === localPlayerId/);
  assert.match(layer, /element\.dataset\.deckReveal = "true"/);
  assert.match(layer, /delete element\.dataset\.deckReveal/);
  assert.match(css, /data-deck-reveal="true"/);
});
''')
