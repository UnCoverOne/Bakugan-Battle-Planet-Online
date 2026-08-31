import type { MatchState } from "../game";
import { ruleDefinitionForCard } from "./catalogue";
import type { AbilityDefinition } from "./model";

/**
 * Static rules permissions change what the engine allows while their source is
 * active. They do not create Batch objects and therefore never resolve as
 * effects of their own.
 */
export type RulePermission = "battle-mastery-select-both" | "empower-free";

const PERMISSION_MATCHERS: ReadonlyArray<{
  permission: RulePermission;
  matches: (text: string) => boolean;
}> = [
  {
    permission: "battle-mastery-select-both",
    matches: (text) => /when you play a card with Battle Mastery,\s*you may choose both/i.test(text),
  },
  {
    permission: "empower-free",
    matches: (text) => /\bEmpower cards for free\b/i.test(text),
  },
];

export function permissionsGrantedByAbility(ability: AbilityDefinition): RulePermission[] {
  const sourceText = ability.instructions.map((instruction) => instruction.sourceText).join(" ");
  return PERMISSION_MATCHERS
    .filter((entry) => entry.matches(sourceText))
    .map((entry) => entry.permission);
}

export function abilityGrantsStaticPermission(ability: AbilityDefinition) {
  return permissionsGrantedByAbility(ability).length > 0;
}

export function activeRulePermissions(state: MatchState, controllerId: string): Set<RulePermission> {
  const player = state.players.find((candidate) => candidate.id === controllerId);
  if (!player) return new Set();

  const activeSources = [
    ...player.heroes,
    ...player.bakugan.flatMap((bakugan) => [bakugan.evoStack.at(-1) ?? (bakugan.fused ? bakugan.fusionCharacter : undefined) ?? bakugan.character, ...(bakugan.bakuGear ?? [])]),
  ];
  const permissions = new Set<RulePermission>();
  for (const source of activeSources) {
    const definition = ruleDefinitionForCard(source);
    for (const ability of definition.abilities) {
      for (const permission of permissionsGrantedByAbility(ability)) permissions.add(permission);
    }
  }
  return permissions;
}

export function hasActiveRulePermission(
  state: MatchState,
  controllerId: string,
  permission: RulePermission,
) {
  return activeRulePermissions(state, controllerId).has(permission);
}
