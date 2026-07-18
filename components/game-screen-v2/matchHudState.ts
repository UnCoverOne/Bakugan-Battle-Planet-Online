import {
  cardChoiceSpec,
  type CardChoices,
  type GameCard,
  type MatchState,
  type PlayerState,
} from "../../lib/game";
import {
  playerCanDrawTurnCard,
} from "../../lib/turnStart";

export type HandActionMode = "play" | "energize" | null;
export type MatchHudActionKey =
  | "draw-card"
  | "play-card"
  | "energize-card"
  | "skip-energize"
  | "pass-turn"
  | "select";

export const PRIORITY_WINDOW_PHASES = [
  "preRoll",
  "power",
  "victor",
  "postDamage",
  "endPlay",
] as const;

export type HudPlayerPair = {
  player: PlayerState | null;
  opponent: PlayerState | null;
};

export type MatchHudActions = Record<MatchHudActionKey, boolean>;
export type CompactMatchHudSlots = readonly [
  MatchHudActionKey | null,
  MatchHudActionKey | null,
];

export function resolveHudPlayers(
  match: MatchState | null | undefined,
  playerId?: string,
): HudPlayerPair {
  if (!match?.players.length) return { player: null, opponent: null };
  const player = match.players.find((candidate) => candidate.id === playerId)
    ?? match.players[0]
    ?? null;
  const opponent = match.players.find((candidate) => candidate.id !== player?.id)
    ?? null;
  return { player, opponent };
}

export function matchRoundTarget(match: Pick<MatchState, "format"> | null | undefined) {
  return match?.format === "bo3" ? 2 : 1;
}

export function isPriorityWindow(match: Pick<MatchState, "phase"> | null | undefined) {
  return Boolean(match && PRIORITY_WINDOW_PHASES.includes(
    match.phase as (typeof PRIORITY_WINDOW_PHASES)[number],
  ));
}

export function cardIsAffordable(card: GameCard, player: PlayerState) {
  return card.cost === "X" || card.cost <= player.energy;
}

export function playableHandCards(
  match: MatchState | null | undefined,
  playerId?: string,
): readonly GameCard[] {
  const { player } = resolveHudPlayers(match, playerId);
  if (!match || !player || !isPriorityWindow(match) || match.priority !== player.id) return [];
  return player.hand.filter((card) => (
    card.type !== "Flip"
    && card.type !== "Character"
    && cardIsAffordable(card, player)
  ));
}

export function canEnergizeCard(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const { player } = resolveHudPlayers(match, playerId);
  return Boolean(
    match
    && player
    && match.phase === "energize"
    && !player.energizedThisTurn
    && player.hand.length,
  );
}

export function canSkipEnergizing(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const { player } = resolveHudPlayers(match, playerId);
  return Boolean(
    match
    && player
    && match.phase === "energize"
    && !player.energizedThisTurn,
  );
}

export function handCardIsActionable(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  card: GameCard,
  mode: HandActionMode,
) {
  const { player } = resolveHudPlayers(match, playerId);
  if (!match || !player || !mode) return false;
  if (mode === "energize") return canEnergizeCard(match, player.id);
  return playableHandCards(match, player.id).some((candidate) => candidate.id === card.id);
}

export function cardRequiresSelection(
  match: MatchState | null | undefined,
  playerId: string | undefined,
  cardId: string,
) {
  const { player } = resolveHudPlayers(match, playerId);
  const card = player?.hand.find((candidate) => candidate.id === cardId);
  return Boolean(match && player && card && cardChoiceSpec(match, player.id, card).length);
}

export function visibleMatchHudActions({
  match,
  playerId,
  mode,
  selectedCardId,
  selectionPending,
  now = Date.now(),
}: {
  match: MatchState | null | undefined;
  playerId?: string;
  mode: HandActionMode;
  selectedCardId: string;
  selectionPending: boolean;
  now?: number;
}): MatchHudActions {
  const { player } = resolveHudPlayers(match, playerId);
  const playCards = playableHandCards(match, player?.id);
  const canPlay = Boolean(playCards.length);
  const canPass = Boolean(match && player && isPriorityWindow(match) && match.priority === player.id);
  const selectedPlayable = playCards.some((card) => card.id === selectedCardId);
  return {
    "draw-card": playerCanDrawTurnCard(match, player?.id, now),
    "play-card": canPlay,
    "energize-card": canEnergizeCard(match, player?.id),
    "skip-energize": canSkipEnergizing(match, player?.id),
    "pass-turn": canPass,
    select: Boolean(
      selectionPending
      && mode === "play"
      && selectedPlayable
      && cardRequiresSelection(match, player?.id, selectedCardId),
    ),
  };
}

