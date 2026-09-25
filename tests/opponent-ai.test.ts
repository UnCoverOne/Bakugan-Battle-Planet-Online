import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CENTER_CELL,
  HEX_CELLS,
  createMatch,
  type Bakugan,
  type Core,
  type Faction,
  type GameCard,
  type MatchState,
  type PlayerState,
} from "../lib/game";
import { advanceOpponentAi, chooseCardChoices } from "../lib/opponentAi";

const gameplayClient = readFileSync(
  new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url),
  "utf8",
);

let serial = 0;

function card(
  name: string,
  effect: string,
  type: GameCard["type"] = "Action",
  cost: number | "X" = 0,
  extra: Partial<GameCard> = {},
): GameCard {
  serial += 1;
  return {
    id: extra.id ?? "card-" + serial,
    catalogId: extra.catalogId ?? "catalog-" + serial,
    number: serial,
    name,
    displayName: name,
    faction: extra.faction ?? "Aquos",
    factions: extra.factions ?? [extra.faction ?? "Aquos"],
    type,
    cost,
    rarity: "",
    effect,
    mechanics: [],
    bPower: null,
    damage: null,
    coreTypes: [],
    evolvesFrom: null,
    art: "",
    ...extra,
  };
}

function bakugan(
  id: string,
  faction: Faction,
  bPower: number,
  damage: number,
  extra: Partial<Bakugan> = {},
): Bakugan {
  const character = card(id + " Character", "", "Character", 0, {
    id: id + "-character",
    catalogId: id + "-character",
    faction,
    factions: [faction],
    bPower,
    damage,
  });
  return {
    id,
    name: id,
    faction,
    bPower,
    damage,
    rollAccuracy: 90,
    doubleCoreChance: 5,
    art: "",
    character,
    open: false,
    heldCoreCells: [],
    evoStack: [],
    ...extra,
  };
}

function core(
  id: string,
  bonus: number,
  damageBonus = 0,
  extra: Partial<Core> = {},
): Core {
  return {
    id,
    number: serial++,
    name: id,
    type: "Fist",
    bonus,
    damageBonus,
    art: "",
    ...extra,
  };
}

function player(
  id: string,
  bakuganTeam: Bakugan[],
  cores: Core[] = [],
  hand: GameCard[] = [],
): PlayerState {
  return {
    id,
    name: id,
    bakugan: bakuganTeam,
    cores,
    deck: 0,
    deckCards: [],
    hand,
    discard: [],
    energyZone: [],
    heroes: [],
    energy: 0,
    ready: true,
    connected: true,
    lastSeen: Date.now(),
    energizedThisTurn: false,
    cardsPlayedThisTurn: 0,
  };
}

function matchWith(
  ai: PlayerState,
  human: PlayerState,
  phase: MatchState["phase"],
): MatchState {
  const match = createMatch("AITEST", "bo1", [ai, human]);
  match.turn = 2;
  match.phase = phase;
  match.priority = ai.id;
  match.startingPlayer = ai.id;
  match.initialStartingPlayer = ai.id;
  match.stepLabel = phase;
  return match;
}

function cell(q: number, r: number) {
  const found = HEX_CELLS.find((candidate) => candidate.q === q && candidate.r === r);
  assert.ok(found);
  return found.id;
}

function addEnergy(owner: PlayerState, amount: number) {
  owner.energyZone = Array.from(
    { length: amount },
    (_, index) => card("Energy " + index, "", "Action", 0),
  );
  owner.energy = 0;
}

test("resolution choices use their stored schema and locate the source in the batch", () => {
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  ai.deckCards = [card("Drawn card", "")];
  ai.deck = 1;
  const match = matchWith(ai, human, "power");
  const source = card("Batch Source", "You may draw a card.");
  match.batch = [{
    id: "effect",
    controllerId: ai.id,
    card: source,
    choices: {},
    kind: "card",
    instructionIndex: 0,
  }];
  match.pendingChoice = {
    id: "choice",
    kind: "resolution",
    controllerId: ai.id,
    cardId: source.id,
    schema: {
      id: "stored-schema",
      sourceId: source.id,
      sourceName: source.name,
      controllerId: ai.id,
      simultaneous: false,
      fields: [{
        id: "confirmed",
        kind: "confirm",
        label: "Use this optional effect?",
        chooserId: ai.id,
        visibility: "public",
        minimum: 1,
        maximum: 1,
        required: true,
        options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
      }],
    },
    answers: {},
    createdVersion: match.version,
    pendingEffectId: "effect",
    instructionIndex: 0,
    resumePriority: ai.id,
  };

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.pendingChoice, undefined);
  assert.notEqual(next.phase, "result");
});

