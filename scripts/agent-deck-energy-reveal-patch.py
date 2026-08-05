from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


Path("lib/energyVisibility.ts").write_text('''export const DECK_ENERGY_FACE_REVEAL_MS = 5_000;

export type EnergyEntrySource = "hand" | "deck" | "hero" | "self";

export type EnergyVisibilityCard = {
  id: string;
  energyFaceRevealUntil?: number;
};

/**
 * Record whether an Energized card may be shown to its owner. Only cards moved
 * from the top of the deck receive a temporary face-up window. Re-energizing a
 * card from another zone clears any stale reveal deadline carried by the card.
 */
export function applyEnergyEntryVisibility<T extends EnergyVisibilityCard>(
  cards: readonly T[],
  source: EnergyEntrySource,
  energizedAt = Date.now(),
) {
  const revealUntil = source === "deck"
    ? energizedAt + DECK_ENERGY_FACE_REVEAL_MS
    : undefined;
  for (const card of cards) {
    if (revealUntil == null) delete card.energyFaceRevealUntil;
    else card.energyFaceRevealUntil = revealUntil;
  }
}

export function deckEnergyFaceVisible(
  card: EnergyVisibilityCard,
  now: number,
) {
  const revealUntil = card.energyFaceRevealUntil;
  return typeof revealUntil === "number"
    && Number.isFinite(revealUntil)
    && revealUntil > now;
}

export function nextDeckEnergyFaceRevealExpiry(
  cards: readonly EnergyVisibilityCard[],
  now: number,
) {
  let next: number | null = null;
  for (const card of cards) {
    const revealUntil = card.energyFaceRevealUntil;
    if (typeof revealUntil !== "number" || !Number.isFinite(revealUntil) || revealUntil <= now) continue;
    if (next == null || revealUntil < next) next = revealUntil;
  }
  return next;
}
''')

replace_once(
    "lib/game.ts",
    'import { collectRuleTriggers } from "./rules/triggers";\n',
    'import { collectRuleTriggers } from "./rules/triggers";\nimport { applyEnergyEntryVisibility } from "./energyVisibility";\n',
)

replace_once(
    "lib/game.ts",
    '  /** Turn in which this physical card instance entered play. */\n  playedTurn?: number;\n};',
    '  /** Turn in which this physical card instance entered play. */\n  playedTurn?: number;\n  /** Owner-only deadline for a card Energized from the top of the deck. */\n  energyFaceRevealUntil?: number;\n};',
)

replace_once(
    "lib/game.ts",
    '    const [card] = player.hand.splice(index, 1); player.energyZone.push(card); player.maxEnergy += 1; player.energy += 1;',
    '    const [card] = player.hand.splice(index, 1);\n    applyEnergyEntryVisibility([card], "hand");\n    player.energyZone.push(card);\n    player.maxEnergy += 1;\n    player.energy += 1;',
)

replace_once(
    "lib/game.ts",
    '        player.hand = player.hand.filter((candidate) => !selected.has(candidate.id));\n        player.energyZone.push(...energized);',
    '        player.hand = player.hand.filter((candidate) => !selected.has(candidate.id));\n        applyEnergyEntryVisibility(energized, "hand");\n        player.energyZone.push(...energized);',
)

replace_once(
    "lib/game.ts",
    '        player.energyZone.push(...energized);\n        applyEnergizedEntryState(state, player, energized, action.enters);\n        syncDeck(player);',
    '        applyEnergyEntryVisibility(energized, "deck");\n        player.energyZone.push(...energized);\n        applyEnergizedEntryState(state, player, energized, action.enters);\n        syncDeck(player);',
)

replace_once(
    "lib/game.ts",
    '            const energized = owner.heroes.splice(index, 1);\n            owner.energyZone.push(...energized);',
    '            const energized = owner.heroes.splice(index, 1);\n            applyEnergyEntryVisibility(energized, "hero");\n            owner.energyZone.push(...energized);',
)

