from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str):
    file = Path(path)
    text = file.read_text()
    if marker in text:
        raise SystemExit(f"{path}: marker already exists: {marker}")
    file.write_text(text + content)


# Typed rule semantics: coin flips are first-class actions and their result can
# gate later printed clauses such as "If heads" and "If tails".
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "reroll-opened" }\n  | { kind: "printed"; text: string };',
    '  | { kind: "reroll-opened" }\n  | { kind: "coin-result"; result: "heads" | "tails" }\n  | { kind: "printed"; text: string };',
)
replace_once(
    "lib/rules/model.ts",
    '  | { kind: "reroll"; target: "controller" | "opponent"; mandatory: boolean; requiresDiscard: boolean }\n  | { kind: "trigger"; event: TriggerEventName; definition: TriggerDefinition }',
    '  | { kind: "reroll"; target: "controller" | "opponent"; mandatory: boolean; requiresDiscard: boolean }\n  | { kind: "coin-flip" }\n  | { kind: "trigger"; event: TriggerEventName; definition: TriggerDefinition }',
)

replace_once(
    "lib/rules/catalogue-primitives.ts",
    'export function conditionFor(text: string): RuleCondition {\n  if (/if you open on the Reroll/i.test(text)) return { kind: "reroll-opened" };',
    'export function conditionFor(text: string): RuleCondition {\n  if (/\\bif heads\\b/i.test(text)) return { kind: "coin-result", result: "heads" };\n  if (/\\bif tails\\b/i.test(text)) return { kind: "coin-result", result: "tails" };\n  if (/if you open on the Reroll/i.test(text)) return { kind: "reroll-opened" };',
)
replace_once(
    "lib/rules/catalogue-primitives.ts",
    '  if (/\\+?\\[ShadowStrike\\]|\\bShadowStrike\\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });\n  if (/\\[Stop\\]/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });',
    '  if (/\\+?\\[ShadowStrike\\]|\\bShadowStrike\\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "ShadowStrike", duration });\n  if (/\\bflip a coin\\b/i.test(text)) actions.push({ kind: "coin-flip" });\n  if (/\\[Stop\\]|\\bstop the attack\\b/i.test(text)) actions.push({ kind: "grant-keyword", keyword: "Stop", duration });',
)

replace_once(
    "lib/rules/modifiers.ts",
    '    case "reroll-opened": return false;\n    case "printed": return false;',
    '    case "reroll-opened": return false;\n    // Coin results are resolution-local and are evaluated by the game kernel.\n    case "coin-result": return false;\n    case "printed": return false;',
)

