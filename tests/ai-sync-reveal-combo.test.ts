import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import {
  createMatch,
  passPriority,
  submitCardChoice,
  totalPower,
  type GameCard,
  type MatchState,
} from "../lib/game";
import { playCardWithAutoEnergy } from "../lib/cardPayment";
import { chooseOpponentAiCommand } from "../lib/opponentAi";

function card(catalogId: string, id: string): GameCard {
  const printed = CARDS.find((entry) => entry.catalogId === catalogId);
  assert.ok(printed, `Missing ${catalogId}`);
  return { ...printed, id };
}

function roundThree(aiPower = 1450, opponentPower = 2100): MatchState {
  const ai = makePlayer("training-bot", "Training AI", STARTER_DECKS[0]);
  const opponent = makePlayer("human", "UnCover", STARTER_DECKS[1]);
  const state = createMatch("AI-SYNC-REVEAL", "bo1", [ai, opponent]);
  state.phase = "power";
  state.stepLabel = "Brawl Phase • Power Step";
  state.turn = 3;
  state.priority = ai.id;
  state.startingPlayer = ai.id;
  const activeAi = state.players[0];
  const activeOpponent = state.players[1];
  for (const [owner, power] of [[activeAi, aiPower], [activeOpponent, opponentPower]] as const) {
    const selected = owner.bakugan[0];
    selected.open = true;
    selected.bPower = power;
    selected.character.bPower = power;
    selected.heldCoreCells = [];
    state.selected[owner.id] = selected.id;
  }
  activeAi.energy = 0;
  activeAi.energyZone = [card("ff-9", "energy-1"), card("ff-9", "energy-2")];
  activeAi.hand = [
    card("ff-9", "falling-strike"),
    card("ff-45", "howling-shell-bomb"),
    card("ff-45", "second-shell-bomb"),
    card("av-155", "expensive-inert-sync-reveal"),
  ];
  return state;
}

test("round-three AI starts the affordable Sync play instead of passing against a 650 B deficit", () => {
  const match = roundThree();
  assert.equal(totalPower(match, "training-bot"), 1450);
  assert.equal(totalPower(match, "human"), 2100);
  const command = chooseOpponentAiCommand(match, "training-bot");
  assert.equal(command?.type, "PLAY_CARD");
  if (command?.type === "PLAY_CARD") assert.equal(command.cardId, "falling-strike");
});

test("Sync chooses and plays Howling Shell Bomb without paying five Energy", () => {
  let match = roundThree();
  const first = chooseOpponentAiCommand(match, "training-bot");
  assert.equal(first?.type, "PLAY_CARD");
  if (first?.type !== "PLAY_CARD") return;
  match = playCardWithAutoEnergy(match, "training-bot", first.cardId, first.choices);
  let sawSyncReveal = false;
  for (let step = 0; step < 30 && (match.batch.length || match.pendingChoice); step += 1) {
    if (match.pendingChoice) {
      const next = chooseOpponentAiCommand(match, "training-bot");
      assert.equal(next?.type, "SUBMIT_CARD_CHOICE");
      if (next?.type !== "SUBMIT_CARD_CHOICE") return;
      if (match.pendingChoice.schema.fields.some((field) => field.id === "syncCardId")) {
        sawSyncReveal = true;
        assert.ok(["howling-shell-bomb", "second-shell-bomb"].includes(String(next.choices.syncCardId)));
      }
      match = submitCardChoice(match, "training-bot", next.choices);
    } else {
      match = passPriority(match, match.priority);
    }
  }
  assert.equal(sawSyncReveal, true);
  assert.equal(match.pendingChoice, undefined);
  assert.equal(match.batch.length, 0);
  assert.equal(totalPower(match, "training-bot"), 2550);
  assert.equal(match.players[0].energyZone.length, 2);
  assert.equal(match.players[0].hand.filter((entry) => entry.catalogId === "ff-45").length, 1);
});

test("AI does not spend Falling Strike if even the free follow-up cannot win", () => {
  const match = roundThree(500, 2100);
  const command = chooseOpponentAiCommand(match, "training-bot");
  assert.equal(command?.type, "PASS_PRIORITY");
});

test("AI does not invent a free play from an ordinary expensive Sync reveal", () => {
  const match = roundThree();
  match.players[0].hand = match.players[0].hand.filter((entry) => entry.catalogId !== "ff-45");
  const command = chooseOpponentAiCommand(match, "training-bot");
  assert.equal(command?.type, "PASS_PRIORITY");
});
