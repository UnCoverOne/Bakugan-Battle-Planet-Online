from pathlib import Path

TURN_DRAW = '''import type { GameCard, MatchState } from "../game";

export type ExtraTurnDrawTarget = "controller" | "opponent" | "all-players";

export type ExtraTurnDrawModifier = {
  id: string;
  sourceCardId: string;
  controllerId: string;
  target: ExtraTurnDrawTarget;
  amount: number;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const EXTRA_TURN_DRAW = /\\b(all players|each player|you|your opponent)\\s+draws?\\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+)?additional cards?\\s+each turn\\b/gi;

function amountFor(value: string | undefined) {
  if (!value) return 1;
  return NUMBER_WORDS[value.toLowerCase()] ?? Math.max(0, Number(value) || 1);
}

function targetFor(subject: string): ExtraTurnDrawTarget {
  if (/^your opponent$/i.test(subject)) return "opponent";
  if (/^(?:all players|each player)$/i.test(subject)) return "all-players";
  return "controller";
}

/**
 * Compile the generic "additional draw each turn" mechanic from a card's
 * printed rules text. This intentionally has no card-name or catalogue-ID
 * knowledge: any in-play source with matching text activates the same mechanic.
 */
export function extraTurnDrawModifiersForCard(
  card: GameCard,
  controllerId: string,
): ExtraTurnDrawModifier[] {
  const text = card.effect.replace(/\\s+/g, " ").trim();
  return [...text.matchAll(EXTRA_TURN_DRAW)].map((match, index) => ({
    id: `${card.id}:extra-turn-draw:${index}`,
    sourceCardId: card.id,
    controllerId,
    target: targetFor(match[1]),
    amount: amountFor(match[2]),
  }));
}

/**
 * Return every currently active extra-turn-draw modifier.
 *
 * Hero cards activate their static text only while they are in the Hero zone.
 * Each physical copy is evaluated independently, so multiple copies stack.
 */
export function activeExtraTurnDrawModifiers(state: MatchState): ExtraTurnDrawModifier[] {
  return state.players.flatMap((controller) => controller.heroes.flatMap((hero) => (
    extraTurnDrawModifiersForCard(hero, controller.id)
  )));
}

function modifierAffectsPlayer(
  state: MatchState,
  modifier: ExtraTurnDrawModifier,
  playerId: string,
) {
  if (modifier.target === "all-players") return state.players.some((player) => player.id === playerId);
  if (modifier.target === "controller") return modifier.controllerId === playerId;
  return state.players.some((player) => player.id === playerId && player.id !== modifier.controllerId);
}

export function extraTurnDrawsForPlayer(state: MatchState, playerId: string) {
  return activeExtraTurnDrawModifiers(state)
    .filter((modifier) => modifierAffectsPlayer(state, modifier, playerId))
    .reduce((total, modifier) => total + modifier.amount, 0);
}

export function turnDrawCountForPlayer(state: MatchState, playerId: string, baseDraws = 1) {
  return Math.max(0, baseDraws) + extraTurnDrawsForPlayer(state, playerId);
}

export function turnDrawCounts(state: MatchState, baseDraws = 1): Record<string, number> {
  return Object.fromEntries(state.players.map((player) => [
    player.id,
    turnDrawCountForPlayer(state, player.id, baseDraws),
  ]));
}
'''

