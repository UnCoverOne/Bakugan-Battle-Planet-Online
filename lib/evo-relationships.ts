import evoTargets from "../content/evo-character-targets.json";

/**
 * The single runtime Evo relationship registry. Generated from the reviewed
 * evo-character-relationships.audit.json and checked against it by tests.
 *
 * Do not infer a fallback from names, factions, or release sets: those can
 * identify different, incompatible Character versions.
 */
export type EvoCharacterRelationship = {
  readonly targetCharacterIds: readonly string[];
  readonly requiresFusedFace: boolean;
  readonly cancelled: boolean;
};

const relationships: Readonly<Record<string, EvoCharacterRelationship>> = evoTargets;

/** Unknown and cancelled Evos deliberately have no legal target. */
export function evoCharacterTargets(evoId: string): readonly string[] {
  return relationships[evoId]?.targetCharacterIds ?? [];
}

export function isCancelledEvo(evoId: string): boolean {
  return relationships[evoId]?.cancelled === true;
}

/** Reverse index for exact Character versions, including Epic and fused faces. */
const evosByCharacter = new Map<string, string[]>();
for (const [evoId, relationship] of Object.entries(relationships)) {
  for (const characterId of relationship.targetCharacterIds) {
    const evos = evosByCharacter.get(characterId) ?? [];
    evos.push(evoId);
    evosByCharacter.set(characterId, evos);
  }
}

export function evolutionIdsForCharacter(characterId: string): readonly string[] {
  return evosByCharacter.get(characterId) ?? [];
}
