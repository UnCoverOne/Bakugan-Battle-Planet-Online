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

test("the controlled catalogue has four Action-on-this trigger sources", () => {
  const sources = CARDS
    .filter((candidate) => /\bwhen you play an Action(?: card)? on this\b/i.test(candidate.effect))
    .map((candidate) => candidate.catalogId)
    .sort();
  assert.deepEqual(sources, [...ACTION_ON_THIS_SOURCES].sort());
});

test("Action-on-this triggers require an actual Bakugan target selection", () => {
  for (const catalogId of ACTION_ON_THIS_SOURCES) {
    const player = makePlayer(`player-${catalogId}`, "Player", STARTER_DECKS[0]);
    const opponent = makePlayer(`opponent-${catalogId}`, "Opponent", STARTER_DECKS[1]);
    const state = createMatch(`TARGET-${catalogId}`, "bo1", [player, opponent]);
    state.turn = 2;
    state.phase = "power";
    state.startingPlayer = player.id;
    state.priority = player.id;

    const source = card(catalogId, `source-${catalogId}`);
    const sourceBakugan = installSource(player, source);
    const otherBakugan = player.bakugan[1];
    state.selected[player.id] = sourceBakugan.id;
    state.selected[opponent.id] = opponent.bakugan[0].id;

    const songOfFire = card("bb-109", `song-of-fire-${catalogId}`);
    emitRuleEvent(state, {
      id: `${catalogId}:song-of-fire`,
      name: "CARD_PLAYED",
      actorId: player.id,
      controllerId: player.id,
      card: songOfFire,
      cardType: "Action",
      // Legacy card-play events can carry the active Bakugan here even when
      // the Action made no target selection. That must not satisfy "on this".
      targetBakuganId: sourceBakugan.id,
      choices: {},
      createdAt: Date.now(),
    });
    assert.equal(
      state.batch.filter((object) => object.card.id === source.id).length,
      0,
      `${catalogId} must not trigger from non-targeting Song of Fire`,
    );

    const targetedAction = card("aa-50", `targeted-action-${catalogId}`);
    emitRuleEvent(state, {
      id: `${catalogId}:other-target`,
      name: "CARD_PLAYED",
      actorId: player.id,
      controllerId: player.id,
      card: targetedAction,
      cardType: "Action",
      targetBakuganId: otherBakugan.id,
      choices: { targetBakuganId: otherBakugan.id },
      createdAt: Date.now(),
    });
    assert.equal(
      state.batch.filter((object) => object.card.id === source.id).length,
      0,
      `${catalogId} must not trigger when the Action targets another Bakugan`,
    );

    emitRuleEvent(state, {
      id: `${catalogId}:source-target`,
      name: "CARD_PLAYED",
      actorId: player.id,
      controllerId: player.id,
      card: targetedAction,
      cardType: "Action",
      targetBakuganId: sourceBakugan.id,
      choices: { targetBakuganId: sourceBakugan.id },
      createdAt: Date.now(),
    });
    assert.equal(
      state.batch.filter((object) => object.card.id === source.id).length,
      1,
      `${catalogId} must trigger when the Action targets its Bakugan`,
    );
  }
});

test("Action-on-this triggers also recognize a secondary Bakugan target", () => {
  const player = makePlayer("secondary-player", "Player", STARTER_DECKS[0]);
  const opponent = makePlayer("secondary-opponent", "Opponent", STARTER_DECKS[1]);
  const state = createMatch("SECONDARYTARGET", "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const source = card("br-190", "secondary-source-trox");
  const sourceBakugan = installSource(player, source);
  state.selected[player.id] = sourceBakugan.id;
  state.selected[opponent.id] = opponent.bakugan[0].id;

  const ventusTrap = card("aa-50", "secondary-ventus-trap");
  emitRuleEvent(state, {
    id: "secondary-target-action",
    name: "CARD_PLAYED",
    actorId: player.id,
    controllerId: player.id,
    card: ventusTrap,
    cardType: "Action",
    targetBakuganId: opponent.bakugan[0].id,
    choices: {
      targetBakuganId: opponent.bakugan[0].id,
      secondaryTargetBakuganId: sourceBakugan.id,
    },
    createdAt: Date.now(),
  });

  assert.equal(state.batch.filter((object) => object.card.id === source.id).length, 1);
});
