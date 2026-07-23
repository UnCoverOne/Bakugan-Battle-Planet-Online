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
  if (first < 0) throw new Error(`Expected block was not found in ${path}:\n${before.slice(0, 180)}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected block was not unique in ${path}:\n${before.slice(0, 180)}`);
  }
  write(path, source.slice(0, first) + after + source.slice(first + before.length));
}

function replaceCount(path, before, after, expectedCount) {
  const source = read(path);
  const matches = source.split(before).length - 1;
  if (matches !== expectedCount) {
    throw new Error(`Expected ${expectedCount} matches in ${path}, found ${matches}: ${before}`);
  }
  write(path, source.split(before).join(after));
}

function appendOnce(path, marker, addition) {
  const source = read(path);
  if (source.includes(marker)) throw new Error(`Marker already exists in ${path}: ${marker}`);
  write(path, `${source.trimEnd()}\n\n${addition.trim()}\n`);
}

write("components/game-screen-v2/matrixPerspectiveState.ts", `import type { MatchState } from "../../lib/game";

export type MatrixPoint = { x: number; y: number };

/**
 * The second player sits across the Hide Matrix, so their local rendering is a
 * half-turn of the canonical server coordinates. Cell IDs remain canonical.
 */
export function playerUsesOppositeMatrixPerspective(
  match: Pick<MatchState, "players"> | null | undefined,
  playerId?: string,
) {
  if (!match?.players.length || !playerId) return false;
  return match.players.findIndex((player) => player.id === playerId) > 0;
}

export function orientMatrixPoint(
  point: MatrixPoint,
  oppositePerspective: boolean,
  width: number,
  height: number,
): MatrixPoint {
  return oppositePerspective
    ? { x: width - point.x, y: height - point.y }
    : point;
}

export function orientMatrixPath(
  points: readonly MatrixPoint[],
  oppositePerspective: boolean,
  width: number,
  height: number,
) {
  return oppositePerspective
    ? points.map((point) => orientMatrixPoint(point, true, width, height))
    : points;
}
`);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `import { readMatchStore } from "./matchStore";\n`,
  `import { readMatchStore } from "./matchStore";\nimport {\n  orientMatrixPath,\n  orientMatrixPoint,\n  playerUsesOppositeMatrixPerspective,\n} from "./matrixPerspectiveState";\n`,
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `function cellPosition(cellId: string) {\n  const cell = HEX_CELLS.find((candidate) => candidate.id === cellId);\n  if (!cell) return null;\n  return {\n    x: GRID_CENTER_X + cell.q * HEX_X_STEP,\n    y: GRID_CENTER_Y + (cell.r + cell.q / 2) * HEX_HEIGHT,\n  };\n}\n`,
  `function cellPosition(cellId: string, oppositePerspective = false) {\n  const cell = HEX_CELLS.find((candidate) => candidate.id === cellId);\n  if (!cell) return null;\n  return orientMatrixPoint({\n    x: GRID_CENTER_X + cell.q * HEX_X_STEP,\n    y: GRID_CENTER_Y + (cell.r + cell.q / 2) * HEX_HEIGHT,\n  }, oppositePerspective, GRID_WIDTH, GRID_HEIGHT);\n}\n`,
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `function RollTraceLayer({\n  match,\n  localPlayerId,\n  signature,\n}: {\n  match: MatchState;\n  localPlayerId: string;\n  signature: string;\n}) {`,
  `function RollTraceLayer({\n  match,\n  localPlayerId,\n  signature,\n  oppositePerspective,\n}: {\n  match: MatchState;\n  localPlayerId: string;\n  signature: string;\n  oppositePerspective: boolean;\n}) {`,
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `        const target = cellPosition(roll.target);\n        const endpoint = roll.path.at(-1)!;\n        const local = player.id === localPlayerId;`,
  `        const target = cellPosition(roll.target, oppositePerspective);\n        const path = orientMatrixPath(roll.path, oppositePerspective, GRID_WIDTH, GRID_HEIGHT);\n        const endpoint = path.at(-1)!;\n        const local = player.id === localPlayerId;`,
);
replaceCount(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `rollTracePath(roll.path)`,
  `rollTracePath(path)`,
  2,
);

replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `function CoreTransferSprite({\n  match,\n  playerId,\n  playArea,\n  cell,\n}: {\n  match: MatchState;\n  playerId?: string;\n  playArea: HTMLElement;\n  cell: string;\n}) {`,
  `function CoreTransferSprite({\n  match,\n  playerId,\n  playArea,\n  cell,\n  oppositePerspective,\n}: {\n  match: MatchState;\n  playerId?: string;\n  playArea: HTMLElement;\n  cell: string;\n  oppositePerspective: boolean;\n}) {`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `        const source = cellPosition(cell);`,
  `        const source = cellPosition(cell, oppositePerspective);`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `  }, [cell, destination?.owner, destination?.slot, placement, playArea]);`,
  `  }, [cell, destination?.owner, destination?.slot, oppositePerspective, placement, playArea]);`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `  const actorId = playerId ?? localPlayer?.id;\n  const selectable = playerCanSelectRollTarget(match, actorId);`,
  `  const actorId = playerId ?? localPlayer?.id;\n  const oppositePerspective = playerUsesOppositeMatrixPerspective(match, actorId);\n  const selectable = playerCanSelectRollTarget(match, actorId);`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `            aria-label="BakuCores in the Hide Matrix"\n          >`,
  `            aria-label="BakuCores in the Hide Matrix"\n            data-perspective={oppositePerspective ? "opposite" : "local"}\n          >`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `              const position = cellPosition(placement.cell);`,
  `              const position = cellPosition(placement.cell, oppositePerspective);`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `              signature={resultSignature}\n            />`,
  `              signature={resultSignature}\n              oppositePerspective={oppositePerspective}\n            />`,
);
replaceOnce(
  "components/game-screen-v2/BakuCoreLayer.tsx",
  `                  playArea={targets.playArea!}\n                  cell={cell}\n                  key=`,
  `                  playArea={targets.playArea!}\n                  cell={cell}\n                  oppositePerspective={oppositePerspective}\n                  key=`,
);

replaceOnce(
  "components/game-screen-v2/CorePlacementLayer.tsx",
  `import { readMatchStore } from "./matchStore";\n`,
  `import { readMatchStore } from "./matchStore";\nimport { playerUsesOppositeMatrixPerspective } from "./matrixPerspectiveState";\n`,
);
replaceOnce(
  "components/game-screen-v2/CorePlacementLayer.tsx",
  `  const actorId = playerId ?? match?.players[0]?.id;\n  const player = match?.players.find((candidate) => candidate.id === actorId);`,
  `  const actorId = playerId ?? match?.players[0]?.id;\n  const oppositePerspective = playerUsesOppositeMatrixPerspective(match, actorId);\n  const player = match?.players.find((candidate) => candidate.id === actorId);`,
);
replaceOnce(
  "components/game-screen-v2/CorePlacementLayer.tsx",
  `      <div className={styles.matrix} aria-label="Face-down BakuCore matrix">`,
  `      <div className={styles.matrix} aria-label="Face-down BakuCore matrix" data-perspective={oppositePerspective ? "opposite" : "local"}>`,
);
replaceOnce(
  "components/game-screen-v2/CorePlacementLayer.tsx",
  `          const position = { "--q": cell.q, "--r": cell.r } as CSSProperties;`,
  `          const position = {\n            "--q": oppositePerspective ? -cell.q : cell.q,\n            "--r": oppositePerspective ? -cell.r : cell.r,\n          } as CSSProperties;`,
);

