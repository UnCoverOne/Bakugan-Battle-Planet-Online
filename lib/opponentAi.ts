import {
  CENTER_CELL,
  HEX_CELLS,
  cloneMatch,
  legalPlacementCells,
  passPriority,
  placeCore,
  playerCanActivateIntrinsicReroll,
  rotationPhaseOpenCell,
  totalDamage,
  totalPower,
  type CardChoices,
  type GameCard,
  type MatchState,
} from "./game";
import {
  advanceOpponentAi as advanceBaseOpponentAi,
  chooseCardChoices as chooseBaseCardChoices,
} from "./opponentAiBase";
import { compileCardEffect, type RuleAction, type RuleInstruction } from "./rules/effects";
import { ruleConditionActive } from "./rules/modifiers";

export { chooseCardChoices, opponentAiCanAct } from "./opponentAiBase";

type HexCell = (typeof HEX_CELLS)[number];
type CombatStat = "power" | "damage";

type CombatProjection = {
  playerParticipates: boolean;
  opponentParticipates: boolean;
  currentWin: boolean;
  projectedWin: boolean;
  decidingStat: CombatStat;
  projectedGap: number;
  usefulPostVictoryEffect: boolean;
};

const NON_SUBSTANTIVE_ACTIONS = new Set<RuleAction["kind"]>(["choice", "trigger"]);

function playerById(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id === playerId);
}

function opponentOf(match: MatchState, playerId: string) {
  return match.players.find((player) => player.id !== playerId);
}

function activeBakugan(match: MatchState, playerId: string) {
  const player = playerById(match, playerId);
  return player?.bakugan.find((bakugan) => bakugan.id === match.selected[playerId]);
}

function participatesInBrawl(match: MatchState, playerId: string) {
  const active = activeBakugan(match, playerId);
  const roll = match.rolls[playerId];
  if (!active || roll?.result === "miss-closed") return false;
  return active.open || Boolean(roll && roll.result !== "miss-closed");
}

