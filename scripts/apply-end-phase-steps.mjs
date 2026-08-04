import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
}

function replaceOnce(path, before, after) {
  const source = read(path);
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${path}: expected source block was not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected source block was not unique`);
  }
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function replacePattern(path, pattern, replacement) {
  const source = read(path);
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${path}: expected one pattern match, found ${matches.length}`);
  }
  write(path, source.replace(pattern, replacement));
}

const lines = (...values) => values.join("\n");

replaceOnce(
  "lib/game.ts",
  lines(
    "export type Phase =",
    "  | \"lobby\" | \"startingPlayer\" | \"placement\" | \"draw\" | \"energize\" | \"selection\" | \"preRoll\" | \"target\" | \"reroll\"",
    "  | \"power\" | \"victor\" | \"damage\" | \"postDamage\" | \"retract\" | \"endPlay\"",
    "  | \"handLimit\" | \"result\";",
  ),
  lines(
    "export type Phase =",
    "  | \"lobby\" | \"startingPlayer\" | \"placement\" | \"draw\" | \"energize\" | \"selection\" | \"preRoll\" | \"target\" | \"reroll\"",
    "  | \"power\" | \"victor\" | \"damage\" | \"postDamage\" | \"retract\" | \"endPlay\" | \"charge\" | \"reset\"",
    "  | \"handLimit\" | \"result\";",
  ),
);

replaceOnce(
  "lib/game.ts",
  lines(
    "const PHASE_TIMERS: Record<Phase, number> = {",
    "  lobby: 60, startingPlayer: 8, placement: 45, draw: 35, energize: 35, selection: 35, preRoll: 30, target: 30, reroll: 30,",
    "  power: 40, victor: 30, damage: 35, postDamage: 25, retract: 10, endPlay: 35,",
    "  handLimit: 40, result: 120,",
    "};",
  ),
  lines(
    "const PHASE_TIMERS: Record<Phase, number> = {",
    "  lobby: 60, startingPlayer: 8, placement: 45, draw: 35, energize: 35, selection: 35, preRoll: 30, target: 30, reroll: 30,",
    "  power: 40, victor: 30, damage: 35, postDamage: 25, retract: 10, endPlay: 35, charge: 2, reset: 2,",
    "  handLimit: 40, result: 120,",
    "};",
  ),
);

const endPhaseEngine = lines(
  "type EndPhaseEnergyPlayer = PlayerState & { tappedEnergyIds?: string[]; energyTapTurn?: number };",
  "",
  "function beginChargeStep(state: MatchState) {",
  "  emitGameEvent(state, { id: `${state.turn}:end-turn`, type: \"end-turn\", playerId: state.startingPlayer });",
  "  if (state.batch.length || state.triggerOrders.length) return;",
  "  for (const player of state.players) for (const bakugan of player.bakugan) {",
  "    if (state.delayedRetracts.includes(bakugan.id)) retractBakugan(state, bakugan);",
  "  }",
  "  for (const player of state.players) {",
  "    const tracked = player as EndPhaseEnergyPlayer;",
  "    tracked.tappedEnergyIds = [];",
  "    tracked.energyTapTurn = state.turn;",
  "    player.energy = 0;",
  "    player.maxEnergy = player.energyZone.length;",
  "  }",
  "  setPhase(state, \"charge\", \"End Phase • Charge Step\", state.startingPlayer);",
  "  entry(state, \"game\", \"Both players charged all Energy cards.\");",
  "}",
  "",
  "function beginResetStep(state: MatchState) {",
  "  state.powerBoost = {};",
  "  state.damageBoost = {};",
  "  state.frostStrike = {};",
  "  state.doubleStrike = {};",
  "  state.shadowStrike = {};",
  "  const rules = ensureRulesState(state);",
  "  rules.modifiers = rules.modifiers.filter((modifier) => modifier.duration !== \"turn\");",
  "  rules.replacements = rules.replacements.filter((replacement) => replacement.effect.kind !== \"prevention\");",
  "  rules.triggerUsage = {};",
  "  setPhase(state, \"reset\", \"End Phase • Reset Step\", state.startingPlayer);",
  "  entry(state, \"game\", \"Turn-duration modifications were reset.\");",
  "}",
  "",
  "function finishResetStep(state: MatchState) {",
  "  const over = state.players.find((player) => player.hand.length > 7);",
  "  if (over) setPhase(state, \"handLimit\", \"End of turn • Discard to seven\", over.id);",
  "  else beginTurn(state);",
  "}",
  "",
  "const advanceEmptyBatch = (state: MatchState) => {",
  "  if (state.phase === \"preRoll\") setPhase(state, \"target\", \"Roll Phase • Secret target selection\", state.startingPlayer);",
  "  else if (state.phase === \"power\") declareVictor(state);",
  "  else if (state.phase === \"victor\") beginDamage(state);",
  "  else if (state.phase === \"postDamage\") {",
  "    const loser = playerById(state, state.pendingLoser); const loserBakugan = activeBakugan(state, loser.id); if (loserBakugan) retractBakugan(state, loserBakugan);",
  "    if (state.teamAttack) playerById(state, state.brawlWinner).bakugan.forEach((bakugan) => retractBakugan(state, bakugan));",
  "    setPhase(state, \"endPlay\", \"End Phase • Play Step\", state.startingPlayer);",
  "  } else if (state.phase === \"endPlay\") beginChargeStep(state);",
  "  else if (state.phase === \"reset\") finishResetStep(state);",
  "};",
  "",
  "export const passPriority",
);

