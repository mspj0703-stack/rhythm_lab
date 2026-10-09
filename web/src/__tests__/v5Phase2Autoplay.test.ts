/// <reference types="node" />
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { attemptFlick, attemptHoldRelease, attemptLanePress, createInitialGameState, tick } from "../engine/gameState";
import { computeResult } from "../engine/resultCalculation";
import { addNote, deleteNotes, fromChartNotes, moveNotes, toChartNotes } from "../maker/editorModel";
import { validatePlayability } from "../maker/validator";
import { getChart, saveAnalysisToLibrary, saveCommunityChart, saveEditedChart } from "../library/db";
import type { Chart, ChartNote } from "../types/chart";
import type { AnalysisResponse } from "../web/types";

const fixtures = import.meta.glob("./fixtures/v5/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Perfect autoplay through the production engine (same harness as v5GeneratedCharts). */
function autoplay(chart: Chart) {
  type Event = { time: number; note: ChartNote; release: boolean };
  const events: Event[] = chart.notes.flatMap((note) => [
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
  return { state, result: computeResult(state) };
}

/** A realistic Maker session: drop one note, move another by a 1/16, add a Hold in a free gap. */
function makerEdit(chart: Chart): ChartNote[] {
  let state = fromChartNotes(chart.notes);
  const sixteenth = 60 / chart.bpm / 4;
  state = deleteNotes(state, new Set([state.notes[Math.floor(state.notes.length / 2)].id]));
  const candidate = state.notes.find((note, index) => {
    const next = state.notes.slice(index + 1).find((other) => other.lane === note.lane);
    const prev = state.notes.slice(0, index).reverse().find((other) => other.lane === note.lane);
    const prevEnd = prev ? prev.time + (prev.duration ?? 0) : -Infinity;
    return note.type === "tap" && (!next || next.time - note.time > 0.6) && note.time - prevEnd > 0.6;
  });
  if (candidate) state = moveNotes(state, new Set([candidate.id]), sixteenth, 0);
  const end = state.notes.at(-1)!;
  const freeLane = ([0, 1, 2, 3] as const).find((lane) => !state.notes.some((note) => note.lane === lane && note.time > end.time - 1)) ?? 0;
  state = addNote(state, { time: end.time + 1, lane: freeLane, type: "hold", duration: 0.5 }).state;
  return toChartNotes(state);
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob(["m"], { type: "audio/wav" }) })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("covers Mobile/Desktop x 5 difficulties", () => expect(Object.keys(fixtures)).toHaveLength(10));

for (const [path, raw] of Object.entries(fixtures)) {
  it(`${path}: Maker-edited and Community-downloaded copies validate and finish at 100% with Hold ticks and Flick policy`, async () => {
    const chart = JSON.parse(raw) as Chart;
    const ai = (await saveAnalysisToLibrary({ id: "f".repeat(32), originalName: "f.wav", mediaUrl: "/api/media/f", mediaKind: "audio", chart,
      report: { duration: 600, bpm: chart.bpm, generatorVersion: "fixture", seed: 1 } as AnalysisResponse["report"] })).charts[0];

    const edited = await saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: makerEdit(chart), authorId: "a" });
    const community = await saveCommunityChart(ai.songId, { cloudChartId: "c".repeat(32), authorId: "b", title: "shared", difficulty: chart.difficulty,
      level: chart.level, platformProfile: chart.platformProfile!, chart: edited.chart });
    expect((await getChart(ai.id))?.chart.notes).toEqual(chart.notes);

    for (const copy of [edited, community]) {
      const stored = (await getChart(copy.id))!;
      expect(stored.chart.scoringVersion).toBe(2);
      expect(stored.chart.platformProfile).toBe(chart.platformProfile);
      expect(validatePlayability(stored.chart.notes, { difficulty: stored.difficulty, platformProfile: stored.chart.platformProfile }).errors).toBe(0);
      if (chart.platformProfile === "desktop") expect(stored.chart.notes.some((note) => note.type === "flick")).toBe(false);
      const { state, result } = autoplay(stored.chart);
      expect(state.finished).toBe(true);
      expect(state.failed).toBe(false);
      expect(state.judgementCounts.Miss).toBe(0);
      expect(state.totalJudged).toBe(stored.chart.notes.length);
      expect(result.accuracyPercent).toBe(100);
      // The added 0.5s Hold earns tick score on v2 scoring.
      expect(state.holdTickScore).toBeGreaterThan(0);
    }
  });
}
