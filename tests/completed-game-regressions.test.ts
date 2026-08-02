import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { achievementsFor } from "../lib/achievements";
import { STARTER_DECKS, makePlayer } from "../lib/data";
import { accountStatMatches } from "../lib/match-statistics";
import {
  completeMatch,
  createMatch,
  passPriority,
  type MatchState,
} from "../lib/game";
import {
  compactMatchHudSlots,
  visibleMatchHudActions,
} from "../components/game-screen-v2/matchHudState";

function passWindow(state: MatchState) {
  state = passPriority(state, state.priority);
  return passPriority(state, state.priority);
}

test("a zero-Damage Victor skips damage cards and enters post-damage priority", () => {
  const winner = makePlayer("winner", "Winner", STARTER_DECKS[0]);
  const loser = makePlayer("loser", "Loser", STARTER_DECKS[1]);
  let state = createMatch("ZERODMG", "bo1", [winner, loser]);
  const attacking = winner.bakugan[0];
  attacking.open = true;
  state.phase = "victor";
  state.stepLabel = "Brawl Phase • Victor Step";
  state.startingPlayer = winner.id;
  state.priority = winner.id;
  state.brawlWinner = winner.id;
  state.selected[winner.id] = attacking.id;
  state.damageBoost[attacking.id] = -(attacking.character.damage ?? attacking.damage);
  const loserDeckSize = loser.deckCards.length;

  state = passWindow(state);

  assert.equal(state.pendingDamage, 0);
  assert.equal(state.phase, "postDamage");
  assert.equal(state.priority, winner.id);
  assert.equal(state.revealedFlip, undefined);
  assert.equal(state.players.find((player) => player.id === loser.id)?.deckCards.length, loserDeckSize);
});

test("completed games freeze engine decisions and expose only Exit in the Action HUD", () => {
  const winner = makePlayer("winner", "Winner", STARTER_DECKS[0]);
  const loser = makePlayer("loser", "Loser", STARTER_DECKS[1]);
  const state = createMatch("COMPLETE", "bo1", [winner, loser]);
  state.priority = loser.id;
  state.passes = [winner.id];
  state.pendingChoice = {} as NonNullable<MatchState["pendingChoice"]>;

  completeMatch(state, winner.id, "Regression test");
  const actions = visibleMatchHudActions({
    match: state,
    playerId: winner.id,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });

  assert.equal(state.phase, "result");
  assert.equal(state.priority, "");
  assert.equal(state.pendingChoice, undefined);
  assert.equal(state.undoWindow, undefined);
  assert.deepEqual(Object.entries(actions).filter(([, visible]) => visible).map(([action]) => action), ["exit"]);
  assert.deepEqual(compactMatchHudSlots(actions), ["exit"]);
});

test("practice records stay in history but do not affect account competition statistics", () => {
  const history = [
    { id: "practice", result: "Victor", mode: "training" as const, at: "2026-08-01T00:00:00.000Z" },
    { id: "online", result: "Defeat", mode: "online" as const, at: "2026-08-02T00:00:00.000Z" },
  ];
  assert.deepEqual(accountStatMatches(history).map((record) => record.id), ["online"]);

  const achievements = achievementsFor([], history);
  assert.equal(achievements.find((item) => item.id === "first-win")?.unlocked, false);
  assert.equal(achievements.find((item) => item.id === "training-day")?.unlocked, true);
  assert.equal(achievements.find((item) => item.id === "online")?.unlocked, true);
});

test("completion remains on the gameplay route until the player presses Exit", () => {
  const provider = readFileSync(new URL("../components/application/AppProvider.jsx", import.meta.url), "utf8");
  const gameplay = readFileSync(new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url), "utf8");
  const hud = readFileSync(new URL("../components/game-screen-v2/MatchHudLayer.tsx", import.meta.url), "utf8");
  const menu = readFileSync(new URL("../components/game-screen-v2/GameMenuHud.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../components/application/AppShell.jsx", import.meta.url), "utf8");
  const profile = readFileSync(new URL("../components/routes/ProfileScreen.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(provider, /shouldOpenMatchResult|router\.replace\("\/play\/result"\)/);
  assert.doesNotMatch(gameplay, /match\?\.phase !== "result"[\s\S]{0,180}writeGameRoute\("result"\)/);
  assert.match(gameplay, /const exitCompletedMatch = \(\) => \{[\s\S]*writeGameRoute\("result"\)/);
  assert.match(hud, /exit:\s*\{[\s\S]*label: "Exit"/);
  assert.match(menu, /!completed[\s\S]*Undo Latest Card/);
  assert.match(menu, /!completed[\s\S]*Concede/);
  assert.match(shell, /accountStatMatches\(history\)/);
  assert.match(profile, /const completedGames = accountStatMatches\(history\)/);
});
