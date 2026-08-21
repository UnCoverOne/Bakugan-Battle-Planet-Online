import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard } from "../lib/game";
import {
  COIN_FLIP_RECOVERY_GRACE_MS,
  coinFlipRecoveryAt,
  nextMatchAlarmAt,
  resolveExpiredDeadline,
} from "../lib/deadlines";
import { apiActionToCommand } from "../lib/engine/commands";
import { dispatchRulesCommand } from "../lib/rules/runtime";

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function addUntappedEnergy(player: ReturnType<typeof makePlayer>, amount: number) {
  player.energyZone = Array.from({ length: amount }, (_, index) => (
    card("bb-10", `${player.id}-energy-${index}`)
  ));
  player.energy = 0;
}

function lostAtSeaDamageState() {
  const defender = makePlayer("coin-recovery-defender", "Defender", STARTER_DECKS[0]);
  const attacker = makePlayer("coin-recovery-attacker", "Attacker", STARTER_DECKS[1]);
  const lostAtSea = card("br-62", "lost-at-sea-recovery-test");
  defender.discard = [lostAtSea];
  addUntappedEnergy(defender, 2);

  const state = createMatch("COINRC", "bo1", [defender, attacker]);
  state.turn = 2;
  state.phase = "damage";
  state.stepLabel = "Damage Step • Flip decision • 3 remaining";
  state.startingPlayer = attacker.id;
  state.initialStartingPlayer = defender.id;
  state.priority = defender.id;
  state.pendingLoser = defender.id;
  state.pendingDamage = 3;
  state.damageOrigin = attacker.bakugan[0].id;
  state.damageFaction = attacker.bakugan[0].faction;
  state.revealedFlip = lostAtSea;
  state.selected[defender.id] = defender.bakugan[0].id;
  state.selected[attacker.id] = attacker.bakugan[0].id;
  defender.bakugan[0].open = true;
  attacker.bakugan[0].open = true;

  return { state, defender, attacker, lostAtSea };
}

function suspendLostAtSea() {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });
  assert.ok(state.pendingCoinFlip);
  return { state, defender, attacker, lostAtSea };
}

test("online transport exposes the same coin-flip completion command as the gameplay client", () => {
  const route = readFileSync("app/api/game/route.ts", "utf8");
  const gameplay = readFileSync("components/game-screen-v2/GameplayClient.tsx", "utf8");
  const coinLayer = readFileSync("components/game-screen-v2/CoinFlipLayer.tsx", "utf8");

  assert.match(route, /ACTIONS[\s\S]*"complete-coin-flip"/);
  assert.match(gameplay, /submitMatchAction\(\s*"complete-coin-flip"/);
  assert.deepEqual(apiActionToCommand("complete-coin-flip", {}), { type: "COMPLETE_COIN_FLIP" });

  // The acknowledgement is a rules-liveness handshake, so a one-shot network
  // failure must be retried while the same pending flip is still visible.
  assert.match(coinLayer, /COIN_FLIP_COMPLETION_RETRY_MS/);
  assert.match(coinLayer, /catch[\s\S]*scheduleCompletion\(COIN_FLIP_COMPLETION_RETRY_MS\)/);
  assert.match(coinLayer, /pending\.resolveAt - Date\.now\(\)/);
});

test("coin flip recovery gets its own alarm before the generic action deadline", () => {
  const { state } = suspendLostAtSea();
  const recoveryAt = coinFlipRecoveryAt(state);
  assert.ok(recoveryAt != null);
  assert.equal(recoveryAt, state.pendingCoinFlip!.resolveAt + COIN_FLIP_RECOVERY_GRACE_MS);
  assert.ok(recoveryAt < state.deadline);

  const alarmAt = nextMatchAlarmAt(state, state.pendingCoinFlip!.createdAt);
  assert.equal(alarmAt, recoveryAt);

  const notYet = resolveExpiredDeadline(state, recoveryAt - 1);
  assert.ok(notYet.pendingCoinFlip);
  assert.equal(notYet.pendingDamage, 3);
});

test("server recovery resumes Lost at Sea and applies heads even if the UI acknowledgement is lost", () => {
  const { state } = suspendLostAtSea();
  const effectId = state.pendingCoinFlip!.sourceEffectId;
  state.pendingCoinFlip!.result = "heads";
  state.coinFlipResults[effectId] = "heads";
  const recoveryAt = coinFlipRecoveryAt(state);
  assert.ok(recoveryAt != null);

  const recovered = resolveExpiredDeadline(state, recoveryAt);

  assert.equal(recovered.pendingCoinFlip, undefined);
  assert.equal(recovered.coinFlipResults[effectId], undefined);
  assert.equal(recovered.pendingDamage, 0);
  assert.equal(recovered.phase, "postDamage");
});
