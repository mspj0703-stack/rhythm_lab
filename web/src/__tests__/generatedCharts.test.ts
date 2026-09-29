/**
 * v0.2 자동 생성 채보(analyzer/make_fixtures.py 출력)가
 * v0.1 loader / 게임 상태 엔진에서 그대로 동작하는지 검증한다.
 */
import { describe, expect, it } from "vitest";
import { parseChart } from "../engine/chartLoader";
import { attemptTap, calculateAccuracyPercent, createInitialGameState, tick } from "../engine/gameState";
import type { Lane } from "../types/chart";

const fixtures = import.meta.glob("./fixtures/generated/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(fixtures);

describe("v0.2 생성 채보 호환성", () => {
  it("픽스처가 16개(4 샘플 x 4 난이도) 존재한다", () => {
    expect(entries.length).toBe(16);
  });

  for (const [path, raw] of entries) {
    const name = path.split("/").pop();

    it(`${name}: v0.1 parseChart로 로드된다`, () => {
      const chart = parseChart(raw);
      expect(chart.notes.length).toBeGreaterThan(0);
      expect(["Easy", "Normal", "Hard", "Expert"]).toContain(chart.difficulty);
    });

    it(`${name}: 시간 오름차순, 레인 0~3, 같은 레인+시각 중복 없음`, () => {
      const chart = parseChart(raw);
      const seen = new Set<string>();
      for (let i = 0; i < chart.notes.length; i++) {
        const n = chart.notes[i];
        if (i > 0) expect(n.time).toBeGreaterThanOrEqual(chart.notes[i - 1].time);
        expect([0, 1, 2, 3]).toContain(n.lane);
        const key = `${n.time}:${n.lane}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    it(`${name}: 게임 엔진에서 완벽하게 끝까지 플레이 가능 (전부 Perfect, finished)`, () => {
      const chart = parseChart(raw);
      let state = createInitialGameState(chart, { failEnabled: true });
      for (const n of chart.notes) {
        state = tick(state, n.time);
        state = attemptTap(state, n.lane as Lane, n.time);
      }
      const last = chart.notes[chart.notes.length - 1].time;
      state = tick(state, last + 1);
      expect(state.finished).toBe(true);
      expect(state.failed).toBe(false);
      expect(state.judgementCounts.Perfect).toBe(chart.notes.length);
      expect(state.judgementCounts.Miss).toBe(0);
      expect(state.maxCombo).toBe(chart.notes.length);
      expect(calculateAccuracyPercent(state)).toBe(100);
    });
  }
});
