import { readFile, writeFile, unlink } from "node:fs/promises";

async function replaceOnce(path, before, after) {
  const source = await readFile(path, "utf8");
  if (!source.includes(before)) throw new Error(`Expected patch anchor not found in ${path}: ${before.slice(0, 100)}`);
  if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Patch anchor is ambiguous in ${path}`);
  await writeFile(path, source.replace(before, after));
}

await replaceOnce(
  "lib/rules/model.ts",
  '  attachmentState?: "attached" | "unattached";\n  /** Exclude the Bakugan that created the trigger ("another Bakugan"). */',
  '  attachmentState?: "attached" | "unattached";\n  /** Restrict Energy-card choices by their charged state for Recharge effects. */\n  energyState?: "charged" | "uncharged";\n  /** Exclude the Bakugan that created the trigger ("another Bakugan"). */',
);
await replaceOnce(
  "lib/rules/model.ts",
  '  | { kind: "generate-energy"; amount: number; scale?: string }\n  | { kind: "set-stat"; stat: "power" | "damage"; value: number }',
  '  | { kind: "generate-energy"; amount: number; scale?: string }\n  | { kind: "recharge-energy"; amount: number | "all" }\n  | { kind: "set-stat"; stat: "power" | "damage"; value: number }',
);

await replaceOnce(
  "lib/rules/catalogue-primitives.ts",
  '  if (/Energize this(?: uncharged|\\b)/i.test(text)) actions.push({\n    kind: "energize",\n    amount: 1,\n    source: "self",\n    enters: energizeEntryState,\n  });\n\n  const generatedEnergy = text.match(/\\+(\\d+) \\[Energy\\]/i);',
  '  if (/Energize this(?: uncharged|\\b)/i.test(text)) actions.push({\n    kind: "energize",\n    amount: 1,\n    source: "self",\n    enters: energizeEntryState,\n  });\n\n  const recharge = text.match(/\\brecharge\\s+(?:(?:all\\s+of\\s+)?your\\s+)?(?:(up to)\\s+)?(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)?\\s*Energy cards?\\b/i);\n  if (recharge) actions.push({\n    kind: "recharge-energy",\n    amount: recharge[2] ? numberValue(recharge[2]) : "all",\n  });\n\n  const generatedEnergy = text.match(/\\+(\\d+) \\[Energy\\]/i);',
);

await replaceOnce(
  "lib/rules/catalogue-structure.ts",
  '  if (!/destroy all/i.test(text) && /destroy (?:an?|two|three) (?:enemy )?energy|choose an energy/i.test(text)) {\n    const selected = choice("targetEnergyIds", targetTiming, "energy-card", "Choose Energy");\n    selected.targetOwner = targetOwner;\n    const amountText = text.match(/destroy (an?|one|two|three|\\d+) (?:enemy )?energy/i)?.[1]?.toLowerCase();\n    const amount = amountText === "two" ? 2 : amountText === "three" ? 3 : Number(amountText) || 1;\n    selected.minimum = cardId === "bb-97" ? 1 : amount;\n    selected.maximum = cardId === "bb-97" ? 2 : amount;\n    result.push(selected);\n  }',
  '  if (!/destroy all/i.test(text) && /destroy (?:an?|two|three) (?:enemy )?energy|choose an energy/i.test(text)) {\n    const selected = choice("targetEnergyIds", targetTiming, "energy-card", "Choose Energy");\n    selected.targetOwner = targetOwner;\n    const amountText = text.match(/destroy (an?|one|two|three|\\d+) (?:enemy )?energy/i)?.[1]?.toLowerCase();\n    const amount = amountText === "two" ? 2 : amountText === "three" ? 3 : Number(amountText) || 1;\n    selected.minimum = cardId === "bb-97" ? 1 : amount;\n    selected.maximum = cardId === "bb-97" ? 2 : amount;\n    result.push(selected);\n  }\n  const rechargeChoice = text.match(/\\brecharge\\s+up to\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+Energy cards?\\b/i);\n  if (rechargeChoice) {\n    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };\n    const amount = words[rechargeChoice[1].toLowerCase()] ?? Math.max(1, Number(rechargeChoice[1]) || 1);\n    const selected = choice("targetEnergyIds", "resolve", "energy-card", `Choose up to ${amount} uncharged Energy cards`, true);\n    selected.targetOwner = "controller";\n    selected.energyState = "uncharged";\n    selected.minimum = 0;\n    selected.maximum = amount;\n    result.push(selected);\n  }',
);
await replaceOnce(
  "lib/rules/catalogue-structure.ts",
  '  if (/\\bmay\\b/i.test(text) && !/may discard/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));',
  '  if (/\\bmay\\b/i.test(text) && !/may discard|may recharge up to/i.test(text)) result.push(choice("confirmed", "resolve", "mode", "Use this optional effect?", false));',
);

await replaceOnce(
  "lib/rules/choices.ts",
  'import { canonicalEvoTargetAllowed } from "./identity";\nimport type { ChoiceSpec, ChoiceTiming } from "./model";',
  'import { canonicalEvoTargetAllowed } from "./identity";\nimport { activeTappedEnergyIds } from "./costs";\nimport type { ChoiceSpec, ChoiceTiming } from "./model";',
);
await replaceOnce(
  "lib/rules/choices.ts",
  '    case "energy-card":\n      return targetOwners(match, controllerId, spec).flatMap((owner) => owner.energyZone\n        .filter((energy) => cardMatchesSpec(energy, spec))\n        .map((energy) => option(energy.id, "Face-down Energy", owner.id)));',
  '    case "energy-card":\n      return targetOwners(match, controllerId, spec).flatMap((owner) => {\n        const uncharged = new Set(activeTappedEnergyIds(owner, match.turn));\n        return owner.energyZone\n          .filter((energy) => cardMatchesSpec(energy, spec))\n          .filter((energy) => !spec.energyState\n            || (spec.energyState === "uncharged" ? uncharged.has(energy.id) : !uncharged.has(energy.id)))\n          .map((energy) => option(energy.id, spec.energyState === "uncharged" ? "Uncharged Energy" : "Face-down Energy", owner.id));\n      });',
);

await replaceOnce(
  "lib/rules/costs.ts",
  'export function availableEnergy(player: EnergyTrackedPlayer, turn: number) {\n  return player.energyTapTurn === turn ? Math.max(0, Math.floor(player.energy)) : 0;\n}\n\nexport function beginCardPayment(',
  'export function availableEnergy(player: EnergyTrackedPlayer, turn: number) {\n  return player.energyTapTurn === turn ? Math.max(0, Math.floor(player.energy)) : 0;\n}\n\n/** Charge selected uncharged Energy cards, or every uncharged Energy card when no selection is supplied. */\nexport function rechargeEnergyCards(\n  state: MatchState,\n  playerId: string,\n  selectedIds?: readonly string[],\n) {\n  const player = playerById(state, playerId) as EnergyTrackedPlayer;\n  const tapped = activeTappedEnergyIds(player, state.turn);\n  const requested = selectedIds ? new Set(selectedIds) : undefined;\n  const recharged = tapped.filter((id) => !requested || requested.has(id));\n  if (!recharged.length) return 0;\n  const rechargedSet = new Set(recharged);\n  player.energyTapTurn = state.turn;\n  player.tappedEnergyIds = tapped.filter((id) => !rechargedSet.has(id));\n  return recharged.length;\n}\n\nexport function beginCardPayment(',
);

await replaceOnce(
  "lib/game.ts",
  'import { activeTappedEnergyIds, cardCostBreakdown } from "./rules/costs";',
  'import { activeTappedEnergyIds, cardCostBreakdown, rechargeEnergyCards } from "./rules/costs";',
);
await replaceOnce(
  "lib/game.ts",
  '    case "generate-energy":\n      player.energy += Math.max(0, scaleStat(state, player, text, action.amount, "draw"));\n      return;\n    case "set-stat":',
  '    case "generate-energy":\n      player.energy += Math.max(0, scaleStat(state, player, text, action.amount, "draw"));\n      return;\n    case "recharge-energy": {\n      if (choices.confirmed === false) return;\n      const selected = action.amount === "all" ? undefined : (choices.targetEnergyIds ?? []).slice(0, action.amount);\n      rechargeEnergyCards(state, controllerId, selected);\n      return;\n    }\n    case "set-stat":',
);

await replaceOnce(
  "lib/rules/effects.ts",
  '    case "energize": return action.amount * 2;\n    case "grant-keyword":',
  '    case "energize": return action.amount * 2;\n    case "recharge-energy": return action.amount === "all" ? 4 : action.amount * 1.6;\n    case "grant-keyword":',
);

await replaceOnce(
  "lib/aiCardSemantics.ts",
  '    case "energize": return action.amount * 2;\n    case "generate-energy": return action.amount * 1.6;',
  '    case "energize": return action.amount * 2;\n    case "generate-energy": return action.amount * 1.6;\n    case "recharge-energy": return action.amount === "all" ? 4 : action.amount * 1.6;',
);

await replaceOnce(
  "lib/opponentAiBase.ts",
  'import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";\nimport { flipDamageCard, resolveManualDamage } from "./manualDamage";',
  'import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";\nimport { activeTappedEnergyIds } from "./rules/costs";\nimport { flipDamageCard, resolveManualDamage } from "./manualDamage";',
);
await replaceOnce(
  "lib/opponentAiBase.ts",
  'function hasEligibleAttacker(\n  match: MatchState,\n  playerId: string,\n  action: Extract<RuleAction, { kind: "attack" }>,\n) {\n  const player = playerById(match, playerId);\n  return Boolean(player?.bakugan.some((bakugan) => (\n    bakugan.open && (!action.faction || bakugan.faction === action.faction)\n  )));\n}\n\nfunction cardValue(',
  'function hasEligibleAttacker(\n  match: MatchState,\n  playerId: string,\n  action: Extract<RuleAction, { kind: "attack" }>,\n) {\n  const player = playerById(match, playerId);\n  return Boolean(player?.bakugan.some((bakugan) => (\n    bakugan.open && (!action.faction || bakugan.faction === action.faction)\n  )));\n}\n\nfunction rechargeEnergyValue(\n  match: MatchState,\n  playerId: string,\n  action: Extract<RuleAction, { kind: "recharge-energy" }>,\n) {\n  const player = playerById(match, playerId);\n  if (!player) return 0;\n  const uncharged = activeTappedEnergyIds(player, match.turn).length;\n  const amount = action.amount === "all" ? uncharged : Math.min(uncharged, action.amount);\n  return amount * 1.6;\n}\n\nfunction temporaryPowerChangesVictor(\n  match: MatchState,\n  playerId: string,\n  choices: CardChoices,\n  entries: ReturnType<typeof activeCardActionEntries>,\n) {\n  if (match.phase !== "power" || match.victorByDamage) return true;\n  const opponent = opponentOf(match, playerId);\n  const playerRoll = match.rolls[playerId];\n  const opponentRoll = opponent ? match.rolls[opponent.id] : undefined;\n  if (!opponent || !playerRoll || playerRoll.result === "miss-closed") return true;\n  if (!opponentRoll || opponentRoll.result === "miss-closed") return false;\n\n  let own = totalPower(match, playerId);\n  let enemy = totalPower(match, opponent.id);\n  if (own > enemy) return false;\n  let found = false;\n  for (const { instruction, action } of entries) {\n    if (!isTemporaryCombatAction(action)) continue;\n    if (action.kind !== "modify-stat" && action.kind !== "set-stat") continue;\n    if (action.stat !== "power") continue;\n    const targetsEnemy = actionTargetsEnemy(match, playerId, choices, action, instruction.sourceText);\n    if (action.kind === "modify-stat") {\n      if (shadowStrikeBlocksReduction(match, playerId, choices, action, instruction.sourceText)) continue;\n      if (targetsEnemy) enemy += action.amount;\n      else own += action.amount;\n    } else if (targetsEnemy) enemy = action.value;\n    else own = action.value;\n    found = true;\n  }\n  return !found || own > enemy;\n}\n\nfunction isTemporaryPowerAction(action: RuleAction) {\n  return isTemporaryCombatAction(action)\n    && (action.kind === "modify-stat" || action.kind === "set-stat")\n    && action.stat === "power";\n}\n\nfunction cardValue(',
);
await replaceOnce(
  "lib/opponentAiBase.ts",
  '  const entries = activeCardActionEntries(\n    resolving,\n    playerId,\n    card,\n    choices,\n    { execution: "play" },\n  );\n  let value = entries.reduce((sum, entry) => {\n    if (\n      entry.action.kind === "attack"\n      && !hasEligibleAttacker(resolving, playerId, entry.action)\n    ) return sum;\n    return sum + estimateRuleActionValue(entry.action, resolving);\n  }, 0) - printedCost * 0.72;\n  for (const { instruction, action } of entries) {\n    const raw = actionBaseValue(action);',
  '  const entries = activeCardActionEntries(\n    resolving,\n    playerId,\n    card,\n    choices,\n    { execution: "play" },\n  );\n  const powerChangesVictor = temporaryPowerChangesVictor(match, playerId, choices, entries);\n  let value = entries.reduce((sum, entry) => {\n    if (\n      entry.action.kind === "attack"\n      && !hasEligibleAttacker(resolving, playerId, entry.action)\n    ) return sum;\n    if (isTemporaryPowerAction(entry.action) && !powerChangesVictor) return sum;\n    if (entry.action.kind === "recharge-energy") {\n      return sum + rechargeEnergyValue(resolving, playerId, entry.action);\n    }\n    return sum + estimateRuleActionValue(entry.action, resolving);\n  }, 0) - printedCost * 0.72;\n  for (const { instruction, action } of entries) {\n    if (isTemporaryPowerAction(action) && !powerChangesVictor) continue;\n    const raw = actionBaseValue(action);',
);
await replaceOnce(
  "lib/opponentAiBase.ts",
  '    if (["move", "search", "play", "energize", "generate-energy", "copy", "negate", "prevention"].includes(action.kind)) {',
  '    if (["move", "search", "play", "energize", "generate-energy", "recharge-energy", "copy", "negate", "prevention"].includes(action.kind)) {',
);
await replaceOnce(
  "lib/opponentAiBase.ts",
  '    if (action.kind === "negate") {\n      value += negateValue(match, playerId, compileCardEffect(card));\n      continue;\n    }\n    const raw = actionBaseValue(action);',
  '    if (action.kind === "negate") {\n      value += negateValue(match, playerId, compileCardEffect(card));\n      continue;\n    }\n    if (action.kind === "recharge-energy") {\n      value += rechargeEnergyValue(match, playerId, action);\n      continue;\n    }\n    const raw = actionBaseValue(action);',
);
await replaceOnce(
  "lib/opponentAiBase.ts",
  '  if (field.kind === "energy") return option?.ownerId === chooserId ? -1 : 1;',
  '  if (field.kind === "energy") {\n    if (/\\brecharge\\b/i.test(card.effect)) return option?.ownerId === chooserId ? 1.5 : -1.5;\n    return option?.ownerId === chooserId ? -1 : 1;\n  }',
);

await replaceOnce(
  "tests/opponent-ai-tactics.test.ts",
  '  let energize = matchWith(ai, human, "energize");',
  '  const energize = matchWith(ai, human, "energize");',
);

const testSource = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { CARDS } from "../lib/data";\nimport {\n  CENTER_CELL,\n  createMatch,\n  emitGameEvent,\n  passPriority,\n  submitCardChoice,\n  type Bakugan,\n  type GameCard,\n  type MatchState,\n  type PlayerState,\n  type RollOutcome,\n} from "../lib/game";\nimport { advanceOpponentAi } from "../lib/opponentAi";\nimport { buildChoiceSchemaFromSpecs } from "../lib/rules/choices";\nimport { activeTappedEnergyIds, rechargeEnergyCards } from "../lib/rules/costs";\nimport { ruleDefinitionForCard } from "../lib/rules";\n\nlet serial = 0;\nfunction card(catalogId: string): GameCard {\n  const source = CARDS.find((candidate) => candidate.catalogId === catalogId);\n  assert.ok(source, \\`Missing \\${catalogId}\\`);\n  serial += 1;\n  return { ...source, id: \\`\\${catalogId}-test-\\${serial}\\` };\n}\nfunction character(faction: GameCard["faction"]) {\n  const source = CARDS.find((candidate) => candidate.type === "Character" && candidate.faction === faction);\n  assert.ok(source);\n  serial += 1;\n  return { ...source, id: \\`character-\\${faction}-\\${serial}\\` };\n}\nfunction bakugan(id: string, faction: GameCard["faction"], power: number, evo?: GameCard): Bakugan {\n  const printed = character(faction);\n  return {\n    id, name: id, faction, bPower: power, damage: 5, rollAccuracy: 90, doubleCoreChance: 5, art: "",\n    character: { ...printed, bPower: power, damage: 5 }, open: true, heldCoreCells: [], evoStack: evo ? [evo] : [],\n  };\n}\nfunction player(id: string, active: Bakugan, hand: GameCard[] = []): PlayerState {\n  return {\n    id, name: id, bakugan: [active], cores: [], deck: 0, deckCards: [], hand, discard: [], energyZone: [], heroes: [],\n    energy: 0, maxEnergy: 0, ready: true, connected: true, lastSeen: Date.now(), energizedThisTurn: false, cardsPlayedThisTurn: 0,\n  };\n}\nfunction openRoll(playerId: string, bakuganId: string): RollOutcome {\n  return { playerId, bakuganId, target: CENTER_CELL, resolvedTarget: CENTER_CELL, result: "open-no-core", cores: [], accuracyRoll: 0, deviationRoll: 0, doubleRoll: 0, secondCoreRoll: 0, doubleCore: false, path: [], note: "test" };\n}\nfunction brawl(ai: PlayerState, human: PlayerState): MatchState {\n  const match = createMatch("RECHARGE-AI", "bo1", [ai, human]);\n  match.turn = 2; match.phase = "power"; match.stepLabel = "Power Step"; match.startingPlayer = ai.id; match.initialStartingPlayer = ai.id; match.priority = ai.id;\n  match.selected[ai.id] = ai.bakugan[0].id; match.selected[human.id] = human.bakugan[0].id;\n  match.rolls[ai.id] = openRoll(ai.id, ai.bakugan[0].id); match.rolls[human.id] = openRoll(human.id, human.bakugan[0].id);\n  ai.bakugan[0].open = true; human.bakugan[0].open = true;\n  return match;\n}\nfunction setEnergy(owner: PlayerState, amount: number, tapped: number, turn: number) {\n  owner.energyZone = Array.from({ length: amount }, (_, index) => card("br-53")).map((energy, index) => ({ ...energy, id: \\`\\${owner.id}-energy-\\${index}\\` }));\n  owner.maxEnergy = amount;\n  Object.assign(owner, { energyTapTurn: turn, tappedEnergyIds: owner.energyZone.slice(0, tapped).map((energy) => energy.id) });\n}\n\ntest("Recharge text compiles into executable typed actions for Serpenteze and generic Recharge cards", () => {\n  for (const [catalogId, expected] of [["br-163", "all"], ["br-156", 2], ["br-52", "all"], ["br-75", "all"]] as const) {\n    const definition = ruleDefinitionForCard(card(catalogId));\n    const actions = definition.abilities.flatMap((ability) => ability.instructions.flatMap((instruction) => instruction.actions));\n    const recharge = actions.find((action) => action.kind === "recharge-energy");\n    assert.ok(recharge, \\`\\${catalogId} should have a Recharge action\\`);\n    assert.equal(recharge.amount, expected);\n  }\n  const titan = ruleDefinitionForCard(card("br-163"));\n  assert.ok(titan.abilities.some((ability) => ability.trigger?.event === "BAKUGAN_OPENED"));\n});\n\ntest("up-to Recharge choices expose only the controller's uncharged Energy", () => {\n  const hyper = card("br-156");\n  const ai = player("ai", bakugan("serpenteze", "Ventus", 700, hyper));\n  const human = player("human", bakugan("human", "Pyrus", 500));\n  const match = brawl(ai, human);\n  setEnergy(match.players[0], 4, 3, match.turn);\n  const definition = ruleDefinitionForCard(hyper);\n  const instruction = definition.abilities.flatMap((ability) => ability.instructions).find((candidate) => candidate.sourceText.includes("recharge up to two"));\n  assert.ok(instruction);\n  const schema = buildChoiceSchemaFromSpecs(match, ai.id, hyper, instruction.choices, "resolve", { sourceBakuganId: ai.bakugan[0].id });\n  const field = schema.fields.find((candidate) => candidate.id === "targetEnergyIds");\n  assert.ok(field);\n  assert.equal(field.minimum, 0);\n  assert.equal(field.maximum, 2);\n  assert.deepEqual(field.options.map((option) => option.id), match.players[0].energyZone.slice(0, 3).map((energy) => energy.id));\n});\n\ntest("Recharge changes uncharged Energy back to charged without creating Energy pool", () => {\n  const ai = player("ai", bakugan("serpenteze", "Ventus", 700));\n  const human = player("human", bakugan("human", "Pyrus", 500));\n  const match = brawl(ai, human);\n  setEnergy(match.players[0], 4, 3, match.turn);\n  const ids = activeTappedEnergyIds(match.players[0], match.turn);\n  assert.equal(rechargeEnergyCards(match, ai.id, [ids[1]]), 1);\n  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), [ids[0], ids[2]]);\n  assert.equal(match.players[0].energy, 0);\n  assert.equal(rechargeEnergyCards(match, ai.id), 2);\n  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), []);\n  assert.equal(match.players[0].energy, 0);\n});\n\ntest("Titan Serpenteze Ultra's open trigger resolves Recharge all through the game engine", () => {\n  const titan = card("br-163");\n  const ai = player("ai", bakugan("titan-serpenteze", "Ventus", 1000, titan));\n  const human = player("human", bakugan("human", "Pyrus", 500));\n  let match = brawl(ai, human);\n  setEnergy(match.players[0], 5, 4, match.turn);\n  emitGameEvent(match, { id: "titan-open", type: "open", playerId: ai.id, targetBakuganId: ai.bakugan[0].id });\n  assert.ok(match.batch.some((effect) => effect.card.catalogId === "br-163"));\n  match = passPriority(match, ai.id);\n  match = passPriority(match, human.id);\n  assert.ok(match.pendingChoice, "optional Recharge should ask on resolution");\n  assert.equal(match.pendingChoice?.controllerId, ai.id);\n  match = submitCardChoice(match, ai.id, { confirmed: true });\n  assert.deepEqual(activeTappedEnergyIds(match.players[0], match.turn), []);\n});\n\ntest("AI keeps Dark Waters when its +200 B is redundant and the optional Reroll is not valuable", () => {\n  const darkWaters = card("br-5");\n  const ai = player("ai", bakugan("ai-b", "Aquos", 900), [darkWaters]);\n  const human = player("human", bakugan("human-b", "Pyrus", 700));\n  const match = brawl(ai, human);\n  setEnergy(match.players[0], 1, 0, match.turn);\n  const next = advanceOpponentAi(match, ai.id);\n  assert.ok(next);\n  assert.equal(next.batch.length, 0);\n  assert.ok(next.players[0].hand.some((candidate) => candidate.id === darkWaters.id));\n});\n\ntest("AI may still use Dark Waters for independent Reroll value rather than redundant B-Power", () => {\n  const darkWaters = card("br-5");\n  const ai = player("ai", bakugan("ai-b", "Aquos", 500), [darkWaters]);\n  const human = player("human", bakugan("human-b", "Pyrus", 700));\n  const match = brawl(ai, human);\n  match.rolls[ai.id] = { ...match.rolls[ai.id], result: "miss-closed" };\n  match.players[0].bakugan[0].open = false;\n  setEnergy(match.players[0], 1, 0, match.turn);\n  const next = advanceOpponentAi(match, ai.id);\n  assert.ok(next);\n  assert.equal(next.players[0].hand.some((candidate) => candidate.id === darkWaters.id), false);\n  assert.ok(next.batch.some((effect) => effect.card.id === darkWaters.id) || next.phase === "reroll");\n});\n`;
await writeFile("tests/recharge-and-dark-waters.test.ts", testSource);

const packagePath = "package.json";
const pkg = JSON.parse(await readFile(packagePath, "utf8"));
for (const name of ["test", "test:rules"]) {
  if (!pkg.scripts[name].includes("tests/recharge-and-dark-waters.test.ts")) {
    pkg.scripts[name] = pkg.scripts[name].replace("node --import tsx --test ", "node --import tsx --test tests/recharge-and-dark-waters.test.ts ");
  }
}
await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

await unlink("scripts/apply-serpenteze-dark-waters-fix.mjs");
await unlink(".github/workflows/apply-serpenteze-dark-waters-fix.yml");