function actionTargetsEnemy(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  action: RuleAction,
  sourceText: string,
) {
  if (action.kind === "modify-stat" && action.scope === "all-enemy") return true;
  const targetId = choices.targetBakuganId;
  if (targetId) {
    return Boolean(opponentOf(match, playerId)?.bakugan.some((bakugan) => bakugan.id === targetId));
  }
  return /enemy|opposing|opponent(?:'s)?|non-\[[a-z]+\]/i.test(sourceText);
}

function actionIsTemporaryCombat(action: RuleAction) {
  if (action.kind === "set-stat" || action.kind === "set-rule") return true;
  return (action.kind === "modify-stat" || action.kind === "grant-keyword")
    && action.duration !== "while-source-in-play"
    && action.duration !== "next-card";
}

function nestedRuleActions(action: RuleAction): RuleAction[] {
  if (action.kind === "conditional") {
    return [...action.whenTrue, ...(action.whenFalse ?? [])];
  }
  if (action.kind === "replacement") return action.replaceWith;
  if (action.kind === "sequence") return action.effects;
  return [];
}

function substantiveLeafActions(action: RuleAction): RuleAction[] {
  if (NON_SUBSTANTIVE_ACTIONS.has(action.kind)) return [];
  const nested = nestedRuleActions(action);
  return nested.length ? nested.flatMap(substantiveLeafActions) : [action];
}

function cardLeafActions(card: GameCard, source = card.effect) {
  return compileCardEffect(card, source).instructions
    .flatMap((instruction) => instruction.actions)
    .flatMap(substantiveLeafActions);
}

function pureTemporaryCombatProgram(card: GameCard) {
  const substantive = cardLeafActions(card);
  return substantive.length > 0
    && substantive.some(actionIsTemporaryCombat)
    && substantive.every(actionIsTemporaryCombat);
}

function shouldReserveDrawRerollCard(match: MatchState, card: GameCard) {
  if (match.phase !== "preRoll") return false;
  const actions = cardLeafActions(card);
  const optionalControllerReroll = actions.some((action) => (
    action.kind === "reroll"
    && action.target === "controller"
    && !action.mandatory
  ));
  if (!optionalControllerReroll) return false;
  const independent = actions.filter((action) => action.kind !== "reroll");
  // A phase-insensitive draw remains available during the Power Step, where the
  // AI can also decide whether the Reroll is actually useful. Spending the card
  // before either roll gives away that option for no additional benefit.
  return independent.length > 0 && independent.every((action) => action.kind === "draw");
}

function sourceHasPrintedIntrinsicReroll(match: MatchState, playerId: string) {
  const bakugan = activeBakugan(match, playerId);
  const roll = match.rolls[playerId];
  if (!bakugan || roll?.result !== "miss-closed") return false;
  const source = bakugan.evoStack.at(-1) ?? bakugan.character;
  if (!(["Character", "Evo"] as const).includes(source.type as "Character" | "Evo")) return false;
  if (!source.mechanics.some((mechanic) => mechanic.toLowerCase() === "reroll")) return false;
  return /\byou may Reroll(?: this)? (?:once each turn|any time) if you miss a Roll with it\b/i.test(source.effect)
    || /\bif you miss a Roll with (?:this|it)[^.]*,? you may Reroll (?:this|it)\b/i.test(source.effect);
}

function effectContainsReroll(match: MatchState, effectId: string) {
  const effect = match.batch.find((candidate) => candidate.id === effectId);
  if (!effect) return false;
  try {
    return cardLeafActions(effect.card, effect.effect ?? effect.card.effect)
      .some((action) => action.kind === "reroll");
  } catch {
    return false;
  }
}

function rerollTransitionAuthorized(
  input: MatchState,
  next: MatchState,
  playerId: string,
) {
  if (input.phase === "reroll" || next.phase !== "reroll") return true;
  const pending = next.pendingReroll;
  if (!pending) return false;
  if (pending.sourceEffectId) return effectContainsReroll(next, pending.sourceEffectId);
  return pending.playerId === playerId
    && playerCanActivateIntrinsicReroll(input, playerId)
    && sourceHasPrintedIntrinsicReroll(input, playerId);
}

function validateAiTransition(
  input: MatchState,
  next: MatchState | null,
  playerId: string,
) {
  if (!next || rerollTransitionAuthorized(input, next, playerId)) return next;
  // A bare miss is not permission to Reroll. Reject any speculative transition
  // that is not backed by a resolving Reroll action or a printed intrinsic
  // ability, and take the normal priority pass instead.
  const passed = passPriority(input, playerId);
  return rerollTransitionAuthorized(input, passed, playerId) ? passed : null;
}

function restoreShadowStrikePenalty(
  match: MatchState,
  playerId: string,
  targetsEnemy: boolean,
  power: { own: number; enemy: number },
  damage: { own: number; enemy: number },
) {
  const targetId = targetsEnemy ? opponentOf(match, playerId)?.id : playerId;
  const target = targetId ? activeBakugan(match, targetId) : undefined;
  if (!target) return;
  const powerPenalty = Math.min(0, match.powerBoost[target.id] ?? 0);
  const damagePenalty = Math.min(0, match.damageBoost[target.id] ?? 0);
  if (targetsEnemy) {
    power.enemy -= powerPenalty;
    damage.enemy -= damagePenalty;
  } else {
    power.own -= powerPenalty;
    damage.own -= damagePenalty;
  }
}

function applyProjectedAction(
  match: MatchState,
  playerId: string,
  choices: CardChoices,
  instruction: RuleInstruction,
  action: RuleAction,
  power: { own: number; enemy: number },
  damage: { own: number; enemy: number },
  deciding: { stat: CombatStat },
) {
  const targetsEnemy = actionTargetsEnemy(
    match,
    playerId,
    choices,
    action,
    instruction.sourceText,
  );
  if (action.kind === "modify-stat") {
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy += action.amount;
      else power.own += action.amount;
    } else if (action.stat === "damage") {
      if (targetsEnemy) damage.enemy += action.amount;
      else damage.own += action.amount;
    }
    return;
  }
  if (action.kind === "set-stat") {
    if (action.stat === "power") {
      if (targetsEnemy) power.enemy = action.value;
      else power.own = action.value;
    } else {
      if (targetsEnemy) damage.enemy = action.value;
      else damage.own = action.value;
    }
    return;
  }
  if (action.kind === "set-rule" && action.rule === "victor-stat") {
    deciding.stat = action.value;
    return;
  }
  if (action.kind === "grant-keyword" && action.keyword === "ShadowStrike") {
    restoreShadowStrikePenalty(match, playerId, targetsEnemy, power, damage);
  }
}

