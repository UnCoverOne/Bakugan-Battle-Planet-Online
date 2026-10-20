import type { GameCard } from "./game";
import { ruleDefinitionForCard } from "./rules/catalogue";

/** Printed hand-reveal trigger which grants an effect-originated free play. */
export function playsFreeWhenRevealedFromHand(card: GameCard) {
  return ruleDefinitionForCard(card).abilities.some((ability) => (
    ability.kind === "triggered"
    && ability.trigger?.event === "CARD_REVEALED_FROM_HAND"
    && ability.trigger.source === "self"
    && ability.trigger.causedByCard === true
    && ability.instructions.some((instruction) => instruction.actions.some((action) => (
      action.kind === "play" && action.source === "revealed-hand" && action.free
    )))
  ));
}