# Match-state serialization and resumable resolution support.
replace_once(
    "lib/game.ts",
    'export type PendingReroll = {\n  id: string;\n  playerId: string;\n  bakuganId: string;\n  sourceEffectId?: string;\n  sourceName: string;\n  mandatory: boolean;\n  targetCell?: string;\n  resumePriority: string;\n  resumeDeadline: number;\n  resumeStepLabel: string;\n};\n\nexport type PendingEffectDamageResume = {',
    '''export type PendingReroll = {\n  id: string;\n  playerId: string;\n  bakuganId: string;\n  sourceEffectId?: string;\n  sourceName: string;\n  mandatory: boolean;\n  targetCell?: string;\n  resumePriority: string;\n  resumeDeadline: number;\n  resumeStepLabel: string;\n};\n\nexport type CoinFlipResult = "heads" | "tails";\n\nexport type PendingCoinFlip = {\n  id: string;\n  controllerId: string;\n  sourceEffectId: string;\n  sourceName: string;\n  result: CoinFlipResult;\n  createdAt: number;\n  resolveAt: number;\n  resumePriority: string;\n  resumeDeadline: number;\n  resumeStepLabel: string;\n};\n\nexport type PendingEffectDamageResume = {''',
)
replace_once(
    "lib/game.ts",
    '  rolls: Record<string, RollOutcome>;\n  pendingReroll?: PendingReroll;\n  pendingEffectDamageResume?: PendingEffectDamageResume;',
    '  rolls: Record<string, RollOutcome>;\n  pendingReroll?: PendingReroll;\n  pendingCoinFlip?: PendingCoinFlip;\n  coinFlipResults: Record<string, CoinFlipResult>;\n  pendingEffectDamageResume?: PendingEffectDamageResume;',
)
replace_once(
    "lib/game.ts",
    '  state.rolls = state.rolls && typeof state.rolls === "object" ? state.rolls : {};\n  state.rerollOpenedByEffect = state.rerollOpenedByEffect && typeof state.rerollOpenedByEffect === "object" ? state.rerollOpenedByEffect : {};',
    '  state.rolls = state.rolls && typeof state.rolls === "object" ? state.rolls : {};\n  state.coinFlipResults = state.coinFlipResults && typeof state.coinFlipResults === "object" ? state.coinFlipResults : {};\n  if (state.pendingCoinFlip && typeof state.pendingCoinFlip !== "object") state.pendingCoinFlip = undefined;\n  state.rerollOpenedByEffect = state.rerollOpenedByEffect && typeof state.rerollOpenedByEffect === "object" ? state.rerollOpenedByEffect : {};',
)
replace_once(
    "lib/game.ts",
    '    priority: startingPlayer, placementTurn: 0, placements: [], selected: {}, targets: {}, rolls: {},\n    rerollOpenedByEffect: {}, rerollTargetByEffect: {}, rerollUsage: {}, rerollSequence: 0, repeatRollAfterReroll: false, nextCardCostReduction: {}, temporaryVictorDiscards: {},',
    '    priority: startingPlayer, placementTurn: 0, placements: [], selected: {}, targets: {}, rolls: {},\n    coinFlipResults: {}, rerollOpenedByEffect: {}, rerollTargetByEffect: {}, rerollUsage: {}, rerollSequence: 0, repeatRollAfterReroll: false, nextCardCostReduction: {}, temporaryVictorDiscards: {},',
)
replace_once(
    "lib/game.ts",
    '  state.selected = {}; state.targets = {}; state.rolls = {}; state.pendingReroll = undefined; state.pendingEffectDamageResume = undefined; state.pendingRerollOpenEvent = undefined; state.rerollOpenedByEffect = {}; state.rerollTargetByEffect = {}; state.rerollUsage = {}; state.rerollSequence = 0; state.repeatRollAfterReroll = false; state.nextCardCostReduction = {}; state.temporaryVictorDiscards = {}; state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {};',
    '  state.selected = {}; state.targets = {}; state.rolls = {}; state.pendingReroll = undefined; state.pendingCoinFlip = undefined; state.coinFlipResults = {}; state.pendingEffectDamageResume = undefined; state.pendingRerollOpenEvent = undefined; state.rerollOpenedByEffect = {}; state.rerollTargetByEffect = {}; state.rerollUsage = {}; state.rerollSequence = 0; state.repeatRollAfterReroll = false; state.nextCardCostReduction = {}; state.temporaryVictorDiscards = {}; state.powerBoost = {}; state.damageBoost = {}; state.frostStrike = {};',
)
replace_once(
    "lib/game.ts",
    '''class DamageResolutionSuspended extends Error {\n  constructor() {\n    super("Card resolution suspended for a separate attack.");\n    this.name = "DamageResolutionSuspended";\n  }\n}\n''',
    '''class DamageResolutionSuspended extends Error {\n  constructor() {\n    super("Card resolution suspended for a separate attack.");\n    this.name = "DamageResolutionSuspended";\n  }\n}\n\nclass CoinFlipResolutionSuspended extends Error {\n  constructor() {\n    super("Card resolution suspended for a coin flip presentation.");\n    this.name = "CoinFlipResolutionSuspended";\n  }\n}\n''',
)
replace_once(
    "lib/game.ts",
    '  if (instruction.condition.kind === "reroll-opened") return Boolean(state.rerollOpenedByEffect[pending.id]);\n  if (instruction.condition.kind === "printed") return conditionActive(state, player, instruction.condition.text, choices);',
    '  if (instruction.condition.kind === "reroll-opened") return Boolean(state.rerollOpenedByEffect[pending.id]);\n  if (instruction.condition.kind === "coin-result") return state.coinFlipResults[pending.id] === instruction.condition.result;\n  if (instruction.condition.kind === "printed") return conditionActive(state, player, instruction.condition.text, choices);',
)
replace_once(
    "lib/game.ts",
    '''    case "reroll": {\n      if (!action.mandatory && choices.confirmed === false) return;''',
    '''    case "coin-flip": {\n      const now = Date.now();\n      const result: CoinFlipResult = secureRandomInt(2) === 0 ? "heads" : "tails";\n      state.coinFlipResults[pending.id] = result;\n      pending.instructionIndex = instructionIndex + 1;\n      if (isRuleObject(pending)) pending.cursor.instructionIndex = instructionIndex + 1;\n      state.pendingCoinFlip = {\n        id: uid(),\n        controllerId,\n        sourceEffectId: pending.id,\n        sourceName: card.displayName || card.name,\n        result,\n        createdAt: now,\n        resolveAt: now + 2_200,\n        resumePriority: state.priority,\n        resumeDeadline: state.deadline,\n        resumeStepLabel: state.stepLabel,\n      };\n      state.priority = controllerId;\n      state.stepLabel = `${card.displayName || card.name} • Coin flip`;\n      state.deadline = now + 35_000;\n      state.informationEpoch += 1;\n      state.undoWindow = undefined;\n      entry(state, "random", `${player.name}: ${card.displayName || card.name} coin flip → ${result}.`, card, "effect", controllerId);\n      throw new CoinFlipResolutionSuspended();\n    }\n    case "reroll": {\n      if (!action.mandatory && choices.confirmed === false) return;''',
)
replace_once(
    "lib/game.ts",
    '  if (/\\[Stop\\] an attack/i.test(text)) return true;',
    '  if (/\\bstop the attack\\b/i.test(text)) return true;\n  if (/\\[Stop\\] an attack/i.test(text)) return true;',
)
replace_once(
    "lib/game.ts",
    '    if (error instanceof RerollResolutionSuspended || error instanceof DamageResolutionSuspended) return false;',
    '    if (error instanceof RerollResolutionSuspended || error instanceof DamageResolutionSuspended || error instanceof CoinFlipResolutionSuspended) return false;',
)
replace_once(
    "lib/game.ts",
    '  state.batch = state.batch.filter((candidate) => candidate.id !== pending.id);\n  if (!pending.alternateWin) stageDragonoidMaximusWinEffect(state);',
    '  state.batch = state.batch.filter((candidate) => candidate.id !== pending.id);\n  delete state.coinFlipResults[pending.id];\n  if (!pending.alternateWin) stageDragonoidMaximusWinEffect(state);',
)
replace_once(
    "lib/game.ts",
    'export function resumePendingEffectAfterDamage(state: MatchState) {',
    '''export function completeCoinFlip(input: MatchState, playerId: string) {\n  const state = cloneMatch(input);\n  const pending = state.pendingCoinFlip;\n  if (!pending) throw new Error("There is no coin flip waiting to finish.");\n  if (pending.controllerId !== playerId) throw new Error("Only the resolving card's controller can finish this coin flip.");\n  const effect = state.batch.find((candidate) => candidate.id === pending.sourceEffectId);\n  state.pendingCoinFlip = undefined;\n  state.priority = pending.resumePriority;\n  state.deadline = Math.max(pending.resumeDeadline, deadlineFor(state.phase));\n  state.stepLabel = pending.resumeStepLabel;\n  state.passes = [];\n  if (!effect) {\n    delete state.coinFlipResults[pending.sourceEffectId];\n    return withVersion(state);\n  }\n  const completed = resolvePendingEffect(state, effect);\n  if (completed && !hasQueuedEffectDraw(state)) {\n    state.priority = state.startingPlayer;\n    state.deadline = deadlineFor(state.phase);\n  }\n  return withVersion(state);\n}\n\nexport function resumePendingEffectAfterDamage(state: MatchState) {''',
)
replace_once(
    "lib/game.ts",
    '  if (hasQueuedEffectDraw(state)) throw new Error("Complete every pending Draw action before passing priority.");\n  if (state.pendingChoice) throw new Error("Complete the pending player choice before passing priority.");',
    '  if (hasQueuedEffectDraw(state)) throw new Error("Complete every pending Draw action before passing priority.");\n  if (state.pendingCoinFlip) throw new Error("Wait for the pending coin flip to finish before passing priority.");\n  if (state.pendingChoice) throw new Error("Complete the pending player choice before passing priority.");',
)

