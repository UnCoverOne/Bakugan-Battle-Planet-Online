import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard } from "../lib/game";
import { emitRuleEvent } from "../lib/rules/triggers";

const ACTION_ON_THIS_SOURCES = ["bb-221", "bb-261", "br-101", "br-190"] as const;

function card(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function installSource(player: ReturnType<typeof makePlayer>, source: GameCard) {
  const bakugan = player.bakugan[0];
  bakugan.open = true;
  if (source.type === "Character") {
    bakugan.character = source;
    bakugan.name = source.displayName;
    bakugan.faction = source.faction;
    bakugan.bPower = source.bPower ?? bakugan.bPower;
    bakugan.damage = source.damage ?? bakugan.damage;
    bakugan.evoStack = [];
  } else {
    bakugan.evoStack = [source];
  }
  return bakugan;
}

test("Action-on-this triggers keep their source Bakugan as the resolution target", () => {
  for (const catalogId of ACTION_ON_THIS_SOURCES) {
    const player = makePlayer(`player-${catalogId}`, "Player", STARTER_DECKS[0]);
    const opponent = makePlayer(`opponent-${catalogId}`, "Opponent", STARTER_DECKS[1]);
    const state = createMatch(`RESOLVE-${catalogId}`, "bo1", [player, opponent]);
    state.turn = 2;
    state.phase = "power";
    state.startingPlayer = player.id;
    state.priority = player.id;

    const source = card(catalogId, `source-${catalogId}`);
    const sourceBakugan = installSource(player, source);
    const selectedBakugan = player.bakugan[1];
    selectedBakugan.open = true;
    state.selected[player.id] = selectedBakugan.id;
    state.selected[opponent.id] = opponent.bakugan[0].id;

    const targetedAction = card("aa-50", `targeted-action-${catalogId}`);
    emitRuleEvent(state, {
      id: `${catalogId}:source-resolution-target`,
      name: "CARD_PLAYED",
      actorId: player.id,
      controllerId: player.id,
      card: targetedAction,
      cardType: "Action",
      // CARD_PLAYED keeps the selected Bakugan as contextual event data, while
      // the Action's explicit secondary target is the open Action-on-this source.
      targetBakuganId: selectedBakugan.id,
      choices: {
        targetBakuganId: opponent.bakugan[0].id,
        secondaryTargetBakuganId: sourceBakugan.id,
      },
      createdAt: Date.now(),
    });

    const trigger = state.batch.find((object) => object.card.id === source.id);
    assert.ok(trigger, `${catalogId} should create its Action-on-this trigger`);
    assert.equal(trigger.choices.sourceBakuganId, sourceBakugan.id);
    assert.equal(
      trigger.choices.targetBakuganId,
      sourceBakugan.id,
      `${catalogId} must resolve its "this" effect on the Bakugan carrying the trigger`,
    );
    assert.notEqual(trigger.choices.targetBakuganId, selectedBakugan.id);
  }
});
