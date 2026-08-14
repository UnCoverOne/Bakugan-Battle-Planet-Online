import {
  CENTER_CELL,
  HEX_CELLS,
  cloneMatch,
  legalPlacementCells,
  passPriority,
  prepareCardPlay,
  placeCore,
  playerCanActivateIntrinsicReroll,
  rotationPhaseOpenCell,
  totalDamage,
  totalPower,
  type CardChoices,
  type GameCard,
  type MatchState,
} from "./game";
import { bestAiRollTarget } from "./aiRollForecast";
import { cardEnergyPaymentState, playCardWithAutoEnergy } from "./cardPayment";
import { drawPendingCard, playerCanResolvePendingDraw } from "./drawQueue";
import { evaluateBakuganCharacteristics } from "./rules/modifiers";
import { activeTappedEnergyIds } from "./rules/costs";
import { buildChoiceSchema } from "./rules/choices";
import {
  advanceOpponentAi as advanceBaseOpponentAi,
  chooseOpponentAiCommand as chooseBaseOpponentAiCommand,
  chooseCardChoices as chooseBaseCardChoices,
  handCardRetentionValue,
} from "./opponentAiBase";
import { playerCanSelectRollTarget, selectRollTarget } from "./rolling";
import {
  activeCardActionEntries,
  cardLeafActions,
  estimateRuleActionValue,
  hasNonDeferrablePreRollTiming,
  isTemporaryCombatAction,
} from "./aiCardSemantics";
import type { RuleAction, RuleInstruction } from "./rules/effects";
import type { GameCommand } from "./engine/types";

export { chooseCardChoices } from "./opponentAiBase";
export { opponentAiCanAct } from "./opponentAiCanAct";

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

function cardHasOptionalSelfReroll(card: GameCard) {
  try {
    return cardLeafActions(card).some((action) => (
      action.kind === "reroll"
      && action.target === "controller"
      && !action.mandatory
    ));
  } catch {
    return false;
  }
}