test("roll targeting values the resolved modulo-four Core, not the selected Core", () => {
  const aiBakugan = bakugan("ai-b", "Aquos", 500, 5);
  const ai = player("ai", [aiBakugan]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  const match = matchWith(ai, human, "target");
  match.selected[ai.id] = aiBakugan.id;
  match.selected[human.id] = human.bakugan[0].id;
  const row = [4, 3, 2, 1, 0].map((r) => cell(0, r));
  const values = [-500, 0, 0, 250, 1000];
  match.placements = row.map((cellId, index) => ({
    playerId: index % 2 ? human.id : ai.id,
    core: core("row-" + (index + 1), values[index]),
    cell: cellId,
    order: index + 1,
  }));
  match.targets[human.id] = row[1];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.targets[ai.id], row[3]);
  assert.notEqual(next.targets[ai.id], row[4]);
});

test("harmful effects target the strongest enemy Bakugan", () => {
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)]);
  const weak = bakugan("weak", "Pyrus", 200, 2);
  const strong = bakugan("strong", "Pyrus", 1000, 10);
  const human = player("human", [weak, strong]);
  const match = matchWith(ai, human, "power");
  const debuff = card("Crushing Wave", "Choose an enemy Bakugan. -500 [B].");

  assert.equal(chooseCardChoices(match, ai.id, debuff).targetBakuganId, strong.id);
});

test("an opponent-controlled harmful choice protects its own best Bakugan", () => {
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)]);
  const weak = bakugan("weak", "Pyrus", 200, 2);
  const strong = bakugan("strong", "Pyrus", 1000, 10);
  const human = player("human", [weak, strong]);
  const match = matchWith(ai, human, "power");
  const debuff = card(
    "Opponent Choice",
    "Your opponent chooses a Bakugan. That Bakugan gets -500 [B].",
  );

  assert.equal(
    chooseCardChoices(match, ai.id, debuff, human.id).targetBakuganId,
    weak.id,
  );
});

test("free plays, searches, and top-deck ordering choose the most valuable cards", () => {
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  const match = matchWith(ai, human, "power");
  const low = card("Low", "Draw a card.");
  const middle = card("Middle", "Draw two cards.");
  const high = card("High", "Draw three cards.");
  ai.hand = [low, high];

  const freePlay = card("Free Play", "Play a card from your hand for free.");
  assert.deepEqual(chooseCardChoices(match, ai.id, freePlay).handCardIds, [high.id]);

  ai.deckCards = [low, high, middle];
  ai.deck = 3;
  const search = card("Search", "Search your deck for an Action card.");
  assert.equal(chooseCardChoices(match, ai.id, search).deckCardId, high.id);

  const order = card(
    "Order",
    "Look at the top three cards of your deck. Put them on top of your deck in any order.",
  );
  assert.deepEqual(
    chooseCardChoices(match, ai.id, order).orderedCardIds,
    [high.id, middle.id, low.id],
  );
});

test("negates are held against the AI's own batch and played against an opponent", () => {
  const negate = card("Nope", "Negate an Action card.");
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [negate]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  addEnergy(ai, 1);
  const ownBatch = matchWith(ai, human, "power");
  ownBatch.batch = [{
    id: "own-effect",
    controllerId: ai.id,
    card: card("Own Action", "Draw a card."),
    choices: {},
    kind: "card",
  }];

  const held = advanceOpponentAi(ownBatch, ai.id);
  assert.ok(held);
  assert.ok(held.players[0].hand.some((candidate) => candidate.id === negate.id));
  assert.equal(held.batch.length, 1);

  const opponentBatch = matchWith(ai, human, "power");
  opponentBatch.batch = [{
    id: "enemy-effect",
    controllerId: human.id,
    card: card("Enemy Action", "Draw three cards."),
    choices: {},
    kind: "card",
  }];
  const played = advanceOpponentAi(opponentBatch, ai.id);
  assert.ok(played);
  assert.equal(played.players[0].hand.some((candidate) => candidate.id === negate.id), false);
  assert.equal(played.batch.at(-1)?.card.id, negate.id);
});

test("temporary combat boosts are not spent after their relevant window", () => {
  const boost = card("Late Boost", "+1000 [B].", "Action", 1);
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [], [boost]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  addEnergy(ai, 1);
  const match = matchWith(ai, human, "postDamage");

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.ok(next.players[0].hand.some((candidate) => candidate.id === boost.id));
  assert.equal(next.batch.length, 0);
});