replace_once(
    "lib/game.ts",
    '        player.discard = player.discard.filter((candidate) => candidate.id !== card.id);\n        player.energyZone.push(card);',
    '        player.discard = player.discard.filter((candidate) => candidate.id !== card.id);\n        applyEnergyEntryVisibility([card], "self");\n        player.energyZone.push(card);',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    'import { useEffect, useRef, useState } from "react";',
    'import { useEffect, useLayoutEffect, useRef, useState } from "react";',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '} from "../../lib/energy";\n',
    '} from "../../lib/energy";\nimport {\n  deckEnergyFaceVisible,\n  nextDeckEnergyFaceRevealExpiry,\n} from "../../lib/energyVisibility";\n',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  canTap,\n  revealFaces = false,\n}: {\n  owner: ZoneOwner;\n  energy: EnergyZoneView;\n  pendingCardId?: string;\n  onTap?: EnergyTapHandler;\n  canTap?: (cardId: string) => boolean;\n  revealFaces?: boolean;\n}) {',
    '  canTap,\n  revealFaces = false,\n  temporaryRevealCardIds,\n}: {\n  owner: ZoneOwner;\n  energy: EnergyZoneView;\n  pendingCardId?: string;\n  onTap?: EnergyTapHandler;\n  canTap?: (cardId: string) => boolean;\n  revealFaces?: boolean;\n  temporaryRevealCardIds?: ReadonlySet<string>;\n}) {',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '        const tapped = tappedIds.has(card.id);\n        const actionable = owner === "player"',
    '        const tapped = tappedIds.has(card.id);\n        const faceVisible = revealFaces || temporaryRevealCardIds?.has(card.id) === true;\n        const actionable = owner === "player"',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '              src={revealFaces ? card.art : CARD_BACK_ART}\n              alt={revealFaces ? card.displayName || card.name : ""}\n              aria-hidden={!revealFaces}\n              data-hidden={revealFaces ? "false" : "true"}',
    '              src={faceVisible ? card.art : CARD_BACK_ART}\n              alt={faceVisible ? card.displayName || card.name : ""}\n              aria-hidden={!faceVisible}\n              data-hidden={faceVisible ? "false" : "true"}',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  canTap,\n  revealFaces = false,\n}: {\n  owner: ZoneOwner;\n  energy: EnergyZoneView;\n  pendingCardId?: string;\n  onTap?: EnergyTapHandler;\n  canTap?: (cardId: string) => boolean;\n  revealFaces?: boolean;\n}) {\n  return (',
    '  canTap,\n  revealFaces = false,\n  temporaryRevealCardIds,\n}: {\n  owner: ZoneOwner;\n  energy: EnergyZoneView;\n  pendingCardId?: string;\n  onTap?: EnergyTapHandler;\n  canTap?: (cardId: string) => boolean;\n  revealFaces?: boolean;\n  temporaryRevealCardIds?: ReadonlySet<string>;\n}) {\n  return (',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '        canTap={canTap}\n        revealFaces={revealFaces}\n      />',
    '        canTap={canTap}\n        revealFaces={revealFaces}\n        temporaryRevealCardIds={temporaryRevealCardIds}\n      />',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  canTapEnergyCard,\n  revealEnergyFaces = false,\n  drawAvailable = false,',
    '  canTapEnergyCard,\n  revealEnergyFaces = false,\n  temporaryEnergyRevealCardIds,\n  drawAvailable = false,',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  canTapEnergyCard?: (cardId: string) => boolean;\n  revealEnergyFaces?: boolean;\n  drawAvailable?: boolean;',
    '  canTapEnergyCard?: (cardId: string) => boolean;\n  revealEnergyFaces?: boolean;\n  temporaryEnergyRevealCardIds?: ReadonlySet<string>;\n  drawAvailable?: boolean;',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '          canTap={canTapEnergyCard}\n          revealFaces={revealEnergyFaces}\n        />',
    '          canTap={canTapEnergyCard}\n          revealFaces={revealEnergyFaces}\n          temporaryRevealCardIds={temporaryEnergyRevealCardIds}\n        />',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  const [drawClock, setDrawClock] = useState(() => Date.now());\n  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);',
    '  const [drawClock, setDrawClock] = useState(() => Date.now());\n  const [energyRevealClock, setEnergyRevealClock] = useState(() => Date.now());\n  const [openDiscardOwner, setOpenDiscardOwner] = useState<ZoneOwner | null>(null);',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);\n  const localPlayerId = playerId ?? match?.players[0]?.id;',
    '  const revealOpponentAiCards = useAdministratorAiVisibility(match, playerId);\n  const localPlayerId = playerId ?? match?.players[0]?.id;\n  const temporaryEnergyFaceCardIds = new Set(\n    energyState.player.cards\n      .filter((card) => deckEnergyFaceVisible(card, energyRevealClock))\n      .map((card) => card.id),\n  );',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '  useEffect(() => {\n    setDrawClock(Date.now());',
    '  useLayoutEffect(() => {\n    setEnergyRevealClock(Date.now());\n  }, [match?.id, match?.version]);\n\n  useEffect(() => {\n    const expiresAt = nextDeckEnergyFaceRevealExpiry(energyState.player.cards, energyRevealClock);\n    if (expiresAt == null) return;\n    const delay = Math.max(0, expiresAt - Date.now());\n    const timeout = window.setTimeout(() => setEnergyRevealClock(Date.now()), delay + 20);\n    return () => window.clearTimeout(timeout);\n  }, [match?.id, match?.version, energyRevealClock]);\n\n  useEffect(() => {\n    setDrawClock(Date.now());',
)

