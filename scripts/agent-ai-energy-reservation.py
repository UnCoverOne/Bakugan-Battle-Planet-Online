from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "lib/opponentAiBase.ts",
    '''import {
  compileCardEffect,
  estimateProgramValue,
  type RuleAction,
  type RuleProgram,
} from "./rules/effects";
''',
    '''import {
  compileCardEffect,
  estimateProgramValue,
  type RuleAction,
  type RuleProgram,
} from "./rules/effects";
import { evaluateBakuganCharacteristics } from "./rules/modifiers";
''',
)

replace_once(
    "lib/opponentAiBase.ts",
    '''type RollForecastSample = {
  outcome: RollOutcome;
  value: number;
};
''',
    '''type RollForecastSample = {
  outcome: RollOutcome;
  value: number;
  power: number;
  damage: number;
};
''',
)

replace_once(
    "lib/opponentAiBase.ts",
    '''type RollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
  samples: RollForecastSample[];
};

/**
 * Forecast through the authoritative resolver rather than duplicating roll
''',
    '''type RollForecast = {
  target: Placement;
  value: number;
  openProbability: number;
  coreProbability: number;
  primaryProbability: Map<string, number>;
  samples: RollForecastSample[];
};

function projectedRollCharacteristics(
  match: MatchState,
  playerId: string,
  bakuganId: string,
  outcome: RollOutcome,
) {
  if (outcome.result === "miss-closed") {
    return { power: 0, damage: 0, value: -1.25 };
  }
  const projected = cloneMatch(match);
  const player = playerById(projected, playerId);
  const bakugan = player?.bakugan.find((candidate) => candidate.id === bakuganId);
  if (!player || !bakugan) return { power: 0, damage: 0, value: -1.25 };
  for (const placement of projected.placements) {
    if (placement.attachedTo === bakugan.id) delete placement.attachedTo;
  }
  bakugan.open = true;
  bakugan.heldCoreCells = [...outcome.cores];
  for (const cell of outcome.cores) {
    const placement = projected.placements.find((candidate) => candidate.cell === cell);
    if (placement) placement.attachedTo = bakugan.id;
  }
  projected.rolls[playerId] = outcome;
  const characteristics = evaluateBakuganCharacteristics(projected, bakugan, player);
  return {
    power: characteristics.power,
    damage: characteristics.damage,
    value: characteristics.power * 0.01
      + characteristics.damage * 0.9
      + characteristics.frostStrike * 0.55
      + (characteristics.shadowStrike ? 1.2 : 0)
      + (characteristics.doubleStrike ? characteristics.damage * 0.9 : 0),
  };
}

/**
 * Forecast through the authoritative resolver rather than duplicating roll
''',
)

replace_once(
    "lib/opponentAiBase.ts",
    '''    const coreValue = outcome.cores.reduce((sum, cell) => {
      const placement = state.placements.find((candidate) => candidate.cell === cell);
      return sum + (placement ? coreValueForBakugan(placement.core, bakugan) : 0);
    }, 0);
    const outcomeValue = (didOpen ? printedBakuganValue(bakugan) : -1.25) + coreValue;
    totalValue += outcomeValue;
    samples.push({ outcome, value: outcomeValue });
''',
    '''    const characteristics = projectedRollCharacteristics(
      state,
      playerId,
      bakugan.id,
      outcome,
    );
    totalValue += characteristics.value;
    samples.push({
      outcome,
      value: characteristics.value,
      power: characteristics.power,
      damage: characteristics.damage,
    });
''',
)