replacePattern(
  "lib/game.ts",
  /const advanceEmptyBatch = \(state: MatchState\) => \{[\s\S]*?\n\};\n\nexport const passPriority/,
  endPhaseEngine,
);

replaceOnce(
  "lib/game.ts",
  "  if (![\"preRoll\", \"power\", \"victor\", \"postDamage\", \"endPlay\"].includes(state.phase) || state.priority !== playerId) throw new Error(\"You do not have priority.\");",
  "  if (![\"preRoll\", \"power\", \"victor\", \"postDamage\", \"endPlay\", \"reset\"].includes(state.phase) || state.priority !== playerId) throw new Error(\"You do not have priority.\");",
);

replacePattern(
  "lib/game.ts",
  /export const discardToHandLimit = \(input: MatchState, playerId: string, cardIds: string\[\]\) => \{[\s\S]*?\n\};\n\nexport function completeMatch/,
  lines(
    "export const discardToHandLimit = (input: MatchState, playerId: string, cardIds: string[]) => {",
    "  const state = cloneMatch(input); const player = playerById(state, playerId);",
    "  if (state.phase !== \"handLimit\" || state.priority !== playerId || cardIds.length !== player.hand.length - 7) throw new Error(\"Select exactly enough cards to keep seven.\");",
    "  discardFromHand(state, player, cardIds.length, cardIds); const next = state.players.find((candidate) => candidate.hand.length > 7);",
    "  if (next) state.priority = next.id;",
    "  else if (state.batch.length || state.triggerOrders.length) setPhase(state, \"reset\", \"End Phase • Reset Step • Resolve discard triggers\", state.startingPlayer);",
    "  else beginTurn(state);",
    "  return withVersion(state);",
    "};",
    "",
    "export function completeMatch",
  ),
);

replacePattern(
  "lib/game.ts",
  /export const nextTurn = \(input: MatchState\) => \{[\s\S]*?\n\};\n\nexport const startNextSeriesGame/,
  lines(
    "export const nextTurn = (input: MatchState) => {",
    "  const state = cloneMatch(input);",
    "  if (state.phase === \"retract\" || state.phase === \"endPlay\") {",
    "    state.batch = [];",
    "    advanceEmptyBatch(state);",
    "    return withVersion(state);",
    "  }",
    "  if (state.phase === \"charge\") {",
    "    beginResetStep(state);",
    "    return withVersion(state);",
    "  }",
    "  if (state.phase === \"reset\") {",
    "    if (state.pendingChoice || state.batch.length || state.triggerOrders.length) {",
    "      throw new Error(\"Resolve every Reset Step trigger before advancing the turn.\");",
    "    }",
    "    finishResetStep(state);",
    "    return withVersion(state);",
    "  }",
    "  if (state.phase === \"handLimit\") {",
    "    if (state.players.some((player) => player.hand.length > 7)) throw new Error(\"Complete every hand-limit discard before advancing the turn.\");",
    "    if (state.batch.length || state.triggerOrders.length) setPhase(state, \"reset\", \"End Phase • Reset Step • Resolve discard triggers\", state.startingPlayer);",
    "    else beginTurn(state);",
    "    return withVersion(state);",
    "  }",
    "  throw new Error(\"The turn advances through priority and the End Phase.\");",
    "};",
    "",
    "export const startNextSeriesGame",
  ),
);

