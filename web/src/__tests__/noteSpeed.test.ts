import { describe, expect, it } from "vitest";
import { computeHoldTailLengthPx, computeNoteY } from "../engine/renderer";
import {
  DEFAULT_NOTE_SPEED,
  getNoteFallTimeSec,
  loadNoteSpeed,
  normalizeNoteSpeed,
  NOTE_SPEED_STORAGE_KEY,
  saveNoteSpeed,
} from "../settings/noteSpeed";

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}

describe("노트 속도 설정", () => {
  it("v2 기본 8.0은 약 1.2초 접근 시간을 사용한다", () => {
    expect(DEFAULT_NOTE_SPEED).toBe(8);
    expect(getNoteFallTimeSec(8)).toBeCloseTo(1.2, 8);
  });

  it("고속 영역은 실제로 빠르며 20.0에서 약 0.35초다", () => {
    expect(getNoteFallTimeSec(12)).toBeCloseTo(0.7, 8);
    expect(getNoteFallTimeSec(15)).toBeCloseTo(0.5, 8);
    expect(getNoteFallTimeSec(20)).toBeCloseTo(0.35, 8);
  });

  it("속도가 높을수록 같은 time-to-hit의 노트가 더 위쪽에 보인다", () => {
    const judgeLineY = 400;
    const slowY = computeNoteY(1, 0.5, judgeLineY, 3);
    const fastY = computeNoteY(1, 0.5, judgeLineY, 9);
    expect(fastY).toBeLessThan(slowY);
  });

  it("속도가 높을수록 같은 duration의 hold 꼬리가 길어진다", () => {
    expect(computeHoldTailLengthPx(1, 400, 9)).toBeGreaterThan(computeHoldTailLengthPx(1, 400, 3));
  });

  it("1.0~20.0 범위와 0.1 단위를 강제한다", () => {
    expect(normalizeNoteSpeed(-2)).toBe(1);
    expect(normalizeNoteSpeed(22)).toBe(20);
    expect(normalizeNoteSpeed(6.26)).toBeCloseTo(6.3, 8);
  });

  it("마지막 속도를 저장하고 다시 불러온다", () => {
    const storage = new MemoryStorage();
    saveNoteSpeed(7.4, storage);
    expect(storage.getItem(NOTE_SPEED_STORAGE_KEY)).toBe("7.4");
    expect(loadNoteSpeed(storage)).toBe(7.4);
  });
});