TEST = '''import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, nextTurn, type GameCard, type MatchState } from "../lib/game";
import {
  activeExtraTurnDrawModifiers,
  extraTurnDrawModifiersForCard,
  turnDrawCounts,
} from "../lib/rules/turn-draw";

function cardInstance(card: GameCard, suffix: string): GameCard {
  return { ...card, id: `${card.catalogId}-${suffix}` };
}

function resetState(): MatchState {
  const first = makePlayer("first", "First", STARTER_DECKS[0]);
  const second = makePlayer("second", "Second", STARTER_DECKS[1]);
  const state = createMatch("DRAWMECH", "bo1", [first, second]);
  state.turn = 0;
  state.phase = "reset";
  state.startingPlayer = first.id;
  state.priority = first.id;
  state.batch = [];
  state.triggerOrders = [];
  state.pendingChoice = undefined;
  return state;
}

const bbStrata = CARDS.find((card) => (
  card.type === "Hero"
  && card.catalogId.startsWith("bb-")
  && card.displayName === "Strata"
  && /all players draw an additional card each turn/i.test(card.effect)
));
const brStrata = CARDS.find((card) => (
  card.type === "Hero"
  && card.catalogId.startsWith("br-")
  && card.displayName === "Strata"
));

assert.ok(bbStrata, "Battle Brawlers Strata must exist in the catalogue");
assert.ok(brStrata, "Bakugan Resurgence Strata must exist in the catalogue");

test("extra-turn draw is a generic rules-text mechanic, not a Strata name check", () => {
  const controllerOnly: GameCard = {
    ...bbStrata,
    id: "generic-controller-draw",
    catalogId: "ex-1",
    displayName: "Generic Draw Source",
    name: "Generic Draw Source",
    effect: "You draw an additional card each turn.",
  };
  const opponentOnly: GameCard = {
    ...bbStrata,
    id: "generic-opponent-draw",
    catalogId: "ex-2",
    displayName: "Generic Opponent Draw Source",
    name: "Generic Opponent Draw Source",
    effect: "Your opponent draws two additional cards each turn.",
  };

  assert.deepEqual(extraTurnDrawModifiersForCard(controllerOnly, "first").map(({ target, amount }) => ({ target, amount })), [
    { target: "controller", amount: 1 },
  ]);
  assert.deepEqual(extraTurnDrawModifiersForCard(opponentOnly, "first").map(({ target, amount }) => ({ target, amount })), [
    { target: "opponent", amount: 2 },
  ]);
  assert.deepEqual(extraTurnDrawModifiersForCard(brStrata, "first"), []);
});

test("Battle Brawlers Strata adds one draw to every player while in play", () => {
  const state = resetState();
  state.players[0].heroes.push(cardInstance(bbStrata, "copy-1"));

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 2,
    [state.players[1].id]: 2,
  });

  const next = nextTurn(state);
  assert.deepEqual(next.drawRemainingByPlayer, {
    [next.players[0].id]: 2,
    [next.players[1].id]: 2,
  });
});

test("multiple Battle Brawlers Strata copies stack independently", () => {
  const state = resetState();
  state.players[0].heroes.push(
    cardInstance(bbStrata, "copy-1"),
    cardInstance(bbStrata, "copy-2"),
  );

  assert.equal(activeExtraTurnDrawModifiers(state).length, 2);
  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 3,
    [state.players[1].id]: 3,
  });
});

test("Battle Brawlers Strata copies controlled by different players also stack", () => {
  const state = resetState();
  state.players[0].heroes.push(cardInstance(bbStrata, "first-copy"));
  state.players[1].heroes.push(cardInstance(bbStrata, "second-copy"));

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 3,
    [state.players[1].id]: 3,
  });
});

test("Bakugan Resurgence Strata does not activate extra-turn draw", () => {
  const state = resetState();
  state.players[0].heroes.push(
    cardInstance(brStrata, "br-copy-1"),
    cardInstance(brStrata, "br-copy-2"),
  );

  assert.equal(activeExtraTurnDrawModifiers(state).length, 0);
  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 1,
    [state.players[1].id]: 1,
  });

  const next = nextTurn(state);
  assert.deepEqual(next.drawRemainingByPlayer, {
    [next.players[0].id]: 1,
    [next.players[1].id]: 1,
  });
});

test("single-player extra-turn draw targets remain asymmetric", () => {
  const state = resetState();
  const controllerOnly: GameCard = {
    ...bbStrata,
    id: "generic-controller-draw",
    catalogId: "ex-1",
    displayName: "Generic Draw Source",
    name: "Generic Draw Source",
    effect: "You draw an additional card each turn.",
  };
  state.players[0].heroes.push(controllerOnly);

  assert.deepEqual(turnDrawCounts(state), {
    [state.players[0].id]: 2,
    [state.players[1].id]: 1,
  });
});
'''