# Command surface, timeout recovery, and rules dispatch.
replace_once(
    "lib/engine/types.ts",
    '  | { type: "PASS_PRIORITY" }\n  | { type: "REVEAL_DAMAGE_FLIP" }',
    '  | { type: "PASS_PRIORITY" }\n  | { type: "COMPLETE_COIN_FLIP" }\n  | { type: "REVEAL_DAMAGE_FLIP" }',
)
replace_once(
    "lib/engine/commands.ts",
    '  | "pass"\n  | "flip-damage"',
    '  | "pass"\n  | "complete-coin-flip"\n  | "flip-damage"',
)
replace_once(
    "lib/engine/commands.ts",
    '    case "pass": return { type: "PASS_PRIORITY" };\n    case "flip-damage": return { type: "REVEAL_DAMAGE_FLIP" };',
    '    case "pass": return { type: "PASS_PRIORITY" };\n    case "complete-coin-flip": return { type: "COMPLETE_COIN_FLIP" };\n    case "flip-damage": return { type: "REVEAL_DAMAGE_FLIP" };',
)
replace_once(
    "lib/rules/runtime.ts",
    '  cancelCardChoice,\n  orderTriggers,',
    '  cancelCardChoice,\n  completeCoinFlip,\n  orderTriggers,',
)
replace_once(
    "lib/rules/runtime.ts",
    '  | { type: "PASS_PRIORITY" }\n>;',
    '  | { type: "PASS_PRIORITY" }\n  | { type: "COMPLETE_COIN_FLIP" }\n>;',
)
replace_once(
    "lib/rules/runtime.ts",
    '    "PASS_PRIORITY",\n  ].includes(command.type);',
    '    "PASS_PRIORITY", "COMPLETE_COIN_FLIP",\n  ].includes(command.type);',
)
replace_once(
    "lib/rules/runtime.ts",
    'export function dispatchRulesCommand(input: MatchState, actorId: string, command: RulesCommand): MatchState {\n  normalizeRuleObjects(input);\n  let next: MatchState;',
    'export function dispatchRulesCommand(input: MatchState, actorId: string, command: RulesCommand): MatchState {\n  normalizeRuleObjects(input);\n  if (input.pendingCoinFlip && command.type !== "COMPLETE_COIN_FLIP") {\n    throw new Error("The coin flip animation must finish before another rules action can resolve.");\n  }\n  let next: MatchState;',
)
replace_once(
    "lib/rules/runtime.ts",
    '    case "PASS_PRIORITY": next = resumeDamageAfterFlipWindow(passPriorityWithTieBreak(input, actorId)); break;\n  }',
    '    case "PASS_PRIORITY": next = resumeDamageAfterFlipWindow(passPriorityWithTieBreak(input, actorId)); break;\n    case "COMPLETE_COIN_FLIP": next = resumeDamageAfterFlipWindow(completeCoinFlip(input, actorId)); break;\n  }',
)
replace_once(
    "lib/deadlines.ts",
    '  beginCorePlacement,\n  concedeMatch,',
    '  beginCorePlacement,\n  completeCoinFlip,\n  concedeMatch,',
)
replace_once(
    "lib/deadlines.ts",
    '  const state = structuredClone(input);\n  const tieBreak = manualTieBreakState(state);',
    '  const state = structuredClone(input);\n  if (state.pendingCoinFlip) return completeCoinFlip(state, state.pendingCoinFlip.controllerId);\n  const tieBreak = manualTieBreakState(state);',
)

