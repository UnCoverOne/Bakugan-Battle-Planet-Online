import {
  BAKUGAN,
  CARD_BY_ID,
  CORES,
  deckIsLegal,
  type DeckRecord,
} from "./data";
import type { CoreType, Faction } from "./game";

export const ACHIEVEMENT_FACTIONS = [
  "Pyrus",
  "Aquos",
  "Darkus",
  "Haos",
  "Ventus",
  "Aurelus",
] as const satisfies readonly Faction[];

export const MONO_MASTERY_FACTIONS = [
  "Pyrus",
  "Aquos",
  "Ventus",
  "Haos",
  "Darkus",
] as const;

export type MonoMasteryFaction = (typeof MONO_MASTERY_FACTIONS)[number];
export type MatchEvidenceBucket = {
  training: string[];
  nonTraining: string[];
};
export type MonoFactionEvidence = Record<MonoMasteryFaction, MatchEvidenceBucket>;

export type AchievementProgress = {
  standardDeckIds: string[];
  standardDeckSignatures: string[];
  singletonDeckIds: string[];
  singletonDeckSignatures: string[];
  competitiveDeckIds: string[];
  competitiveDeckSignatures: string[];
  publishedDeckIds: string[];
  publishedDeckSignatures: string[];
  characterCardIds: string[];
  coreTypes: CoreType[];
  discoveredMainCardIds: string[];
  processedMatchIds: string[];
  arenaWinIds: MatchEvidenceBucket;
  bo1WinIds: MatchEvidenceBucket;
  bo3WinIds: MatchEvidenceBucket;
  rankedWinIds: string[];
  onlineOpponentKeys: string[];
  winningFactions: {
    training: Faction[];
    nonTraining: Faction[];
  };
  monoFactionWinIds: MonoFactionEvidence;
};

const emptyBucket = (): MatchEvidenceBucket => ({ training: [], nonTraining: [] });
const emptyMonoEvidence = (): MonoFactionEvidence => ({
  Pyrus: emptyBucket(),
  Aquos: emptyBucket(),
  Ventus: emptyBucket(),
  Haos: emptyBucket(),
  Darkus: emptyBucket(),
});

export const EMPTY_ACHIEVEMENT_PROGRESS: AchievementProgress = {
  standardDeckIds: [],
  standardDeckSignatures: [],
  singletonDeckIds: [],
  singletonDeckSignatures: [],
  competitiveDeckIds: [],
  competitiveDeckSignatures: [],
  publishedDeckIds: [],
  publishedDeckSignatures: [],
  characterCardIds: [],
  coreTypes: [],
  discoveredMainCardIds: [],
  processedMatchIds: [],
  arenaWinIds: emptyBucket(),
  bo1WinIds: emptyBucket(),
  bo3WinIds: emptyBucket(),
  rankedWinIds: [],
  onlineOpponentKeys: [],
  winningFactions: { training: [], nonTraining: [] },
  monoFactionWinIds: emptyMonoEvidence(),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizedStrings = (value: unknown, limit = 500, maxLength = 240) => {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, maxLength))
        .filter(Boolean),
    ),
  ].slice(0, limit);
};

const normalizedFactionList = (value: unknown) => {
  const allowed = new Set<string>(ACHIEVEMENT_FACTIONS);
  return normalizedStrings(value, ACHIEVEMENT_FACTIONS.length, 20)
    .filter((item): item is Faction => allowed.has(item));
};

const normalizedCoreTypes = (value: unknown) => {
  const allowed = new Set(CORES.map((core) => core.type));
  return normalizedStrings(value, 5, 30)
    .filter((item): item is CoreType => allowed.has(item as CoreType));
};

const normalizeBucket = (value: unknown): MatchEvidenceBucket => {
  const input = isRecord(value) ? value : {};
  return {
    training: normalizedStrings(input.training, 200, 180),
    nonTraining: normalizedStrings(input.nonTraining, 200, 180),
  };
};

const normalizeMonoEvidence = (value: unknown): MonoFactionEvidence => {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries(
    MONO_MASTERY_FACTIONS.map((faction) => [faction, normalizeBucket(input[faction])]),
  ) as MonoFactionEvidence;
};

