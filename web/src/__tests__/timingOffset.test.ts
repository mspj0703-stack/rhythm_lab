import { describe, expect, it } from "vitest";
import {
  applyTimingOffsetSec,
  DEFAULT_TIMING_OFFSET_MS,
  estimateTimingOffsetMs,
  loadTimingOffsetMs,
  normalizeTimingOffsetMs,
  saveTimingOffsetMs,
  TIMING_OFFSET_STORAGE_KEY,
} from "../settings/timingOffset";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe("Timing Offset v1", () => {
  it("기본값은 0ms이고 -300~+300ms 범위를 1ms 단위로 강제한다", () => {
    expect(DEFAULT_TIMING_OFFSET_MS).toBe(0);
    expect(normalizeTimingOffsetMs(-999)).toBe(-300);
    expect(normalizeTimingOffsetMs(999)).toBe(300);
    expect(normalizeTimingOffsetMs(12.6)).toBe(13);
  });

  it("+offset은 채보/판정 시계를 그만큼 늦춘다", () => {
    expect(applyTimingOffsetSec(1.08, 80)).toBeCloseTo(1.0, 8);
    expect(applyTimingOffsetSec(0.94, -60)).toBeCloseTo(1.0, 8);
  });

  it("기기별 localStorage 값으로 저장/복원한다", () => {
    const storage = new MemoryStorage();
    saveTimingOffsetMs(47.7, storage);
    expect(storage.getItem(TIMING_OFFSET_STORAGE_KEY)).toBe("48");
    expect(loadTimingOffsetMs(storage)).toBe(48);
  });

  it("보정은 첫 3개 샘플을 버리고 중앙값으로 추천값을 만든다", () => {
    const estimate = estimateTimingOffsetMs([
      -180, 240, 130, // 적응 구간 -> 폐기
      42, 39, 44, 41, 43, 40, 42, 41, 45, 39, 42, 40, 43,
    ]);
    expect(estimate.discardedCount).toBe(3);
    expect(estimate.sampleCount).toBe(13);
    expect(estimate.offsetMs).toBe(42);
    expect(estimate.unstable).toBe(false);
  });

  it("편차가 큰 보정 샘플은 unstable로 표시한다", () => {
    const estimate = estimateTimingOffsetMs([
      0, 0, 0,
      -110, 120, -80, 140, -95, 105, -130, 90, 125, -100,
    ]);
    expect(estimate.unstable).toBe(true);
    expect(estimate.stddevMs).toBeGreaterThan(45);
  });
});