old_best = '''function bestPlayableCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  return player.hand
    .filter((card) => card.type !== "Flip" && card.type !== "Character")
    .filter((card) => cardRerollTimingLegal(match, playerId, card))
    .map((card) => {
      const program = compileCardEffect(card);
      const choices = chooseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      const temporaryCombat = program.instructions.some((instruction) => instruction.actions.some(
        (action) => (
          action.kind === "set-stat"
          || action.kind === "set-rule"
          || ((action.kind === "modify-stat" || action.kind === "grant-keyword")
            && action.duration !== "while-source-in-play"
            && action.duration !== "next-card")
        ),
      ));
      const uniquePreRollValue = program.instructions.some((instruction) => (
        /(?:before|when) (?:you )?(?:select|roll)|select a Bakugan to roll|turn a BakuCore .*face up/i.test(instruction.sourceText)
        && instruction.actions.some((action) => ![
          "modify-stat", "grant-keyword", "set-stat", "set-rule", "choice", "trigger",
        ].includes(action.kind))
      ));
      const timingLegal = match.phase !== "preRoll" || !temporaryCombat || uniquePreRollValue;
      return {
        card,
        choices,
        payment,
        score: timingLegal ? cardValue(match, playerId, card, choices) : Number.NEGATIVE_INFINITY,
      };
    })
    .filter((candidate) => candidate.payment && candidate.payment.kind !== "insufficient")
    .sort((a, b) => b.score - a.score)[0];
}
'''

