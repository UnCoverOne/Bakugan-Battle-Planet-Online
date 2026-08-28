import type {
  CharacterCardSlot,
  GameScreenZoneState,
  ZoneOwner,
} from "./gameScreenState";

export type BoardCardFinalizeKind = "hero" | "evo";

export type BoardCardFinalizeTarget = {
  cardId: string;
  owner: ZoneOwner;
  kind: BoardCardFinalizeKind;
  slot?: CharacterCardSlot;
};

type OwnerFinalizeSnapshot = {
  heroIds: readonly string[];
  evoIdsBySlot: readonly (readonly string[])[];
};

export type BoardCardFinalizeSnapshot = Record<ZoneOwner, OwnerFinalizeSnapshot>;

const OWNERS: readonly ZoneOwner[] = ["player", "opponent"];
const CHARACTER_SLOTS: readonly CharacterCardSlot[] = [1, 2, 3];

/**
 * Capture only immutable card-instance identifiers so later match mutations cannot
 * erase the presentation transition we need to detect.
 */
export function captureBoardCardFinalizeSnapshot(
  state: GameScreenZoneState,
): BoardCardFinalizeSnapshot {
  const snapshotFor = (owner: ZoneOwner): OwnerFinalizeSnapshot => ({
    heroIds: state[owner].heroCards.map((card) => card.id),
    evoIdsBySlot: CHARACTER_SLOTS.map((slot) => (
      state[owner].bakugan[slot - 1]?.evoStack.map((card) => card.id) ?? []
    )),
  });

  return {
    player: snapshotFor("player"),
    opponent: snapshotFor("opponent"),
  };
}

/**
 * Find Hero and Evo cards that have just become permanent board objects.
 * The game state is already authoritative when this runs; callers use these
 * transitions only to decorate the newly finalized cards with presentation.
 */
export function boardCardFinalizeTransitions(
  previous: BoardCardFinalizeSnapshot,
  current: GameScreenZoneState,
): readonly BoardCardFinalizeTarget[] {
  const targets: BoardCardFinalizeTarget[] = [];

  for (const owner of OWNERS) {
    const previousHeroes = new Set(previous[owner].heroIds);
    for (const card of current[owner].heroCards) {
      if (previousHeroes.has(card.id)) continue;
      targets.push({ cardId: card.id, owner, kind: "hero" });
    }

    for (const slot of CHARACTER_SLOTS) {
      const bakugan = current[owner].bakugan[slot - 1];
      if (!bakugan) continue;
      const previousEvos = new Set(previous[owner].evoIdsBySlot[slot - 1] ?? []);
      for (const card of bakugan.evoStack) {
        if (previousEvos.has(card.id)) continue;
        targets.push({ cardId: card.id, owner, kind: "evo", slot });
      }
    }
  }

  return targets;
}
