import { describe, expect, it } from "vitest";
import { attemptHoldRelease, attemptHoldStart, createInitialGameState, restartGame, tick } from "../engine/gameState";
import { computeResult } from "../engine/resultCalculation";
import type { Chart } from "../types/chart";

function start(duration = 1, scoringVersion: 1 | 2 = 2) {
  const chart: Chart = { title: "Hold", artist: "", bpm: 120, offset: 0, difficulty: "Extreme", level: 18,
    scoringVersion, platformProfile: "desktop", notes: [{ type: "hold", lane: 0, time: 1, duration }] };
  return attemptHoldStart(createInitialGameState(chart, { failEnabled: false }), 0, 1);
}

describe("v5 Hold ticks", () => {
  it("awards ticks while held without changing combo, gauge, judgement or accuracy", () => {
    const state = tick(start(), 1.5);
    expect(state.score).toBe(30); expect(state.holdTicksEarned).toBe(2);
    expect(state.totalJudged).toBe(0); expect(state.combo).toBe(0);
    expect(state.gauge).toBe(start().gauge);
    const done = tick(state, 2);
    expect(done.score).toBe(145); expect(done.combo).toBe(1);
    expect(done.judgementCounts.Perfect).toBe(1);
    expect(computeResult(done)).toMatchObject({ scoringVersion: 2, chartProfile: "desktop", accuracyPercent: 100, holdTicksEarned: 3 });
  });
  it("preserves legacy scores and short Holds", () => {
    expect(tick(start(1, 1), 2).score).toBe(100);
    expect(tick(start(0.29), 1.29).score).toBe(100);
    expect(tick(start(0.29), 1.29).holdTicksEarned).toBe(0);
  });
  it("is frame-rate independent, idempotent and bounded even for very long Holds", () => {
    let fine = start(8);
    for (let t = 1; t <= 9.001; t += 0.01) fine = tick(fine, t);
    fine = tick(fine, 9.01);
    const coarse = tick(start(8), 9);
    expect(fine.score).toBeCloseTo(coarse.score, 8);
    expect(coarse.holdTickScore).toBeCloseTo(50);
    expect(tick(coarse, 10).score).toBe(coarse.score);
    expect(tick(start(100), 101).holdTickScore).toBeCloseTo(50);
  });
  it("grants tolerated early release, without advancing other Holds into the future", () => {
    let state = start();
    state = { ...state, chart: { ...state.chart, notes: [...state.chart.notes, { type: "hold", lane: 3, time: 1, duration: 2 }] },
      notes: [...state.notes, { index: 1, note: { type: "hold", lane: 3, time: 1, duration: 2 }, status: "holding", judgement: "Perfect", holdStartedAt: 1 }] };
    state = attemptHoldRelease(state, 0, 1.9);
    expect(state.notes[0].status).toBe("hit");
    expect(state.notes[1].holdTicksProcessed).toBe(3);
    expect(state.judgementCounts.Miss).toBe(0);
  });
  it("skips released ticks even after a successful regrab", () => {
    let state = attemptHoldRelease(start(), 0, 1.48);
    state = tick(state, 1.52);
    expect(state.holdTicksEarned).toBe(1);
    state = attemptHoldStart(state, 0, 1.56);
    state = tick(state, 2);
    expect(state.holdTicksEarned).toBe(2);
    expect(state.score).toBe(130); expect(state.judgementCounts.Miss).toBe(0);
  });
  it("stops ticks after a broken Hold, failed state and restart", () => {
    let state = attemptHoldRelease(start(), 0, 1.3);
    state = tick(state, 1.5);
    expect(state.notes[0].status).toBe("hold_broken");
    expect(state.judgementCounts.Miss).toBe(1);
    expect(tick(state, 2).holdTicksEarned).toBe(1);
    expect(tick({ ...start(), failed: true }, 2).holdTickScore).toBe(0);
    const reset = restartGame(state);
    expect(reset.score).toBe(0); expect(reset.holdTicksEarned).toBe(0);
    expect(reset.notes[0].holdTicksProcessed).toBeUndefined();
  });
});