# Training AI acknowledges its own presentation gate only after the animation's
# minimum landing time, while recovery remains deterministic.
replace_once(
    "lib/opponentAiCanAct.ts",
    '  beginCorePlacement,\n  discardToHandLimit,',
    '  beginCorePlacement,\n  completeCoinFlip,\n  discardToHandLimit,',
)
replace_once(
    "lib/opponentAiCanAct.ts",
    '  if (!player) return false;\n  if (playerCanResolvePendingDraw(match, playerId)) return true;',
    '  if (!player) return false;\n  if (match.pendingCoinFlip?.controllerId === playerId) return true;\n  if (playerCanResolvePendingDraw(match, playerId)) return true;',
)
replace_once(
    "lib/opponentAiCanAct.ts",
    '  if (!player || !opponentAiCanAct(match, playerId)) return null;\n  if (playerCanResolvePendingDraw(match, playerId)) return { type: "DRAW_PENDING_CARD" };',
    '  if (!player || !opponentAiCanAct(match, playerId)) return null;\n  if (match.pendingCoinFlip?.controllerId === playerId) return { type: "COMPLETE_COIN_FLIP" };\n  if (playerCanResolvePendingDraw(match, playerId)) return { type: "DRAW_PENDING_CARD" };',
)
replace_once(
    "lib/opponentAiCanAct.ts",
    '  try {\n    if (playerCanResolvePendingDraw(match, playerId)) {',
    '  try {\n    if (match.pendingCoinFlip?.controllerId === playerId) {\n      return completeCoinFlip(match, playerId);\n    }\n    if (playerCanResolvePendingDraw(match, playerId)) {',
)
replace_once(
    "lib/opponentAi.ts",
    '  cloneMatch,\n  legalPlacementCells,',
    '  cloneMatch,\n  completeCoinFlip,\n  legalPlacementCells,',
)
replace_once(
    "lib/opponentAi.ts",
    'function advanceOpponentAiStep(input: MatchState, playerId: string): MatchState | null {\n  if (playerCanResolvePendingDraw(input, playerId)) {',
    'function advanceOpponentAiStep(input: MatchState, playerId: string): MatchState | null {\n  if (input.pendingCoinFlip?.controllerId === playerId) return completeCoinFlip(input, playerId);\n  if (playerCanResolvePendingDraw(input, playerId)) {',
)
replace_once(
    "lib/opponentAi.ts",
    '/** Pure one-step decision for the Training worker; the main reducer applies it. */\nexport function chooseOpponentAiCommand(input: MatchState, playerId: string): GameCommand | null {\n  if (playerCanResolvePendingDraw(input, playerId)) {',
    '/** Pure one-step decision for the Training worker; the main reducer applies it. */\nexport function chooseOpponentAiCommand(input: MatchState, playerId: string): GameCommand | null {\n  if (input.pendingCoinFlip?.controllerId === playerId) return { type: "COMPLETE_COIN_FLIP" };\n  if (playerCanResolvePendingDraw(input, playerId)) {',
)

