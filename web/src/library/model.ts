import type { GameResult } from "../engine/resultCalculation";
import type { BestRecord, ClearType, PlayRecord, RecordFeedback } from "./types";

const CLEAR_ORDER: Record<ClearType, number> = {
  CLEAR: 0,
  FULL_COMBO: 1,
  PERFECT_COMBO: 2,
};

export function getClearType(result: Pick<GameResult, "perfect" | "great" | "good" | "miss">): ClearType {
  if (result.perfect > 0 && result.great === 0 && result.good === 0 && result.miss === 0) return "PERFECT_COMBO";
  if (result.miss === 0 && result.perfect + result.great + result.good > 0) return "FULL_COMBO";
  return "CLEAR";
}

export function maxClearType(a: ClearType, b: ClearType): ClearType {
  return CLEAR_ORDER[a] >= CLEAR_ORDER[b] ? a : b;
}

export function summarizeRecords(records: readonly PlayRecord[]): BestRecord | null {
  const normal = records.filter((record) => !record.practice);
  if (normal.length === 0) return null;
  return normal.reduce<BestRecord>((best, record) => ({
    bestScore: Math.max(best.bestScore, record.score),
    bestAccuracy: Math.max(best.bestAccuracy, record.accuracy),
    bestMaxCombo: Math.max(best.bestMaxCombo, record.maxCombo),
    bestClearType: maxClearType(best.bestClearType, record.clearType),
    playCount: best.playCount + 1,
    lastPlayedAt: Math.max(best.lastPlayedAt ?? 0, record.playedAt),
  }), {
    bestScore: 0,
    bestAccuracy: 0,
    bestMaxCombo: 0,
    bestClearType: "CLEAR",
    playCount: 0,
    lastPlayedAt: 0,
  });
}

export function buildRecordFeedback(previous: BestRecord | null, result: GameResult): RecordFeedback {
  const clearType = getClearType(result);
  return {
    clearType,
    newHighScore: previous === null || result.score > previous.bestScore,
    newAccuracyBest: previous === null || result.accuracyPercent > previous.bestAccuracy,
    newComboBest: previous === null || result.maxCombo > previous.bestMaxCombo,
    firstFullCombo: clearType !== "CLEAR" && (previous === null || previous.bestClearType === "CLEAR"),
    firstPerfectCombo: clearType === "PERFECT_COMBO" && (previous === null || previous.bestClearType !== "PERFECT_COMBO"),
  };
}

export function makeSongFingerprint(originalName: string, durationSec: number, bpm: number): string {
  const normalized = originalName.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  return `v1:${normalized}:${Math.round(durationSec * 10)}:${Math.round(bpm * 10)}`;
}

/** Charts saved before `origin` existed are analyzer output; treat a missing origin as the AI original. */
export function isAiOriginal(chart: { origin?: string }): boolean {
  return (chart.origin ?? "AI_GENERATED") === "AI_GENERATED";
}