replace_once(
    "components/game-screen-v2/GameScreen.tsx",
    '            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}\n            drawAvailable={drawAvailable}',
    '            canTapEnergyCard={(cardId) => energyCardCanTap(match, playerId, cardId)}\n            temporaryEnergyRevealCardIds={temporaryEnergyFaceCardIds}\n            drawAvailable={drawAvailable}',
)

replace_once(
    "package.json",
    'tests/profile-customization.test.ts tests/presentation-stability.test.ts && node --test tests/rendered-html.test.mjs',
    'tests/profile-customization.test.ts tests/deck-energy-reveal.test.ts tests/presentation-stability.test.ts && node --test tests/rendered-html.test.mjs',
)

Path("tests/deck-energy-reveal.test.ts").write_text('''import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, redactForPlayer } from "../lib/game";
import {
  DECK_ENERGY_FACE_REVEAL_MS,
  applyEnergyEntryVisibility,
  deckEnergyFaceVisible,
  nextDeckEnergyFaceRevealExpiry,
} from "../lib/energyVisibility";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("top-deck Energize grants exactly five seconds of owner visibility", () => {
  const first = { id: "first-energy", energyFaceRevealUntil: undefined as number | undefined };
  const second = { id: "second-energy", energyFaceRevealUntil: undefined as number | undefined };
  applyEnergyEntryVisibility([first, second], "deck", 10_000);

  assert.equal(DECK_ENERGY_FACE_REVEAL_MS, 5_000);
  assert.equal(first.energyFaceRevealUntil, 15_000);
  assert.equal(second.energyFaceRevealUntil, 15_000);
  assert.equal(deckEnergyFaceVisible(first, 14_999), true);
  assert.equal(deckEnergyFaceVisible(first, 15_000), false);
  assert.equal(nextDeckEnergyFaceRevealExpiry([first, second], 10_000), 15_000);
  assert.equal(nextDeckEnergyFaceRevealExpiry([first, second], 15_000), null);
});

test("Energizing from a non-deck zone clears a stale face-reveal deadline", () => {
  for (const source of ["hand", "hero", "self"] as const) {
    const card = { id: `${source}-energy`, energyFaceRevealUntil: 99_999 };
    applyEnergyEntryVisibility([card], source, 10_000);
    assert.equal(card.energyFaceRevealUntil, undefined);
  }
});

test("temporary Energy faces remain private to their owner", () => {
  const player = makePlayer("reveal-player", "Dan", STARTER_DECKS[0]);
  const opponent = makePlayer("reveal-opponent", "Magnus", STARTER_DECKS[1]);
  const match = createMatch("DECKENERGYREVEAL", "bo1", [player, opponent]);
  const livePlayer = match.players.find((candidate) => candidate.id === player.id)!;
  const liveOpponent = match.players.find((candidate) => candidate.id === opponent.id)!;
  const playerCard = livePlayer.hand.pop()!;
  const opponentCard = liveOpponent.hand.pop()!;
  applyEnergyEntryVisibility([playerCard], "deck", 1_000);
  applyEnergyEntryVisibility([opponentCard], "deck", 1_000);
  livePlayer.energyZone.push(playerCard);
  liveOpponent.energyZone.push(opponentCard);

  const redacted = redactForPlayer(match, livePlayer.id);
  const ownEnergy = redacted.players.find((candidate) => candidate.id === livePlayer.id)!.energyZone[0];
  const hiddenOpponentEnergy = redacted.players.find((candidate) => candidate.id === liveOpponent.id)!.energyZone[0];
  assert.equal(ownEnergy.id, playerCard.id);
  assert.equal(ownEnergy.energyFaceRevealUntil, 6_000);
  assert.notEqual(hiddenOpponentEnergy.id, opponentCard.id);
  assert.equal(hiddenOpponentEnergy.energyFaceRevealUntil, undefined);
});

test("engine and game screen wire the reveal only to deck entries and the local Energy zone", () => {
  const game = read("lib/game.ts");
  const screen = read("components/game-screen-v2/GameScreen.tsx");
  assert.match(game, /applyEnergyEntryVisibility\(energized, "deck"\);/);
  assert.match(game, /applyEnergyEntryVisibility\(energized, "hand"\);/);
  assert.match(screen, /temporaryEnergyFaceCardIds/);
  assert.match(screen, /temporaryEnergyRevealCardIds=\{temporaryEnergyFaceCardIds\}/);

  const opponentStart = screen.indexOf('owner="opponent"');
  const playerStart = screen.indexOf('owner="player"', opponentStart + 1);
  assert.ok(opponentStart >= 0 && playerStart > opponentStart);
  assert.doesNotMatch(screen.slice(opponentStart, playerStart), /temporaryEnergyRevealCardIds/);
});
''')