# Dedicated coin animation layer. The result is authoritative in MatchState;
# presentation never generates randomness locally.
Path("components/game-screen-v2/CoinFlipLayer.tsx").write_text(r'''"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchState } from "../../lib/game";
import styles from "./CoinFlipLayer.module.css";

type CoinFlipAction = () => void | Promise<void>;

type CoinFlipLayerProps = {
  match: MatchState | null;
  playerId?: string;
  onCompleteCoinFlip: CoinFlipAction;
};

export function CoinFlipLayer({ match, playerId, onCompleteCoinFlip }: CoinFlipLayerProps) {
  const pending = match?.pendingCoinFlip;
  const localPlayerId = playerId ?? match?.players[0]?.id;
  const [revealedId, setRevealedId] = useState("");
  const completingId = useRef("");
  const completeRef = useRef(onCompleteCoinFlip);

  useEffect(() => {
    completeRef.current = onCompleteCoinFlip;
  }, [onCompleteCoinFlip]);

  useEffect(() => {
    if (!pending) {
      setRevealedId("");
      completingId.current = "";
      return;
    }
    setRevealedId("");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const revealTimer = window.setTimeout(
      () => setRevealedId(pending.id),
      reducedMotion ? 160 : 1_450,
    );
    const completeTimer = pending.controllerId === localPlayerId
      ? window.setTimeout(() => {
        if (completingId.current === pending.id) return;
        completingId.current = pending.id;
        void Promise.resolve(completeRef.current()).catch(() => {
          if (completingId.current === pending.id) completingId.current = "";
        });
      }, reducedMotion ? 650 : 2_200)
      : undefined;
    return () => {
      window.clearTimeout(revealTimer);
      if (completeTimer != null) window.clearTimeout(completeTimer);
    };
  }, [pending?.id, pending?.controllerId, localPlayerId]);

  if (!pending) return null;
  const revealed = revealedId === pending.id;
  const resultLabel = pending.result === "heads" ? "HEADS" : "TAILS";

  return (
    <div className={styles.backdrop} data-coin-flip-id={pending.id}>
      <section
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${pending.sourceName} coin flip`}
      >
        <p className={styles.eyebrow}>COIN FLIP</p>
        <h2 className={styles.title}>{pending.sourceName}</h2>
        <div className={styles.stage} aria-hidden="true">
          <div className={`${styles.coin} ${pending.result === "heads" ? styles.landHeads : styles.landTails}`}>
            <div className={`${styles.face} ${styles.front}`}>
              <span className={styles.rim}>H</span>
              <strong>HEADS</strong>
            </div>
            <div className={`${styles.face} ${styles.back}`}>
              <span className={styles.rim}>T</span>
              <strong>TAILS</strong>
            </div>
          </div>
          <div className={styles.shadow} />
        </div>
        <div className={styles.result} aria-live="assertive" aria-atomic="true">
          <span>{revealed ? "RESULT" : "FLIPPING…"}</span>
          <strong className={revealed ? styles.resultVisible : styles.resultHidden}>
            {resultLabel}
          </strong>
        </div>
      </section>
    </div>
  );
}
''')