test("pre-roll temporary combat cards are withheld while true pre-roll setup remains eligible", () => {
  const boost = card("Pre-roll Boost", "+500 [B].", "Action", 1);
  const aiBakugan = bakugan("ai-b", "Aquos", 500, 5);
  const ai = player("ai", [aiBakugan], [], [boost]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  addEnergy(ai, 2);
  const preRoll = matchWith(ai, human, "preRoll");
  preRoll.selected[ai.id] = aiBakugan.id;
  preRoll.selected[human.id] = human.bakugan[0].id;
  preRoll.placements = [{
    playerId: ai.id,
    core: core("target", 100),
    cell: CENTER_CELL,
    order: 1,
  }];

  const boosted = advanceOpponentAi(preRoll, ai.id);
  assert.ok(boosted);
  assert.equal(boosted.players[0].hand.some((candidate) => candidate.id === boost.id), true);
  assert.equal(boosted.batch.length, 0);

  const scoutingBoost = card(
    "Pre-roll Scouting",
    "+500 [B]. Turn a BakuCore on the field face up.",
    "Action",
    0,
  );
  const scoutingAi = player("scouting-ai", [bakugan("scout-b", "Aquos", 500, 5)], [], [scoutingBoost]);
  const scoutingHuman = player("scouting-human", [bakugan("human-scout", "Pyrus", 500, 5)]);
  const scouting = matchWith(scoutingAi, scoutingHuman, "preRoll");
  scouting.selected[scoutingAi.id] = scoutingAi.bakugan[0].id;
  scouting.selected[scoutingHuman.id] = scoutingHuman.bakugan[0].id;
  scouting.placements = [{
    playerId: scoutingHuman.id,
    core: core("scouting-target", 100),
    cell: CENTER_CELL,
    order: 1,
  }];
  const prepared = advanceOpponentAi(scouting, scoutingAi.id);
  assert.ok(prepared);
  assert.ok(
    prepared.pendingChoice?.cardId === scoutingBoost.id
      || !prepared.players[0].hand.some((candidate) => candidate.id === scoutingBoost.id),
  );

  const hero = card("Persistent Hero", "Your Bakugan have +200 [B].", "Hero", 0);
  const setupAi = player("ai", [aiBakugan], [], [hero]);
  const endPlay = matchWith(setupAi, human, "endPlay");
  const setup = advanceOpponentAi(endPlay, setupAi.id);
  assert.ok(setup);
  assert.equal(setup.players[0].hand.some((candidate) => candidate.id === hero.id), false);
});

test("Core placement puts a favourable Core on the AI-facing side", () => {
  const favourable = core("a-favourable", 0, 0, {
    conditionalFactions: ["Aquos"],
    conditionalBonus: 600,
  });
  const poor = core("z-poor", -200);
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [favourable, poor]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  const match = matchWith(ai, human, "placement");
  match.placements = [{
    playerId: human.id,
    core: core("centre", 0),
    cell: CENTER_CELL,
    order: 1,
  }];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const placed = next.placements.at(-1)!;
  const placedCell = HEX_CELLS.find((candidate) => candidate.id === placed.cell)!;
  assert.equal(placed.core.id, favourable.id);
  assert.ok(placedCell.r + placedCell.q / 2 > 0);
});

test("Core placement exposes a harmful Core toward the opponent", () => {
  const harmful = core("harmful", -600);
  const ai = player("ai", [bakugan("ai-b", "Aquos", 500, 5)], [harmful]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  const match = matchWith(ai, human, "placement");
  match.placements = [{
    playerId: human.id,
    core: core("centre", 0),
    cell: CENTER_CELL,
    order: 1,
  }];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  const placedCell = HEX_CELLS.find(
    (candidate) => candidate.id === next.placements.at(-1)?.cell,
  )!;
  assert.ok(placedCell.r + placedCell.q / 2 < 0);
});

test("Bakugan selection includes reachable Core and faction synergy", () => {
  const strong = bakugan("strong", "Pyrus", 900, 3);
  const synergistic = bakugan("synergy", "Aquos", 300, 3);
  const reserve = bakugan("reserve", "Darkus", 400, 3);
  const ai = player("ai", [strong, synergistic, reserve]);
  const human = player("human", [bakugan("human-b", "Pyrus", 500, 5)]);
  const match = matchWith(ai, human, "selection");
  match.placements = [{
    playerId: ai.id,
    core: core("aquos-core", 0, 0, {
      conditionalFactions: ["Aquos"],
      conditionalBonus: 800,
    }),
    cell: CENTER_CELL,
    order: 1,
  }];

  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.selected[ai.id], synergistic.id);
});

test("training AI waits until the roll presentation is completely clear", () => {
  assert.match(gameplayClient, /const \{ rollPresentationPending \} = useBakuCorePresentation\(\)/);
  assert.match(gameplayClient, /storedState\.online[\s\S]{0,120}\|\| rollPresentationPending/);
  assert.match(gameplayClient, /storedState\.match\?\.version,[\s\S]{0,120}rollPresentationPending/);
});
