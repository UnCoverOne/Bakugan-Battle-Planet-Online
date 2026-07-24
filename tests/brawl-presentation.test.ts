import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type MatchState, type RollOutcome } from "../lib/game";
import {
  brawlCombatants,
  brawlIsEngaged,
  brawlRollLabel,
} from "../components/game-screen-v2/brawlState";

function roll(
  playerId: string,
  bakuganId: string,
  result: RollOutcome["result"],
): RollOutcome {
  return {
    playerId,
    bakuganId,
    target: "h3-3",
    resolvedTarget: "h3-3",
    result,
    cores: [],
    accuracyRoll: result === "miss-closed" ? 100 : 1,
    deviationRoll: 1,
    doubleRoll: 100,
    secondCoreRoll: 100,
    doubleCore: false,
    path: [{ x: 900, y: 1090 }, { x: 900, y: 500 }, { x: 900, y: 450 }],
    note: result === "miss-closed"
      ? "The Bakugan remained closed."
      : "The Bakugan opened.",
  };
}

function previewMatch(phase: MatchState["phase"], opponentMissed = true) {
  const player = makePlayer("player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("opponent", "Opponent", STARTER_DECKS[1]);
  const match = createMatch("PREVIEW", "bo1", [player, opponent]);
  const playerBakugan = player.bakugan[0];
  const opponentBakugan = opponent.bakugan[0];

  match.turn = 1;
  match.phase = phase;
  match.stepLabel = phase === "victor"
    ? "Brawl Phase • Victor Step"
    : phase === "damage"
      ? "Damage Step • 3 incoming"
      : "Brawl Phase • Power Step";
  match.selected = {
    [player.id]: playerBakugan.id,
    [opponent.id]: opponentBakugan.id,
  };
  match.rolls = {
    [player.id]: roll(player.id, playerBakugan.id, "open-no-core"),
    [opponent.id]: roll(
      opponent.id,
      opponentBakugan.id,
      opponentMissed ? "miss-closed" : "open-no-core",
    ),
  };
  playerBakugan.open = true;
  opponentBakugan.open = !opponentMissed;
  match.brawlWinner = opponentMissed ? player.id : "";
  return match;
}

test("the Brawl Preview keeps both selected Bakugan visible when one roll misses", () => {
  const match = previewMatch("power", true);
  const views = brawlCombatants(match, "player");

  assert.equal(brawlIsEngaged(match), true);
  assert.equal(views.length, 2);
  assert.equal(views[0].participating, true);
  assert.equal(views[1].participating, false);
  assert.equal(views[1].rollResult, "miss-closed");
  assert.equal(views[1].rollLabel, "MISS • CLOSED");
  assert.equal(views[1].power, 0);
  assert.equal(views[1].damage, 0);
  assert.match(views[1].modifiers[0], /Missed and remained closed/);
});

test("the Brawl Preview persists through Victor and closes when Damage begins", () => {
  assert.equal(brawlCombatants(previewMatch("power"), "player").length, 2);
  assert.equal(brawlCombatants(previewMatch("victor"), "player").length, 2);
  assert.equal(brawlCombatants(previewMatch("damage"), "player").length, 0);
});

test("contested Brawls still expose two active combatants and descriptive roll labels", () => {
  const views = brawlCombatants(previewMatch("power", false), "player");
  assert.equal(views.length, 2);
  assert.ok(views.every((view) => view.participating));
  assert.equal(brawlRollLabel("intended-core"), "OPEN • INTENDED CORE");
  assert.equal(brawlRollLabel("path-intercept"), "OPEN • PATH INTERCEPT");
});

test("the larger Brawl Preview uses a floating hover window for Effects and Modifiers", async () => {
  const css = await readFile(
    new URL("../components/game-screen-v2/BrawlPreviewEnhancements.module.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /max-width:\s*min\(32rem/);
  assert.match(
    css,
    /article\s*>\s*div:first-child\s*>\s*div:last-child\s+strong\s*\{[\s\S]*?white-space:\s*normal;/,
  );
  assert.match(
    css,
    /article\s*>\s*div:nth-child\(3\)\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?visibility:\s*hidden;/,
  );
  assert.match(
    css,
    /article:hover\s*>\s*div:nth-child\(3\)\s*\{[\s\S]*?visibility:\s*visible;/,
  );
  assert.match(css, /\.brawlPreview::before\s*\{/);
});

test("Selection focuses Character Cards while Rolling focuses the Hide Matrix", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL("../components/game-screen-v2/PhaseTransitionLayer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../components/game-screen-v2/PhaseTransitionLayer.module.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(source, /PHASE_TRANSITION_DURATION_MS\s*=\s*4200/);
  assert.match(
    source,
    /case\s+"selection":[\s\S]*?primarySelector:\s*'\[data-zone-group="character-cards"\]\[data-zone-owner="player"\]'/,
  );
  assert.match(
    source,
    /case\s+"rolling":[\s\S]*?primarySelector:\s*'\[aria-label="BakuCores in the Hide Matrix"\]'/,
  );
  assert.match(css, /animation:\s*transition-callout\s+4000ms/);
  assert.match(
    css,
    /data-turn-transition-step="selection"\]\s*\[data-zone-kind="character-card"\]/,
  );
  assert.match(
    css,
    /data-turn-transition-step="rolling"\]\s*\[aria-label="BakuCores in the Hide Matrix"\]/,
  );
});