Path("lib/rules/turn-draw.ts").write_text(TURN_DRAW)
Path("tests/turn-draw-mechanic.test.ts").write_text(TEST)

game_path = Path("lib/game.ts")
game = game_path.read_text()
old_import = 'import { evaluateBakuganCharacteristics, ruleConditionActive } from "./rules/modifiers";'
new_import = old_import + '\nimport { turnDrawCounts } from "./rules/turn-draw";'
if old_import not in game:
    raise SystemExit("game.ts modifier import anchor not found")
game = game.replace(old_import, new_import, 1)

old_draw = '''  const now = Date.now();
  const drawCount = 1 + state.players.reduce((total, player) => (
    total + player.heroes.filter((hero) => hero.name === "Strata" || /all players draw an additional card each turn/i.test(hero.effect)).length
  ), 0);
  state.drawPreparedTurn = state.turn;
  state.drawReadyAt = now + (state.turn === 1 ? 3_000 : 0);
  state.drawDeadline = state.drawReadyAt + PHASE_TIMERS.draw * 1_000;
  state.drawnPlayerIds = [];
  state.drawRemainingByPlayer = Object.fromEntries(state.players.map((player) => [player.id, drawCount]));
  setPhase(state, "draw", state.turn === 1 ? `Turn ${state.turn} • Draw Step begins in 3 seconds` : `Turn ${state.turn} • Draw Step`, state.startingPlayer);
  state.deadline = state.drawDeadline;
  entry(state, "game", `Turn ${state.turn} began. Both players have ${drawCount} explicit Draw action${drawCount === 1 ? "" : "s"}.`);
'''
new_draw = '''  const now = Date.now();
  const drawCounts = turnDrawCounts(state);
  state.drawPreparedTurn = state.turn;
  state.drawReadyAt = now + (state.turn === 1 ? 3_000 : 0);
  state.drawDeadline = state.drawReadyAt + PHASE_TIMERS.draw * 1_000;
  state.drawnPlayerIds = [];
  state.drawRemainingByPlayer = drawCounts;
  setPhase(state, "draw", state.turn === 1 ? `Turn ${state.turn} • Draw Step begins in 3 seconds` : `Turn ${state.turn} • Draw Step`, state.startingPlayer);
  state.deadline = state.drawDeadline;
  const drawSummary = state.players.map((player) => {
    const count = drawCounts[player.id] ?? 1;
    return `${player.name} has ${count} explicit Draw action${count === 1 ? "" : "s"}`;
  }).join("; ");
  entry(state, "game", `Turn ${state.turn} began. ${drawSummary}.`);
'''
if old_draw not in game:
    raise SystemExit("game.ts Draw Step anchor not found")
game_path.write_text(game.replace(old_draw, new_draw, 1))

index_path = Path("lib/rules/index.ts")
index = index_path.read_text()
anchor = 'export { evaluateBakuganCharacteristics, activeFrostStrike, ruleConditionActive } from "./modifiers";\n'
export_line = 'export { activeExtraTurnDrawModifiers, extraTurnDrawModifiersForCard, extraTurnDrawsForPlayer, turnDrawCountForPlayer, turnDrawCounts } from "./turn-draw";\n'
if anchor not in index:
    raise SystemExit("rules index export anchor not found")
index_path.write_text(index.replace(anchor, anchor + export_line, 1))

package_path = Path("package.json")
package_text = package_path.read_text()
for script_name in ("test", "test:engine", "test:rules", "test:gameplay"):
    # Insert exactly once immediately after the modern rules suite.
    needle = "tests/rules-engine-modernization.test.ts"
    replacement = needle + " tests/turn-draw-mechanic.test.ts"
    # Limit each script independently by finding its JSON line.
    lines = package_text.splitlines()
    for i, line in enumerate(lines):
        if f'"{script_name}":' in line and replacement not in line:
            lines[i] = line.replace(needle, replacement, 1)
            break
    package_text = "\n".join(lines) + ("\n" if package_text.endswith("\n") else "")
package_path.write_text(package_text)