replaceOnce(
  "lib/deadlines.ts",
  lines(
    "  legalPlacementCells,",
    "  orderTriggers,",
    "  selectBakugan,",
  ),
  lines(
    "  legalPlacementCells,",
    "  nextTurn,",
    "  orderTriggers,",
    "  selectBakugan,",
  ),
);

replaceOnce(
  "lib/deadlines.ts",
  lines(
    "  if (tieBreak?.status === \"waiting\") {",
    "    const nextPlayer = state.players.find((player) => !tieBreak.current[player.id]);",
    "    return nextPlayer ? flipTieBreakCard(state, nextPlayer.id) : input;",
    "  }",
    "  const actorId = state.priority;",
  ),
  lines(
    "  if (tieBreak?.status === \"waiting\") {",
    "    const nextPlayer = state.players.find((player) => !tieBreak.current[player.id]);",
    "    return nextPlayer ? flipTieBreakCard(state, nextPlayer.id) : input;",
    "  }",
    "  if (state.phase === \"charge\") return nextTurn(state);",
    "  if (",
    "    state.phase === \"reset\"",
    "    && !state.pendingChoice",
    "    && !state.batch.length",
    "    && !state.triggerOrders.length",
    "  ) return nextTurn(state);",
    "  const actorId = state.priority;",
  ),
);

replaceOnce(
  "lib/deadlines.ts",
  "  if (decisionTimeouts >= 3 && [\"preRoll\", \"power\", \"victor\", \"damage\", \"postDamage\", \"reroll\", \"retract\", \"endPlay\", \"handLimit\"].includes(state.phase)) return concedeMatch(state, actorId);",
  "  if (decisionTimeouts >= 3 && [\"preRoll\", \"power\", \"victor\", \"damage\", \"postDamage\", \"reroll\", \"retract\", \"endPlay\", \"reset\", \"handLimit\"].includes(state.phase)) return concedeMatch(state, actorId);",
);

replaceOnce(
  "lib/deadlines.ts",
  "  if ([\"preRoll\", \"power\", \"victor\", \"postDamage\", \"endPlay\"].includes(state.phase)) return passPriorityWithTieBreak(state, actorId);",
  "  if ([\"preRoll\", \"power\", \"victor\", \"postDamage\", \"endPlay\", \"reset\"].includes(state.phase)) return passPriorityWithTieBreak(state, actorId);",
);

replaceOnce(
  "lib/engine/phase-machine.ts",
  "  NEXT_TURN: [\"postDamage\", \"retract\", \"endPlay\", \"handLimit\"],",
  "  NEXT_TURN: [\"postDamage\", \"retract\", \"endPlay\", \"charge\", \"reset\", \"handLimit\"],",
);

replacePattern(
  "lib/engine/phase-machine.ts",
  /  endPlay: \[\"endPlay\", \"retract\", \"handLimit\", \"draw\", \"result\"\],\n  handLimit: \[\"handLimit\", \"retract\", \"draw\", \"result\"\],/,
  lines(
    "  endPlay: [\"endPlay\", \"retract\", \"charge\", \"result\"],",
    "  charge: [\"charge\", \"reset\", \"result\"],",
    "  reset: [\"reset\", \"handLimit\", \"draw\", \"result\"],",
    "  handLimit: [\"handLimit\", \"reset\", \"retract\", \"draw\", \"result\"],",
  ),
);

replaceOnce(
  "lib/engine/phase-machine.ts",
  lines(
    "    case \"endPlay\": return { area: \"brawl\", step: \"end-play\", legacy: phase };",
    "    case \"handLimit\": return { area: \"brawl\", step: \"hand-limit\", legacy: phase };",
  ),
  lines(
    "    case \"endPlay\": return { area: \"end\", step: \"play\", legacy: phase };",
    "    case \"charge\": return { area: \"end\", step: \"charge\", legacy: phase };",
    "    case \"reset\": return { area: \"end\", step: \"reset\", legacy: phase };",
    "    case \"handLimit\": return { area: \"end\", step: \"hand-limit\", legacy: phase };",
  ),
);

replaceOnce(
  "lib/engine/types.ts",
  "  | { area: \"brawl\"; step: \"power\" | \"victor\" | \"damage\" | \"post-damage\" | \"retract\" | \"end-play\" | \"hand-limit\"; legacy: MatchState[\"phase\"] }",
  lines(
    "  | { area: \"brawl\"; step: \"power\" | \"victor\" | \"damage\" | \"post-damage\" | \"retract\"; legacy: MatchState[\"phase\"] }",
    "  | { area: \"end\"; step: \"play\" | \"charge\" | \"reset\" | \"hand-limit\"; legacy: MatchState[\"phase\"] }",
  ),
);

replaceOnce(
  "components/game-screen-v2/turnProgressState.ts",
  lines(
    "  endPlay: { phaseKey: \"end\", stepKey: \"play\" },",
    "  handLimit: { phaseKey: \"end\", stepKey: \"reset\" },",
    "  result: { phaseKey: \"end\", stepKey: \"reset\" },",
  ),
  lines(
    "  endPlay: { phaseKey: \"end\", stepKey: \"play\" },",
    "  charge: { phaseKey: \"end\", stepKey: \"charge\" },",
    "  reset: { phaseKey: \"end\", stepKey: \"reset\" },",
    "  handLimit: { phaseKey: \"end\", stepKey: \"reset\" },",
    "  result: { phaseKey: \"end\", stepKey: \"reset\" },",
  ),
);

replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  lines(
    "  energizeCard,",
    "  prepareCardPlay,",
    "  selectBakugan,",
  ),
  lines(
    "  energizeCard,",
    "  nextTurn,",
    "  prepareCardPlay,",
    "  selectBakugan,",
  ),
);

replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  lines(
    "  const passTurn = () => submitMatchAction(",
    "    \"pass\",",
    "    {},",
    "    (match, actorId) => resumeDamageAfterFlipWindow(passPriorityWithTieBreak(match, actorId)),",
    "  );",
  ),
  lines(
    "  const passTurn = () => submitMatchAction(",
    "    \"pass\",",
    "    {},",
    "    (match, actorId) => resumeDamageAfterFlipWindow(passPriorityWithTieBreak(match, actorId)),",
    "  );",
    "",
    "  const advanceEndPhase = () => submitMatchAction(",
    "    \"next-turn\",",
    "    {},",
    "    (match) => nextTurn(match),",
    "  );",
  ),
);

const automaticEndPhaseEffect = lines(
  "  useEffect(() => {",
  "    const match = storedState.match;",
  "    const actorId = storedState.playerId ?? match?.players[0]?.id;",
  "    const triggerOrderPending = match?.triggerOrders.some((request) => !request.orderedIds);",
  "    const resetResolutionPending = match?.phase === \"reset\" && Boolean(",
  "      match.pendingChoice || match.batch.length || triggerOrderPending,",
  "    );",
  "    if (",
  "      storedState.route !== \"match\"",
  "      || !match",
  "      || !actorId",
  "      || ![\"charge\", \"reset\"].includes(match.phase)",
  "      || resetResolutionPending",
  "      || (storedState.online && actorId !== match.startingPlayer)",
  "    ) return;",
  "",
  "    const key = `end-phase:${match.id}:${match.version}:${match.phase}`;",
  "    const delay = Math.max(250, match.deadline - Date.now());",
  "    const timeout = window.setTimeout(() => {",
  "      if (automaticActionKey.current === key) return;",
  "      automaticActionKey.current = key;",
  "      void advanceEndPhase().catch(() => {",
  "        if (automaticActionKey.current === key) automaticActionKey.current = \"\";",
  "      });",
  "    }, delay);",
  "    return () => window.clearTimeout(timeout);",
  "  }, [",
  "    storedState.route,",
  "    storedState.online,",
  "    storedState.match?.id,",
  "    storedState.match?.phase,",
  "    storedState.match?.version,",
  "    storedState.match?.deadline,",
  "    storedState.match?.batch.length,",
  "    storedState.match?.pendingChoice?.id,",
  "    storedState.match?.triggerOrders.length,",
  "    storedState.playerId,",
  "  ]);",
  "",
  "  useEffect(() => {",
    "    const match = storedState.match;",
);

replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  lines(
    "  useEffect(() => {",
    "    const match = storedState.match;",
    "    if (",
    "      storedState.route !== \"match\"",
    "      || storedState.online",
  ),
  automaticEndPhaseEffect + lines(
    "    if (",
    "      storedState.route !== \"match\"",
    "      || storedState.online",
  ),
);

replaceOnce(
  "components/game-screen-v2/matchHudState.ts",
  lines(
    "  const canPass = Boolean(",
    "    match",
    "    && player",
    "    && !hasPendingDraws(match)",
    "    && isPriorityWindow(match)",
    "    && match.priority === player.id,",
    "  );",
  ),
  lines(
    "  const resetResolutionWindow = Boolean(match?.phase === \"reset\" && match.batch.length);",
    "  const canPass = Boolean(",
    "    match",
    "    && player",
    "    && !hasPendingDraws(match)",
    "    && (isPriorityWindow(match) || resetResolutionWindow)",
    "    && match.priority === player.id,",
    "  );",
  ),
);