function shouldReserveOptionalRerollCard(match: MatchState, card: GameCard) {
  if (match.phase !== "preRoll") return false;
  if (hasNonDeferrablePreRollTiming(card.effect)) return false;
  // An optional self-Reroll has no value until the first roll has resolved.
  // Hold the complete card so mixed programs (for example, attack + Reroll)
  // cannot spend their immediate clause while throwing away the later option.
  return cardHasOptionalSelfReroll(card);
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

function playerHasRerollInFlight(match: MatchState, playerId: string) {
  if (match.pendingReroll?.playerId === playerId) return true;
  return match.batch.some((effect) => (
    effect.controllerId === playerId
    && !effect.negated
    && effectContainsReroll(match, effect.id)
  ));
}

function shouldWaitForRerollOutcome(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  if (!playerHasRerollInFlight(match, playerId)) return false;
  try {
    return cardLeafActions(card).some((action) => action.kind === "reroll");
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

function bakuganHasShadowStrike(match: MatchState, bakuganId: string) {
  const owner = match.players.find((player) => player.bakugan.some((candidate) => candidate.id === bakuganId));
  const bakugan = owner?.bakugan.find((candidate) => candidate.id === bakuganId);
  return Boolean(owner && bakugan
    && evaluateBakuganCharacteristics(match, bakugan, owner).shadowStrike);
}

function activeTargetBakugan(match: MatchState, playerId: string, targetsEnemy: boolean) {
  const targetPlayer = targetsEnemy ? opponentOf(match, playerId) : playerById(match, playerId);
  if (!targetPlayer) return undefined;
  return targetPlayer.bakugan.find((bakugan) => bakugan.id === match.selected[targetPlayer.id])
    ?? targetPlayer.bakugan.find((bakugan) => bakugan.open)
    ?? targetPlayer.bakugan[0];
}

function projectShadowStrikeGain(
  match: MatchState,
  controllerId: string,
  perspectiveId: string,
  targetsEnemy: boolean,
  power: { own: number; enemy: number },
  damage: { own: number; enemy: number },
) {
  const targetPlayer = targetsEnemy
    ? opponentOf(match, controllerId)
    : playerById(match, controllerId);
  const target = activeTargetBakugan(match, controllerId, targetsEnemy);
  if (!targetPlayer || !target) return;
  const projected = cloneMatch(match);
  projected.shadowStrike[target.id] = true;
  if (targetPlayer.id === perspectiveId) {
    power.own = totalPower(projected, targetPlayer.id);
    damage.own = totalDamage(projected, targetPlayer.id);
  } else {
    power.enemy = totalPower(projected, targetPlayer.id);
    damage.enemy = totalDamage(projected, targetPlayer.id);
  }
}

function applyProjectedAction(
  match: MatchState,
  controllerId: string,
  perspectiveId: string,
  choices: CardChoices,
  instruction: RuleInstruction,
  action: RuleAction,
  power: { own: number; enemy: number },
  damage: { own: number; enemy: number },
  deciding: { stat: CombatStat },
) {
  const targetsEnemy = actionTargetsEnemy(
    match,
    controllerId,
    choices,
    action,
    instruction.sourceText,
  );
  const targetPlayer = targetsEnemy
    ? opponentOf(match, controllerId)
    : playerById(match, controllerId);
  const targetsPerspective = targetPlayer?.id === perspectiveId;
  if (action.kind === "modify-stat") {
    const target = activeTargetBakugan(match, controllerId, targetsEnemy);
    const prevented = action.amount < 0
      && (action.stat === "power" || action.stat === "damage")
      && Boolean(target && bakuganHasShadowStrike(match, target.id));
    if (prevented) return;
    if (action.stat === "power") {
      if (targetsPerspective) power.own += action.amount;
      else power.enemy += action.amount;
    } else if (action.stat === "damage") {
      if (targetsPerspective) damage.own += action.amount;
      else damage.enemy += action.amount;
    }
    return;
  }
  if (action.kind === "set-stat") {
    const target = activeTargetBakugan(match, controllerId, targetsEnemy);
    const current = action.stat === "power"
      ? (targetsPerspective ? power.own : power.enemy)
      : (targetsPerspective ? damage.own : damage.enemy);
    if (action.value < current && target && bakuganHasShadowStrike(match, target.id)) return;
    if (action.stat === "power") {
      if (targetsPerspective) power.own = action.value;
      else power.enemy = action.value;
    } else {
      if (targetsPerspective) damage.own = action.value;
      else damage.enemy = action.value;
    }
    return;
  }
  if (action.kind === "set-rule" && action.rule === "victor-stat") {
    deciding.stat = action.value;
    return;
  }
  if (action.kind === "grant-keyword" && action.keyword === "ShadowStrike") {
    projectShadowStrikeGain(
      match,
      controllerId,
      perspectiveId,
      targetsEnemy,
      power,
      damage,
    );
  }
}

type ProjectedCombatState = {
  power: { own: number; enemy: number };
  damage: { own: number; enemy: number };
  deciding: { stat: CombatStat };
};

function pendingEffectChoices(
  effect: MatchState["batch"][number],
) {
  const through = effect.instructionIndex ?? 0;
  const resolved = Object.entries(effect.resolvedChoices ?? {})
    .filter(([index]) => Number(index) <= through)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, choices]) => choices);
  return Object.assign({}, effect.choices, ...resolved) as CardChoices;
}

function applyProjectedCard(
  match: MatchState,
  perspectiveId: string,
  controllerId: string,
  card: GameCard,
  choices: CardChoices,
  combat: ProjectedCombatState,
  options: {
    execution: "play" | "all";
    source?: string;
    startInstructionIndex?: number;
    candidate?: boolean;
  },
) {
  const resolving = cloneMatch(match);
  if (options.candidate) {
    const controller = playerById(resolving, controllerId);
    if (controller) controller.cardsPlayedThisTurn += 1;
  }
  let usefulPostVictoryEffect = false;
  for (const { instruction, action } of activeCardActionEntries(
    resolving,
    controllerId,
    card,
    choices,
    options,
  )) {
    if (!isTemporaryCombatAction(action)) continue;
    const targetsEnemy = actionTargetsEnemy(
      match,
      controllerId,
      choices,
      action,
      instruction.sourceText,
    );
    if (
      options.candidate
      && controllerId === perspectiveId
      && !targetsEnemy
      && (
        (action.kind === "modify-stat" && action.stat === "damage" && action.amount > 0)
        || (action.kind === "set-stat" && action.stat === "damage" && action.value > combat.damage.own)
        || (action.kind === "grant-keyword"
          && (action.keyword === "DoubleStrike" || action.keyword === "FrostStrike"))
      )
    ) usefulPostVictoryEffect = true;
    applyProjectedAction(
      match,
      controllerId,
      perspectiveId,
      choices,
      instruction,
      action,
      combat.power,
      combat.damage,
      combat.deciding,
    );
  }
  return usefulPostVictoryEffect;
}

