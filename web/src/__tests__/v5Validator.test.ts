import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePlayability, type IssueCode } from "../maker/validator";
import type { Chart, ChartNote } from "../types/chart";

const codes = (notes: ChartNote[], ctx: Partial<Parameters<typeof validatePlayability>[1]> = {}) =>
  validatePlayability(notes, { difficulty: "hard", platformProfile: "mobile", durationSec: 60, ...ctx }).issues.map((issue) => `${issue.severity}:${issue.code}`);
const has = (list: string[], severity: "ERROR" | "WARNING", code: IssueCode) => list.includes(`${severity}:${code}`);

describe("Playability Validator", () => {
  it("accepts a clean chart", () => {
    const result = validatePlayability([
      { time: 1, lane: 0, type: "tap" }, { time: 1.5, lane: 1, type: "hold", duration: 0.5 }, { time: 2.5, lane: 1, type: "flick" },
    ], { difficulty: "hard", platformProfile: "mobile", durationSec: 60 });
    expect(result).toMatchObject({ ok: true, errors: 0 });
  });

  it("flags duplicate and overlapping same-lane notes", () => {
    expect(has(codes([{ time: 1, lane: 0, type: "tap" }, { time: 1, lane: 0, type: "tap" }]), "ERROR", "DUPLICATE")).toBe(true);
    expect(has(codes([{ time: 1, lane: 0, type: "tap" }, { time: 1.03, lane: 0, type: "tap" }]), "ERROR", "OVERLAP")).toBe(true);
    expect(has(codes([{ time: 1, lane: 0, type: "tap" }, { time: 1.1, lane: 0, type: "tap" }]), "WARNING", "SAME_LANE_TOO_CLOSE")).toBe(true);
    // Different lanes at the same time is a chord, not an overlap.
    expect(codes([{ time: 1, lane: 0, type: "tap" }, { time: 1, lane: 2, type: "tap" }])).toEqual([]);
  });

  it("flags notes inside or right after a Hold on the same lane", () => {
    const hold: ChartNote = { time: 1, lane: 2, type: "hold", duration: 1 };
    expect(has(codes([hold, { time: 1.5, lane: 2, type: "tap" }]), "ERROR", "HOLD_BLOCKED")).toBe(true);
    expect(has(codes([hold, { time: 1.6, lane: 2, type: "hold", duration: 0.5 }]), "ERROR", "HOLD_OVERLAP")).toBe(true);
    expect(has(codes([hold, { time: 2.02, lane: 2, type: "tap" }]), "ERROR", "HOLD_BLOCKED")).toBe(true);
    expect(codes([hold, { time: 1.5, lane: 0, type: "tap" }])).toEqual([]);
  });

  it("flags invalid lane, time and Hold values", () => {
    expect(has(codes([{ time: 1, lane: 4 as ChartNote["lane"], type: "tap" }]), "ERROR", "INVALID_LANE")).toBe(true);
    expect(has(codes([{ time: Number.NaN, lane: 0, type: "tap" }]), "ERROR", "INVALID_TIME")).toBe(true);
    expect(has(codes([{ time: -0.2, lane: 0, type: "tap" }]), "ERROR", "NEGATIVE_TIME")).toBe(true);
    expect(has(codes([{ time: 61, lane: 0, type: "tap" }]), "ERROR", "AFTER_SONG_END")).toBe(true);
    expect(has(codes([{ time: 59, lane: 0, type: "hold", duration: 3 }]), "ERROR", "HOLD_PAST_END")).toBe(true);
    expect(has(codes([{ time: 1, lane: 0, type: "hold", duration: 0 }]), "ERROR", "INVALID_HOLD")).toBe(true);
    expect(has(codes([{ time: 1, lane: 0, type: "hold", duration: -1 }]), "ERROR", "INVALID_HOLD")).toBe(true);
    expect(has(codes([{ time: 1, lane: 0, type: "hold", duration: 0.07 }]), "WARNING", "SHORT_HOLD")).toBe(true);
    expect(has(codes([]), "ERROR", "EMPTY")).toBe(true);
    // Unknown song length skips end checks instead of guessing.
    expect(codes([{ time: 500, lane: 0, type: "tap" }], { durationSec: 0 })).toEqual([]);
  });

  it("forbids Flick on desktop charts only", () => {
    const flick: ChartNote[] = [{ time: 1, lane: 0, type: "flick" }];
    expect(has(codes(flick, { platformProfile: "desktop" }), "ERROR", "DESKTOP_FLICK")).toBe(true);
    expect(codes(flick, { platformProfile: "mobile" })).toEqual([]);
    expect(codes(flick, { platformProfile: undefined })).toEqual([]);
  });

  it("flags 3-key chords as warnings and 4-key chords as errors", () => {
    const chord = (lanes: number[]) => lanes.map((lane) => ({ time: 1, lane, type: "tap" }) as ChartNote);
    expect(has(codes(chord([0, 1, 2])), "WARNING", "CHORD_THREE")).toBe(true);
    expect(has(codes(chord([0, 1, 2, 3])), "ERROR", "CHORD_FOUR")).toBe(true);
  });

  it("flags excessive density", () => {
    const dense = Array.from({ length: 30 }, (_, i) => ({ time: 1 + i * 0.03, lane: (i % 4), type: "tap" }) as ChartNote);
    const result = codes(dense, { difficulty: "extreme" });
    expect(has(result, "ERROR", "DENSITY_EXCESSIVE")).toBe(true);
    const busy = Array.from({ length: 10 }, (_, i) => ({ time: 1 + i * 0.09, lane: (i % 4), type: "tap" }) as ChartNote);
    expect(has(codes(busy, { difficulty: "normal" }), "WARNING", "DENSITY_HIGH")).toBe(true);
    expect(codes(busy, { difficulty: "extreme" }).some((code) => code.includes("DENSITY"))).toBe(false);
  });

  it("finds no ERROR in any shipped Mobile/Desktop x 5 difficulty AI chart", () => {
    const dir = join(__dirname, "fixtures", "v5");
    const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files).toHaveLength(10);
    for (const file of files) {
      const chart = JSON.parse(readFileSync(join(dir, file), "utf8")) as Chart;
      const result = validatePlayability(chart.notes, { difficulty: chart.difficulty, platformProfile: chart.platformProfile, durationSec: 0 });
      expect({ file, errors: result.issues.filter((issue) => issue.severity === "ERROR") }).toEqual({ file, errors: [] });
    }
  });
});
