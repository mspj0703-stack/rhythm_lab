import { describe, expect, it } from "vitest";
import {
  addNote, canRedo, canUndo, commit, createHistory, deleteNotes, fromChartNotes, moveNotes, redo, resizeHolds,
  setNoteLane, setNoteTime, setNoteType, toChartNotes, undo, HISTORY_LIMIT, MIN_HOLD_SEC, type EditorState,
} from "../maker/editorModel";
import { estimateBeatPhase, gridLines, gridStepSec, snapTime } from "../maker/snap";
import { notesEqual, summarizeEdit } from "../library/chartDiff";
import type { ChartNote } from "../types/chart";

const base: ChartNote[] = [
  { time: 1, lane: 0, type: "tap" },
  { time: 1.5, lane: 1, type: "hold", duration: 0.5 },
  { time: 2, lane: 3, type: "flick" },
];
const ids = (state: EditorState) => state.notes.map((note) => note.id);
const idOf = (state: EditorState, time: number, lane: number) => state.notes.find((note) => note.time === time && note.lane === lane)!.id;

describe("Maker editor model", () => {
  it("round-trips chart notes without changing them", () => {
    const state = fromChartNotes(base);
    expect(toChartNotes(state)).toEqual(base);
    expect(notesEqual(toChartNotes(state), base)).toBe(true);
  });

  it("adds a note sorted by time and refuses an exact duplicate", () => {
    const state = fromChartNotes(base);
    const { state: added, id } = addNote(state, { time: 1.25, lane: 2, type: "tap" });
    expect(id).not.toBeNull();
    expect(toChartNotes(added).map((note) => note.time)).toEqual([1, 1.25, 1.5, 2]);
    const again = addNote(added, { time: 1.25, lane: 2, type: "tap" });
    expect(again.id).toBeNull();
    expect(again.state).toBe(added);
    const hold = addNote(state, { time: 3, lane: 0, type: "hold", duration: 0.75 });
    expect(toChartNotes(hold.state).at(-1)).toEqual({ time: 3, lane: 0, type: "hold", duration: 0.75 });
  });

  it("deletes selected notes", () => {
    const state = fromChartNotes(base);
    const next = deleteNotes(state, new Set([idOf(state, 1, 0), idOf(state, 2, 3)]));
    expect(toChartNotes(next)).toEqual([base[1]]);
    expect(deleteNotes(state, new Set())).toBe(state);
  });

  it("moves notes in time and lane, keeping the selection inside 0..3 and >= 0s", () => {
    const state = fromChartNotes(base);
    const selection = new Set([idOf(state, 1, 0), idOf(state, 1.5, 1)]);
    const moved = moveNotes(state, selection, 0.25, 1);
    expect(toChartNotes(moved)).toEqual([
      { time: 1.25, lane: 1, type: "tap" },
      { time: 1.75, lane: 2, type: "hold", duration: 0.5 },
      base[2],
    ]);
    // Lane shift clamps to keep the shape: lane 3 flick cannot move right.
    expect(moveNotes(state, new Set([idOf(state, 2, 3)]), 0, 2)).toBe(state);
    const early = moveNotes(state, selection, -5, 0);
    expect(toChartNotes(early).slice(0, 2).map((note) => note.time)).toEqual([0, 0.5]);
  });

  it("changes lane and time of a single note", () => {
    const state = fromChartNotes(base);
    const id = idOf(state, 1, 0);
    expect(toChartNotes(setNoteLane(state, id, 2))[0]).toEqual({ time: 1, lane: 2, type: "tap" });
    expect(toChartNotes(setNoteTime(state, id, 2.75)).at(-1)).toEqual({ time: 2.75, lane: 0, type: "tap" });
  });

  it("converts Tap <-> Hold and blocks new Flick on desktop charts", () => {
    const state = fromChartNotes(base);
    const tap = new Set([idOf(state, 1, 0)]);
    const asHold = setNoteType(state, tap, "hold", 0.4, "mobile");
    expect(toChartNotes(asHold)[0]).toEqual({ time: 1, lane: 0, type: "hold", duration: 0.4 });
    const back = setNoteType(asHold, tap, "tap", 0.4, "mobile");
    expect(toChartNotes(back)[0]).toEqual({ time: 1, lane: 0, type: "tap" });
    expect(toChartNotes(setNoteType(state, tap, "flick", 0.4, "mobile"))[0].type).toBe("flick");
    expect(setNoteType(state, tap, "flick", 0.4, "desktop")).toBe(state);
    // Legacy charts keep the old Flick vocabulary.
    expect(toChartNotes(setNoteType(state, tap, "flick", 0.4, undefined))[0].type).toBe("flick");
  });

  it("resizes Holds with bounds and ignores non-Hold notes", () => {
    const state = fromChartNotes(base);
    const all = new Set(ids(state));
    const longer = resizeHolds(state, all, { delta: 0.25 });
    expect(toChartNotes(longer)[1]).toEqual({ time: 1.5, lane: 1, type: "hold", duration: 0.75 });
    expect(toChartNotes(longer)[0]).toEqual(base[0]);
    expect(toChartNotes(resizeHolds(state, all, { set: -3 }))[1]).toMatchObject({ duration: MIN_HOLD_SEC });
  });

  it("undo/redo covers add, delete, move, type change and Hold resize", () => {
    let history = createHistory(fromChartNotes(base));
    const steps: ((state: EditorState) => EditorState)[] = [
      (state) => addNote(state, { time: 3, lane: 2, type: "tap" }).state,
      (state) => deleteNotes(state, new Set([idOf(state, 1, 0)])),
      (state) => moveNotes(state, new Set([idOf(state, 2, 3)]), 0.5, -1),
      (state) => setNoteType(state, new Set([idOf(state, 3, 2)]), "hold", 0.5, "mobile"),
      (state) => resizeHolds(state, new Set([idOf(state, 3, 2)]), { set: 1 }),
    ];
    const snapshots = [toChartNotes(history.present)];
    for (const step of steps) { history = commit(history, step(history.present)); snapshots.push(toChartNotes(history.present)); }
    for (let i = snapshots.length - 2; i >= 0; i--) { history = undo(history); expect(toChartNotes(history.present)).toEqual(snapshots[i]); }
    expect(canUndo(history)).toBe(false);
    for (let i = 1; i < snapshots.length; i++) { history = redo(history); expect(toChartNotes(history.present)).toEqual(snapshots[i]); }
    expect(canRedo(history)).toBe(false);
    // A new edit after undo drops the redo branch.
    history = commit(undo(history), addNote(history.present, { time: 9, lane: 0, type: "tap" }).state);
    expect(canRedo(history)).toBe(false);
  });

  it("does not record no-op edits and caps history length", () => {
    let history = createHistory(fromChartNotes(base));
    history = commit(history, history.present);
    expect(canUndo(history)).toBe(false);
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) history = commit(history, addNote(history.present, { time: 10 + i, lane: 0, type: "tap" }).state);
    expect(history.past.length).toBe(HISTORY_LIMIT);
  });

  it("summarizes edits: a move is one removal and one addition, identical charts are not edits", () => {
    expect(summarizeEdit(base, base)).toEqual({ added: 0, removed: 0, unchanged: 3 });
    const moved = toChartNotes(moveNotes(fromChartNotes(base), new Set([1]), 0.25, 0));
    expect(summarizeEdit(base, moved)).toEqual({ added: 1, removed: 1, unchanged: 2 });
    // Sub-millisecond float noise is not an edit.
    expect(notesEqual(base, base.map((note) => ({ ...note, time: note.time + 0.0001 })))).toBe(true);
  });
});

