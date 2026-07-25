import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const write = (path, value) => writeFile(new URL(path, root), value);

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing integration anchor: ${label}`);
  return source.replace(before, after);
}

// Integrate the physical simulator with the authoritative game kernel.
{
  const path = "lib/game.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    'import { collectRuleTriggers } from "./rules/triggers";\n',
    'import { collectRuleTriggers } from "./rules/triggers";\nimport {\n  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,\n  PhysicalSimulationError,\n  physicalRotationPhaseOpenCell,\n  resolvePhysicalRollOutcome,\n  simulatePhysicalRollStep,\n} from "./rules/physical-simulation";\nimport {\n  EngineRuntimeLimitError,\n  MAX_PHYSICAL_ROLL_ATTEMPTS,\n  consumePhysicalRollAttempt,\n} from "./engine/limits";\n',
    "game imports",
  );
  source = replaceOnce(
    source,
    'export type RollPathPoint = { x: number; y: number };\nexport type RollResult =\n',
    'export type RollPathPoint = { x: number; y: number };\nexport type PhysicalCollisionDecision = {\n  kind: "primary-contested" | "secondary-yielded";\n  coreCell: string;\n  winnerPlayerId: string;\n  affectedPlayerId: string;\n  policy: string;\n};\nexport type RollResult =\n',
    "collision type",
  );
  source = replaceOnce(
    source,
    '  path: RollPathPoint[];\n  note: string;\n};\n',
    '  path: RollPathPoint[];\n  note: string;\n  /** Versioned digital-adaptation profile that interpreted the physical roll. */\n  simulationProfileId?: string;\n  /** One-based attempt number when every Bakugan remained closed and the step repeated. */\n  attempt?: number;\n  /** Structured contested-pickup decisions retained for replay and diagnostics. */\n  collisionDecisions?: PhysicalCollisionDecision[];\n};\n',
    "roll metadata",
  );
  const start = source.indexOf("const ROLL_GRID_WIDTH = 1800;");
  const end = source.indexOf("export const targetCore = ", start);
  if (start < 0 || end < 0) throw new Error("Could not locate the embedded physical simulation block.");
  const replacement = `export const rotationPhaseOpenCell = (\n  state: MatchState,\n  playerId: string,\n  targetCell: string,\n) => physicalRotationPhaseOpenCell(\n  state,\n  HEX_CELLS,\n  playerId,\n  targetCell,\n  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,\n);\n\nexport const resolveRollOutcome = (\n  state: MatchState,\n  player: PlayerState,\n  randomRoll: (maximum: number) => number = secureRandomInt,\n): RollOutcome => resolvePhysicalRollOutcome(\n  state,\n  HEX_CELLS,\n  player,\n  randomRoll,\n  BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,\n);\n\nconst performRolls = (state: MatchState) => {\n  const simulation = (() => {\n    try {\n      return simulatePhysicalRollStep(\n        state,\n        HEX_CELLS,\n        secureRandomInt,\n        BATTLE_PLANET_PHYSICAL_SIMULATION_PROFILE,\n        { onAttempt: () => consumePhysicalRollAttempt() },\n      );\n    } catch (error) {\n      if (error instanceof PhysicalSimulationError && error.code === "ROLL_ATTEMPT_LIMIT") {\n        throw new EngineRuntimeLimitError(\n          "physicalRollAttempts",\n          MAX_PHYSICAL_ROLL_ATTEMPTS,\n          MAX_PHYSICAL_ROLL_ATTEMPTS + 1,\n        );\n      }\n      throw error;\n    }\n  })();\n  for (const attempt of simulation.attempts) {\n    for (const roll of attempt.outcomes) {\n      entry(\n        state,\n        "random",\n        \\`${"${playerById(state, roll.playerId).name}"}: physical ${"${simulation.profileId}"} attempt ${"${attempt.attempt}"}, accuracy ${"${roll.accuracyRoll}"}/100, double ${"${roll.doubleRoll}"}/100 → ${"${roll.result}"}. ${"${roll.note}"}\\`,\n      );\n    }\n    if (attempt.repeated) {\n      entry(\n        state,\n        "game",\n        \\`Physical roll attempt ${"${attempt.attempt}"} left every Bakugan closed. The Rolling Step repeats under ${"${simulation.profileId}"}.\\`,\n      );\n    }\n  }\n  for (const decision of simulation.collisionDecisions) {\n    entry(\n      state,\n      "game",\n      \\`Physical collision on ${"${decision.coreCell}"}: ${"${playerById(state, decision.winnerPlayerId).name}"} kept the pickup; ${"${playerById(state, decision.affectedPlayerId).name}"} was resolved by ${"${decision.policy}"}.\\`,\n    );\n  }\n  const outcomes = simulation.outcomes;\n  state.informationEpoch += 1;\n  state.undoWindow = undefined;\n  const openedPlayerIds: string[] = [];\n  for (const roll of outcomes) {\n    state.rolls[roll.playerId] = roll;\n    const player = playerById(state, roll.playerId);\n    const bakugan = player.bakugan.find((candidate) => candidate.id === roll.bakuganId)!;\n    bakugan.open = roll.result !== "miss-closed";\n    if (bakugan.open) {\n      openedPlayerIds.push(player.id);\n      (bakugan as Bakugan & { openedTurn?: number }).openedTurn = state.turn;\n      for (const cell of roll.cores) {\n        const placement = state.placements.find((candidate) => candidate.cell === cell);\n        if (placement) placement.attachedTo = bakugan.id;\n      }\n      bakugan.heldCoreCells.push(...roll.cores.filter((cell) => !bakugan.heldCoreCells.includes(cell)));\n    }\n  }\n  setPhase(state, "power", "Brawl Phase • Power Step", state.startingPlayer);\n  emitGameEvent(state, {\n    id: \\`${"${state.turn}"}:open:${"${openedPlayerIds.sort().join("+")}"}\\`,\n    type: "open",\n    playerId: "*",\n    playerIds: openedPlayerIds,\n  });\n};\n\n`;
  source = `${source.slice(0, start)}${replacement}${source.slice(end)}`;
  await write(path, source);
}

// Include simulation identity and repeat attempts in presentation signatures.
{
  const path = "lib/rolling.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    '    .map((roll) => `${roll.playerId}:${roll.result}:${roll.accuracyRoll}:${roll.deviationRoll}:${roll.doubleRoll}:${roll.secondCoreRoll}:${roll.cores.join(",")}`)\n',
    '    .map((roll) => `${roll.playerId}:${roll.simulationProfileId ?? "legacy"}:${roll.attempt ?? 1}:${roll.result}:${roll.accuracyRoll}:${roll.deviationRoll}:${roll.doubleRoll}:${roll.secondCoreRoll}:${roll.cores.join(",")}`)\n',
    "roll result signature",
  );
  await write(path, source);
}

// Version the extracted simulation profile independently.
{
  const path = "lib/content/versions.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    'export const DIGITAL_ADAPTATION_VERSION = "digital-roll-profile-v1" as const;\n',
    'export const PHYSICAL_SIMULATION_VERSION = "physical-simulation-v2" as const;\nexport const DIGITAL_ADAPTATION_VERSION = PHYSICAL_SIMULATION_VERSION;\n',
    "physical simulation version",
  );
  await write(path, source);
}

// Draft authoring definitions are typed but can never masquerade as reviewed production definitions.
{
  const path = "lib/rules/model.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    '  implementationStatus: "complete";\n',
    '  implementationStatus: "draft" | "complete";\n',
    "rule definition status",
  );
  await write(path, source);
}

{
  const path = "lib/rules/catalogue.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    'const DEFINITIONS = Object.freeze(CARDS.map(definitionForCard));\n',
    `export function authorRuleDefinitionForCard(\n  card: GameCard,\n): RuleDefinition & { implementationStatus: "draft" } {\n  const definition = definitionForCard(card);\n  return {\n    ...definition,\n    implementationStatus: "draft",\n    provenance: {\n      authorityOrder: [...definition.provenance.authorityOrder],\n      citations: definition.provenance.citations.map((citation) => ({ ...citation })),\n      reviewed: false,\n    },\n    goldenTestIds: [],\n  };\n}\n\nconst DEFINITIONS = Object.freeze(CARDS.map(definitionForCard));\n`,
    "authoring compiler export",
  );
  source = replaceOnce(
    source,
    'export function validateCardAgainstRules(card: GameCard) {\n  const definition = ruleDefinitionForCard(card);\n',
    'export function validateCardAgainstRules(card: GameCard) {\n  const definition = ruleDefinitionForCard(card);\n  if (definition.implementationStatus !== "complete") throw new UnsupportedCardTextError("UNSUPPORTED_RULE_NODE", `${card.name} is not a reviewed production definition.`);\n',
    "production status validation",
  );
  await write(path, source);
}

// Track repeated physical attempts in the same fail-closed runtime budget as effects and replacements.
{
  const path = "lib/engine/limits.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    'export const MAX_PENDING_CHOICES = 20;\n\nexport type RuntimeBudgetMetric = "triggerChainDepth" | "effectSteps" | "replacementIterations" | "pendingChoices";\n',
    'export const MAX_PENDING_CHOICES = 20;\nexport const MAX_PHYSICAL_ROLL_ATTEMPTS = 64;\n\nexport type RuntimeBudgetMetric = "triggerChainDepth" | "effectSteps" | "replacementIterations" | "pendingChoices" | "physicalRollAttempts";\n',
    "physical runtime metric",
  );
  source = replaceOnce(
    source,
    '  pendingChoices: MAX_PENDING_CHOICES,\n};\n',
    '  pendingChoices: MAX_PENDING_CHOICES,\n  physicalRollAttempts: MAX_PHYSICAL_ROLL_ATTEMPTS,\n};\n',
    "physical runtime limit",
  );
  source = replaceOnce(
    source,
    'export const consumePendingChoice = (amount = 1) => consume("pendingChoices", amount);\n',
    'export const consumePendingChoice = (amount = 1) => consume("pendingChoices", amount);\nexport const consumePhysicalRollAttempt = (amount = 1) => consume("physicalRollAttempts", amount);\n',
    "physical budget consumer",
  );
  source = replaceOnce(
    source,
    '  const budget: RuntimeBudget = { triggerChainDepth: 0, effectSteps: 0, replacementIterations: 0, pendingChoices: 0 };\n',
    '  const budget: RuntimeBudget = { triggerChainDepth: 0, effectSteps: 0, replacementIterations: 0, pendingChoices: 0, physicalRollAttempts: 0 };\n',
    "physical budget initialization",
  );
  await write(path, source);
}

{
  const path = "lib/engine/types.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    '  runtimeBudget?: { triggerChainDepth: number; effectSteps: number; replacementIterations: number; pendingChoices: number };\n',
    '  runtimeBudget?: { triggerChainDepth: number; effectSteps: number; replacementIterations: number; pendingChoices: number; physicalRollAttempts: number };\n',
    "engine metadata physical budget",
  );
  await write(path, source);
}

// Simplify browser-safe numeric normalization before type checking.
{
  const path = "lib/content/card-authoring.ts";
  let source = await read(path);
  source = replaceOnce(
    source,
    '    bPower: candidate.bPower == null || candidate.bPower === "" as never ? null : Number(candidate.bPower),\n    damage: candidate.damage == null || candidate.damage === "" as never ? null : Number(candidate.damage),\n',
    '    bPower: candidate.bPower == null || String(candidate.bPower).trim() === "" ? null : Number(candidate.bPower),\n    damage: candidate.damage == null || String(candidate.damage).trim() === "" ? null : Number(candidate.damage),\n',
    "authoring numeric normalization",
  );
  await write(path, source);
}

// Add the CLI and focused suites to the ordinary developer and CI commands.
{
  const path = "package.json";
  const packageJson = JSON.parse(await read(path));
  packageJson.scripts["card:author"] = "node --import tsx scripts/card-author.mts";
  packageJson.scripts["test:simulation"] = "node --import tsx --test tests/physical-simulation.test.ts";
  packageJson.scripts["test:authoring"] = "node --import tsx --test tests/card-authoring.test.ts";
  packageJson.scripts.test = packageJson.scripts.test.replace(
    "tests/content-pipeline.test.ts tests/quality-assurance.test.ts",
    "tests/content-pipeline.test.ts tests/card-authoring.test.ts tests/physical-simulation.test.ts tests/quality-assurance.test.ts",
  );
  packageJson.scripts["test:engine"] = packageJson.scripts["test:engine"].replace(
    "tests/engine-architecture.test.ts",
    "tests/engine-architecture.test.ts tests/physical-simulation.test.ts",
  );
  await write(path, `${JSON.stringify(packageJson, null, 2)}\n`);
}

// Correct the conformance matrix to the deliberate contested-core digital policy.
{
  const path = "content/conformance-matrix.json";
  const matrix = JSON.parse(await read(path));
  const index = matrix.findIndex((entry) => entry.id === "shared-core");
  if (index < 0) throw new Error("Missing shared-core conformance entry.");
  matrix[index] = {
    id: "contested-core-collision",
    area: "rolling",
    requirement: "A contested primary pickup is awarded by normalized accuracy and the other Bakugan opens without a Core.",
    test: "tests/physical-simulation.test.ts",
    status: "covered",
  };
  await write(path, `${JSON.stringify(matrix, null, 2)}\n`);
}

// Make the browser workbench discoverable without adding it to the ordinary player navigation.
{
  const path = "app/page.tsx";
  let source = await read(path);
  source = replaceOnce(
    source,
    '<Link href="/compendium">Rules</Link><a href="#accessibility">Accessibility</a><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online" target="_blank" rel="noreferrer">Project repository</a>',
    '<Link href="/compendium">Rules</Link><Link href="/tools/card-editor">Card editor</Link><a href="#accessibility">Accessibility</a><a href="https://github.com/UnCoverOne/Bakugan-Battle-Planet-Online" target="_blank" rel="noreferrer">Project repository</a>',
    "card editor footer link",
  );
  await write(path, source);
}

console.log("Integrated the physical simulation module and card-authoring workbench.");
