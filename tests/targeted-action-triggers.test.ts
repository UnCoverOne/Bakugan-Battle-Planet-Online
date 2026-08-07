import assert from "node:assert/strict";
import test from "node:test";
import { CARDS, STARTER_DECKS, makePlayer } from "../lib/data";
import { createMatch, type GameCard } from "../lib/game";
import { emitRuleEvent } from "../lib/rules/triggers";

const ACTION_ON_THIS_SOURCES = ["bb-221", "bb-261", "br-101", "br-190"] as const;
const IMPLICIT_REROLL_ACTIONS = [
  "br-5",  // Dark Waters
  "br-6",  // Deep Dive
  "br-9",  // Rip Tide
  "br-20", // Mind Slip
  "br-21", // Second Strike
  "br-27", // Divine Intervention
  "br-29", // Haos Blessing
  "br-30", // Spirit Guide
  "br-40", // Dual Strike
  "br-44", // Quickfire
  "br-45", // Superfuel
] as const;

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

function triggerState(sourceCatalogId: string, suffix: string) {
  const player = makePlayer(`player-${suffix}`, "Player", STARTER_DECKS[0]);
  const opponent = makePlayer(`opponent-${suffix}`, "Opponent", STARTER_DECKS[1]);
  const state = createMatch(`TARGET-${suffix}`.slice(0, 24), "bo1", [player, opponent]);
  state.turn = 2;
  state.phase = "power";
  state.startingPlayer = player.id;
  state.priority = player.id;

  const source = card(sourceCatalogId, `source-${suffix}`);
  const sourceBakugan = installSource(player, source);
  state.selected[player.id] = sourceBakugan.id;
  state.selected[opponent.id] = opponent.bakugan[0].id;
  return { state, player, opponent, source, sourceBakugan };
}

test("the controlled catalogue has four Action-on-this trigger sources", () => {
  const sources = CARDS
    .filter((candidate) => /\bwhen you play an Action(?: card)? on this\b/i.test(candidate.effect))
    .map((candidate) => candidate.catalogId)
    .sort();
  assert.deepEqual(sources, [...ACTION_ON_THIS_SOURCES].sort());
});

test("Action-on-this triggers require an Action that is actually played on the source Bakugan", () => {
  for (const catalogId of ACTION_ON_THIS_SOURCES) {
    const { state, opponent, source, sourceBakugan } = triggerState(catalogId, catalogId);
    const otherBakugan = state.players[0].bakugan[1];

    const songOfFire = card("bb-109", `song-of-fire-${catalogId}`);
    emitRuleEvent(state, {
      id: `${catalogId}:song-of-fire`,
      name: "CARD_PLAYED",
      actorId: state.players[0].id,
      controllerId: state.players[0].id,
      card: songOfFire,
      cardType: "Action",
      // Card-play events carry the active Bakugan as contextual event data.
      // A non-Bakugan Action must not turn that context into an "on this" target.
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
      actorId: state.players[0].id,
      controllerId: state.players[0].id,
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
      actorId: state.players[0].id,
      controllerId: state.players[0].id,
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

    assert.ok(opponent);
  }
});

test("Deep Dive and Quickfire implicitly select the active Bakugan for every Action-on-this source", () => {
  for (const sourceCatalogId of ACTION_ON_THIS_SOURCES) {
    for (const actionCatalogId of ["br-6", "br-44"] as const) {
      const suffix = `${sourceCatalogId}-${actionCatalogId}`;
      const { state, player, source, sourceBakugan } = triggerState(sourceCatalogId, suffix);
      const action = card(actionCatalogId, `action-${suffix}`);
      emitRuleEvent(state, {
        id: `${suffix}:implicit-target`,
        name: "CARD_PLAYED",
        actorId: player.id,
        controllerId: player.id,
        card: action,
        cardType: "Action",
        targetBakuganId: sourceBakugan.id,
        choices: {},
        createdAt: Date.now(),
      });
      assert.equal(
        state.batch.filter((object) => object.card.id === source.id).length,
        1,
        `${sourceCatalogId} must trigger from ${action.displayName}`,
      );
    }
  }
});

test("all controller-reroll Actions use the same implicit active-Bakugan targeting path", () => {
  for (const actionCatalogId of IMPLICIT_REROLL_ACTIONS) {
    const suffix = `br-101-${actionCatalogId}`;
    const { state, player, source, sourceBakugan } = triggerState("br-101", suffix);
    const action = card(actionCatalogId, `action-${suffix}`);
    assert.match(action.effect, /Reroll/i);
    emitRuleEvent(state, {
      id: `${suffix}:reroll-target`,
      name: "CARD_PLAYED",
      actorId: player.id,
      controllerId: player.id,
      card: action,
      cardType: "Action",
      targetBakuganId: sourceBakugan.id,
      choices: {},
      createdAt: Date.now(),
    });
    assert.equal(
      state.batch.filter((object) => object.card.id === source.id).length,
      1,
      `${action.displayName} must count as played on the selected Bakugan`,
    );
  }
});

test("ordinary stat Actions without a printed choice also count as played on the active Bakugan", () => {
  const { state, player, source, sourceBakugan } = triggerState("br-101", "implicit-stat-action");
  const waterBoost = card("bb-10", "implicit-greater-water-boost");
  emitRuleEvent(state, {
    id: "implicit-stat-target",
    name: "CARD_PLAYED",
    actorId: player.id,
    controllerId: player.id,
    card: waterBoost,
    cardType: "Action",
    targetBakuganId: sourceBakugan.id,
    choices: {},
    createdAt: Date.now(),
  });
  assert.equal(state.batch.filter((object) => object.card.id === source.id).length, 1);
});

test("Action-on-this triggers also recognize a secondary Bakugan target", () => {
  const { state, player, opponent, source, sourceBakugan } = triggerState("br-190", "secondary");
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
