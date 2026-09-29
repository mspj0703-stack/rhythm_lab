import { describe, expect, it } from "vitest";
import { attemptTap, attemptLanePress, attemptHoldStart, attemptHoldRelease, attemptFlick, createInitialGameState, tick } from "../engine/gameState";
import { projection, laneGeometry, JUDGE_LINE_Y, TOP_WIDTH_RATIO, BOTTOM_WIDTH_RATIO } from "../engine/highway";
import { getNoteFallTimeSec } from "../settings/noteSpeed";
import type { Chart, ChartNote } from "../types/chart";

function state(note: ChartNote) {
  return createInitialGameState({ title: "test", artist: "test", bpm: 120, difficulty: "hard", level: 5, notes: [note] } as Chart, { failEnabled: false });
}

describe("v3 timing boundaries in actual seconds", () => {
  for (const time of [1, 10, 479]) for (const sign of [-1, 1]) {
    for (const [ms, label] of [[35, "Perfect"], [75, "Great"], [120, "Good"]] as const) {
      it(`${time}s / ${sign * ms}ms applies to Tap, Hold and Flick`, () => {
        const t = time + sign * ms / 1000;
        expect(attemptTap(state({ time, lane: 0, type: "tap" }), 0, t).notes[0].judgement).toBe(label);
        expect(attemptHoldStart(state({ time, lane: 0, type: "hold", duration: 1 }), 0, t).notes[0].judgement).toBe(label);
        expect(attemptFlick(state({ time, lane: 0, type: "flick" }), 0, t).notes[0].judgement).toBe(label);
      });
    }
  }
  it("pending expires only beyond 120ms", () => {
    const s = state({ time: 1, lane: 0, type: "tap" });
    expect(tick(s, 1.120).notes[0].status).toBe("pending");
    expect(tick(s, 1.12001).notes[0].status).toBe("missed");
  });
  it("hold release accepts 120ms and regrab accepts 100ms even after a frame at the boundary", () => {
    const s = attemptHoldStart(state({ time: 1, lane: 0, type: "hold", duration: 2 }), 0, 1);
    expect(attemptHoldRelease(s, 0, 2.880).notes[0].status).toBe("hit");
    const released = attemptHoldRelease(s, 0, 1.5);
    expect(attemptHoldStart(tick(released, 1.6), 0, 1.6).notes[0].holdReleasedAt).toBeUndefined();
    expect(tick(released, 1.60001).notes[0].status).toBe("hold_broken");
  });
});

describe("perspective visibility and lane containment", () => {
  for (const speed of [1, 8, 12, 20]) {
    it(`Speed ${speed}: horizon 1.6x, judge line, smooth forward movement`, () => {
      const base = getNoteFallTimeSec(speed);
      expect(projection(base * 1.61, 0, JUDGE_LINE_Y, speed).p).toBeLessThan(0);
      expect(projection(base * 1.6, 0, JUDGE_LINE_Y, speed).y).toBeCloseTo(0);
      expect(projection(0, 0, JUDGE_LINE_Y, speed).y).toBe(JUDGE_LINE_Y);
      const nearSpeed = (JUDGE_LINE_Y - projection(0.00001, 0, JUDGE_LINE_Y, speed).y) / 0.00001;
      expect(nearSpeed / (JUDGE_LINE_Y / base)).toBeCloseTo(1.62 / 1.6, 3);
      for (const fraction of [0.1, 0.4, 0.8, 1]) {
        const a = projection(base * fraction, 0, JUDGE_LINE_Y, speed);
        const b = projection(base * fraction, 0.01, JUDGE_LINE_Y, speed);
        expect(b.y).toBeGreaterThan(a.y);
        const expectedWidth = 640 * (TOP_WIDTH_RATIO + (BOTTOM_WIDTH_RATIO - TOP_WIDTH_RATIO) * a.y / JUDGE_LINE_Y);
        expect(laneGeometry(0, 4, 640, a.scale).laneW * 4).toBeCloseTo(expectedWidth);
      }
    });
  }
});


describe("one press / one closest note", () => {
  it("nearby Tap and Hold do not both consume a single lane press", () => {
    const s = state({ time: 1, lane: 0, type: "tap" });
    const chart = { ...s.chart, notes: [...s.chart.notes, { time: 1.18, lane: 0, type: "hold", duration: 1 } as ChartNote] };
    const next = attemptLanePress(createInitialGameState(chart, s.options), 0, 1.10);
    expect(next.notes[0].status).toBe("pending");
    expect(next.notes[1].status).toBe("holding");
  });
  it("Flick preparation does not consume a nearby Tap", () => {
    const s = state({ time: 1, lane: 0, type: "flick" });
    const chart = { ...s.chart, notes: [...s.chart.notes, { time: 1.10, lane: 0, type: "tap" } as ChartNote] };
    const initial = createInitialGameState(chart, s.options);
    expect(attemptLanePress(initial, 0, 1)).toBe(initial);
    expect(attemptFlick(initial, 0, 1).notes[0].status).toBe("hit");
  });
});
