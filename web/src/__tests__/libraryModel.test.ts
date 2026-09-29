import { describe, expect, it } from "vitest";
import { buildRecordFeedback, getClearType, makeSongFingerprint, summarizeRecords } from "../library/model";
import type { PlayRecord } from "../library/types";

function result(overrides: Partial<{ perfect: number; great: number; good: number; miss: number; score: number; accuracyPercent: number; maxCombo: number }> = {}) {
  return { perfect: 100, great: 0, good: 0, miss: 0, score: 1_000_000, accuracyPercent: 100, maxCombo: 100, rank: "SSS" as const, ...overrides };
}

describe("v4 library model", () => {
  it("distinguishes clear / full combo / perfect combo", () => {
    expect(getClearType(result({ perfect: 0 }))).toBe("CLEAR");
    expect(getClearType(result())).toBe("PERFECT_COMBO");
    expect(getClearType(result({ great: 1, perfect: 99 }))).toBe("FULL_COMBO");
    expect(getClearType(result({ miss: 1, perfect: 99 }))).toBe("CLEAR");
  });

  it("keeps best values independently", () => {
    const records: PlayRecord[] = [
      { id:"1", songId:"s", chartId:"c", difficulty:"hard", playedAt:1, score:900000, accuracy:99.5, maxCombo:80, perfect:90, great:10, good:0, miss:0, clearType:"FULL_COMBO", practice:false, offsetMs:0 },
      { id:"2", songId:"s", chartId:"c", difficulty:"hard", playedAt:2, score:950000, accuracy:98.0, maxCombo:70, perfect:80, great:15, good:4, miss:1, clearType:"CLEAR", practice:false, offsetMs:0 },
    ];
    expect(summarizeRecords(records)).toMatchObject({ bestScore:950000, bestAccuracy:99.5, bestMaxCombo:80, bestClearType:"FULL_COMBO", playCount:2 });
  });

  it("reports first FC/PC and new best flags", () => {
    expect(buildRecordFeedback(null, result({ great:1, perfect:99 }))).toMatchObject({ clearType:"FULL_COMBO", firstFullCombo:true, firstPerfectCombo:false });
    expect(buildRecordFeedback({ bestScore:999999, bestAccuracy:99.9, bestMaxCombo:100, bestClearType:"FULL_COMBO", playCount:3 }, result())).toMatchObject({ clearType:"PERFECT_COMBO", firstFullCombo:false, firstPerfectCombo:true });
  });

  it("creates stable local fingerprints", () => {
    expect(makeSongFingerprint(" Test  Song ", 180.02, 120.04)).toBe(makeSongFingerprint("test song", 180.01, 120.02));
  });
});