replaceOnce(
  "lib/game.ts",
  `/**\n * A Bakugan's magnet returns to the same downward phase after four BakuCores.\n * The target is assigned a one-based position in the ordered roll lane; the\n * earliest Core with the same position modulo four is the first one that opens\n * the Bakugan.\n */\nexport const rotationPhaseOpenCell = (\n  state: MatchState,\n  playerId: string,\n  targetCell: string,\n) => {\n  const playerIndex = state.players.findIndex((player) => player.id === playerId);\n  if (playerIndex < 0) return targetCell;\n  const lane = rollLane(state, playerIndex, targetCell)\n    .filter((candidate) => candidate.along <= 1.001);\n  const targetIndex = lane.findIndex((candidate) => candidate.placement.cell === targetCell);\n  if (targetIndex < 0) return targetCell;\n  return lane[targetIndex % 4]?.placement.cell ?? targetCell;\n};`,
  `/**\n * A Bakugan's magnet returns to the same downward phase after travelling four\n * BakuCore lengths. The intended target calibrates the downward phase, then an\n * earlier Core can intercept at four, eight, and subsequent Core lengths.\n *\n * Axial cell distance measures the physical slots in the Hide Matrix rather\n * than counting only occupied placements, so empty slots still advance the\n * Bakugan's rotation.\n */\nexport const rotationPhaseOpenCell = (\n  state: MatchState,\n  playerId: string,\n  targetCell: string,\n) => {\n  const playerIndex = state.players.findIndex((player) => player.id === playerId);\n  const target = cellAt(targetCell);\n  if (playerIndex < 0 || !target) return targetCell;\n  const intercept = rollLane(state, playerIndex, targetCell).find((candidate) => {\n    if (candidate.placement.cell === targetCell || candidate.along >= 0.999) return false;\n    const candidateCell = cellAt(candidate.placement.cell);\n    if (!candidateCell) return false;\n    const coreLengths = distance(candidateCell, target);\n    return coreLengths > 0 && coreLengths % 4 === 0;\n  });\n  return intercept?.placement.cell ?? targetCell;\n};`,
);

replaceOnce(
  "lib/rules/choices.ts",
  `function cardUsesBakuganTarget(card: GameCard) {\n  const text = card.effect;\n  return card.type === "Evo"\n    || /(?:choose(?:s)?|target|your|enemy|opposing|non-\\[[a-z]+\\]) (?:an? )?bakugan|retract a bakugan|on this|this bakugan/i.test(text);\n}`,
  `function cardUsesBakuganTarget(card: GameCard, includeIntrinsicCardTarget: boolean) {\n  const selectionText = card.effect\n    .replace(/\\b(?:all (?:of )?)?your Bakugan (?:have|get)\\b[^.]*\\.?/gi, "")\n    .replace(/\\b(?:all )?(?:enemy|opposing) Bakugan (?:have|get)\\b[^.]*\\.?/gi, "");\n  return (includeIntrinsicCardTarget && card.type === "Evo")\n    || /(?:choose(?:s)?|target|your|enemy|opposing|non-\\[[a-z]+\\]) (?:an? )?bakugan|retract a bakugan|on this|this bakugan/i.test(selectionText);\n}`,
);
replaceOnce(
  "lib/rules/choices.ts",
  `  if (cardUsesBakuganTarget(contextualCard)) {`,
  `  const includeIntrinsicCardTarget = sourceText === card.effect && !priorChoices.targetBakuganId;\n  if (cardUsesBakuganTarget(contextualCard, includeIntrinsicCardTarget)) {`,
);

replaceOnce(
  "lib/rules/effects.ts",
  `  const scope = /all enemy Bakugan/i.test(text) ? "all-enemy" as const\n    : /all (?:of )?your Bakugan/i.test(text) ? "all-friendly" as const\n      : "target" as const;`,
  `  const scope = /all enemy Bakugan|(?:enemy|opposing) Bakugan (?:have|get)/i.test(text)\n    ? "all-enemy" as const\n    : /all (?:of )?your Bakugan|your Bakugan (?:have|get)/i.test(text)\n      ? "all-friendly" as const\n      : "target" as const;`,
);

replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  `import { BakuCoreLayer } from "./BakuCoreLayer";\n`,
  `import { BakuCoreLayer } from "./BakuCoreLayer";\nimport { useBakuCorePresentation } from "./BakuCorePresentation";\n`,
);
replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  `  const automaticActionKey = useRef("");\n  const botActionKey = useRef("");\n`,
  `  const automaticActionKey = useRef("");\n  const botActionKey = useRef("");\n  const { rollPresentationPending } = useBakuCorePresentation();\n`,
);
replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  `      storedState.route !== "match"\n      || storedState.online\n      || !match\n    ) return;`,
  `      storedState.route !== "match"\n      || storedState.online\n      || !match\n      || rollPresentationPending\n    ) return;`,
);
replaceOnce(
  "components/game-screen-v2/GameplayClient.tsx",
  `    storedState.match?.version,\n    publishMatch,\n  ]);`,
  `    storedState.match?.version,\n    rollPresentationPending,\n    publishMatch,\n  ]);`,
);

replaceOnce(
  "tests/rolling-mechanic.test.ts",
  `import {\n  HEX_CELLS,\n  createMatch,\n  resolveRollOutcome,\n  rotationPhaseOpenCell,\n  type MatchState,\n} from "../lib/game";\n`,
  `import {\n  HEX_CELLS,\n  createMatch,\n  resolveRollOutcome,\n  rotationPhaseOpenCell,\n  type MatchState,\n} from "../lib/game";\nimport {\n  orientMatrixPoint,\n  playerUsesOppositeMatrixPerspective,\n} from "../components/game-screen-v2/matrixPerspectiveState";\n`,
);
replaceOnce(
  "tests/rolling-mechanic.test.ts",
  `const rollStyles = readFileSync(new URL("../components/game-screen-v2/BakuCoreLayer.module.css", import.meta.url), "utf8");\n`,
  `const rollStyles = readFileSync(new URL("../components/game-screen-v2/BakuCoreLayer.module.css", import.meta.url), "utf8");\nconst placementLayer = readFileSync(new URL("../components/game-screen-v2/CorePlacementLayer.tsx", import.meta.url), "utf8");\n`,
);
appendOnce(
  "tests/rolling-mechanic.test.ts",
  `empty Hide Matrix slots still advance the four-Core rotation phase`,
  `test("empty Hide Matrix slots still advance the four-Core rotation phase", () => {\n  const first = cell(0, 4);\n  const target = cell(0, 0);\n  const gapped = rollMatch([first, target], target);\n  assert.equal(rotationPhaseOpenCell(gapped, "player-a", target), first);\n  assert.deepEqual(resolve(gapped, 1, 1).cores, [first]);\n\n  const threeLengthsAway = cell(0, 3);\n  const shortGap = rollMatch([threeLengthsAway, target], target);\n  assert.equal(rotationPhaseOpenCell(shortGap, "player-a", target), target);\n});\n\ntest("four-Core physical spacing is symmetric from the opposite player's edge", () => {\n  const first = cell(0, -4);\n  const target = cell(0, 0);\n  const match = rollMatch([first, target], target);\n  assert.equal(rotationPhaseOpenCell(match, "player-b", target), first);\n});\n\ntest("each local player sees and interacts with the Hide Matrix from their own side", () => {\n  const match = rollMatch([cell(0, 0)]);\n  assert.equal(playerUsesOppositeMatrixPerspective(match, "player-a"), false);\n  assert.equal(playerUsesOppositeMatrixPerspective(match, "player-b"), true);\n  assert.deepEqual(orientMatrixPoint({ x: 240, y: 180 }, false, 1800, 1000), { x: 240, y: 180 });\n  assert.deepEqual(orientMatrixPoint({ x: 240, y: 180 }, true, 1800, 1000), { x: 1560, y: 820 });\n  assert.match(rollLayer, /playerUsesOppositeMatrixPerspective/);\n  assert.match(rollLayer, /orientMatrixPath/);\n  assert.match(placementLayer, /oppositePerspective \? -cell\\.q : cell\\.q/);\n});`,
);