describe("Maker snap grid", () => {
  const bpm = 120; // beat 0.5s, 1/16 = 0.125s
  const phase = 0.07;
  const times = Array.from({ length: 40 }, (_, i) => phase + i * 0.25);

  it("recovers the beat phase of the chart's notes", () => {
    expect(estimateBeatPhase(times, bpm)).toBeCloseTo(phase, 3);
  });

  it("snaps to 1/4, 1/8, 1/16 and 1/32 on the recovered grid; OFF keeps milliseconds", () => {
    const ctx = { bpm, noteTimes: times };
    expect(gridStepSec(bpm, 4)).toBeCloseTo(0.5);
    expect(gridStepSec(bpm, 32)).toBeCloseTo(0.0625);
    expect(snapTime(1.3, 4, ctx)).toBeCloseTo(1.07, 3);
    expect(snapTime(1.4, 4, ctx)).toBeCloseTo(1.57, 3);
    expect(snapTime(1.3, 8, ctx)).toBeCloseTo(1.32, 3);
    expect(snapTime(1.3, 16, ctx)).toBeCloseTo(1.32, 3);
    expect(snapTime(1.36, 32, ctx)).toBeCloseTo(1.3825, 3);
    expect(snapTime(1.23456, 0, ctx)).toBe(1.235);
    expect(snapTime(-1, 16, ctx)).toBeGreaterThanOrEqual(0);
  });

  it("follows local tempo drift instead of a single global phase", () => {
    const drifted = [...Array.from({ length: 20 }, (_, i) => i * 0.5), ...Array.from({ length: 20 }, (_, i) => 30.03 + i * 0.5)];
    const ctx = { bpm, noteTimes: drifted };
    expect(snapTime(1.01, 4, ctx)).toBeCloseTo(1, 3);
    expect(snapTime(35.0, 4, ctx)).toBeCloseTo(35.03, 3);
  });

  it("draws bar, beat and subdivision lines", () => {
    const lines = gridLines(0, 2.1, 8, { bpm, noteTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3] });
    expect(lines.map((line) => line.time)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(lines.filter((line) => line.strength !== "sub").map((line) => line.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(lines.filter((line) => line.strength === "bar").map((line) => line.time)).toEqual([0, 2]);
  });
});