Path("components/game-screen-v2/CoinFlipLayer.module.css").write_text(r'''.backdrop {
  position: fixed;
  inset: 0;
  z-index: 260;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgb(1 6 18 / 72%);
  backdrop-filter: blur(7px);
  pointer-events: all;
}

.panel {
  width: min(430px, 100%);
  padding: 28px 28px 24px;
  border: 1px solid rgb(119 183 255 / 42%);
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 15%, rgb(37 99 235 / 18%), transparent 44%),
    rgb(7 18 38 / 96%);
  box-shadow: 0 24px 80px rgb(0 0 0 / 55%);
  color: #f8fbff;
  text-align: center;
}

.eyebrow {
  margin: 0 0 4px;
  color: #93c5fd;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.22em;
}

.title {
  margin: 0;
  font-size: clamp(1.3rem, 4vw, 1.75rem);
  font-weight: 800;
}

.stage {
  position: relative;
  display: grid;
  place-items: center;
  height: 220px;
  margin: 12px 0 2px;
  perspective: 900px;
}

.coin {
  position: relative;
  z-index: 2;
  width: 142px;
  height: 142px;
  transform-style: preserve-3d;
  will-change: transform;
}

.face {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  border: 8px double rgb(224 242 254 / 70%);
  border-radius: 50%;
  background:
    radial-gradient(circle at 32% 26%, rgb(255 255 255 / 52%), transparent 18%),
    radial-gradient(circle at 50% 55%, #38bdf8 0%, #1d4ed8 62%, #10275d 100%);
  box-shadow:
    inset 0 0 0 4px rgb(3 19 48 / 38%),
    inset 0 0 26px rgb(0 0 0 / 28%),
    0 0 22px rgb(56 189 248 / 22%);
  backface-visibility: hidden;
}

.face strong {
  font-size: 0.88rem;
  letter-spacing: 0.1em;
}

.rim {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border: 2px solid rgb(255 255 255 / 70%);
  border-radius: 50%;
  font-size: 2rem;
  font-weight: 900;
}

.back {
  transform: rotateY(180deg);
}

.landHeads {
  animation: flipHeads 1.75s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
}

.landTails {
  animation: flipTails 1.75s cubic-bezier(0.2, 0.75, 0.2, 1) forwards;
}

.shadow {
  position: absolute;
  bottom: 29px;
  width: 118px;
  height: 20px;
  border-radius: 50%;
  background: rgb(0 0 0 / 45%);
  filter: blur(7px);
  animation: coinShadow 1.75s ease-in-out forwards;
}

.result {
  display: grid;
  min-height: 58px;
  place-items: center;
  gap: 3px;
}

.result > span {
  color: #93c5fd;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.2em;
}

.result > strong {
  font-size: 1.55rem;
  letter-spacing: 0.12em;
  transition: opacity 160ms ease, transform 160ms ease;
}

.resultHidden {
  opacity: 0;
  transform: translateY(5px);
}

.resultVisible {
  opacity: 1;
  transform: translateY(0);
}

@keyframes flipHeads {
  0% { transform: translateY(18px) rotateY(0deg) rotateZ(-3deg); }
  42% { transform: translateY(-66px) rotateY(900deg) rotateZ(5deg); }
  76% { transform: translateY(-14px) rotateY(1530deg) rotateZ(-2deg); }
  100% { transform: translateY(0) rotateY(1800deg) rotateZ(0deg); }
}

@keyframes flipTails {
  0% { transform: translateY(18px) rotateY(0deg) rotateZ(3deg); }
  42% { transform: translateY(-66px) rotateY(900deg) rotateZ(-5deg); }
  76% { transform: translateY(-14px) rotateY(1530deg) rotateZ(2deg); }
  100% { transform: translateY(0) rotateY(1980deg) rotateZ(0deg); }
}

@keyframes coinShadow {
  0%, 100% { opacity: 0.52; transform: scaleX(1); }
  42% { opacity: 0.2; transform: scaleX(0.56); }
  76% { opacity: 0.36; transform: scaleX(0.78); }
}

@media (prefers-reduced-motion: reduce) {
  .landHeads { animation: settleHeads 280ms ease-out forwards; }
  .landTails { animation: settleTails 280ms ease-out forwards; }
  .shadow { animation: none; }
}

@keyframes settleHeads {
  from { transform: scale(0.9) rotateY(180deg); opacity: 0.4; }
  to { transform: scale(1) rotateY(0deg); opacity: 1; }
}

@keyframes settleTails {
  from { transform: scale(0.9) rotateY(0deg); opacity: 0.4; }
  to { transform: scale(1) rotateY(180deg); opacity: 1; }
}
''')

replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    'import { CardPreviewLayer } from "./CardPreviewLayer";\nimport { CorePlacementLayer } from "./CorePlacementLayer";',
    'import { CardPreviewLayer } from "./CardPreviewLayer";\nimport { CoinFlipLayer } from "./CoinFlipLayer";\nimport { CorePlacementLayer } from "./CorePlacementLayer";',
)
replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '  const passTurn = () => submitMatchAction(\n    "pass",\n    {},\n  );',
    '  const passTurn = () => submitMatchAction(\n    "pass",\n    {},\n  );\n\n  const completeCoinFlip = () => submitMatchAction(\n    "complete-coin-flip",\n    {},\n  );',
)
replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '    const key = `${match.id}:${match.version}:${match.phase}:${match.pendingChoice?.id ?? ""}`;\n    if (botActionKey.current === key) return;\n    botActionKey.current = key;\n    const drawDelay = waitingForDrawWindow\n      ? Math.max(0, (match.drawReadyAt ?? 0) - Date.now())\n      : 0;',
    '    const key = `${match.id}:${match.version}:${match.phase}:${match.pendingChoice?.id ?? ""}:${match.pendingCoinFlip?.id ?? ""}`;\n    if (botActionKey.current === key) return;\n    botActionKey.current = key;\n    const drawDelay = waitingForDrawWindow\n      ? Math.max(0, (match.drawReadyAt ?? 0) - Date.now())\n      : 0;\n    const coinFlipDelay = match.pendingCoinFlip?.controllerId === "training-bot"\n      ? Math.max(0, match.pendingCoinFlip.resolveAt - Date.now())\n      : 0;',
)
replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '    }, Math.max(520, drawDelay));',
    '    }, Math.max(520, drawDelay, coinFlipDelay));',
)
replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '    storedState.match?.pendingChoice?.id,\n    rollPresentationPending,',
    '    storedState.match?.pendingChoice?.id,\n    storedState.match?.pendingCoinFlip?.id,\n    storedState.match?.pendingCoinFlip?.resolveAt,\n    rollPresentationPending,',
)
replace_once(
    "components/game-screen-v2/GameplayClient.tsx",
    '        <PhaseTransitionLayer match={storedState.match} />\n        <MatchHudLayer',
    '        <PhaseTransitionLayer match={storedState.match} />\n        <CoinFlipLayer\n          match={storedState.match}\n          playerId={storedState.playerId}\n          onCompleteCoinFlip={completeCoinFlip}\n        />\n        <MatchHudLayer',
)