/**
 * The compact Action HUD owns two permanent positions. Draw, Select,
 * Energize, and Play Card reuse the primary position. Pass remains in the
 * second position whenever it is legal; Skip Energizing may use that frame
 * only during the non-priority Energize Step.
 */
export function compactMatchHudSlots(actions: MatchHudActions): CompactMatchHudSlots {
  const primary: MatchHudActionKey | null = actions.select
    ? "select"
    : actions["draw-card"]
      ? "draw-card"
      : actions["energize-card"]
        ? "energize-card"
        : actions["play-card"]
          ? "play-card"
          : null;
  const secondary: MatchHudActionKey | null = actions["pass-turn"]
    ? "pass-turn"
    : actions["skip-energize"]
      ? "skip-energize"
      : null;
  return [primary, secondary];
}

export function shouldAutomaticallyPass(
  match: MatchState | null | undefined,
  playerId?: string,
) {
  const actions = visibleMatchHudActions({
    match,
    playerId,
    mode: null,
    selectedCardId: "",
    selectionPending: false,
  });
  return actions["pass-turn"] && !actions["play-card"];
}

function activeBakuganId(match: MatchState, player: PlayerState) {
  return match.selected[player.id]
    ?? player.bakugan.find((bakugan) => bakugan.open)?.id
    ?? player.bakugan[0]?.id;
}

export function defaultCardChoices(
  match: MatchState,
  playerId: string,
  card: GameCard,
): CardChoices {
  const { player, opponent } = resolveHudPlayers(match, playerId);
  if (!player || !opponent) return {};
  const specs = new Set(cardChoiceSpec(match, player.id, card));
  const lower = card.effect.toLowerCase();
  const enemyTarget = /enemy|opposing|non-\[[a-z]+\]/i.test(lower);
  const targetOwner = enemyTarget ? opponent : player;
  const choices: CardChoices = {};

  if (specs.has("targetBakugan")) {
    choices.targetBakuganId = activeBakuganId(match, targetOwner);
  }
  if (specs.has("targetPlayer")) {
    choices.targetPlayerId = /choose yourself|you may choose yourself/i.test(lower)
      ? player.id
      : opponent.id;
  }
  if (specs.has("targetHero")) {
    choices.targetHeroId = opponent.heroes[0]?.id ?? player.heroes[0]?.id;
  }
  if (specs.has("targetEvo")) {
    choices.targetEvoId = opponent.bakugan.flatMap((bakugan) => bakugan.evoStack)[0]?.id
      ?? player.bakugan.flatMap((bakugan) => bakugan.evoStack)[0]?.id;
  }
  if (specs.has("targetEnergy")) {
    choices.targetEnergyId = opponent.energyZone[0]?.id ?? player.energyZone[0]?.id;
  }
  if (specs.has("core")) {
    const targetBakugan = [...player.bakugan, ...opponent.bakugan]
      .find((bakugan) => bakugan.id === choices.targetBakuganId);
    choices.coreCell = /remove an enemy bakugan's bakucore/i.test(lower)
      ? targetBakugan?.heldCoreCells[0]
      : match.placements.find((placement) => !placement.attachedTo)?.cell;
  }
  if (specs.has("discard")) {
    const amount = /discard two/i.test(lower) ? 2 : 1;
    choices.discardCardIds = player.hand
      .filter((candidate) => candidate.id !== card.id)
      .slice(0, amount)
      .map((candidate) => candidate.id);
  }
  if (specs.has("multiHand")) {
    choices.handCardIds = player.hand
      .filter((candidate) => candidate.id !== card.id)
      .slice(0, 1)
      .map((candidate) => candidate.id);
  }
  if (specs.has("xValue")) choices.xValue = Math.min(player.energy, 1);
  if (specs.has("mode")) choices.mode = /damage/i.test(lower) ? "damage" : "power";

  return choices;
}