new_best = '''type PreRollCombatForecast = {
  own?: RollForecast;
  opponent?: RollForecast;
};

type PreRollResponseOption = {
  cardId: string;
  cost: number;
  powerSwing: number;
  secondaryValue: number;
};

type PreRollDecisionContext = {
  capacity: number;
  forecast: PreRollCombatForecast;
  passContinuation: number;
  openChance: number;
  existingOpenDraws: number;
  averageDeckCardValue: number;
  drawCache: Map<string, number>;
};

function selectedRollForecast(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  const selected = player?.bakugan.find(
    (candidate) => candidate.id === match.selected[playerId],
  );
  return selected ? bestForecast(match, playerId, selected) : undefined;
}

function preRollCombatForecast(match: MatchState, playerId: string): PreRollCombatForecast {
  const opponent = opponentOf(match, playerId);
  return {
    own: selectedRollForecast(match, playerId),
    opponent: opponent ? selectedRollForecast(match, opponent.id) : undefined,
  };
}

function repeatableOpenDrawAmount(card: GameCard) {
  try {
    return compileCardEffect(card).instructions.reduce((sum, instruction) => {
      const opens = instruction.actions.some((action) => (
        action.kind === "trigger"
        && action.definition.event === "BAKUGAN_OPENED"
      ));
      if (!opens) return sum;
      return sum + instruction.actions.reduce((amount, action) => (
        amount + (action.kind === "draw" ? action.amount : 0)
      ), 0);
    }, 0);
  } catch {
    return 0;
  }
}

function temporaryResponseProfile(
  match: MatchState,
  playerId: string,
  card: GameCard,
): PreRollResponseOption | undefined {
  if (card.type === "Flip" || card.type === "Character") return undefined;
  let choices: CardChoices = {};
  try { choices = chooseCardChoices(match, playerId, card); } catch { choices = {}; }
  let cost = card.cost === "X" ? Math.max(1, currentEnergyCapacity(match, playerId)) : card.cost;
  try { cost = cardEnergyPaymentState(match, playerId, card, choices)?.cost ?? cost; } catch { /* printed cost */ }
  let powerSwing = 0;
  let secondaryValue = 0;
  let program: RuleProgram;
  try { program = compileCardEffect(card); } catch { return undefined; }
  for (const instruction of program.instructions) {
    for (const action of instruction.actions) {
      if (action.kind === "modify-stat") {
        if (action.duration === "while-source-active" || action.duration === "next-card") continue;
        const targetsEnemy = actionTargetsEnemy(
          match,
          playerId,
          choices,
          action,
          instruction.sourceText,
        );
        const direction = targetsEnemy ? -1 : 1;
        if (action.stat === "power") {
          powerSwing += Math.max(0, action.amount * direction);
        } else {
          secondaryValue += Math.max(0, actionBaseValue(action) * direction) * 0.35;
        }
      } else if (action.kind === "grant-keyword") {
        if (action.duration === "while-source-active" || action.duration === "next-card") continue;
        secondaryValue += Math.max(0, actionBaseValue(action)) * 0.25;
      }
    }
  }
  const likelihood = futurePlayLikelihood(match, playerId, card, choices, "hand");
  powerSwing *= likelihood;
  secondaryValue *= likelihood;
  if (powerSwing <= 0 && secondaryValue <= 0) return undefined;
  return { cardId: card.id, cost: Math.max(0, cost), powerSwing, secondaryValue };
}

function responseCombinations(options: readonly PreRollResponseOption[], budget: number) {
  let combinations = [{ cost: 0, powerSwing: 0, secondaryValue: 0 }];
  for (const option of options.slice(0, 10)) {
    const added = combinations
      .filter((combination) => combination.cost + option.cost <= budget)
      .map((combination) => ({
        cost: combination.cost + option.cost,
        powerSwing: combination.powerSwing + option.powerSwing,
        secondaryValue: combination.secondaryValue + option.secondaryValue,
      }));
    combinations = [...combinations, ...added];
  }
  return combinations;
}

function expectedPowerResponseContinuation(
  match: MatchState,
  playerId: string,
  hand: readonly GameCard[],
  budget: number,
  forecast: PreRollCombatForecast,
) {
  if (budget <= 0 || !forecast.own || !forecast.opponent) return 0;
  const options = hand
    .map((card) => temporaryResponseProfile(match, playerId, card))
    .filter((option): option is PreRollResponseOption => Boolean(option))
    .filter((option) => option.cost <= budget)
    .sort((a, b) => (
      (b.powerSwing + b.secondaryValue * 100) / Math.max(1, b.cost)
      - (a.powerSwing + a.secondaryValue * 100) / Math.max(1, a.cost)
    ));
  if (!options.length) return 0;
  const combinations = responseCombinations(options, budget);
  const sampleCount = Math.min(
    forecast.own.samples.length,
    forecast.opponent.samples.length,
  );
  let total = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const own = forecast.own.samples[index];
    const opponent = forecast.opponent.samples[index];
    if (
      own.outcome.result === "miss-closed"
      || opponent.outcome.result === "miss-closed"
    ) continue;
    const deficit = opponent.power - own.power;
    let best = 0;
    for (const combination of combinations) {
      if (combination.cost <= 0) continue;
      if (deficit >= 0 && combination.powerSwing > deficit) {
        const margin = combination.powerSwing - deficit;
        best = Math.max(
          best,
          5.5
            + Math.min(2.25, margin / 250)
            + Math.min(1.25, combination.secondaryValue * 0.2),
        );
      } else if (deficit >= 0 && combination.powerSwing > 0) {
        best = Math.max(
          best,
          Math.min(0.45, combination.powerSwing / Math.max(400, deficit + 400)),
        );
      } else if (deficit < 0 && combination.secondaryValue > 0) {
        best = Math.max(best, Math.min(0.8, combination.secondaryValue * 0.2));
      }
    }
    total += best;
  }
  return total / Math.max(1, sampleCount);
}

function averageDeckCardValue(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  if (!player?.deckCards.length) return 0;
  return player.deckCards.reduce((sum, card) => (
    sum + clamp(Math.max(0, handCardRetentionValue(match, playerId, card)), 0, 3.5)
  ), 0) / player.deckCards.length;
}

function marginalDeckDrawValue(
  match: MatchState,
  playerId: string,
  hand: readonly GameCard[],
  budget: number,
  context: PreRollDecisionContext,
) {
  const player = playerById(match, playerId);
  if (!player?.deckCards.length) return 0;
  const key = `${budget}:${hand.map((card) => card.id).sort().join(",")}`;
  const cached = context.drawCache.get(key);
  if (cached != null) return cached;
  const baseline = expectedPowerResponseContinuation(
    match,
    playerId,
    hand,
    budget,
    context.forecast,
  );
  const grouped = new Map<string, GameCard[]>();
  for (const card of player.deckCards) {
    const cards = grouped.get(card.catalogId) ?? [];
    cards.push(card);
    grouped.set(card.catalogId, cards);
  }
  let weighted = 0;
  for (const cards of grouped.values()) {
    const card = cards[0];
    const tactical = Math.max(0, expectedPowerResponseContinuation(
      match,
      playerId,
      [...hand, card],
      budget,
      context.forecast,
    ) - baseline);
    const retained = clamp(
      Math.max(0, handCardRetentionValue(match, playerId, card)) * 0.28,
      0,
      1.25,
    );
    weighted += (tactical + retained) * cards.length;
  }
  const expectedHandSize = hand.length + context.existingOpenDraws * context.openChance;
  const saturation = clamp((8.25 - expectedHandSize) / 3.25, 0.25, 1);
  const value = weighted / player.deckCards.length * saturation;
  context.drawCache.set(key, value);
  return value;
}

function createPreRollDecisionContext(match: MatchState, playerId: string): PreRollDecisionContext {
  const player = playerById(match, playerId)!;
  const forecast = preRollCombatForecast(match, playerId);
  const capacity = currentEnergyCapacity(match, playerId);
  return {
    capacity,
    forecast,
    passContinuation: expectedPowerResponseContinuation(
      match,
      playerId,
      player.hand,
      capacity,
      forecast,
    ),
    openChance: forecast.own?.openProbability ?? expectedOpenChance(match, playerId),
    existingOpenDraws: player.heroes.reduce((sum, hero) => (
      sum + repeatableOpenDrawAmount(hero)
    ), 0),
    averageDeckCardValue: averageDeckCardValue(match, playerId),
    drawCache: new Map(),
  };
}

function preRollCandidateScore(
  match: MatchState,
  playerId: string,
  card: GameCard,
  baseScore: number,
  cost: number,
  context: PreRollDecisionContext,
) {
  const player = playerById(match, playerId)!;
  const remainingCapacity = Math.max(0, context.capacity - cost);
  const remainingHand = player.hand.filter((candidate) => candidate.id !== card.id);
  const continuationAfter = expectedPowerResponseContinuation(
    match,
    playerId,
    remainingHand,
    remainingCapacity,
    context.forecast,
  );
  const energyOpportunityCost = Math.max(0, context.passContinuation - continuationAfter);
  let score = baseScore - energyOpportunityCost;
  const drawAmount = repeatableOpenDrawAmount(card);
  if (drawAmount > 0) {
    const saturation = 1 / (1 + context.existingOpenDraws * 0.55);
    const currentRound = context.openChance
      * marginalDeckDrawValue(
        match,
        playerId,
        remainingHand,
        remainingCapacity,
        context,
      )
      * drawAmount
      * saturation;
    const remainingClosed = Math.max(
      0,
      player.bakugan.filter((bakugan) => !bakugan.open).length - 1,
    );
    const futureOpenings = Math.min(2.5, 0.75 + remainingClosed * 0.8);
    const future = Math.min(
      3.4 * drawAmount,
      context.averageDeckCardValue * 0.55 * futureOpenings * drawAmount,
    ) * saturation;
    const handOverflow = Math.max(
      0,
      remainingHand.length
        + (context.existingOpenDraws + drawAmount) * context.openChance
        - 7,
    );
    score += Math.min(4.5 * drawAmount, currentRound + future)
      - drawAmount * 2.4
      - handOverflow * 0.45;
  }
  return score;
}

function bestPlayableCard(match: MatchState, playerId: string) {
  const player = playerById(match, playerId)!;
  const preRollContext = match.phase === "preRoll"
    ? createPreRollDecisionContext(match, playerId)
    : undefined;
  return player.hand
    .filter((card) => card.type !== "Flip" && card.type !== "Character")
    .filter((card) => cardRerollTimingLegal(match, playerId, card))
    .map((card) => {
      const program = compileCardEffect(card);
      const choices = chooseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      const temporaryCombat = program.instructions.some((instruction) => instruction.actions.some(
        (action) => (
          action.kind === "set-stat"
          || action.kind === "set-rule"
          || ((action.kind === "modify-stat" || action.kind === "grant-keyword")
            && action.duration !== "while-source-in-play"
            && action.duration !== "next-card")
        ),
      ));
      const uniquePreRollValue = program.instructions.some((instruction) => (
        /(?:before|when) (?:you )?(?:select|roll)|select a Bakugan to roll|turn a BakuCore .*face up/i.test(instruction.sourceText)
        && instruction.actions.some((action) => ![
          "modify-stat", "grant-keyword", "set-stat", "set-rule", "choice", "trigger",
        ].includes(action.kind))
      ));
      const timingLegal = match.phase !== "preRoll" || !temporaryCombat || uniquePreRollValue;
      const baseScore = cardValue(match, playerId, card, choices);
      const score = !timingLegal
        ? Number.NEGATIVE_INFINITY
        : preRollContext && payment
          ? preRollCandidateScore(
            match,
            playerId,
            card,
            baseScore,
            payment.cost,
            preRollContext,
          )
          : baseScore;
      return { card, choices, payment, score };
    })
    .filter((candidate) => candidate.payment && candidate.payment.kind !== "insufficient")
    .sort((a, b) => b.score - a.score)[0];
}
'''

