from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


Path("components/game-screen-v2/energizeAnimationState.ts").write_text('''import type { GameCard, MatchState } from "../../lib/game";

export type EnergizeTransition = {
  playerId: string;
  cards: readonly GameCard[];
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
    const previousIds = new Set(before.energyZone.map((card) => card.id));
    const cards = player.energyZone.filter((card) => !previousIds.has(card.id));
    return cards.length ? [{ playerId: player.id, cards }] : [];
  });
}
''')

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
    '''        <img src={ENERGY_SYMBOL_ART} alt="Energy" draggable={false} />
      </strong>
    </div>''',
    '''        <img src={ENERGY_SYMBOL_ART} alt="Energy" draggable={false} />
      </strong>
      <strong className={styles.zoneCount} aria-hidden="true">
        {safeCardCount(energy.cards.length)}
      </strong>
    </div>''',
)

replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    'import { EnergyAffordabilityLayer } from "./EnergyAffordabilityLayer";\n',
    'import { EnergyAffordabilityLayer } from "./EnergyAffordabilityLayer";\nimport { EnergyArrivalLayer } from "./EnergyArrivalLayer";\n',
)

replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '''        <SelectionInteractionLayer
          match={storedState.match}''',
    '''        <EnergyArrivalLayer
          match={storedState.match}
          playerId={storedState.playerId}
        />
        <SelectionInteractionLayer
          match={storedState.match}''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''  transform: translateY(-50%);
  transform-origin: center;''',
    '''  --energy-rotation: 0deg;
  transform: translateY(-50%) rotate(var(--energy-rotation));
  transform-origin: center;''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''.opponentCardStackArea .energyCard {
  transform: translateY(-50%) rotate(180deg);
}

.energyCardTapped {
  transform: translateY(-50%) rotate(90deg);
}

.opponentCardStackArea .energyCardTapped {
  transform: translateY(-50%) rotate(270deg);
}''',
    '''.opponentCardStackArea .energyCard {
  --energy-rotation: 180deg;
}

.energyCardTapped {
  --energy-rotation: 90deg;
}

.opponentCardStackArea .energyCardTapped {
  --energy-rotation: 270deg;
}''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''.cardStackZones {
  display: grid;''',
    '''.energyZone[data-energizing="true"]::after {
  content: "";
  position: absolute;
  inset: -2px;
  z-index: 82;
  border: 2px solid rgba(255, 255, 255, 0.98);
  border-radius: 5px;
  box-shadow:
    inset 0 0 0.5rem rgba(255, 255, 255, 0.62),
    0 0 0.28rem rgba(255, 255, 255, 0.96),
    0 0 1.2rem rgba(225, 240, 255, 0.82);
  opacity: 0;
  pointer-events: none;
  animation: energy-zone-light-frame 560ms cubic-bezier(0.2, 0.78, 0.2, 1) both;
}

.energyCard[data-energizing="true"] {
  z-index: 84;
}

.energyCard[data-energizing="true"] img {
  animation: energy-card-materialize 760ms cubic-bezier(0.16, 0.82, 0.2, 1) 250ms both;
}

.energyCard[data-energizing="true"]::before,
.energyCard[data-energizing="true"]::after {
  content: "";
  position: absolute;
  z-index: 4;
  pointer-events: none;
}

.energyCard[data-energizing="true"]::before {
  inset: -12%;
  border-radius: 10%;
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.96) 0 6%, rgba(225, 242, 255, 0.66) 18%, transparent 62%);
  mix-blend-mode: screen;
  opacity: 0;
  animation: energy-lightning-flash 720ms steps(2, end) 220ms both;
}

.energyCard[data-energizing="true"]::after {
  top: -12%;
  left: 38%;
  width: 24%;
  height: 124%;
  background: #fff;
  clip-path: polygon(52% 0, 100% 0, 66% 38%, 91% 38%, 25% 100%, 43% 53%, 12% 53%);
  filter:
    drop-shadow(0 0 0.18rem rgba(255, 255, 255, 1))
    drop-shadow(0 0 0.62rem rgba(218, 240, 255, 0.96));
  opacity: 0;
  animation: energy-lightning-bolt 640ms cubic-bezier(0.2, 0.8, 0.2, 1) 250ms both;
}

@keyframes energy-zone-light-frame {
  0% { opacity: 0; transform: scale(0.92); }
  24% { opacity: 1; transform: scale(1); }
  68% { opacity: 0.92; transform: scale(1.015); }
  100% { opacity: 0; transform: scale(1.035); }
}

@keyframes energy-card-materialize {
  0% {
    opacity: 0;
    transform: scale(0.72);
    filter: brightness(2.5) blur(6px);
  }
  44% {
    opacity: 0.92;
    transform: scale(1.08);
    filter: brightness(2.05) blur(1px);
  }
  72% {
    opacity: 1;
    transform: scale(0.98);
    filter: brightness(1.35) blur(0);
  }
  100% {
    opacity: 1;
    transform: scale(1);
    filter: brightness(1) blur(0);
  }
}

@keyframes energy-lightning-flash {
  0%, 12%, 36%, 58%, 100% { opacity: 0; }
  18%, 30%, 44%, 66% { opacity: 1; }
}

@keyframes energy-lightning-bolt {
  0%, 18% { opacity: 0; transform: translateY(-8%) scaleY(0.45); }
  28% { opacity: 1; transform: translateY(0) scaleY(1.06); }
  44% { opacity: 0.22; transform: translateY(2%) scaleY(0.92); }
  56% { opacity: 1; transform: translateY(0) scaleY(1); }
  100% { opacity: 0; transform: translateY(6%) scaleY(0.82); }
}

.cardStackZones {
  display: grid;''',
)