function projectionConditionActive(
  match: MatchState,
  playerId: string,
  condition: Parameters<typeof ruleConditionActive>[2],
) {
  const player = playerById(match, playerId);
  return Boolean(player && ruleConditionActive(
    match,
    player,
    condition,
    activeBakugan(match, playerId),
  ));
}

function projectedLeafActions(
  match: MatchState,
  playerId: string,
  action: RuleAction,
): RuleAction[] {
  if (action.kind === "conditional") {
    const branch = projectionConditionActive(match, playerId, action.condition)
      ? action.whenTrue
      : action.whenFalse ?? [];
    return branch.flatMap((nested) => projectedLeafActions(match, playerId, nested));
  }
  if (action.kind === "replacement") {
    if (action.condition && !projectionConditionActive(match, playerId, action.condition)) return [];
    return action.replaceWith.flatMap((nested) => projectedLeafActions(match, playerId, nested));
  }
  if (action.kind === "sequence") {
    return action.effects.flatMap((nested) => projectedLeafActions(match, playerId, nested));
  }
  return [action];
}

function projectedCombatOutcome(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
): CombatProjection {
  const opponent = opponentOf(match, playerId);
  const playerParticipates = participatesInBrawl(match, playerId);
  const opponentParticipates = Boolean(opponent && participatesInBrawl(match, opponent.id));
  const power = {
    own: totalPower(match, playerId),
    enemy: opponent ? totalPower(match, opponent.id) : 0,
  };
  const damage = {
    own: totalDamage(match, playerId),
    enemy: opponent ? totalDamage(match, opponent.id) : 0,
  };
  const deciding: { stat: CombatStat } = {
    stat: match.victorByDamage ? "damage" : "power",
  };
  const currentGap = deciding.stat === "power"
    ? power.own - power.enemy
    : damage.own - damage.enemy;
  const currentWin = playerParticipates && (!opponentParticipates || currentGap > 0);
  let usefulPostVictoryEffect = false;
  const resolving = cloneMatch(match);
  const resolvingPlayer = playerById(resolving, playerId);
  if (resolvingPlayer) resolvingPlayer.cardsPlayedThisTurn += 1;

  for (const instruction of compileCardEffect(card).instructions) {
    if (!projectionConditionActive(resolving, playerId, instruction.condition)) continue;
    const actions = instruction.actions.flatMap((action) => (
      projectedLeafActions(resolving, playerId, action)
    ));
    for (const action of actions) {
      if (!actionIsTemporaryCombat(action)) continue;
      const targetsEnemy = actionTargetsEnemy(
        match,
        playerId,
        choices,
        action,
        instruction.sourceText,
      );
      if (
        !targetsEnemy
        && (
          (action.kind === "modify-stat" && action.stat === "damage" && action.amount > 0)
          || (action.kind === "set-stat" && action.stat === "damage" && action.value > damage.own)
          || (action.kind === "grant-keyword"
            && (action.keyword === "DoubleStrike" || action.keyword === "FrostStrike"))
        )
      ) usefulPostVictoryEffect = true;
      applyProjectedAction(
        match,
        playerId,
        choices,
        instruction,
        action,
        power,
        damage,
        deciding,
      );
    }
  }

  const projectedGap = deciding.stat === "power"
    ? power.own - power.enemy
    : damage.own - damage.enemy;
  const projectedWin = playerParticipates && (!opponentParticipates || projectedGap > 0);
  return {
    playerParticipates,
    opponentParticipates,
    currentWin,
    projectedWin,
    decidingStat: deciding.stat,
    projectedGap,
    usefulPostVictoryEffect,
  };
}

