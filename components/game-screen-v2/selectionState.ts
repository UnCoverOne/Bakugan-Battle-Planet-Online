import { fusionActivationRequirements, type Bakugan, type MatchState, type PlayerState } from "../../lib/game";
import { legalEvoTargets } from "../../lib/evo";
import { playerCanConfirmRoll, playerCanSelectRollTarget } from "../../lib/rolling";
import { playerCanDrawTurnCard } from "../../lib/turnStart";

const PRIORITY_PHASES = new Set([
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
]);

export function selectionPlayer(
  match: MatchState | null | undefined,
  playerId?: string,
): PlayerState | null {
  if (!match?.players.length) return null;
  return match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
}

export function selectableCharacterBakugan(
  match: MatchState | null | undefined,
  playerId?: string,
): readonly Bakugan[] {
  const player = selectionPlayer(match, playerId);
  if (!match || !player || match.phase !== "selection") return [];
  if (match.selected[player.id]) return [];

  const closed = player.bakugan.filter((bakugan) => !bakugan.open);
  return closed.length ? closed : player.bakugan;
}

export function characterSelectionCanConfirm(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  bakuganId: string,
) {
  if (!bakuganId) return false;
  return selectableCharacterBakugan(match, playerId)
    .some((bakugan) => bakugan.id === bakuganId);
}

export function fusionSelectableCharacterBakugan(
  match: MatchState | null | undefined,
  playerId?: string,
): readonly Bakugan[] {
  const player = selectionPlayer(match, playerId);
  if (!match || !player || !PRIORITY_PHASES.has(match.phase) || match.priority !== player.id) return [];
  if (match.pendingChoice || match.pendingCoinFlip || match.pendingReroll) return [];
  return player.bakugan.filter((bakugan) => fusionActivationRequirements(match, player.id, bakugan.id).some((requirement) => requirement.legal));
}

export function activeBakuganId(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const player = selectionPlayer(match, playerId);
  return player ? match?.selected[player.id] ?? "" : "";
}

export function playerActionTooltip({
  match,
  playerId,
  selectedCharacterId,
  selectedHandCardId,
  selectedEvoTargetId,
  now = Date.now(),
}: {
  match: MatchState | null | undefined;
  playerId?: string;
  selectedCharacterId?: string;
  selectedHandCardId?: string;
  selectedEvoTargetId?: string;
  now?: number;
}): string {
  const player = selectionPlayer(match, playerId);
  if (!match || !player) return "";

  if (playerCanDrawTurnCard(match, player.id, now)) {
    return "Press Draw in the Action HUD for the next card.";
  }

  if (match.phase === "energize" && !player.energizedThisTurn) {
    return selectedHandCardId
      ? "Press Energize Card to place the selected card into your Energy zone."
      : "Select a card from your hand, then press Energize Card — or Skip Energizing.";
  }

  if (match.phase === "selection" && !match.selected[player.id]) {
    const selected = player.bakugan.find((bakugan) => bakugan.id === selectedCharacterId);
    return selected
      ? `Press Select to confirm ${selected.name}.`
      : "Select a Character Card, then press Select in the Action HUD.";
  }

  if (playerCanSelectRollTarget(match, player.id)) {
    return match.phase === "reroll"
      ? "Select an available BakuCore for the Reroll, then press Select."
      : "Select an available BakuCore on the playmat, then press Select.";
  }

  if (playerCanConfirmRoll(match, player.id)) {
    return match.phase === "reroll"
      ? "The Reroll target is locked. Press Roll in the Action HUD."
      : "Both targets are locked. Press Roll in the Action HUD.";
  }

  if (PRIORITY_PHASES.has(match.phase) && match.priority === player.id) {
    const fusionTarget = fusionSelectableCharacterBakugan(match, player.id)
      .find((bakugan) => bakugan.id === selectedCharacterId);
    if (fusionTarget) return `Press Fuse to activate ${fusionTarget.name}'s Fusion ability.`;
    const selectedCard = player.hand.find((card) => card.id === selectedHandCardId);
    if (selectedCard?.type === "Evo") {
      const target = legalEvoTargets(match, player.id, selectedCard)
        .find((bakugan) => bakugan.id === selectedEvoTargetId);
      return target
        ? `Press Play Card to evolve ${target.name}.`
        : `Select the matching ${selectedCard.evolvesFrom ?? "Bakugan"} Character Card for this Evo.`;
    }
    return selectedHandCardId
      ? "Press Play Card to use the selected card, or deselect it to choose another action."
      : "Select a playable card from your hand, or press Pass Turn.";
  }

  if (match.phase === "handLimit" && match.priority === player.id && player.hand.length > 7) {
    return `Select ${player.hand.length - 7} card${player.hand.length - 7 === 1 ? "" : "s"} to discard.`;
  }

  return "";
}