function projectCombatAfterBatch(
  match: MatchState,
  playerId: string,
  candidate?: { card: GameCard; choices: CardChoices },
) {
  const opponent = opponentOf(match, playerId);
  const combat: ProjectedCombatState = {
    power: {
      own: totalPower(match, playerId),
      enemy: opponent ? totalPower(match, opponent.id) : 0,
    },
    damage: {
      own: totalDamage(match, playerId),
      enemy: opponent ? totalDamage(match, opponent.id) : 0,
    },
    deciding: { stat: match.victorByDamage ? "damage" : "power" },
  };
  let usefulPostVictoryEffect = false;

  // A newly played card becomes the top batch object, so it resolves before
  // every object that was already staged. Existing objects resolve newest-first.
  if (candidate) {
    usefulPostVictoryEffect = applyProjectedCard(
      match,
      playerId,
      playerId,
      candidate.card,
      candidate.choices,
      combat,
      { execution: "play", candidate: true },
    );
  }
  for (const effect of [...match.batch].reverse()) {
    if (effect.negated) continue;
    applyProjectedCard(
      match,
      playerId,
      effect.controllerId,
      effect.card,
      pendingEffectChoices(effect),
      combat,
      {
        execution: effect.kind === "trigger" ? "all" : "play",
        source: effect.effect ?? effect.card.effect,
        startInstructionIndex: effect.instructionIndex ?? 0,
      },
    );
  }
  const gap = combat.deciding.stat === "power"
    ? combat.power.own - combat.power.enemy
    : combat.damage.own - combat.damage.enemy;
  return { combat, gap, usefulPostVictoryEffect };
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
  const current = projectCombatAfterBatch(match, playerId);
  const projected = projectCombatAfterBatch(match, playerId, { card, choices });
  const currentWin = playerParticipates
    && (!opponentParticipates || current.gap > 0);
  const projectedWin = playerParticipates
    && (!opponentParticipates || projected.gap > 0);
  return {
    playerParticipates,
    opponentParticipates,
    currentWin,
    projectedWin,
    decidingStat: projected.combat.deciding.stat,
    projectedGap: projected.gap,
    usefulPostVictoryEffect: projected.usefulPostVictoryEffect,
  };
}

function activeCandidateEntries(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices: CardChoices,
) {
  const resolving = cloneMatch(match);
  const controller = playerById(resolving, playerId);
  if (controller) controller.cardsPlayedThisTurn += 1;
  return activeCardActionEntries(
    resolving,
    playerId,
    card,
    choices,
    { execution: "play" },
  );
}

function independentActionValue(
  match: MatchState,
  playerId: string,
  action: RuleAction,
) {
  const player = playerById(match, playerId);
  if (!player) return 0;
  if (action.kind === "draw") {
    return Math.min(action.amount, player.deckCards.length) * 2.4;
  }
  if (action.kind === "search") return player.deckCards.length ? 3 : 0;
  if (action.kind === "reveal") return player.deckCards.length ? 0.8 : 0;
  if (action.kind === "recharge-energy") {
    const uncharged = activeTappedEnergyIds(player, match.turn).length;
    const amount = action.amount === "all" ? uncharged : Math.min(uncharged, action.amount);
    return amount * 1.6;
  }
  if (action.kind === "reroll") {
    if (match.phase !== "power") return 0;
    const targetId = action.target === "opponent" ? opponentOf(match, playerId)?.id : playerId;
    const roll = targetId ? match.rolls[targetId] : undefined;
    if (!roll) return 0;
    if (action.target === "controller") {
      return roll.result === "miss-closed" ? 6 : roll.result === "open-no-core" ? 2.5 : 0;
    }
    return roll.result === "miss-closed" ? 0 : 2.5;
  }
  if (action.kind === "play") {
    if (action.source === "hand") return player.hand.length ? 3 : 0;
    if (action.source === "revealed-deck") return player.revealedDeckCardId ? 3 : 0;
    return 3;
  }
  return Math.max(0, estimateRuleActionValue(action, match));
}