function shouldSuppressTemporaryCombatCard(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  if (!pureTemporaryCombatProgram(card)) return false;
  const choices = chooseBaseCardChoices(match, playerId, card);
  const projection = projectedCombatOutcome(match, playerId, card, choices);

  // Before the first roll, or after a closed miss, there is no Brawl state to
  // improve. Pure turn-duration modifiers have no tactical payoff, while
  // rerolls and cards with independent effects remain available.
  if (!projection.playerParticipates) return true;

  // When the opponent missed, or the AI is already winning, do not spend more
  // B-Power merely to increase a margin. Damage/FrostStrike/DoubleStrike may
  // still be useful because they improve the attack that follows.
  if (projection.currentWin) return !projection.usefulPostVictoryEffect;

  // From a losing or tied position, only commit a pure combat card when the
  // complete card program changes the projected Victor. This evaluates all
  // clauses together, so multi-clause cards are not rejected one clause at a
  // time and ties are not mistaken for guaranteed wins.
  return !projection.projectedWin;
}

function restoreSuppressedHandCards(
  original: MatchState,
  next: MatchState,
  playerId: string,
  suppressedIds: ReadonlySet<string>,
) {
  const originalPlayer = playerById(original, playerId);
  const nextPlayer = playerById(next, playerId);
  if (!originalPlayer || !nextPlayer || !suppressedIds.size) return next;
  const remaining = new Map(nextPlayer.hand.map((card) => [card.id, card]));
  const restored: GameCard[] = [];
  const seen = new Set<string>();
  for (const card of originalPlayer.hand) {
    const candidate = remaining.get(card.id);
    if (candidate) {
      restored.push(candidate);
      seen.add(candidate.id);
    } else if (suppressedIds.has(card.id)) {
      restored.push(card);
      seen.add(card.id);
    }
  }
  for (const card of nextPlayer.hand) {
    if (!seen.has(card.id)) restored.push(card);
  }
  nextPlayer.hand = restored;
  return next;
}

function advanceWithCombatPolicy(input: MatchState, playerId: string) {
  const player = playerById(input, playerId);
  if (!player) return null;
  const suppressed = new Set(
    player.hand
      .filter((card) => (
        shouldSuppressTemporaryCombatCard(input, playerId, card)
        || shouldReserveDrawRerollCard(input, card)
      ))
      .map((card) => card.id),
  );
  const working = suppressed.size ? cloneMatch(input) : input;
  if (suppressed.size) {
    const filteredPlayer = playerById(working, playerId)!;
    filteredPlayer.hand = filteredPlayer.hand.filter((card) => !suppressed.has(card.id));
  }
  const next = advanceBaseOpponentAi(working, playerId);
  const restored = next && suppressed.size
    ? restoreSuppressedHandCards(input, next, playerId, suppressed)
    : next;
  return validateAiTransition(input, restored, playerId);
}

function cellById(cellId: string) {
  return HEX_CELLS.find((cell) => cell.id === cellId);
}

function hexDistance(a: HexCell, b: HexCell) {
  return (
    Math.abs(a.q - b.q)
    + Math.abs(a.r - b.r)
    + Math.abs((a.q + a.r) - (b.q + b.r))
  ) / 2;
}

function screenSide(match: MatchState, playerId: string, cell: HexCell) {
  const playerIndex = match.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) return 0;
  const screenY = cell.r + cell.q / 2;
  return (playerIndex === 0 ? screenY : -screenY) / 4;
}

function sameRayFromCentre(a: HexCell, b: HexCell) {
  const centre = cellById(CENTER_CELL)!;
  const aDistance = hexDistance(a, centre);
  const bDistance = hexDistance(b, centre);
  if (!aDistance || !bDistance) return false;
  return (a.q - centre.q) * bDistance === (b.q - centre.q) * aDistance
    && (a.r - centre.r) * bDistance === (b.r - centre.r) * aDistance;
}