export function normalizeAchievementProgress(value: unknown): AchievementProgress {
  const input = isRecord(value) ? value : {};
  const winning = isRecord(input.winningFactions) ? input.winningFactions : {};
  return {
    standardDeckIds: normalizedStrings(input.standardDeckIds, 100, 120),
    standardDeckSignatures: normalizedStrings(input.standardDeckSignatures, 100, 520),
    singletonDeckIds: normalizedStrings(input.singletonDeckIds, 100, 120),
    singletonDeckSignatures: normalizedStrings(input.singletonDeckSignatures, 100, 520),
    competitiveDeckIds: normalizedStrings(input.competitiveDeckIds, 100, 120),
    competitiveDeckSignatures: normalizedStrings(input.competitiveDeckSignatures, 100, 520),
    publishedDeckIds: normalizedStrings(input.publishedDeckIds, 100, 120),
    publishedDeckSignatures: normalizedStrings(input.publishedDeckSignatures, 100, 520),
    characterCardIds: normalizedStrings(input.characterCardIds, 300, 120),
    coreTypes: normalizedCoreTypes(input.coreTypes),
    discoveredMainCardIds: normalizedStrings(input.discoveredMainCardIds, 1_500, 120),
    processedMatchIds: normalizedStrings(input.processedMatchIds, 1_000, 180),
    arenaWinIds: normalizeBucket(input.arenaWinIds),
    bo1WinIds: normalizeBucket(input.bo1WinIds),
    bo3WinIds: normalizeBucket(input.bo3WinIds),
    rankedWinIds: normalizedStrings(input.rankedWinIds, 200, 180),
    onlineOpponentKeys: normalizedStrings(input.onlineOpponentKeys, 500, 180),
    winningFactions: {
      training: normalizedFactionList(winning.training),
      nonTraining: normalizedFactionList(winning.nonTraining),
    },
    monoFactionWinIds: normalizeMonoEvidence(input.monoFactionWinIds),
  };
}

const mergeStrings = (values: string[][], limit: number) =>
  [...new Set(values.flat())].slice(0, limit);

const mergeBucket = (values: MatchEvidenceBucket[], limit = 200): MatchEvidenceBucket => ({
  training: mergeStrings(values.map((item) => item.training), limit),
  nonTraining: mergeStrings(values.map((item) => item.nonTraining), limit),
});

export function mergeAchievementProgress(
  ...values: Array<AchievementProgress | null | undefined>
): AchievementProgress {
  const items = values.map(normalizeAchievementProgress);
  const monoFactionWinIds = Object.fromEntries(
    MONO_MASTERY_FACTIONS.map((faction) => [
      faction,
      mergeBucket(items.map((item) => item.monoFactionWinIds[faction]), 10),
    ]),
  ) as MonoFactionEvidence;
  return normalizeAchievementProgress({
    standardDeckIds: mergeStrings(items.map((item) => item.standardDeckIds), 100),
    standardDeckSignatures: mergeStrings(items.map((item) => item.standardDeckSignatures), 100),
    singletonDeckIds: mergeStrings(items.map((item) => item.singletonDeckIds), 100),
    singletonDeckSignatures: mergeStrings(items.map((item) => item.singletonDeckSignatures), 100),
    competitiveDeckIds: mergeStrings(items.map((item) => item.competitiveDeckIds), 100),
    competitiveDeckSignatures: mergeStrings(items.map((item) => item.competitiveDeckSignatures), 100),
    publishedDeckIds: mergeStrings(items.map((item) => item.publishedDeckIds), 100),
    publishedDeckSignatures: mergeStrings(items.map((item) => item.publishedDeckSignatures), 100),
    characterCardIds: mergeStrings(items.map((item) => item.characterCardIds), 300),
    coreTypes: mergeStrings(items.map((item) => item.coreTypes), 5),
    discoveredMainCardIds: mergeStrings(items.map((item) => item.discoveredMainCardIds), 1_500),
    processedMatchIds: mergeStrings(items.map((item) => item.processedMatchIds), 1_000),
    arenaWinIds: mergeBucket(items.map((item) => item.arenaWinIds)),
    bo1WinIds: mergeBucket(items.map((item) => item.bo1WinIds)),
    bo3WinIds: mergeBucket(items.map((item) => item.bo3WinIds)),
    rankedWinIds: mergeStrings(items.map((item) => item.rankedWinIds), 200),
    onlineOpponentKeys: mergeStrings(items.map((item) => item.onlineOpponentKeys), 500),
    winningFactions: {
      training: mergeStrings(items.map((item) => item.winningFactions.training), 6),
      nonTraining: mergeStrings(items.map((item) => item.winningFactions.nonTraining), 6),
    },
    monoFactionWinIds,
  });
}

export function achievementDeckSignature(deck: DeckRecord) {
  return [
    deck.format ?? "standard",
    [...deck.bakuganIds].sort().join(","),
    [...deck.coreIds].sort().join(","),
    [...deck.cardIds].sort().join(","),
  ].join("|").toLowerCase();
}

const addUnique = (values: string[], value: string, limit: number) => {
  if (!value || values.includes(value)) return values;
  return [...values, value].slice(0, limit);
};

const addMany = (values: string[], additions: readonly string[], limit: number) =>
  [...new Set([...values, ...additions.filter(Boolean)])].slice(0, limit);