replace_once("lib/opponentAiBase.ts", old_best, new_best)

# Add focused behavioural coverage without creating card-specific production rules.
test_file = Path("tests/opponent-ai-tactics.test.ts")
with test_file.open("a") as file:
    file.write('''

function catalogueCard(catalogId: string, id: string): GameCard {
  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);
  assert.ok(source, `Missing catalogue card ${catalogId}`);
  return { ...source, id };
}

function preRollReservationMatch(input: {
  energy: number;
  buffInHand?: boolean;
  existingShuns?: number;
  deckCards?: GameCard[];
}) {
  const shun = catalogueCard("br-77", "reservation-shun");
  const smokeArmor = catalogueCard("bb-49", "reservation-smoke-armor");
  const ai = player(
    "ai",
    [bakugan("ai-reservation-b", "Aquos", 500, 5)],
    [],
    [shun, ...(input.buffInHand === false ? [] : [smokeArmor])],
  );
  const human = player(
    "human",
    [bakugan("human-reservation-b", "Pyrus", 900, 5)],
  );
  addEnergy(ai, input.energy);
  ai.heroes = Array.from({ length: input.existingShuns ?? 0 }, (_, index) => (
    catalogueCard("br-77", `existing-shun-${index}`)
  ));
  ai.deckCards = input.deckCards ?? [
    catalogueCard("bb-10", "reservation-deck-filler-1"),
    catalogueCard("bb-11", "reservation-deck-filler-2"),
    catalogueCard("bb-12", "reservation-deck-filler-3"),
  ];
  ai.deck = ai.deckCards.length;
  const match = matchWith(ai, human, "preRoll");
  const secondCell = cell(1, 0);
  match.placements = [
    { playerId: ai.id, core: core("reservation-core-a"), cell: CENTER_CELL, order: 1 },
    { playerId: human.id, core: core("reservation-core-b"), cell: secondCell, order: 2 },
  ];
  match.selected[ai.id] = ai.bakugan[0].id;
  match.selected[human.id] = human.bakugan[0].id;
  return { match, ai, shun, smokeArmor };
}

test("AI reserves Energy for an in-hand B-Power response that can swing the forecasted Brawl", () => {
  const { match, ai, shun, smokeArmor } = preRollReservationMatch({ energy: 3 });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.length, 0);
  assert.ok(next.players[0].hand.some((card) => card.id === shun.id));
  assert.ok(next.players[0].hand.some((card) => card.id === smokeArmor.id));
  assert.equal(next.priority, "human");
});

test("AI plays the draw Hero when enough Energy remains for the same B-Power response", () => {
  const { match, ai, shun, smokeArmor } = preRollReservationMatch({ energy: 6 });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
  assert.ok(next.players[0].hand.some((card) => card.id === smokeArmor.id));
});

test("AI values a draw Hero when its deck can produce an affordable missing response", () => {
  const tides = [0, 1, 2].map((index) => catalogueCard("bb-24", `reservation-tides-${index}`));
  const { match, ai, shun } = preRollReservationMatch({
    energy: 4,
    buffInHand: false,
    deckCards: tides,
  });
  ai.cardsPlayedThisTurn = 1;
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
});

test("AI has no hard ban on a third draw Hero when tactical Energy remains available", () => {
  const { match, ai, shun } = preRollReservationMatch({
    energy: 6,
    existingShuns: 2,
  });
  const next = advanceOpponentAi(match, ai.id);
  assert.ok(next);
  assert.equal(next.batch.at(-1)?.card.id, shun.id);
});
''')