replaceOnce(
  "lib/opponentAiBase.ts",
  lines(
    "  if (match.phase === \"damage\" && match.pendingLoser === playerId) return true;",
    "  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;",
  ),
  lines(
    "  if (match.phase === \"damage\" && match.pendingLoser === playerId) return true;",
    "  if (match.phase === \"reset\" && match.batch.length && match.priority === playerId) return true;",
    "  if (PRIORITY_PHASES.has(match.phase) && match.priority === playerId) return true;",
  ),
);

replaceOnce(
  "lib/opponentAiBase.ts",
  lines(
    "  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {",
    "    if (alternateWinEffectPending(input)) return passPriority(input, playerId);",
  ),
  lines(
    "  if (input.phase === \"reset\" && input.batch.length && input.priority === playerId) {",
    "    return passPriority(input, playerId);",
    "  }",
    "  if (PRIORITY_PHASES.has(input.phase) && input.priority === playerId) {",
    "    if (alternateWinEffectPending(input)) return passPriority(input, playerId);",
  ),
);

replaceOnce(
  "tests/game-engine.test.ts",
  "  legalPlacementCells, normalizeMatchState, orderTriggers, passPriority, placeCore, playCard, selectBakugan,",
  "  legalPlacementCells, nextTurn, normalizeMatchState, orderTriggers, passPriority, placeCore, playCard, selectBakugan,",
);

