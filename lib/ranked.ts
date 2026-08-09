import type { DeckRestriction } from "./deck-validation";

export const RANKED_STARTING_BP = 1_000;
export const RANKED_ELO_K = 24;

export type BrawlerRank = "Bronze" | "Silver" | "Gold" | "Diamond" | "Awesome Brawler";

export type RankedRuleset = {
  version: number;
  restrictions: DeckRestriction[];
  publishedAt: number;
  publishedBy?: string;
};

export type RankedSettlement = {
  seriesId: string;
  winnerUserId: string;
  loserUserId: string;
  winnerBefore: number;
  loserBefore: number;
  transfer: number;
  winnerAfter: number;
  loserAfter: number;
  settledAt: number;
};

export function rankForBp(bp: number): BrawlerRank {
  if (bp >= 1_600) return "Awesome Brawler";
  if (bp >= 1_400) return "Diamond";
  if (bp >= 1_200) return "Gold";
  if (bp >= 1_000) return "Silver";
  return "Bronze";
}

export function rankProgress(bp: number) {
  const floor = bp >= 1_600 ? 1_600 : bp >= 1_400 ? 1_400 : bp >= 1_200 ? 1_200 : bp >= 1_000 ? 1_000 : 800;
  return {
    rank: rankForBp(bp),
    current: Math.max(0, bp - floor),
    interval: 200,
    nextRankAt: bp >= 1_600 ? null : floor + 200,
  };
}

export function expectedScore(rating: number, opponentRating: number) {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

/** Calculates one integer BP transfer, then applies that exact value to both players. */
export function eloTransfer(winnerRating: number, loserRating: number, k = RANKED_ELO_K) {
  const transfer = Math.max(1, Math.round(k * (1 - expectedScore(winnerRating, loserRating))));
  return {
    transfer,
    winnerAfter: winnerRating + transfer,
    loserAfter: loserRating - transfer,
  };
}