replace_once(
    "components/game-screen-v2/GameScreen.module.css",
    '''  .energyCard,
  .deckBackStack,''',
    '''  .energyCard,
  .energyZone[data-energizing="true"]::after,
  .energyCard[data-energizing="true"] img,
  .energyCard[data-energizing="true"]::before,
  .energyCard[data-energizing="true"]::after,
  .deckBackStack,''',
)

replace_once(
    "tests/game-screen-state.test.ts",
    'import { discardFlipTransitions } from "../components/game-screen-v2/discardFlipAnimationState";\n',
    'import { discardFlipTransitions } from "../components/game-screen-v2/discardFlipAnimationState";\nimport { energizeTransitions } from "../components/game-screen-v2/energizeAnimationState";\n',
)

with Path("tests/game-screen-state.test.ts").open("a") as file:
    file.write('''

test("Energize transitions report only cards newly added to the Energy Zone", () => {
  const player = makePlayer("energy-player", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("energy-opponent", "Magnus", STARTER_DECKS[1]);
  const before = createMatch("ENERGYFX", "bo1", [player, opponent]);
  const after = structuredClone(before);
  const energized = after.players[0].hand.shift();
  assert.ok(energized);
  after.players[0].energyZone.push(energized);
  after.players[0].maxEnergy = after.players[0].energyZone.length;
  after.version += 1;

  const transitions = energizeTransitions(before, after);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].playerId, player.id);
  assert.deepEqual(transitions[0].cards.map((card) => card.id), [energized.id]);

  const tappedOnly = structuredClone(after);
  tappedOnly.players[0].energy = 1;
  tappedOnly.version += 1;
  assert.deepEqual(energizeTransitions(after, tappedOnly), []);
  assert.deepEqual(energizeTransitions(null, after), []);

  const differentMatch = structuredClone(after);
  differentMatch.id = "DIFFERENT-ENERGY-MATCH";
  assert.deepEqual(energizeTransitions(before, differentMatch), []);
});
''')

with Path("tests/presentation-stability.test.ts").open("a") as file:
    file.write('''

test("Energy zones show total cards and stage a white-light Energize arrival", () => {
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  const client = read("components/game-screen-v2/GameplayClient.tsx");
  const layer = read("components/game-screen-v2/EnergyArrivalLayer.tsx");
  const css = read("components/game-screen-v2/GameScreen.module.css");
  assert.match(screen, /\{safeCardCount\(energy\.cards\.length\)\}/);
  assert.match(client, /<EnergyArrivalLayer/);
  assert.match(layer, /energizeTransitions/);
  assert.match(layer, /dataset\.energizing = "true"/);
  assert.match(css, /@keyframes energy-zone-light-frame/);
  assert.match(css, /@keyframes energy-card-materialize/);
  assert.match(css, /@keyframes energy-lightning-flash/);
  assert.match(css, /@keyframes energy-lightning-bolt/);
  assert.match(css, /prefers-reduced-motion[\s\S]*energyZone\[data-energizing/);
});
''')