replacePattern(
  "tests/game-engine.test.ts",
  /test\("the End Phase charges Energy, enforces seven cards, resolves discard triggers, and begins the next Start Phase", \(\) => \{[\s\S]*?\n\}\);\n\ntest\("best-of-three creates a fully reset second game"/,
  lines(
    "test(\"the End Phase exposes Play, Charge, and Reset before hand limits and the next Start Phase\", () => {",
    "  let state = reachPower(); const winner = state.players[0]; const attacking = winner.bakugan.find((bakugan) => bakugan.id === state.selected[winner.id])!; attacking.open = true; state.rolls[winner.id].result = \"open-no-core\"; state.powerBoost[attacking.id] = 9999; state = passWindow(state);",
    "  const loser = state.players[1]; loser.deckCards = loser.deckCards.filter((card) => card.type !== \"Flip\"); loser.deck = loser.deckCards.length; state = settleDamage(passWindow(state));",
    "  if (state.phase === \"postDamage\") state = passWindow(state); assert.equal(state.phase,\"endPlay\"); const currentWinner=state.players.find((player)=>player.id===winner.id)!; currentWinner.hand.push(...currentWinner.deckCards.splice(0, Math.max(0, 9-currentWinner.hand.length))); currentWinner.deck=currentWinner.deckCards.length;",
    "  for (const player of state.players) {",
    "    const tracked = player as typeof player & { tappedEnergyIds?: string[]; energyTapTurn?: number };",
    "    tracked.energyTapTurn = state.turn;",
    "    tracked.tappedEnergyIds = player.energyZone.map((card) => card.id);",
    "    player.energy = 0;",
    "  }",
    "  state = passWindow(state);",
    "  assert.equal(state.phase, \"charge\");",
    "  assert.equal(state.powerBoost[attacking.id], 9999, \"Charge must not perform Reset cleanup.\");",
    "  assert.ok(state.players.every((player) => player.energy === 0));",
    "  assert.ok(state.players.every((player) => ((player as typeof player & { tappedEnergyIds?: string[] }).tappedEnergyIds ?? []).length === 0));",
    "  state = nextTurn(state);",
    "  assert.equal(state.phase, \"reset\");",
    "  assert.deepEqual(state.powerBoost, {});",
    "  assert.deepEqual(state.damageBoost, {});",
    "  state = nextTurn(state);",
    "  assert.equal(state.phase,\"handLimit\"); const actor=state.players.find((player) => player.id===state.priority)!; state=discardToHandLimit(state,actor.id,actor.hand.slice(0,actor.hand.length-7).map((card)=>card.id));",
    "  const nextOver=state.players.find((player)=>state.phase===\"handLimit\"&&player.id===state.priority); if(nextOver) state=discardToHandLimit(state,nextOver.id,nextOver.hand.slice(0,nextOver.hand.length-7).map((card)=>card.id));",
    "  let triggerWindows = 0;",
    "  while (state.phase === \"reset\" && (state.pendingChoice || state.triggerOrders.length || state.batch.length) && triggerWindows < 40) {",
    "    if (state.pendingChoice) {",
    "      const fields = state.pendingChoice.schema.fields.filter((field) => field.chooserId === state.priority);",
    "      state = submitCardChoice(state, state.priority, timeoutChoicesForFields(state, state.priority, fields));",
    "    } else {",
    "      const triggerOrder = state.triggerOrders.find((request) => request.controllerId === state.priority && !request.orderedIds);",
    "      state = triggerOrder",
    "        ? orderTriggers(state, state.priority, triggerOrder.id, triggerOrder.triggerIds)",
    "        : passWindow(state);",
    "    }",
    "    triggerWindows += 1;",
    "  }",
    "  assert.ok(triggerWindows < 40, \"Discard-trigger and choice resolution must terminate.\");",
    "  if (state.phase === \"reset\") state = nextTurn(state);",
    "  assert.equal(state.phase,\"draw\"); assert.equal(state.turn,2);",
    "});",
    "",
    "test(\"best-of-three creates a fully reset second game\"",
  ),
);

replaceOnce(
  "tests/engine-architecture.test.ts",
  lines(
    "  assert.deepEqual(structuredPhaseFor(\"handLimit\"), {",
    "    area: \"brawl\",",
    "    step: \"hand-limit\",",
    "    legacy: \"handLimit\",",
    "  });",
  ),
  lines(
    "  assert.deepEqual(structuredPhaseFor(\"charge\"), {",
    "    area: \"end\",",
    "    step: \"charge\",",
    "    legacy: \"charge\",",
    "  });",
    "  assert.deepEqual(structuredPhaseFor(\"reset\"), {",
    "    area: \"end\",",
    "    step: \"reset\",",
    "    legacy: \"reset\",",
    "  });",
    "  assert.deepEqual(structuredPhaseFor(\"handLimit\"), {",
    "    area: \"end\",",
    "    step: \"hand-limit\",",
    "    legacy: \"handLimit\",",
    "  });",
  ),
);

replaceOnce(
  "tests/roll-phase-presentation.test.ts",
  lines(
    "  presentedTurnProgress,",
    "  turnProgressSnapshot,",
  ),
  lines(
    "  presentedTurnProgress,",
    "  turnProgressSnapshot,",
    "  turnStepsForPhase,",
  ),
);

replaceOnce(
  "tests/roll-phase-presentation.test.ts",
  lines(
    "test(\"Power is presented normally after the roll animation settles\", () => {",
    "  const power = turnProgressSnapshot({",
    "    phase: \"power\",",
    "    stepLabel: \"Brawl Phase • Power Step\",",
    "    turn: 3,",
    "  });",
    "",
    "  assert.equal(presentedTurnProgress(power, null, false)?.stepKey, \"power\");",
    "});",
  ),
  lines(
    "test(\"Power is presented normally after the roll animation settles\", () => {",
    "  const power = turnProgressSnapshot({",
    "    phase: \"power\",",
    "    stepLabel: \"Brawl Phase • Power Step\",",
    "    turn: 3,",
    "  });",
    "",
    "  assert.equal(presentedTurnProgress(power, null, false)?.stepKey, \"power\");",
    "});",
    "",
    "test(\"the End Phase HUD tracks Play, Charge, and Reset as distinct live steps\", () => {",
    "  assert.deepEqual(turnStepsForPhase(\"end\").map((step) => step.key), [\"play\", \"charge\", \"reset\"]);",
    "  assert.equal(turnProgressSnapshot({ phase: \"endPlay\", stepLabel: \"End Phase • Play Step\", turn: 5 })?.stepKey, \"play\");",
    "  assert.equal(turnProgressSnapshot({ phase: \"charge\", stepLabel: \"End Phase • Charge Step\", turn: 5 })?.stepKey, \"charge\");",
    "  assert.equal(turnProgressSnapshot({ phase: \"reset\", stepLabel: \"End Phase • Reset Step\", turn: 5 })?.stepKey, \"reset\");",
    "  assert.equal(turnProgressSnapshot({ phase: \"handLimit\", stepLabel: \"End of turn • Discard to seven\", turn: 5 })?.stepKey, \"reset\");",
    "});",
  ),
);

console.log("Applied distinct End Phase Play, Charge, and Reset engine states.");