function candidateIndependentValue(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices = chooseBaseCardChoices(match, playerId, card),
) {
  return activeCandidateEntries(match, playerId, card, choices)
    .filter(({ action }) => !isTemporaryCombatAction(action))
    .reduce((sum, { action }) => sum + independentActionValue(match, playerId, action), 0);
}

function shouldReservePostBrawlOptionalRerollCard(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  if (!["victor", "postDamage", "endPlay"].includes(match.phase)) return false;
  if (!cardHasOptionalSelfReroll(card) || hasNonDeferrablePreRollTiming(card.effect)) return false;
  const player = playerById(match, playerId);
  if (!player || !player.bakugan.some((bakugan) => !bakugan.open)) return false;
  const choices = chooseBaseCardChoices(match, playerId, card);
  const immediate = candidateIndependentValue(match, playerId, card, choices);
  const payment = cardEnergyPaymentState(match, playerId, card, choices);
  const cost = payment?.kind === "insufficient" ? 0 : payment?.cost ?? 0;
  const retained = Math.max(0, handCardRetentionValue(match, playerId, card));
  const futureRerollReserve = Math.max(3.2, retained * 0.55 + 1.25);
  return immediate - cost * 0.5 < futureRerollReserve;
}

function candidateHasTemporaryPower(
  match: MatchState,
  playerId: string,
  card: GameCard,
  choices = chooseBaseCardChoices(match, playerId, card),
) {
  return activeCandidateEntries(match, playerId, card, choices).some(({ action }) => (
    isTemporaryCombatAction(action)
    && (action.kind === "modify-stat" || action.kind === "set-stat")
    && action.stat === "power"
  ));
}