function topologyScore(match: MatchState, playerId: string, candidate: HexCell) {
  const occupied = match.placements
    .map((placement) => cellById(placement.cell))
    .filter((cell): cell is HexCell => Boolean(cell));
  const own = match.placements
    .filter((placement) => placement.playerId === playerId)
    .map((placement) => cellById(placement.cell))
    .filter((cell): cell is HexCell => Boolean(cell));
  const adjacent = occupied.filter((cell) => hexDistance(cell, candidate) === 1).length;
  const candidateS = -candidate.q - candidate.r;
  const lineCounts = [
    occupied.filter((cell) => cell.q === candidate.q).length,
    occupied.filter((cell) => cell.r === candidate.r).length,
    occupied.filter((cell) => -cell.q - cell.r === candidateS).length,
  ];
  const linePenalty = lineCounts.reduce(
    (sum, count) => sum + Math.max(0, count - 1) * 1.05,
    0,
  );
  const centre = cellById(CENTER_CELL)!;
  const radiusPenalty = Math.max(0, hexDistance(candidate, centre) - 2) * 0.28;
  const rayPenalty = own.filter((cell) => (
    sameRayFromCentre(cell, candidate)
    && hexDistance(candidate, centre) > hexDistance(cell, centre)
  )).length * 0.75;
  const lateralNovelty = own.length >= 2
    && own.every((cell) => cell.q === candidate.q)
    ? -0.45
    : own.some((cell) => cell.q !== candidate.q) ? 0.18 : 0;
  return Math.max(0, adjacent - 1) * 1.4
    + lateralNovelty
    - linePenalty
    - rayPenalty
    - radiusPenalty;
}

function placementCandidateScore(
  match: MatchState,
  playerId: string,
  coreId: string,
  proposedCellId: string,
  candidateId: string,
) {
  const candidate = cellById(candidateId);
  const proposed = cellById(proposedCellId);
  const player = playerById(match, playerId);
  const core = player?.cores.find((item) => item.id === coreId);
  if (!candidate || !proposed || !core) return Number.NEGATIVE_INFINITY;
  const provisional = cloneMatch(match);
  provisional.placements.push({
    playerId,
    core,
    cell: candidateId,
    order: provisional.placements.length + 1,
  });
  const directAccess = rotationPhaseOpenCell(provisional, playerId, candidateId) === candidateId;
  const proposedSide = screenSide(match, playerId, proposed);
  const candidateSide = screenSide(match, playerId, candidate);
  const sidePreservation = 1 - Math.min(2, Math.abs(candidateSide - proposedSide));
  const strategicDistance = hexDistance(candidate, proposed);
  return topologyScore(match, playerId, candidate) * 1.7
    + sidePreservation * 0.75
    + (directAccess ? 0.35 : 0)
    - strategicDistance * 0.12;
}

function diversifyProposedPlacement(
  input: MatchState,
  playerId: string,
  proposed: MatchState,
) {
  const added = proposed.placements.at(-1);
  if (!added || proposed.placements.length !== input.placements.length + 1) return proposed;
  const legal = legalPlacementCells(input);
  if (legal.length < 2) return proposed;
  const ranked = legal.map((cell) => ({
    cell,
    score: placementCandidateScore(input, playerId, added.core.id, added.cell, cell),
  })).sort((a, b) => b.score - a.score || a.cell.localeCompare(b.cell));
  const best = ranked[0];
  const proposedScore = placementCandidateScore(
    input,
    playerId,
    added.core.id,
    added.cell,
    added.cell,
  );
  if (!best || best.cell === added.cell || best.score < proposedScore + 0.2) return proposed;
  return placeCore(input, playerId, added.core.id, best.cell);
}

export function advanceOpponentAi(input: MatchState, playerId: string): MatchState | null {
  if (input.phase === "placement" && input.priority === playerId) {
    const proposed = advanceBaseOpponentAi(input, playerId);
    return proposed ? diversifyProposedPlacement(input, playerId, proposed) : null;
  }
  const hasPendingDecision = Boolean(input.pendingChoice)
    || input.triggerOrders.some((request) => request.controllerId === playerId && !request.orderedIds);
  if (
    (input.phase === "preRoll" || input.phase === "power")
    && input.priority === playerId
    && !hasPendingDecision
  ) return advanceWithCombatPolicy(input, playerId);
  return advanceBaseOpponentAi(input, playerId);
}