replaceOnce(
  "tests/evo-and-draw-queue.test.ts",
  `import { drawTurnCard, playerCanDrawTurnCard } from "../lib/turnStart";\n`,
  `import { drawTurnCard, playerCanDrawTurnCard } from "../lib/turnStart";\nimport { buildChoiceSchema } from "../lib/rules/choices";\nimport { compileCardEffect } from "../lib/rules/effects";\n`,
);
appendOnce(
  "tests/evo-and-draw-queue.test.ts",
  `Everett Ray and Aquos Hyper Fangzor do not create false resolution choices`,
  `test("Everett Ray and Aquos Hyper Fangzor do not create false resolution choices", () => {\n  const { player, opponent } = players();\n  const match = createMatch("NOFAKE", "bo1", [player, opponent]);\n  const everett = CARDS.find((card) => card.name === "Everett Ray" && card.type === "Hero");\n  assert.ok(everett);\n  const everettSchema = buildChoiceSchema(match, player.id, everett);\n  assert.deepEqual(everettSchema.fields, []);\n\n  const powerAction = compileCardEffect(everett).instructions\n    .flatMap((instruction) => instruction.actions)\n    .find((action) => action.kind === "modify-stat" && action.stat === "power");\n  if (powerAction?.kind !== "modify-stat") throw new Error("Everett Ray must compile a B-Power modifier.");\n  assert.equal(powerAction.scope, "all-friendly");\n\n  const fangzor = CARDS.find((card) => (\n    card.type === "Evo"\n    && card.faction === "Aquos"\n    && /Hyper Fangzor/i.test(card.displayName || card.name)\n    && /when you play this,? draw three cards/i.test(card.effect)\n  ));\n  assert.ok(fangzor);\n  const triggerInstruction = compileCardEffect(fangzor).instructions.find((instruction) => (\n    instruction.actions.some((action) => action.kind === "trigger")\n  ));\n  assert.ok(triggerInstruction);\n  const triggerSchema = buildChoiceSchema(\n    match,\n    player.id,\n    fangzor,\n    triggerInstruction.sourceText,\n    { targetBakuganId: player.bakugan[0].id },\n  );\n  assert.deepEqual(triggerSchema.fields, []);\n});`,
);

replaceOnce(
  "tests/opponent-ai.test.ts",
  `import assert from "node:assert/strict";\n`,
  `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\n`,
);
replaceOnce(
  "tests/opponent-ai.test.ts",
  `import { advanceOpponentAi, chooseCardChoices } from "../lib/opponentAi";\n`,
  `import { advanceOpponentAi, chooseCardChoices } from "../lib/opponentAi";\n\nconst gameplayClient = readFileSync(\n  new URL("../components/game-screen-v2/GameplayClient.tsx", import.meta.url),\n  "utf8",\n);\n`,
);
appendOnce(
  "tests/opponent-ai.test.ts",
  `training AI waits until the roll presentation is completely clear`,
  `test("training AI waits until the roll presentation is completely clear", () => {\n  assert.match(gameplayClient, /const \\{ rollPresentationPending \\} = useBakuCorePresentation\\(\\)/);\n  assert.match(gameplayClient, /storedState\\.online[\\s\\S]{0,120}\\|\\| rollPresentationPending/);\n  assert.match(gameplayClient, /storedState\\.match\\?\\.version,[\\s\\S]{0,120}rollPresentationPending/);\n});`,
);

console.log("Applied opposite-perspective, physical-distance, choice, and AI-presentation fixes.");
