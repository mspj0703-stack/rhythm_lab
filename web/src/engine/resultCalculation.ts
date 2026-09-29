import type { GameState } from "./gameState";
import { calculateAccuracyPercent } from "./gameState";

export type ResultRank = "SSS" | "SS" | "S" | "A" | "B" | "C";

export interface GameResult {
  score: number;
  accuracyPercent: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  rank: ResultRank;
}

export function calculateResultRank(accuracyPercent: number): ResultRank {
  if (accuracyPercent >= 99.5) return "SSS";
  if (accuracyPercent >= 98) return "SS";
  if (accuracyPercent >= 95) return "S";
  if (accuracyPercent >= 90) return "A";
  if (accuracyPercent >= 80) return "B";
  return "C";
}

export function computeResult(state: GameState): GameResult {
  const accuracyPercent = Math.round(calculateAccuracyPercent(state) * 100) / 100;
  return {
    score: Math.round(state.score),
    accuracyPercent,
    maxCombo: state.maxCombo,
    perfect: state.judgementCounts.Perfect,
    great: state.judgementCounts.Great,
    good: state.judgementCounts.Good,
    miss: state.judgementCounts.Miss,
    rank: calculateResultRank(accuracyPercent),
  };
}
