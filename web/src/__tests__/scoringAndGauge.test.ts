import { describe, expect, it } from "vitest";
import { calculateNoteScore } from "../engine/scoring";
import { applyJudgementToGauge, isFailed } from "../engine/gauge";

describe("scoring", () => {
  it("Miss는 0점, 콤보 보너스와 무관하다", () => {
    expect(calculateNoteScore("Miss", 50)).toBe(0);
  });

  it("콤보가 높을수록 점수 배율이 올라간다", () => {
    const low = calculateNoteScore("Perfect", 0);
    const high = calculateNoteScore("Perfect", 100);
    expect(high).toBeGreaterThan(low);
  });
});

describe("gauge", () => {
  it("Miss는 게이지를 감소시키고 0 밑으로 내려가지 않는다", () => {
    const g = applyJudgementToGauge(3, "Miss");
    expect(g).toBe(0);
  });

  it("Perfect는 게이지를 MAX 이상으로 올리지 않는다", () => {
    const g = applyJudgementToGauge(100, "Perfect");
    expect(g).toBe(100);
  });

  it("failEnabled가 false면 게이지가 0이어도 실패 처리되지 않는다", () => {
    expect(isFailed(0, false)).toBe(false);
    expect(isFailed(0, true)).toBe(true);
  });
});