function shouldSuppressTemporaryCombatCard(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  const choices = chooseBaseCardChoices(match, playerId, card);
  const entries = activeCandidateEntries(match, playerId, card, choices);
  if (!entries.some(({ action }) => isTemporaryCombatAction(action))) return false;
  const projection = projectedCombatOutcome(match, playerId, card, choices);
  const independentValue = candidateIndependentValue(match, playerId, card, choices);
  const hasIndependentBenefit = independentValue >= 0.75;

  // Once damage has been dealt, no turn-duration combat modifier can affect the
  // completed Brawl. During the Victor Step, only damage/strike improvements
  // controlled by the declared Victor can still improve the pending attack.
  if (match.phase === "postDamage" || match.phase === "endPlay") {
    return !hasIndependentBenefit;
  }
  if (match.phase === "victor") {
    if (match.brawlWinner !== playerId) return !hasIndependentBenefit;
    return !projection.usefulPostVictoryEffect && !hasIndependentBenefit;
  }

  // Before the first roll, or after a closed miss, there is no Brawl state to
  // improve. Pure turn-duration modifiers have no tactical payoff, while
  // rerolls and cards with independent effects remain available.
  if (!projection.playerParticipates) return !hasIndependentBenefit;

  // When the opponent missed, or the AI is already winning, never trade the
  // projected Brawl win for a tie/loss. A card that changes the Victor stat is
  // also suppressed from a winning position unless it has a real non-combat
  // payoff: incidental Damage is not enough reason to abandon a safe B-Power win.
  if (projection.currentWin) {
    if (!projection.projectedWin) return true;
    const changesVictorStat = entries.some(({ action }) => (
      action.kind === "set-rule" && action.rule === "victor-stat"
    ));
    if (changesVictorStat && !hasIndependentBenefit) return true;
    return !projection.usefulPostVictoryEffect && !hasIndependentBenefit;
  }

  // From a losing or tied position, commit a combat card only when its active
  // program changes the projected Victor or an independent clause has real
  // value. This keeps mixed cards available without treating an inactive side
  // clause as permission to waste B-Power.
  return !projection.projectedWin && !hasIndependentBenefit;
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


type TemporaryPowerCandidate = {
  card: GameCard;
  cost: number;
  swing: number;
  strategicCost: number;
};

function currentEnergyCapacity(match: MatchState, playerId: string) {
  const player = playerById(match, playerId) as (ReturnType<typeof playerById> & {
    tappedEnergyIds?: string[];
    energyTapTurn?: number;
  });
  if (!player) return 0;
  if (player.energyTapTurn !== match.turn) return player.energyZone.length;
  const tapped = new Set(player.tappedEnergyIds ?? []);
  const untapped = player.energyZone.filter((card) => !tapped.has(card.id)).length;
  return Math.max(0, Math.floor(player.energy)) + untapped;
}

function temporaryPowerSwing(
  match: MatchState,
  playerId: string,
  card: GameCard,
) {
  const choices = chooseBaseCardChoices(match, playerId, card);
  const current = projectCombatAfterBatch(match, playerId);
  const projected = projectCombatAfterBatch(match, playerId, { card, choices });
  if (current.combat.deciding.stat !== "power" || projected.combat.deciding.stat !== "power") {
    return 0;
  }
  return Math.max(0, projected.gap - current.gap);
}

function minimumWinningTemporaryPowerCards(
  match: MatchState,
  playerId: string,
) {
  const result = new Set<string>();
  if (match.phase !== "power" || match.victorByDamage) return result;
  const player = playerById(match, playerId);
  const opponent = opponentOf(match, playerId);
  if (!player || !opponent) return result;
  if (!participatesInBrawl(match, playerId) || !participatesInBrawl(match, opponent.id)) {
    return result;
  }
  const projectedBatch = projectCombatAfterBatch(match, playerId);
  if (projectedBatch.combat.deciding.stat !== "power") return result;
  const deficit = -projectedBatch.gap;
  if (deficit < 0) return result;
  const budget = currentEnergyCapacity(match, playerId);
  if (budget <= 0) return result;

  const candidates: TemporaryPowerCandidate[] = player.hand
    .filter((card) => candidateHasTemporaryPower(match, playerId, card))
    .map((card) => {
      const choices = chooseBaseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      const cost = payment?.kind === "insufficient" ? budget + 1 : payment?.cost ?? budget + 1;
      const retention = Math.max(0, handCardRetentionValue(match, playerId, card));
      const independentValue = candidateIndependentValue(match, playerId, card, choices);
      return {
        card,
        cost,
        swing: temporaryPowerSwing(match, playerId, card),
        strategicCost: cost * 3
          + 1.25
          + retention * 0.3
          - Math.min(1.5, independentValue * 0.25),
      };
    })
    .filter((candidate) => candidate.swing > 0 && candidate.cost <= budget)
    .sort((a, b) => (
      a.cost - b.cost
      || a.swing - b.swing
      || a.card.id.localeCompare(b.card.id)
    ))
    .slice(0, 12);
  if (!candidates.length) return result;

  type Combination = {
    ids: string[];
    cost: number;
    swing: number;
    strategicCost: number;
  };
  const combinations: Combination[] = [{ ids: [], cost: 0, swing: 0, strategicCost: 0 }];
  for (const candidate of candidates) {
    const existing = [...combinations];
    for (const combination of existing) {
      if (combination.ids.length >= 3) continue;
      const next = {
        ids: [...combination.ids, candidate.card.id],
        cost: combination.cost + candidate.cost,
        swing: combination.swing + candidate.swing,
        strategicCost: combination.strategicCost + candidate.strategicCost,
      };
      if (next.cost <= budget) combinations.push(next);
    }
  }

  let best: Combination | undefined;
  for (const combination of combinations) {
    if (!combination.ids.length || combination.swing <= deficit) continue;
    const overshoot = combination.swing - deficit;
    const bestOvershoot = best ? best.swing - deficit : Number.POSITIVE_INFINITY;
    if (
      !best
      || combination.strategicCost < best.strategicCost
      || (combination.strategicCost === best.strategicCost && combination.cost < best.cost)
      || (combination.strategicCost === best.strategicCost
        && combination.cost === best.cost
        && combination.ids.length < best.ids.length)
      || (combination.strategicCost === best.strategicCost
        && combination.cost === best.cost
        && combination.ids.length === best.ids.length
        && overshoot < bestOvershoot)
    ) best = combination;
  }
  for (const id of best?.ids ?? []) result.add(id);
  return result;
}

function nextWinningPowerPlanCard(
  match: MatchState,
  playerId: string,
  winningPowerPlan: ReadonlySet<string>,
) {
  const player = playerById(match, playerId);
  if (!player || !winningPowerPlan.size) return undefined;
  return player.hand
    .filter((card) => winningPowerPlan.has(card.id))
    .map((card) => {
      const choices = chooseBaseCardChoices(match, playerId, card);
      const payment = cardEnergyPaymentState(match, playerId, card, choices);
      return {
        card,
        choices,
        cost: payment?.kind === "insufficient"
          ? Number.POSITIVE_INFINITY
          : payment?.cost ?? Number.POSITIVE_INFINITY,
        swing: temporaryPowerSwing(match, playerId, card),
      };
    })
    .filter((candidate) => Number.isFinite(candidate.cost) && candidate.swing > 0)
    .sort((a, b) => (
      a.cost - b.cost
      || b.swing - a.swing
      || a.card.id.localeCompare(b.card.id)
    ))[0];
}

function winningPowerPlanCommand(
  match: MatchState,
  playerId: string,
  winningPowerPlan: ReadonlySet<string>,
): GameCommand | null {
  const candidate = nextWinningPowerPlanCard(match, playerId, winningPowerPlan);
  if (!candidate) return null;
  const schema = buildChoiceSchema(match, playerId, candidate.card);
  return schema.fields.length
    ? { type: "PREPARE_CARD_PLAY", cardId: candidate.card.id }
    : { type: "PLAY_CARD", cardId: candidate.card.id, choices: candidate.choices };
}

function advanceWinningPowerPlan(
  match: MatchState,
  playerId: string,
  winningPowerPlan: ReadonlySet<string>,
) {
  const candidate = nextWinningPowerPlanCard(match, playerId, winningPowerPlan);
  if (!candidate) return null;
  const schema = buildChoiceSchema(match, playerId, candidate.card);
  const next = schema.fields.length
    ? prepareCardPlay(match, playerId, candidate.card.id)
    : playCardWithAutoEnergy(match, playerId, candidate.card.id, candidate.choices);
  return validateAiTransition(match, next, playerId);
}

function advanceWithCombatPolicy(input: MatchState, playerId: string) {
  const player = playerById(input, playerId);
  if (!player) return null;
  const winningPowerPlan = minimumWinningTemporaryPowerCards(input, playerId);
  const forcedWinningPlay = advanceWinningPowerPlan(input, playerId, winningPowerPlan);
  if (forcedWinningPlay) return forcedWinningPlay;
  const suppressed = new Set(
    player.hand
      .filter((card) => {
        const unneededPowerAlternative = input.phase === "power"
          && winningPowerPlan.size > 0
          && candidateHasTemporaryPower(input, playerId, card)
          && !winningPowerPlan.has(card.id)
          && candidateIndependentValue(input, playerId, card) < 0.75;
        const tacticallySuppressed = input.phase !== "preRoll"
          && !winningPowerPlan.has(card.id)
          && shouldSuppressTemporaryCombatCard(input, playerId, card);
        return unneededPowerAlternative
          || tacticallySuppressed
          || shouldReserveOptionalRerollCard(input, card)
          || shouldWaitForRerollOutcome(input, playerId, card)
          || shouldReservePostBrawlOptionalRerollCard(input, playerId, card);
      })
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

function chooseWithCombatPolicy(input: MatchState, playerId: string): GameCommand | null {
  const player = playerById(input, playerId);
  if (!player) return null;
  const winningPowerPlan = minimumWinningTemporaryPowerCards(input, playerId);
  const forcedWinningCommand = winningPowerPlanCommand(input, playerId, winningPowerPlan);
  if (forcedWinningCommand) return forcedWinningCommand;
  const suppressed = new Set(
    player.hand
      .filter((card) => {
        const unneededPowerAlternative = input.phase === "power"
          && winningPowerPlan.size > 0
          && candidateHasTemporaryPower(input, playerId, card)
          && !winningPowerPlan.has(card.id)
          && candidateIndependentValue(input, playerId, card) < 0.75;
        const tacticallySuppressed = input.phase !== "preRoll"
          && !winningPowerPlan.has(card.id)
          && shouldSuppressTemporaryCombatCard(input, playerId, card);
        return unneededPowerAlternative
          || tacticallySuppressed
          || shouldReserveOptionalRerollCard(input, card)
          || shouldWaitForRerollOutcome(input, playerId, card)
          || shouldReservePostBrawlOptionalRerollCard(input, playerId, card);
      })
      .map((card) => card.id),
  );
  const working = suppressed.size ? cloneMatch(input) : input;
  if (suppressed.size) {
    const filteredPlayer = playerById(working, playerId)!;
    filteredPlayer.hand = filteredPlayer.hand.filter((card) => !suppressed.has(card.id));
  }
  return chooseBaseOpponentAiCommand(working, playerId);
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

function advanceOpponentAiStep(input: MatchState, playerId: string): MatchState | null {
  if (playerCanResolvePendingDraw(input, playerId)) {
    return drawPendingCard(input, playerId);
  }
  if (
    (input.phase === "target" || input.phase === "reroll")
    && playerCanSelectRollTarget(input, playerId)
  ) {
    const target = bestAiRollTarget(input, playerId);
    return target ? selectRollTarget(input, playerId, target.cell) : null;
  }
  if (input.phase === "placement" && input.priority === playerId) {
    const proposed = advanceBaseOpponentAi(input, playerId);
    return proposed ? diversifyProposedPlacement(input, playerId, proposed) : null;
  }
  const hasPendingDecision = Boolean(input.pendingChoice)
    || input.triggerOrders.some((request) => request.controllerId === playerId && !request.orderedIds);
  if (
    ["preRoll", "power", "victor", "postDamage", "endPlay"].includes(input.phase)
    && input.priority === playerId
    && !hasPendingDecision
  ) return advanceWithCombatPolicy(input, playerId);
  return advanceBaseOpponentAi(input, playerId);
}

/** Pure one-step decision for the Training worker; the main reducer applies it. */
export function chooseOpponentAiCommand(input: MatchState, playerId: string): GameCommand | null {
  if (playerCanResolvePendingDraw(input, playerId)) {
    return { type: "DRAW_PENDING_CARD" };
  }
  if (
    (input.phase === "target" || input.phase === "reroll")
    && playerCanSelectRollTarget(input, playerId)
  ) {
    const target = bestAiRollTarget(input, playerId);
    return target ? { type: "SELECT_ROLL_TARGET", cell: target.cell } : null;
  }
  if (input.phase === "placement" && input.priority === playerId) {
    const proposed = advanceBaseOpponentAi(input, playerId);
    const diversified = proposed ? diversifyProposedPlacement(input, playerId, proposed) : null;
    const placement = diversified?.placements.at(-1);
    return placement && diversified!.placements.length === input.placements.length + 1
      ? { type: "PLACE_CORE", coreId: placement.core.id, cell: placement.cell }
      : null;
  }
  const hasPendingDecision = Boolean(input.pendingChoice)
    || input.triggerOrders.some((request) => request.controllerId === playerId && !request.orderedIds);
  if (
    ["preRoll", "power", "victor", "postDamage", "endPlay"].includes(input.phase)
    && input.priority === playerId
    && !hasPendingDecision
  ) return chooseWithCombatPolicy(input, playerId);
  return chooseBaseOpponentAiCommand(input, playerId);
}


export function advanceOpponentAi(input: MatchState, playerId: string): MatchState | null {
  let current = input;
  let advanced = false;
  for (let step = 0; step < 4; step += 1) {
    const next = advanceOpponentAiStep(current, playerId);
    if (!next) return advanced ? current : null;
    advanced = true;
    current = next;
    const pending = current.pendingChoice;
    const anotherAiChoice = Boolean(
      pending
      && !pending.answers[playerId]
      && pending.schema.fields.some((field) => field.chooserId === playerId),
    );
    if (!anotherAiChoice) return current;
  }
  return current;
}