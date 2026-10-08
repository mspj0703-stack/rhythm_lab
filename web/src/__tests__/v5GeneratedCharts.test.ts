import { expect, it } from "vitest";
import { parseChart } from "../engine/chartLoader";
import { attemptFlick, attemptHoldRelease, attemptLanePress, createInitialGameState, tick } from "../engine/gameState";
import { computeResult } from "../engine/resultCalculation";
import type { ChartNote } from "../types/chart";

const fixtures = import.meta.glob("./fixtures/v5/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
it("includes all ten v5 generation paths", () => expect(Object.keys(fixtures)).toHaveLength(10));
for (const [path, raw] of Object.entries(fixtures)) {
  it(`${path}: loads and finishes with 100% accuracy in the production engine`, () => {
    const chart = parseChart(raw);
    expect(chart.scoringVersion).toBe(2);
    if (chart.platformProfile === "desktop") expect(chart.notes.filter(note => note.type === "flick")).toHaveLength(0);
    type Event = { time: number; note: ChartNote; release: boolean };
    const events: Event[] = chart.notes.flatMap(note => [
      { time: note.time, note, release: false },
      ...(note.type === "hold" ? [{ time: note.time + note.duration, note, release: true }] : []),
    ]).sort((a, b) => a.time - b.time || Number(b.release) - Number(a.release));
    let state = createInitialGameState(chart, { failEnabled: true });
    for (const event of events) {
      state = tick(state, event.time);
      state = event.release ? attemptHoldRelease(state, event.note.lane, event.time) : event.note.type === "flick"
        ? attemptFlick(state, event.note.lane, event.time) : attemptLanePress(state, event.note.lane, event.time);
    }
    state = tick(state, events[events.length - 1].time + 1);
    expect(state.finished).toBe(true); expect(state.failed).toBe(false);
    expect(state.judgementCounts.Miss).toBe(0);
    expect(state.totalJudged).toBe(chart.notes.length);
    expect(computeResult(state).accuracyPercent).toBe(100);
  });
}