# Regression coverage includes the generated card semantics and both branches of
# the real damage-Flip resolution window.
replace_once(
    "tests/reported-gameplay-regressions-2026-08.test.ts",
    '  CENTER_CELL,\n  createMatch,',
    '  CENTER_CELL,\n  completeCoinFlip,\n  createMatch,',
)
replace_once(
    "tests/reported-gameplay-regressions-2026-08.test.ts",
    'import { activeTappedEnergyIds } from "../lib/rules/costs";\nimport { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";',
    'import { activeTappedEnergyIds } from "../lib/rules/costs";\nimport { compileCardEffect } from "../lib/rules/effects";\nimport { evaluateBakuganCharacteristics } from "../lib/rules/modifiers";',
)
replace_once(
    "tests/reported-gameplay-regressions-2026-08.test.ts",
    'import { createRuleObject } from "../lib/rules/objects";\nimport { emitRuleEvent } from "../lib/rules/triggers";',
    'import { createRuleObject } from "../lib/rules/objects";\nimport { dispatchRulesCommand } from "../lib/rules/runtime";\nimport { emitRuleEvent } from "../lib/rules/triggers";',
)
append_once(
    "tests/reported-gameplay-regressions-2026-08.test.ts",
    "// Coin flip resolution regressions (2026-08-15)",
    r'''

// Coin flip resolution regressions (2026-08-15)
function lostAtSeaDamageState() {
  const defender = makePlayer("coin-defender", "Defender", STARTER_DECKS[0]);
  const attacker = makePlayer("coin-attacker", "Attacker", STARTER_DECKS[1]);
  const lostAtSea = card("br-62", "lost-at-sea-coin-test");
  defender.discard = [lostAtSea];
  addUntappedEnergy(defender, 2);
  const state = createMatch("COINFLIP", "bo1", [defender, attacker]);
  state.turn = 2;
  state.phase = "damage";
  state.stepLabel = "Damage Step • Flip decision • 3 remaining";
  state.startingPlayer = attacker.id;
  state.initialStartingPlayer = defender.id;
  state.priority = defender.id;
  state.pendingLoser = defender.id;
  state.pendingDamage = 3;
  state.damageOrigin = attacker.bakugan[0].id;
  state.damageFaction = attacker.bakugan[0].faction;
  state.revealedFlip = lostAtSea;
  state.selected[defender.id] = defender.bakugan[0].id;
  state.selected[attacker.id] = attacker.bakugan[0].id;
  defender.bakugan[0].open = true;
  attacker.bakugan[0].open = true;
  return { state, defender, attacker, lostAtSea };
}

test("Lost at Sea compiles a coin flip followed by a heads-gated Stop", () => {
  const lostAtSea = card("br-62", "lost-at-sea-compiler-test");
  const program = compileCardEffect(lostAtSea);
  assert.equal(program.instructions.length, 2);
  assert.equal(program.instructions[0].effects[0]?.kind, "coin-flip");
  assert.deepEqual(program.instructions[1].condition, { kind: "coin-result", result: "heads" });
  assert.ok(program.instructions[1].effects.some((effect) => (
    effect.kind === "grant-keyword" && effect.keyword === "Stop"
  )));

  const tailsCard = { ...lostAtSea, effect: "Flip a coin. If tails, draw a card." };
  const tailsProgram = compileCardEffect(tailsCard);
  assert.deepEqual(tailsProgram.instructions[1].condition, { kind: "coin-result", result: "tails" });
});

test("Lost at Sea heads lands through the coin animation gate and stops the attack", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });

  assert.equal(state.pendingCoinFlip?.sourceName, "Lost at Sea");
  assert.ok(["heads", "tails"].includes(state.pendingCoinFlip?.result ?? ""));
  assert.ok(state.batch.some((effect) => effect.card.id === lostAtSea.id));

  const effectId = state.pendingCoinFlip!.sourceEffectId;
  state.pendingCoinFlip!.result = "heads";
  state.coinFlipResults[effectId] = "heads";
  state = dispatchRulesCommand(state, defender.id, { type: "COMPLETE_COIN_FLIP" });

  assert.equal(state.pendingCoinFlip, undefined);
  assert.equal(state.coinFlipResults[effectId], undefined);
  assert.equal(state.pendingDamage, 0);
  assert.equal(state.phase, "postDamage");
  assert.equal(state.batch.some((effect) => effect.card.id === lostAtSea.id), false);
});

test("Lost at Sea tails finalizes cleanly and damage continues", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });

  const effectId = state.pendingCoinFlip!.sourceEffectId;
  state.pendingCoinFlip!.result = "tails";
  state.coinFlipResults[effectId] = "tails";
  state = dispatchRulesCommand(state, defender.id, { type: "COMPLETE_COIN_FLIP" });

  assert.equal(state.pendingCoinFlip, undefined);
  assert.equal(state.coinFlipResults[effectId], undefined);
  assert.equal(state.pendingDamage, 3);
  assert.equal(state.phase, "damage");
  assert.equal(state.priority, defender.id);
  assert.equal(state.batch.some((effect) => effect.card.id === lostAtSea.id), false);
});

test("coin flip completion remains controller-authoritative", () => {
  const { state: initial, defender, attacker, lostAtSea } = lostAtSeaDamageState();
  let state = dispatchRulesCommand(initial, defender.id, {
    type: "PLAY_DAMAGE_FLIP",
    cardId: lostAtSea.id,
    choices: {},
  });
  state = dispatchRulesCommand(state, defender.id, { type: "PASS_PRIORITY" });
  state = dispatchRulesCommand(state, attacker.id, { type: "PASS_PRIORITY" });
  assert.throws(() => completeCoinFlip(state, attacker.id), /controller can finish/i);
});
''',
)