export function observeAchievementDecks(
  value: AchievementProgress | null | undefined,
  decks: readonly DeckRecord[],
): AchievementProgress {
  const progress = normalizeAchievementProgress(value);
  for (const deck of decks) {
    if (!deckIsLegal(deck)) continue;
    const format = deck.format ?? "standard";
    const signature = achievementDeckSignature(deck);
    if (format === "standard") {
      progress.standardDeckIds = addUnique(progress.standardDeckIds, deck.id, 100);
      progress.standardDeckSignatures = addUnique(progress.standardDeckSignatures, signature, 100);
      progress.characterCardIds = addMany(progress.characterCardIds, deck.bakuganIds, 300);
      const coreTypes = deck.coreIds.flatMap((id) => {
        const type = CORES.find((core) => core.id === id)?.type;
        return type ? [type] : [];
      });
      progress.coreTypes = addMany(progress.coreTypes, coreTypes, 5) as CoreType[];
      if (deck.visibility === "Public") {
        progress.publishedDeckIds = addUnique(progress.publishedDeckIds, deck.id, 100);
        progress.publishedDeckSignatures = addUnique(progress.publishedDeckSignatures, signature, 100);
      }
    } else if (format === "singleton") {
      progress.singletonDeckIds = addUnique(progress.singletonDeckIds, deck.id, 100);
      progress.singletonDeckSignatures = addUnique(progress.singletonDeckSignatures, signature, 100);
    } else if (format === "competitive") {
      progress.competitiveDeckIds = addUnique(progress.competitiveDeckIds, deck.id, 100);
      progress.competitiveDeckSignatures = addUnique(progress.competitiveDeckSignatures, signature, 100);
    }
  }
  return normalizeAchievementProgress(progress);
}

export type AchievementMatchEvidence = {
  id: string;
  result: string;
  mode?: "training" | "online" | "casual" | "ranked";
  format?: "bo1" | "bo3";
  opponentKey?: string;
};

const deckFactionIdentity = (deck: DeckRecord): Faction[] => {
  const factions = new Set<Faction>();
  for (const id of deck.cardIds) {
    const faction = CARD_BY_ID.get(id)?.faction;
    if (faction) factions.add(faction);
  }
  for (const id of deck.bakuganIds) {
    const faction = BAKUGAN.find((bakugan) => bakugan.id === id)?.faction;
    if (faction) factions.add(faction);
  }
  return [...factions];
};

export function recordAchievementMatch(
  value: AchievementProgress | null | undefined,
  match: AchievementMatchEvidence,
  deck: DeckRecord | null | undefined,
): AchievementProgress {
  const progress = normalizeAchievementProgress(value);
  const id = String(match.id ?? "").trim().slice(0, 180);
  if (!id || progress.processedMatchIds.includes(id)) return progress;

  const training = match.mode === "training";
  const bucket: keyof MatchEvidenceBucket = training ? "training" : "nonTraining";
  const online = match.mode === "online" || match.mode === "casual" || match.mode === "ranked";
  if (online && match.opponentKey) {
    progress.onlineOpponentKeys = addUnique(
      progress.onlineOpponentKeys,
      match.opponentKey.trim().toLowerCase().slice(0, 180),
      500,
    );
  }

  const won = match.result === "Victor";
  if (won) {
    progress.arenaWinIds[bucket] = addUnique(progress.arenaWinIds[bucket], id, 200);
    if ((match.format ?? "bo1") === "bo1") {
      progress.bo1WinIds[bucket] = addUnique(progress.bo1WinIds[bucket], id, 200);
    } else if (match.format === "bo3") {
      progress.bo3WinIds[bucket] = addUnique(progress.bo3WinIds[bucket], id, 200);
    }
    if (match.mode === "ranked") {
      progress.rankedWinIds = addUnique(progress.rankedWinIds, id, 200);
    }
  }

  if (deck && deckIsLegal(deck) && (deck.format ?? "standard") === "standard") {
    progress.discoveredMainCardIds = addMany(progress.discoveredMainCardIds, deck.cardIds, 1_500);
    if (won) {
      const factions = deckFactionIdentity(deck);
      progress.winningFactions[bucket] = addMany(
        progress.winningFactions[bucket],
        factions,
        ACHIEVEMENT_FACTIONS.length,
      ) as Faction[];
      if (factions.length === 1 && MONO_MASTERY_FACTIONS.includes(factions[0] as MonoMasteryFaction)) {
        const faction = factions[0] as MonoMasteryFaction;
        progress.monoFactionWinIds[faction][bucket] = addUnique(
          progress.monoFactionWinIds[faction][bucket],
          id,
          10,
        );
      }
    }
  }

  progress.processedMatchIds = addUnique(progress.processedMatchIds, id, 1_000);
  return normalizeAchievementProgress(progress);
}

export function distinctDeckEvidence(ids: readonly string[], signatures: readonly string[]) {
  return Math.min(new Set(ids).size, new Set(signatures).size);
}
